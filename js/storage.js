/**
 * storage.js — Camada de persistência do PrazoCerto (LocalStorage)
 * ----------------------------------------------------------------
 * Toda leitura/escrita no LocalStorage passa por este módulo.
 * Erros (modo anônimo, cota cheia, JSON corrompido) são tratados aqui,
 * e o app continua funcionando mesmo se o navegador bloquear o armazenamento.
 *
 * Chaves (todas com o prefixo "prazocerto:"):
 *   tema ........ 'light' | 'dark'
 *   tarefas ..... [{ id, titulo, materia, tipo, prioridade, prazo, estimativa,
 *                    descricao, subtarefas[], concluida, concluidaEm, criadaEm, focoMin }]
 *   materias .... [{ id, nome, cor }]
 *   sessoes ..... [{ id, inicio, minutos, materia, tarefaId }]  (ciclos Pomodoro)
 *   config ...... { nome, foco, curta, longa, som }
 *   timer ....... estado do Pomodoro (para continuar depois de recarregar)
 *   conquistas .. ids das conquistas já anunciadas + último nível
 *   avisos ...... { [idTarefa]: prazo } — prazos que já geraram notificação
 */

const Store = (() => {
  const PREFIX = 'prazocerto:';

  /* ---------- Funções base ---------- */
  function ler(chave, padrao) {
    try {
      const bruto = localStorage.getItem(PREFIX + chave);
      return bruto === null ? padrao : JSON.parse(bruto);
    } catch (erro) {
      console.warn('[PrazoCerto] Falha ao ler', chave, erro);
      return padrao;
    }
  }

  function gravar(chave, valor) {
    try {
      localStorage.setItem(PREFIX + chave, JSON.stringify(valor));
      return true;
    } catch (erro) {
      console.warn('[PrazoCerto] Falha ao salvar', chave, erro);
      return false;
    }
  }

  function apagar(chave) {
    try { localStorage.removeItem(PREFIX + chave); } catch (_) { /* ignora */ }
  }

  const novoId = prefixo => `${prefixo}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  /* ---------- Tarefas ---------- */
  /* Dados salvos por versões antigas ou estragados são descartados, para nunca travar o app */
  const ehObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const dataOk = v => v === '' || v == null || !isNaN(new Date(v));
  function getTarefas() {
    const lista = ler('tarefas', []);
    return Array.isArray(lista)
      ? lista.filter(t => ehObj(t) && typeof t.id === 'string' && typeof t.titulo === 'string' && dataOk(t.prazo))
        .map(t => ({ ...t, subtarefas: Array.isArray(t.subtarefas) ? t.subtarefas.filter(ehObj) : [] }))
      : [];
  }
  function salvarTarefas(lista) { return gravar('tarefas', lista); }
  function getTarefa(id) { return getTarefas().find(t => t.id === id) || null; }

  /** Cria ou atualiza uma tarefa. Devolve a tarefa salva. */
  function salvarTarefa(dados) {
    const lista = getTarefas();
    if (dados.id) {
      const i = lista.findIndex(t => t.id === dados.id);
      if (i >= 0) { lista[i] = { ...lista[i], ...dados }; salvarTarefas(lista); return lista[i]; }
    }
    const nova = {
      id: novoId('t'), concluida: false, concluidaEm: null, criadaEm: new Date().toISOString(),
      focoMin: 0, subtarefas: [], descricao: '', estimativa: 60, ...dados
    };
    nova.id = dados.id || nova.id;
    lista.unshift(nova);
    salvarTarefas(lista);
    return nova;
  }

  /** Remove e devolve a tarefa removida (para o "Desfazer"). */
  function removerTarefa(id) {
    const lista = getTarefas();
    const i = lista.findIndex(t => t.id === id);
    if (i < 0) return null;
    const [removida] = lista.splice(i, 1);
    salvarTarefas(lista);
    return { tarefa: removida, posicao: i };
  }

  function restaurarTarefa({ tarefa, posicao }) {
    const lista = getTarefas();
    lista.splice(Math.min(posicao, lista.length), 0, tarefa);
    salvarTarefas(lista);
  }

  function alternarConclusao(id) {
    const lista = getTarefas();
    const t = lista.find(x => x.id === id);
    if (!t) return null;
    t.concluida = !t.concluida;
    t.concluidaEm = t.concluida ? new Date().toISOString() : null;
    salvarTarefas(lista);
    return t;
  }

  function alternarSubtarefa(idTarefa, idSub) {
    const lista = getTarefas();
    const t = lista.find(x => x.id === idTarefa);
    const s = t && t.subtarefas.find(x => x.id === idSub);
    if (!s) return null;
    s.feita = !s.feita;
    salvarTarefas(lista);
    return t;
  }

  function adicionarFoco(idTarefa, minutos) {
    const lista = getTarefas();
    const t = lista.find(x => x.id === idTarefa);
    if (!t) return;
    t.focoMin = (t.focoMin || 0) + minutos;
    salvarTarefas(lista);
  }

  function limparConcluidas() {
    const lista = getTarefas();
    const restantes = lista.filter(t => !t.concluida);
    salvarTarefas(restantes);
    return lista.length - restantes.length;
  }

  /* ---------- Matérias ---------- */
  function getMaterias() {
    const m = ler('materias', null);
    const ok = Array.isArray(m) ? m.filter(x => ehObj(x) && typeof x.id === 'string' && typeof x.nome === 'string') : [];
    return ok.length ? ok : MATERIAS_PADRAO;
  }
  function salvarMaterias(lista) { return gravar('materias', lista); }

  function criarMateria(nome, cor) {
    const lista = getMaterias();
    const nova = { id: novoId('m'), nome: nome.trim().slice(0, 30), cor };
    lista.push(nova);
    salvarMaterias(lista);
    return nova;
  }

  /** Exclui a matéria e move as tarefas dela para "Pessoal" (ou a primeira matéria). */
  function excluirMateria(id) {
    const lista = getMaterias().filter(m => m.id !== id);
    if (!lista.length) return false;
    salvarMaterias(lista);
    const destino = (lista.find(m => m.id === 'm-pessoal') || lista[0]).id;
    salvarTarefas(getTarefas().map(t => (t.materia === id ? { ...t, materia: destino } : t)));
    return true;
  }

  /* ---------- Sessões de foco (Pomodoro) ---------- */
  function getSessoes() {
    const lista = ler('sessoes', []);
    return Array.isArray(lista) ? lista.filter(x => ehObj(x) && dataOk(x.inicio ?? x.data ?? x.quando ?? '')) : [];
  }
  function adicionarSessao(sessao) {
    const lista = [{ id: novoId('s'), ...sessao }, ...getSessoes()].slice(0, 500);
    gravar('sessoes', lista);
  }

  /* ---------- Configurações, tema, timer e conquistas ---------- */
  function getConfig() {
    const c = ler('config', {});
    const limpo = {};
    if (ehObj(c)) Object.keys(CONFIG_PADRAO).forEach(k => { if (typeof c[k] === typeof CONFIG_PADRAO[k]) limpo[k] = c[k]; });
    return { ...CONFIG_PADRAO, ...limpo };
  }
  function salvarConfig(parcial) { const c = { ...getConfig(), ...parcial }; gravar('config', c); return c; }

  function getTema() { return ler('tema', null); }
  function salvarTema(tema) { return gravar('tema', tema); }

  function getTimer() { const t = ler('timer', null); return ehObj(t) ? t : null; }
  function salvarTimer(estado) { return gravar('timer', estado); }

  function getConquistas() {
    const c = ler('conquistas', null);
    return ehObj(c) && Array.isArray(c.vistas) && typeof c.nivel === 'number' ? c : { vistas: [], nivel: 1 };
  }
  function salvarConquistas(dados) { return gravar('conquistas', dados); }

  /* ---------- Avisos de prazo (notificações) ---------- */
  function getAvisos() { const a = ler('avisos', {}); return ehObj(a) ? a : {}; }
  /** Marca que o prazo desta tarefa já foi avisado (se o prazo mudar, avisa de novo). */
  function marcarAvisado(idTarefa, prazo) { const a = getAvisos(); a[idTarefa] = prazo; gravar('avisos', a); }

  /* ---------- Dados de exemplo, backup e reset ---------- */
  function carregarExemplo() {
    const { tarefas, sessoes } = gerarExemplo();
    salvarTarefas(tarefas);
    gravar('sessoes', sessoes);
    salvarMaterias(MATERIAS_PADRAO);
  }

  function exportar() {
    return {
      app: 'PrazoCerto', versao: 1, exportadoEm: new Date().toISOString(),
      tarefas: getTarefas(), materias: getMaterias(), sessoes: getSessoes(), config: getConfig()
    };
  }

  function importar(dados) {
    if (!dados || dados.app !== 'PrazoCerto' || !Array.isArray(dados.tarefas)) throw new Error('Backup inválido');
    salvarTarefas(dados.tarefas);
    if (Array.isArray(dados.materias) && dados.materias.length) salvarMaterias(dados.materias);
    if (Array.isArray(dados.sessoes)) gravar('sessoes', dados.sessoes);
    if (dados.config) salvarConfig(dados.config);
  }

  function apagarTudo() {
    ['tarefas', 'materias', 'sessoes', 'config', 'timer', 'conquistas', 'avisos'].forEach(apagar);
  }

  return {
    getTarefas, getTarefa, salvarTarefa, removerTarefa, restaurarTarefa, alternarConclusao,
    alternarSubtarefa, adicionarFoco, limparConcluidas,
    getMaterias, criarMateria, excluirMateria,
    getSessoes, adicionarSessao,
    getConfig, salvarConfig, getTema, salvarTema, getTimer, salvarTimer,
    getConquistas, salvarConquistas, getAvisos, marcarAvisado,
    carregarExemplo, exportar, importar, apagarTudo
  };
})();
