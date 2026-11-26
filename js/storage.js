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
 *   config ...... { nome, foco, curta, longa, som, toque, repetir, volume, vibrar, aviso, lembretesPadrao, atalhos }
 *   timer ....... estado do Pomodoro (para continuar depois de recarregar)
 *   conquistas .. ids das conquistas já anunciadas + último nível
 *   aulas ....... [{ id, materia, dia (0=dom … 6=sáb), inicio 'HH:MM', fim 'HH:MM', local }]
 *   resumo ...... 'AAAA-MM-DD' — último dia em que o resumo do dia apareceu
 *   avisos ...... { ['idTarefa|minutos']: prazo } — lembretes que já foram avisados
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

  /* Sincronização com a nuvem: quem quiser é avisado quando um dado sincronizado muda */
  const SINCRONIZADAS = ['tarefas', 'materias', 'sessoes', 'aulas', 'conquistas', 'config', 'estudo'];
  const ouvintes = [];
  let silencio = false; // true enquanto aplica dados que vieram da nuvem (não reenviar)

  function gravar(chave, valor) {
    try {
      localStorage.setItem(PREFIX + chave, JSON.stringify(valor));
      if (!silencio && SINCRONIZADAS.includes(chave)) ouvintes.forEach(fn => { try { fn(chave); } catch (_) { /* ouvinte com erro não atrapalha */ } });
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
  const lembretesValidos = lista => [...new Set(lista.map(Number))].filter(m => LEMBRETES.some(l => l.min === m)).sort((a, b) => b - a);
  const dataOk = v => v === '' || v == null || !isNaN(new Date(v));
  function getTarefas() {
    const lista = ler('tarefas', []);
    return Array.isArray(lista)
      ? lista.filter(t => ehObj(t) && typeof t.id === 'string' && typeof t.titulo === 'string' && dataOk(t.prazo))
        .map(t => {
          const limpa = { ...t, subtarefas: Array.isArray(t.subtarefas) ? t.subtarefas.filter(ehObj) : [] };
          // lembretes: lista de minutos válidos; sem a lista, a tarefa usa os lembretes padrão
          if (Array.isArray(t.lembretes)) limpa.lembretes = lembretesValidos(t.lembretes);
          else delete limpa.lembretes;
          if (!REPETICOES.some(r => r.id && r.id === t.repetir)) delete limpa.repetir;
          return limpa;
        })
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
    // lembretes padrão: versões antigas tinham só uma antecedência (avisoMin)
    if (Array.isArray(limpo.lembretesPadrao)) limpo.lembretesPadrao = lembretesValidos(limpo.lembretesPadrao);
    else { delete limpo.lembretesPadrao; if (typeof limpo.avisoMin === 'number') limpo.lembretesPadrao = lembretesValidos([limpo.avisoMin]); }
    if (limpo.toque && !TOQUES.some(t => t.id === limpo.toque)) delete limpo.toque;
    if ('repetir' in limpo && ![0, 1, 3, 5].includes(limpo.repetir)) delete limpo.repetir;
    if ('volume' in limpo) limpo.volume = Math.min(100, Math.max(0, limpo.volume || 0));
    ['estudoInicio', 'estudoFim'].forEach(k => { if (k in limpo && !horaOk(limpo[k])) delete limpo[k]; });
    ['semestreInicio', 'semestreFim'].forEach(k => { if (k in limpo && limpo[k] !== '' && !diaOk(limpo[k])) delete limpo[k]; });
    if ('mediaAprovacao' in limpo && !numOk(limpo.mediaAprovacao, 0, 10)) delete limpo.mediaAprovacao;
    if ('metaFocoMin' in limpo && !numOk(limpo.metaFocoMin, 0, 10000)) delete limpo.metaFocoMin;
    if ('metaTarefas' in limpo && !numOk(limpo.metaTarefas, 0, 500)) delete limpo.metaTarefas;
    if ('somFundo' in limpo && !SONS_FUNDO.some(x => x.id === limpo.somFundo)) delete limpo.somFundo;
    if ('volumeFundo' in limpo) limpo.volumeFundo = Math.min(100, Math.max(0, limpo.volumeFundo || 0));
    if (limpo.estudoInicio && limpo.estudoFim && limpo.estudoInicio >= limpo.estudoFim) { delete limpo.estudoInicio; delete limpo.estudoFim; }
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
  function marcarAvisado(chave, prazo) { const a = getAvisos(); a[chave] = prazo; gravar('avisos', a); }
  /** Esquece lembretes de tarefas que não existem mais (a lista não cresce para sempre). */
  function limparAvisos() {
    const ids = new Set(getTarefas().map(t => t.id));
    const a = getAvisos();
    const limpo = Object.fromEntries(Object.entries(a).filter(([k]) => ids.has(k.split('|')[0])));
    if (Object.keys(limpo).length !== Object.keys(a).length) gravar('avisos', limpo);
  }

  /* ---------- Dados de exemplo, backup e reset ---------- */
  /* ---------- Horário das aulas ---------- */
  const horaOk = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  function getAulas() {
    const lista = ler('aulas', []);
    return Array.isArray(lista)
      ? lista.filter(a => ehObj(a) && typeof a.id === 'string' && typeof a.materia === 'string' &&
          Number.isInteger(a.dia) && a.dia >= 0 && a.dia <= 6 && horaOk(a.inicio) && horaOk(a.fim) && a.inicio < a.fim)
        .map(a => ({ ...a, local: typeof a.local === 'string' ? a.local.slice(0, 30) : '' }))
        .sort((a, b) => a.dia - b.dia || a.inicio.localeCompare(b.inicio))
      : [];
  }
  function salvarAula(dados) {
    const lista = getAulas();
    if (dados.id) {
      const i = lista.findIndex(a => a.id === dados.id);
      if (i >= 0) { lista[i] = { ...lista[i], ...dados }; gravar('aulas', lista); return lista[i]; }
    }
    const nova = { ...dados, id: novoId('a') };
    lista.push(nova);
    gravar('aulas', lista);
    return nova;
  }
  function removerAula(id) { gravar('aulas', getAulas().filter(a => a.id !== id)); }

  /* ---------- Estudo por matéria: notas, faltas, anotações e flashcards ----------
     { [idMateria]: { avaliacoes:[{id,nome,peso,nota|null}], faltas:['AAAA-MM-DD'], limiteFaltas:null|n,
                      media:null|n, anotacoes:'', flashcards:[{id,frente,verso,caixa,proxima,acertos,erros}] } } */
  const diaOk = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const numOk = (v, min, max) => typeof v === 'number' && isFinite(v) && v >= min && v <= max;
  function limparEstudo(e) {
    const txt = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
    return {
      avaliacoes: (Array.isArray(e.avaliacoes) ? e.avaliacoes : []).filter(a => ehObj(a) && typeof a.id === 'string')
        .map(a => ({ id: a.id, nome: txt(a.nome, 40) || 'Avaliação', peso: numOk(a.peso, 0.1, 100) ? a.peso : 1, nota: numOk(a.nota, 0, 10) ? a.nota : null })).slice(0, 30),
      faltas: (Array.isArray(e.faltas) ? e.faltas : []).filter(diaOk).sort(),
      limiteFaltas: numOk(e.limiteFaltas, 0, 999) ? Math.round(e.limiteFaltas) : null,
      media: numOk(e.media, 0, 10) ? e.media : null,
      anotacoes: txt(e.anotacoes, 20000),
      flashcards: (Array.isArray(e.flashcards) ? e.flashcards : []).filter(c => ehObj(c) && typeof c.id === 'string' && typeof c.frente === 'string')
        .map(c => ({ id: c.id, frente: txt(c.frente, 300), verso: txt(c.verso, 600), caixa: numOk(c.caixa, 1, 5) ? Math.round(c.caixa) : 1,
          proxima: diaOk(c.proxima) ? c.proxima : '', acertos: numOk(c.acertos, 0, 1e6) ? c.acertos : 0, erros: numOk(c.erros, 0, 1e6) ? c.erros : 0 })).slice(0, 1000)
    };
  }
  function getEstudoTudo() {
    const e = ler('estudo', {});
    return ehObj(e) ? Object.fromEntries(Object.entries(e).filter(([, v]) => ehObj(v)).map(([k, v]) => [k, limparEstudo(v)])) : {};
  }
  function getEstudo(idMateria) { return getEstudoTudo()[idMateria] || limparEstudo({}); }
  /** Atualiza o estudo de uma matéria: recebe uma função que altera o objeto. */
  function alterarEstudo(idMateria, fn) {
    const tudo = getEstudoTudo();
    const atual = tudo[idMateria] || limparEstudo({});
    fn(atual);
    tudo[idMateria] = limparEstudo(atual);
    gravar('estudo', tudo);
    return tudo[idMateria];
  }

  /* ---------- Relatório da semana (semana em que foi mostrado) ---------- */
  function getRelatorioVisto() { const v = ler('relatorio', ''); return typeof v === 'string' ? v : ''; }
  function marcarRelatorioVisto(semana) { gravar('relatorio', semana); }

  /* ---------- Resumo do dia (data em que foi mostrado pela última vez) ---------- */
  function getResumoVisto() { const v = ler('resumo', ''); return typeof v === 'string' ? v : ''; }
  function marcarResumoVisto(dia) { gravar('resumo', dia); }

  function carregarExemplo() {
    const { tarefas, sessoes, aulas, estudo } = gerarExemplo();
    gravar('estudo', estudo);
    salvarTarefas(tarefas);
    gravar('sessoes', sessoes);
    gravar('aulas', aulas);
    salvarMaterias(MATERIAS_PADRAO);
  }

  function exportar() {
    return {
      app: 'PrazoCerto', versao: 1, exportadoEm: new Date().toISOString(),
      tarefas: getTarefas(), materias: getMaterias(), sessoes: getSessoes(), aulas: getAulas(), estudo: getEstudoTudo(), config: getConfig()
    };
  }

  function importar(dados) {
    if (!dados || dados.app !== 'PrazoCerto' || !Array.isArray(dados.tarefas)) throw new Error('Backup inválido');
    salvarTarefas(dados.tarefas);
    if (Array.isArray(dados.materias) && dados.materias.length) salvarMaterias(dados.materias);
    if (Array.isArray(dados.aulas)) gravar('aulas', dados.aulas);
    if (ehObj(dados.estudo)) gravar('estudo', dados.estudo);
    if (Array.isArray(dados.sessoes)) gravar('sessoes', dados.sessoes);
    if (dados.config) salvarConfig(dados.config);
  }

  function apagarTudo() {
    ['tarefas', 'materias', 'sessoes', 'aulas', 'estudo', 'config', 'timer', 'conquistas', 'avisos', 'resumo', 'relatorio'].forEach(apagar);
  }

  /* ---------- Nuvem: foto dos dados e aplicação dos dados recebidos ---------- */
  // só as preferências que fazem sentido em todos os aparelhos (som e avisos ficam por aparelho)
  const CONFIG_NUVEM = ['nome', 'foco', 'curta', 'longa', 'lembretesPadrao', 'resumoDiario', 'estudoInicio', 'estudoFim', 'atalhos',
    'relatorioSemanal', 'semestreInicio', 'semestreFim', 'mediaAprovacao', 'metaFocoMin', 'metaTarefas'];
  function aoMudar(fn) { ouvintes.push(fn); }
  function instantaneo() {
    const c = getConfig();
    return {
      tarefas: getTarefas(), materias: getMaterias(), sessoes: getSessoes(), aulas: getAulas(), estudo: getEstudoTudo(),
      conquistas: getConquistas(), config: Object.fromEntries(CONFIG_NUVEM.map(k => [k, c[k]]))
    };
  }
  function aplicarInstantaneo(d) {
    if (!ehObj(d)) return;
    silencio = true;
    try {
      ['tarefas', 'materias', 'sessoes', 'aulas'].forEach(k => { if (Array.isArray(d[k])) gravar(k, d[k]); });
      if (ehObj(d.conquistas)) gravar('conquistas', d.conquistas);
      if (ehObj(d.estudo)) gravar('estudo', d.estudo);
      if (ehObj(d.config)) {
        const recebida = Object.fromEntries(CONFIG_NUVEM.filter(k => k in d.config).map(k => [k, d.config[k]]));
        gravar('config', { ...getConfig(), ...recebida });
      }
    } finally {
      silencio = false;
    }
  }

  return {
    aoMudar, instantaneo, aplicarInstantaneo,
    getTarefas, getTarefa, salvarTarefa, removerTarefa, restaurarTarefa, alternarConclusao,
    alternarSubtarefa, adicionarFoco, limparConcluidas,
    getMaterias, criarMateria, excluirMateria,
    getSessoes, adicionarSessao,
    getConfig, salvarConfig, getTema, salvarTema, getTimer, salvarTimer,
    getConquistas, salvarConquistas, getAvisos, marcarAvisado, limparAvisos,
    getAulas, salvarAula, removerAula, getResumoVisto, marcarResumoVisto,
    getEstudoTudo, getEstudo, alterarEstudo, getRelatorioVisto, marcarRelatorioVisto,
    carregarExemplo, exportar, importar, apagarTudo
  };
})();
