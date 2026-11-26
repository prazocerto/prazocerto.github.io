/**
 * app.js — Lógica principal do PrazoCerto
 * ----------------------------------------------------------------
 * Depende de: data.js (dados fixos) e storage.js (LocalStorage).
 *
 *   1. Utilidades (DOM, datas, formatação)
 *   2. Estado da aplicação
 *   3. Regras de prazo e urgência
 *   4. Gamificação (XP, nível, sequência, conquistas)
 *   5. Componentes (item de tarefa, toasts, confirmação, confete)
 *   6. Tarefas: criar, editar, concluir, excluir + tarefa rápida
 *   7. Telas: Hoje · Tarefas · Agenda · Foco · Progresso
 *   8. Configurações, matérias, backup e tema
 *   8.1 Avisos de prazo (notificações do navegador)
 *   9. Navegação, atalhos e eventos
 *  10. Inicialização
 */

/* ================================================================
   1. UTILIDADES
   ================================================================ */
const $ = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];

const esc = texto => String(texto ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const normalizar = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pad = n => String(n).padStart(2, '0');
const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/** Date → "2026-11-18" (data local, sem fuso) */
const dataISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Date → "2026-11-18T23:59" (formato do <input type="datetime-local">) */
const paraInput = d => `${dataISO(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const inicioDia = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const diffDias = (a, b) => Math.round((inicioDia(a) - inicioDia(b)) / 86400000);
const somarDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const maiuscula = s => s.charAt(0).toUpperCase() + s.slice(1);
const hora = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dataCurta = d => `${DIAS_CURTOS[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;

function formatarMin(min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m}min`;
  return m ? `${h}h${pad(m)}` : `${h}h`;
}

const infoPrioridade = id => PRIORIDADES.find(p => p.id === id) || PRIORIDADES[1];
const infoTipo = id => TIPOS.find(t => t.id === id) || TIPOS[TIPOS.length - 1];
const infoMateria = id => Store.getMaterias().find(m => m.id === id) || { id: '', nome: 'Sem matéria', cor: '#64748b' };

/* ================================================================
   2. ESTADO DA APLICAÇÃO
   ================================================================ */
const estado = {
  view: 'hoje',
  mesAgenda: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  diaSelecionado: dataISO(new Date()),
  subtarefasEdicao: [],   // checklist enquanto o modal de tarefa está aberto
  ultimoFoco: null
};

/* ================================================================
   3. REGRAS DE PRAZO E URGÊNCIA
   ----------------------------------------------------------------
   atrasada  → o prazo já passou
   urgente   → vence em menos de 24 horas
   proxima   → vence em até 3 dias
   ok        → mais de 3 dias (ou sem prazo)
   ================================================================ */
function infoPrazo(t, agora = new Date()) {
  if (!t.prazo) return { grupo: 'sem', urgencia: 'ok', texto: 'Sem prazo' };
  const p = new Date(t.prazo);
  const ms = p - agora;
  const dias = diffDias(p, agora);
  const horas = Math.floor(Math.abs(ms) / 3600000);

  if (t.concluida) {
    const quando = new Date(t.concluidaEm);
    return { grupo: 'feita', urgencia: 'ok', texto: quando <= p ? '✅ Entregue no prazo' : '☑️ Entregue com atraso' };
  }
  if (ms < 0) {
    const atras = dias === 0 ? `há ${Math.max(1, horas)}h` : `há ${Math.abs(dias)} dia${Math.abs(dias) > 1 ? 's' : ''}`;
    return { grupo: 'atrasadas', urgencia: 'atrasada', texto: `⚠️ Atrasada ${atras}` };
  }
  const urgencia = ms < 86400000 ? 'urgente' : ms < 3 * 86400000 ? 'proxima' : 'ok';
  if (dias === 0) return { grupo: 'hoje', urgencia, texto: `⏰ Hoje às ${hora(p)} · faltam ${horas ? `${horas}h` : `${Math.ceil(ms / 60000)}min`}` };
  if (dias === 1) return { grupo: 'amanha', urgencia, texto: `⏰ Amanhã às ${hora(p)}` };
  return { grupo: dias <= 7 ? 'semana' : 'depois', urgencia, texto: `⏰ ${dataCurta(p)} às ${hora(p)} · em ${dias} dias` };
}

const GRUPOS = [
  { id: 'atrasadas', titulo: '⚠️ Atrasadas' },
  { id: 'hoje',      titulo: '📌 Hoje' },
  { id: 'amanha',    titulo: '🌤️ Amanhã' },
  { id: 'semana',    titulo: '📆 Próximos 7 dias' },
  { id: 'depois',    titulo: '🗓️ Mais para frente' },
  { id: 'sem',       titulo: '💭 Sem prazo' },
  { id: 'feita',     titulo: '✅ Concluídas' }
];

/** Ordena por prazo (sem prazo por último) e, no empate, por prioridade. */
function compararPrazo(a, b) {
  const pa = a.prazo ? new Date(a.prazo).getTime() : Infinity;
  const pb = b.prazo ? new Date(b.prazo).getTime() : Infinity;
  return pa - pb || infoPrioridade(b.prioridade).peso - infoPrioridade(a.prioridade).peso;
}

/* ================================================================
   4. GAMIFICAÇÃO
   ----------------------------------------------------------------
   XP: tarefa concluída = 10 · no prazo = +5 · prioridade alta = +5
       ciclo Pomodoro = 5. Cada nível precisa de 100 XP.
   ================================================================ */
function calcularStats() {
  const tarefas = Store.getTarefas();
  const sessoes = Store.getSessoes();
  const concluidas = tarefas.filter(t => t.concluida);
  const noPrazo = concluidas.filter(t => !t.prazo || new Date(t.concluidaEm) <= new Date(t.prazo));
  const agora = new Date();

  const xp = concluidas.reduce((s, t) => s + 10
    + (noPrazo.includes(t) ? 5 : 0) + (t.prioridade === 'alta' ? 5 : 0), 0) + sessoes.length * 5;

  // Sequência: dias seguidos (até hoje ou ontem) com ao menos uma tarefa concluída
  const diasComConclusao = new Set(concluidas.map(t => dataISO(new Date(t.concluidaEm))));
  let sequencia = 0;
  let dia = diasComConclusao.has(dataISO(agora)) ? agora : somarDias(agora, -1);
  while (diasComConclusao.has(dataISO(dia))) { sequencia++; dia = somarDias(dia, -1); }

  const porDia = {};
  sessoes.forEach(s => { const k = dataISO(new Date(s.inicio)); porDia[k] = (porDia[k] || 0) + 1; });

  return {
    total: tarefas.length,
    pendentes: tarefas.filter(t => !t.concluida).length,
    atrasadas: tarefas.filter(t => !t.concluida && t.prazo && new Date(t.prazo) < agora).length,
    concluidas: concluidas.length,
    noPrazo: noPrazo.length,
    pontualidade: concluidas.length ? Math.round((noPrazo.filter(t => t.prazo).length / Math.max(1, concluidas.filter(t => t.prazo).length)) * 100) : 0,
    altasConcluidas: concluidas.filter(t => t.prioridade === 'alta').length,
    antesDas9: concluidas.filter(t => new Date(t.concluidaEm).getHours() < 9).length,
    pomodoros: sessoes.length,
    minutosFoco: sessoes.reduce((s, x) => s + x.minutos, 0),
    maxPomodorosDia: Math.max(0, ...Object.values(porDia)),
    sequencia,
    metasBatidas: contarMetasBatidas(sessoes, concluidas),
    acertosCartas: Object.values(Store.getEstudoTudo()).reduce((t, e) => t + e.flashcards.reduce((u, c) => u + c.acertos, 0), 0),
    materiasComNotas: Object.values(Store.getEstudoTudo()).filter(e => e.avaliacoes.length).length,
    xp,
    nivel: Math.floor(xp / 100) + 1,
    xpNoNivel: xp % 100
  };
}

const TITULOS_NIVEL = ['Calouro', 'Calouro', 'Organizado', 'Focado', 'Produtivo', 'Mestre do tempo', 'Lenda do campus'];
const tituloNivel = n => TITULOS_NIVEL[Math.min(n, TITULOS_NIVEL.length - 1)];

/** Compara com o que já foi anunciado e comemora conquistas/níveis novos. */
function verificarConquistas({ silencioso = false } = {}) {
  const s = calcularStats();
  const salvo = Store.getConquistas();
  const ganhas = CONQUISTAS.filter(c => c.teste(s)).map(c => c.id);
  const novas = ganhas.filter(id => !salvo.vistas.includes(id));

  if (!silencioso) {
    if (s.nivel > salvo.nivel) {
      toast(`🎉 Subiu para o nível ${s.nivel} — ${tituloNivel(s.nivel)}!`, { tipo: 'conquista' });
      confete();
    }
    novas.forEach((id, i) => {
      const c = CONQUISTAS.find(x => x.id === id);
      setTimeout(() => toast(`🏆 Conquista: ${c.emoji} ${c.nome}`, { tipo: 'conquista', acao: 'Ver', aoClicar: () => irPara('progresso') }), 400 * (i + 1));
    });
    if (novas.length && s.nivel <= salvo.nivel) confete();
  }
  // guarda o maior nível já alcançado para não comemorar o mesmo nível duas vezes
  Store.salvarConquistas({ vistas: [...new Set([...salvo.vistas, ...ganhas])], nivel: Math.max(s.nivel, salvo.nivel) });
}

/* ================================================================
   5. COMPONENTES
   ================================================================ */

/** HTML de uma tarefa. opcoes.mostrarSubs exibe o checklist clicável. */
/* Lido uma vez por renderização (evita ler o LocalStorage em cada cartão) */
let cacheAvisos = { em: 0, valor: false };
function avisosLigados() {
  if (Date.now() - cacheAvisos.em > 500) cacheAvisos = { em: Date.now(), valor: Store.getConfig().aviso };
  return cacheAvisos.valor;
}

function tarefaHTML(t, { indice = 0, mostrarSubs = false } = {}) {
  const p = infoPrazo(t);
  const prio = infoPrioridade(t.prioridade);
  const tipo = infoTipo(t.tipo);
  const mat = infoMateria(t.materia);
  const subs = t.subtarefas || [];
  const feitas = subs.filter(s => s.feita).length;
  const lembr = !t.concluida && t.prazo && avisosLigados() ? lembretesDe(t) : [];

  return `
    <li class="tarefa prio-${t.prioridade} urg-${t.concluida ? 'ok' : p.urgencia} ${t.concluida ? 'is-done' : ''}" style="--i:${Math.min(indice, 12)}" data-tarefa="${t.id}">
      <button type="button" class="check" data-acao="concluir" data-id="${t.id}" aria-pressed="${t.concluida}"
        aria-label="Concluída: ${esc(t.titulo)}">✓</button>
      <div class="tarefa__main">
        <div class="tarefa__top">
          <span class="materia-tag" style="--cor:${mat.cor}">${esc(mat.nome)}</span>
          <span class="tipo">${tipo.emoji} ${esc(tipo.label)}</span>
          <span class="prio" style="--c:${prio.cor}">${prio.label}</span>
          ${t.grupoId ? `<span class="grupo-tag" title="Trabalho em grupo: ${esc((t.grupoMembros || []).map(m => m.nome).join(', '))}">👥 ${(t.grupoMembros || []).length || ''}</span>` : ''}
          ${t.repetir ? `<span class="repete-tag" title="Repete: ${esc(infoRepeticao(t.repetir).label)}">🔁 ${esc(infoRepeticao(t.repetir).curto)}</span>` : ''}
        </div>
        <h3><button type="button" class="tarefa__titulo" data-acao="editar" data-id="${t.id}">${esc(t.titulo)}</button></h3>
        <div class="tarefa__meta">
          <span class="prazo urg-${t.concluida ? 'ok' : p.urgencia}">${p.texto}</span>
          <span>⏱ ${formatarMin(t.estimativa || 60)}</span>
          ${t.focoMin ? `<span>🍅 ${formatarMin(t.focoMin)} de foco</span>` : ''}
          ${subs.length ? `<span>☑️ ${feitas}/${subs.length} etapas</span>` : ''}
          ${lembr.length ? `<span class="lembrete-tag" title="Lembretes: ${listaLembretes(lembr)}">🔔 ${lembr.map(m => ROTULO_CURTO[m]).join(' · ')}</span>` : ''}
        </div>
        ${subs.length && !mostrarSubs ? `<div class="progresso-sub" role="progressbar" aria-label="Etapas concluídas" aria-valuenow="${feitas}" aria-valuemin="0" aria-valuemax="${subs.length}"><span style="width:${(feitas / subs.length) * 100}%"></span></div>` : ''}
        ${subs.length && mostrarSubs ? `<ul class="subs-inline">${subs.map(s => `
          <li><label><input type="checkbox" data-acao="sub" data-id="${t.id}" data-sub="${s.id}" ${s.feita ? 'checked' : ''}>
          <span class="${s.feita ? 'feita' : ''}">${esc(s.texto)}</span></label>${s.responsavelNome ? ` <small class="resp-tag">👤 ${esc(s.responsavelNome.split(' ')[0])}</small>` : ''}</li>`).join('')}</ul>` : ''}
      </div>
      <div class="tarefa__acoes">
        ${!t.concluida ? `<button type="button" class="acao-mini" data-acao="focar" data-id="${t.id}" aria-label="Focar nesta tarefa" title="Focar (Pomodoro)">🍅</button>` : ''}
        <button type="button" class="acao-mini" data-acao="editar" data-id="${t.id}" aria-label="Editar ${esc(t.titulo)}" title="Editar">✏️</button>
        <button type="button" class="acao-mini" data-acao="excluir" data-id="${t.id}" aria-label="Excluir ${esc(t.titulo)}" title="Excluir">🗑️</button>
      </div>
    </li>`;
}

function vazioHTML(emoji, titulo, texto, botoes = '') {
  return `<div class="vazio"><span class="vazio__emoji" aria-hidden="true">${emoji}</span><h2>${titulo}</h2><p>${texto}</p>${botoes ? `<div class="botoes-linha">${botoes}</div>` : ''}</div>`;
}

const BOTOES_VAZIO = `<button type="button" class="btn btn--primary" data-acao="nova-tarefa">＋ Criar tarefa</button>
  <button type="button" class="btn btn--ghost" data-acao="exemplo">🧪 Ver com dados de exemplo</button>`;

/* Com uma janela (dialog) aberta, o resto da página não recebe cliques: os avisos
   vão para dentro da janela aberta, para "Desfazer"/"Atualizar" continuarem clicáveis. */
function posicionarAvisos() {
  const area = $('#toasts');
  if (!area) return;
  const janela = $$('dialog[open]').pop();
  const destino = janela || document.body;
  if (area.parentElement !== destino) destino.appendChild(area);
}

function toast(mensagem, { tipo = 'info', acao = null, aoClicar = null, duracao = 3500 } = {}) {
  posicionarAvisos();
  const area = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${tipo === 'erro' ? 'toast--erro' : tipo === 'conquista' ? 'toast--conquista' : ''}`;
  el.innerHTML = `<span class="toast__msg">${esc(mensagem)}</span>${acao ? `<button type="button" class="toast__acao">${esc(acao)}</button>` : ''}`;
  area.appendChild(el);
  while (area.children.length > 3) area.firstElementChild.remove();
  if (tipo === 'erro') el.setAttribute('role', 'alert'); // erros são anunciados na hora pelo leitor de tela
  const fechar = () => { el.classList.add('saindo'); setTimeout(() => el.remove(), 250); };
  // O tempo para no mouse ou no foco do teclado, para dar tempo de ler e clicar em "Desfazer" (WCAG 2.2.1)
  const tempo = acao ? duracao + 2500 : duracao;
  let timer = setTimeout(fechar, tempo);
  const pausar = () => clearTimeout(timer);
  const retomar = () => { clearTimeout(timer); timer = setTimeout(fechar, 2500); };
  // pausa só quando o mouse se mexe sobre a notificação (se ela surgir sob um mouse parado, segue o tempo normal)
  el.addEventListener('pointermove', pausar);
  el.addEventListener('mouseleave', retomar);
  el.addEventListener('focusin', pausar);
  el.addEventListener('focusout', retomar);
  if (acao) $('.toast__acao', el).addEventListener('click', () => { clearTimeout(timer); fechar(); aoClicar && aoClicar(); });
}

function confete() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const area = $('#confete');
  const cores = ['#4f46e5', '#0891b2', '#f59e0b', '#ef4444', '#22c55e', '#ec4899'];
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = cores[i % cores.length];
    p.style.setProperty('--dx', `${(Math.random() - .5) * 200}px`);
    p.style.setProperty('--rot', `${Math.random() * 720}deg`);
    p.style.animationDelay = `${Math.random() * .3}s`;
    p.style.animationDuration = `${1.1 + Math.random() * .8}s`;
    area.appendChild(p);
  }
  setTimeout(() => { area.innerHTML = ''; }, 2400);
}

function abrirModal(id) {
  const dlg = document.getElementById(id);
  if (dlg.open) return;
  if (!$('dialog[open]')) estado.ultimoFoco = document.activeElement; // lembra quem abriu o primeiro modal
  dlg.showModal();
  if (alarme.ativo) posicionarBarraAlarme();
  posicionarAvisos();
}
const fecharModal = dlg => { if (dlg && dlg.open) dlg.close(); };

/** Confirmação para ações destrutivas. Retorna Promise<boolean>. */
function confirmar(titulo, texto, rotuloSim = 'Confirmar') {
  return new Promise(resolve => {
    const dlg = $('#dlg-confirmar');
    $('#confirmar-titulo').textContent = titulo;
    $('#confirmar-texto').textContent = texto;
    $('#confirmar-sim').textContent = rotuloSim;
    const fim = v => {
      $('#confirmar-sim').onclick = $('#confirmar-nao').onclick = dlg.onclose = null;
      fecharModal(dlg);
      resolve(v);
    };
    $('#confirmar-sim').onclick = () => fim(true);
    $('#confirmar-nao').onclick = () => fim(false);
    dlg.onclose = () => fim(false);
    abrirModal('dlg-confirmar');
    $('#confirmar-nao').focus();
  });
}

/* ================================================================
   6. TAREFAS: CRIAR, EDITAR, CONCLUIR, EXCLUIR
   ================================================================ */
function montarCamposFixos() {
  $('#t-tipo').innerHTML = TIPOS.map(t => `<option value="${t.id}">${t.emoji} ${esc(t.label)}</option>`).join('');
  $('#t-prioridades').innerHTML = PRIORIDADES.map(p => `
    <label class="prio-opt" style="--c:${p.cor}"><input type="radio" name="prioridade" value="${p.id}"><span>${p.emoji} ${p.label}</span></label>`).join('');
  $('#t-lembretes').innerHTML = chipsLembrete('lembrete');
  $('#t-repetir').innerHTML = REPETICOES.map(r => `<option value="${r.id}">${r.id ? '🔁 ' : ''}${r.label}</option>`).join('');
  $('#a-dias').innerHTML = ORDEM_SEMANA.map(d => `<label class="chip-check"><input type="checkbox" name="aula-dia" value="${d}"><span>${DIAS_SEMANA[d].slice(0, 3)}</span></label>`).join('');
  $('#cfg-lembretes').innerHTML = chipsLembrete('lembrete-padrao');
  $('#cfg-toque').innerHTML = TOQUES.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
  $('#filtro-prioridade').insertAdjacentHTML('beforeend', PRIORIDADES.map(p => `<option value="${p.id}">${p.emoji} ${p.label}</option>`).join(''));
}

/** Atualiza todos os <select> de matérias (formulário e filtro). */
function montarSelectMaterias() {
  const materias = Store.getMaterias();
  const opcoes = materias.map(m => `<option value="${m.id}">${esc(m.nome)}</option>`).join('');
  const filtro = $('#filtro-materia');
  const atual = filtro.value;
  filtro.innerHTML = `<option value="">Todas as matérias</option>${opcoes}`;
  filtro.value = materias.some(m => m.id === atual) ? atual : '';
  $('#t-materia').innerHTML = opcoes;
  $('#a-materia').innerHTML = opcoes;
}

/** Abre o modal de tarefa. dados = tarefa existente (editar) ou valores iniciais (nova). */
function abrirFormTarefa(dados = {}) {
  const editando = !!dados.id;
  $('#tarefa-titulo-modal').textContent = editando ? '✏️ Editar tarefa' : '＋ Nova tarefa';
  $('#t-id').value = dados.id || '';
  $('#t-titulo').value = dados.titulo || '';
  $('#t-materia').value = dados.materia || Store.getMaterias()[0].id;
  $('#t-tipo').value = dados.tipo || 'trabalho';
  $$('input[name="prioridade"]').forEach(r => { r.checked = r.value === (dados.prioridade || 'media'); });
  $('#t-prazo').value = dados.prazo ?? paraInput(prazoPadrao(1));
  $('#t-estimativa').value = String(dados.estimativa || 60);
  $('#t-descricao').value = dados.descricao || '';
  marcarChips('lembrete', lembretesDe(dados));
  atualizarDicaLembretes();
  $('#t-repetir').value = dados.repetir || '';
  $('#t-grupo-id').value = dados.grupoId || '';
  if (window.Nuvem) window.Nuvem.renderCaixaGrupo(dados); else $('#t-grupo').innerHTML = '';
  $('#erro-repetir').hidden = true;
  estado.subtarefasEdicao = (dados.subtarefas || []).map(s => ({ ...s }));
  renderSubtarefasEdicao();
  atualizarModoProva();
  $('#btn-excluir-tarefa').hidden = !editando;
  mostrarErroTitulo('');
  abrirModal('dlg-tarefa');
  setTimeout(() => $('#t-titulo').focus(), 50);
}

/** Prazo sugerido: daqui a N dias às 23:59. */
function prazoPadrao(dias) { const d = somarDias(new Date(), dias); d.setHours(23, 59, 0, 0); return d; }

function renderSubtarefasEdicao() {
  const meuUid = window.Nuvem && window.Nuvem.usuario ? window.Nuvem.usuario.uid : null;
  const emGrupo = !!$('#t-grupo-id').value && meuUid;
  $('#t-subtarefas').innerHTML = estado.subtarefasEdicao.map((s, i) => `
    <li>
      <label><input type="checkbox" data-sub-index="${i}" ${s.feita ? 'checked' : ''}> ${esc(s.texto)}</label>
      ${s.responsavelNome ? `<span class="resp-tag" title="Quem faz">👤 ${esc(s.responsavelNome.split(' ')[0])}</span>` : ''}
      ${emGrupo ? `<button type="button" class="chip-btn" data-eu-faco="${i}">${s.responsavel === meuUid ? 'Liberar' : '✋ Eu faço'}</button>` : ''}
      <button type="button" class="acao-mini" data-remover-sub="${i}" aria-label="Remover etapa ${esc(s.texto)}">✕</button>
    </li>`).join('');
}

function adicionarSubtarefaEdicao() {
  const campo = $('#t-nova-sub');
  const texto = campo.value.trim();
  if (!texto) { campo.focus(); return; }
  estado.subtarefasEdicao.push({ id: `s-${Date.now().toString(36)}`, texto, feita: false });
  campo.value = '';
  renderSubtarefasEdicao();
  campo.focus();
}

function mostrarErroTitulo(msg) {
  const erro = $('#erro-titulo');
  erro.hidden = !msg;
  erro.textContent = msg;
  $('#t-titulo').setAttribute('aria-invalid', !!msg);
}

async function salvarFormTarefa(evento) {
  evento.preventDefault();
  const id = $('#t-id').value;
  const titulo = $('#t-titulo').value.trim();
  if (titulo.length < 3) {
    mostrarErroTitulo(titulo ? 'O título precisa de pelo menos 3 letras.' : 'Dê um nome para a tarefa.');
    $('#t-titulo').focus();
    return;
  }
  mostrarErroTitulo('');
  const prazo = $('#t-prazo').value;
  const repetir = $('#t-repetir').value;
  if (repetir && !prazo) {
    const erroR = $('#erro-repetir');
    erroR.textContent = 'Para repetir, a tarefa precisa de um prazo (é dele que sai a próxima data).';
    erroR.hidden = false;
    $('#t-prazo').focus();
    return;
  }
  $('#erro-repetir').hidden = true;
  // Prevenção de erro: avisa se o prazo de uma tarefa nova já passou
  if (!id && prazo && new Date(prazo) < new Date()) {
    const ok = await confirmar('Esse prazo já passou', 'A data escolhida é no passado e a tarefa já vai aparecer como atrasada. Salvar mesmo assim?', 'Salvar assim');
    abrirModal('dlg-tarefa');
    if (!ok) { $('#t-prazo').focus(); return; }
  }
  const dados = {
    titulo, prazo,
    materia: $('#t-materia').value,
    tipo: $('#t-tipo').value,
    prioridade: $('input[name="prioridade"]:checked')?.value || 'media',
    estimativa: Number($('#t-estimativa').value),
    descricao: $('#t-descricao').value.trim(),
    subtarefas: estado.subtarefasEdicao,
    lembretes: lerChips('lembrete'),
    repetir
  };
  if (id) dados.id = id;
  pularLembretesPassados(Store.salvarTarefa(dados));
  fecharModal($('#dlg-tarefa'));
  toast(id ? '✏️ Tarefa atualizada' : `✅ “${titulo}” adicionada`);
  atualizarTudo();
}

function concluir(id, botao) {
  const t = Store.alternarConclusao(id);
  if (!t) return;
  if (t.concluida) {
    const p = infoPrazo({ ...t, concluida: false, prazo: t.prazo }, new Date(t.concluidaEm));
    const bonus = 10 + (p.urgencia !== 'atrasada' ? 5 : 0) + (t.prioridade === 'alta' ? 5 : 0);
    const proxima = criarProximaRepeticao(t);
    toast(`🎉 Concluída! +${bonus} XP${proxima ? ` · 🔁 Próxima: ${dataCurta(new Date(proxima.prazo))}` : ''}`,
      { acao: 'Desfazer', aoClicar: () => { Store.alternarConclusao(id); desfazerRepeticao(id); atualizarTudo(); } });
    const item = botao && botao.closest('.tarefa');
    if (item && $('#filtro-status').value === 'pendentes' && estado.view === 'tarefas') {
      botao.setAttribute('aria-pressed', 'true');
      item.classList.add('saindo');
      setTimeout(() => { atualizarTudo(); verificarConquistas(); }, 320);
      return;
    }
  } else {
    desfazerRepeticao(id);
    toast('Tarefa voltou para pendentes');
  }
  atualizarTudo();
  verificarConquistas();
}

async function excluir(id) {
  const t = Store.getTarefa(id);
  if (!t) return;
  const removida = Store.removerTarefa(id);
  fecharModal($('#dlg-tarefa'));
  const item = $(`[data-tarefa="${id}"]`);
  if (item) { item.classList.add('saindo'); setTimeout(atualizarTudo, 300); } else atualizarTudo();
  toast(`🗑️ “${t.titulo}” excluída`, { acao: 'Desfazer', aoClicar: () => { Store.restaurarTarefa(removida); atualizarTudo(); } });
}

function alternarSub(idTarefa, idSub) {
  const t = Store.alternarSubtarefa(idTarefa, idSub);
  if (!t) return;
  const feitas = t.subtarefas.filter(s => s.feita).length;
  if (feitas === t.subtarefas.length && !t.concluida) {
    toast('Todas as etapas feitas! Marcar a tarefa como concluída?', { acao: 'Concluir', aoClicar: () => concluir(idTarefa) });
  }
  atualizarTudo();
}

/* ---------- Tarefa rápida (linguagem natural simples) ----------
   Ex.: "Lista de Cálculo amanhã 23:59 !alta #calc"
        "Prova BD sex 19h"   "Ler artigo 25/11"                  */
function interpretarRapida(texto) {
  let resto = ` ${texto} `;
  const agora = new Date();
  let data = null, horaDef = null, prioridade = 'media', materia = null;

  const tirar = regex => { const m = resto.match(regex); if (m) resto = resto.replace(m[0], ' '); return m; };

  // prioridade: !alta, !media, !baixa, !!! (alta)
  let m = tirar(/\s!(alta|m[eé]dia|baixa|!+)(?=\s)/i);
  if (m) prioridade = /^!|alta/i.test(m[1]) ? 'alta' : /baixa/i.test(m[1]) ? 'baixa' : 'media';

  // matéria: #nome (compara com o começo do nome da matéria, sem acento)
  m = tirar(/\s#([\p{L}\d-]+)(?=\s)/iu);
  if (m) {
    const termo = normalizar(m[1]);
    // aceita o começo de qualquer palavra ("#calc") ou as iniciais ("#bd" → Banco de Dados)
    materia = Store.getMaterias().find(x => {
      const palavras = normalizar(x.nome).split(/[^a-z0-9]+/).filter(Boolean);
      const iniciais = palavras.filter(p => p.length > 2).map(p => p[0]).join('');
      return palavras.some(p => p.startsWith(termo)) || iniciais.startsWith(termo);
    });
  }

  // hora: 23:59, 19h, 19h30
  m = tirar(/\s(?:às\s|as\s)?(\d{1,2})(?::(\d{2})|h(\d{2})?)(?=\s)/i);
  if (m && Number(m[1]) < 24) horaDef = [Number(m[1]), Number(m[2] || m[3] || 0)];

  // data: hoje, amanhã, depois de amanhã, dd/mm, dia da semana
  if (tirar(/\sdepois de amanh[aã](?=\s)/i)) data = somarDias(agora, 2);
  else if (tirar(/\samanh[aã](?=\s)/i)) data = somarDias(agora, 1);
  else if (tirar(/\shoje(?=\s)/i)) data = new Date(agora);
  else if ((m = tirar(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/))) {
    const ano = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : agora.getFullYear();
    data = new Date(ano, Number(m[2]) - 1, Number(m[1]));
    if (!m[3] && data < inicioDia(agora)) data.setFullYear(ano + 1);
  } else if ((m = tirar(/\s(?:na\s|no\s)?(dom(?:ingo)?|seg(?:unda)?|ter(?:[cç]a)?|qua(?:rta)?|qui(?:nta)?|sex(?:ta)?|s[aá]b(?:ado)?)(?:-feira)?(?=\s)/iu))) {
    const alvo = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'].indexOf(normalizar(m[1]).slice(0, 3));
    let dif = (alvo - agora.getDay() + 7) % 7;
    if (dif === 0) dif = 7;
    data = somarDias(agora, dif);
  }

  if (!data && horaDef) data = new Date(agora);
  let prazo = '';
  if (data) {
    data.setHours(horaDef ? horaDef[0] : 23, horaDef ? horaDef[1] : 59, 0, 0);
    if (horaDef && data < agora && diffDias(data, agora) === 0 && !/hoje/i.test(texto)) data = somarDias(data, 1);
    prazo = paraInput(data);
  }
  const titulo = resto.replace(/\s+/g, ' ').trim();
  return { titulo, prazo, prioridade, materia: materia ? materia.id : null };
}

function adicionarRapida(evento) {
  evento.preventDefault();
  const campo = $('#rapido');
  const texto = campo.value.trim();
  if (!texto) { toast('Digite algo para adicionar 🙂', { tipo: 'erro' }); campo.focus(); return; }
  const r = interpretarRapida(texto);
  if (r.titulo.length < 3) { toast('O título ficou curto demais. Escreva o nome da tarefa.', { tipo: 'erro' }); return; }
  const t = Store.salvarTarefa({
    titulo: r.titulo, prazo: r.prazo, prioridade: r.prioridade,
    materia: r.materia || Store.getMaterias()[0].id, tipo: 'outro', estimativa: 60
  });
  pularLembretesPassados(t);
  campo.value = '';
  const p = infoPrazo(t);
  toast(`⚡ “${t.titulo}” · ${p.texto.replace(/^⏰ /, '')}`, { acao: 'Editar', aoClicar: () => abrirFormTarefa(Store.getTarefa(t.id)) });
  atualizarTudo();
}

/* ================================================================
   7. TELAS
   ================================================================ */

/* ---------------- 7.1 HOJE ---------------- */
function saudacao() {
  const h = new Date().getHours();
  return h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

function renderHoje() {
  const agora = new Date();
  const nome = Store.getConfig().nome;
  $('#titulo-hoje').textContent = `${saudacao()}${nome ? `, ${nome}` : ''}! 👋`;
  $('#hoje-data').textContent = maiuscula(agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }));
  $('#hoje-frase').textContent = FRASES[agora.getDate() % FRASES.length];

  const tarefas = Store.getTarefas();
  const pendentes = tarefas.filter(t => !t.concluida).sort(compararPrazo);
  const s = calcularStats();

  renderProximoPrazo();

  // Nível
  $('#nivel-conteudo').innerHTML = `
    <div class="nivel">
      <div class="nivel__num" aria-label="Nível ${s.nivel}">${s.nivel}</div>
      <div class="nivel__info">
        <strong>${tituloNivel(s.nivel)}</strong>
        <div class="xp-barra" role="progressbar" aria-label="XP no nível" aria-valuenow="${s.xpNoNivel}" aria-valuemin="0" aria-valuemax="100"><span style="width:${s.xpNoNivel}%"></span></div>
        <small class="sub">${s.xpNoNivel}/100 XP para o nível ${s.nivel + 1}</small>
      </div>
    </div>
    <div class="nivel__extra"><span>🔥 ${s.sequencia} dia(s) seguidos</span><span>🏆 ${CONQUISTAS.filter(c => c.teste(s)).length}/${CONQUISTAS.length} conquistas</span></div>`;

  // Indicadores
  const paraHoje = pendentes.filter(t => t.prazo && diffDias(new Date(t.prazo), agora) === 0).length;
  const feitasHoje = tarefas.filter(t => t.concluida && diffDias(new Date(t.concluidaEm), agora) === 0).length;
  const focoHoje = Store.getSessoes().filter(x => diffDias(new Date(x.inicio), agora) === 0).reduce((a, x) => a + x.minutos, 0);
  $('#hoje-kpis').innerHTML = `
    <a class="card kpi ${s.atrasadas ? 'kpi--alerta' : ''}" href="#tarefas"><span class="kpi__valor">${s.atrasadas}</span><span class="kpi__label">⚠️ Atrasadas</span></a>
    <a class="card kpi" href="#tarefas"><span class="kpi__valor">${paraHoje}</span><span class="kpi__label">📌 Vencem hoje</span></a>
    <a class="card kpi" href="#progresso"><span class="kpi__valor">${feitasHoje}</span><span class="kpi__label">✅ Concluídas hoje</span></a>
    <a class="card kpi" href="#foco"><span class="kpi__valor">${focoHoje ? formatarMin(focoHoje) : '0'}</span><span class="kpi__label">🍅 Foco hoje</span></a>`;

  renderHojeExtra();

  // Listas: atrasadas, hoje/amanhã e próximos dias (até 7 dias)
  if (!tarefas.length) {
    $('#hoje-listas').innerHTML = vazioHTML('🗒️', 'Nenhuma tarefa por aqui', 'Cadastre provas, trabalhos e listas para nunca mais perder um prazo.', BOTOES_VAZIO);
    return;
  }
  const grupos = { atrasadas: [], hoje: [], amanha: [], semana: [] };
  pendentes.forEach(t => { const g = infoPrazo(t).grupo; if (grupos[g]) grupos[g].push(t); });
  const blocos = GRUPOS.filter(g => grupos[g.id] && grupos[g.id].length).map(g => `
    <section class="grupo grupo--${g.id}" aria-label="${esc(g.titulo)}">
      <h2 class="grupo__titulo">${g.titulo} <span class="contagem">${grupos[g.id].length}</span></h2>
      <ul class="lista">${grupos[g.id].map((t, i) => tarefaHTML(t, { indice: i })).join('')}</ul>
    </section>`).join('');
  $('#hoje-listas').innerHTML = blocos || vazioHTML('🏖️', 'Semana livre!', 'Nenhum prazo nos próximos 7 dias. Aproveite para adiantar algo ou descansar.',
    '<a class="btn btn--ghost" href="#tarefas">Ver todas as tarefas</a>');
}

/** Cartão "Próximo prazo" com contagem regressiva (atualiza a cada segundo). */
function renderProximoPrazo() {
  const alvo = $('#proximo-conteudo');
  const card = $('#proximo-prazo');
  const pendentes = Store.getTarefas().filter(t => !t.concluida && t.prazo).sort(compararPrazo);
  const atrasada = pendentes.find(t => new Date(t.prazo) < new Date());
  const proxima = pendentes.find(t => new Date(t.prazo) >= new Date());
  const t = atrasada || proxima;
  $('#titulo-proximo').textContent = atrasada ? '⚠️ Prazo vencido — atrasada há' : t ? '⏳ Próximo prazo — faltam' : '⏳ Próximo prazo';
  card.classList.toggle('is-atrasada', !!atrasada);

  if (!t) {
    alvo.innerHTML = `<h3>Nenhum prazo pendente 🎉</h3><p>Cadastre suas próximas entregas para acompanhar a contagem regressiva.</p>
      <button type="button" class="btn btn--sm" data-acao="nova-tarefa">＋ Nova tarefa</button>`;
    alvo.dataset.id = '';
    return;
  }
  const mat = infoMateria(t.materia);
  if (alvo.dataset.id !== t.id) {
    alvo.dataset.id = t.id;
    alvo.innerHTML = `
      <span class="materia-tag" style="--cor:#fff">${esc(mat.nome)}</span>
      <h3>${esc(t.titulo)}</h3>
      <div class="contador" id="contador" aria-live="off"></div>
      <p id="contador-texto"></p>
      <button type="button" class="btn btn--sm" data-acao="focar" data-id="${t.id}">🍅 Começar a focar nisso</button>`;
  }
  atualizarContador(t);
}

function atualizarContador(t) {
  const caixa = $('#contador');
  if (!caixa) return;
  const ms = Math.abs(new Date(t.prazo) - new Date());
  const d = Math.floor(ms / 86400000), h = Math.floor(ms / 3600000) % 24, m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  caixa.innerHTML = [[d, 'dias'], [h, 'horas'], [m, 'min'], [s, 'seg']].map(([v, l]) => `<div><b>${pad(v)}</b><small>${l}</small></div>`).join('');
  const atrasada = new Date(t.prazo) < new Date();
  $('#contador-texto').textContent = atrasada
    ? `Venceu em ${dataCurta(new Date(t.prazo))} às ${hora(new Date(t.prazo))}. Ainda dá tempo de entregar!`
    : `Entrega: ${dataCurta(new Date(t.prazo))} às ${hora(new Date(t.prazo))}`;
}

/* ---------------- 7.2 TAREFAS ---------------- */
function renderTarefas() {
  const termo = normalizar($('#busca').value.trim());
  const status = $('#filtro-status').value;
  const prioridade = $('#filtro-prioridade').value;
  const materia = $('#filtro-materia').value;
  const ordem = $('#ordem').value;
  const todas = Store.getTarefas();

  let lista = todas.filter(t =>
    (status === 'todas' || (status === 'concluidas' ? t.concluida : !t.concluida)) &&
    (!prioridade || t.prioridade === prioridade) &&
    (!materia || t.materia === materia) &&
    (!termo || normalizar(`${t.titulo} ${t.descricao} ${infoMateria(t.materia).nome}`).includes(termo))
  );

  const pend = todas.filter(t => !t.concluida).length;
  $('#sub-tarefas').textContent = `${pend} pendente(s) · ${todas.length - pend} concluída(s)`;
  $('#btn-limpar-concluidas').hidden = !todas.some(t => t.concluida) || status === 'pendentes';

  const alvo = $('#lista-tarefas');
  if (!todas.length) { alvo.innerHTML = vazioHTML('🗒️', 'Sua lista está vazia', 'Comece cadastrando a sua próxima entrega.', BOTOES_VAZIO); return; }
  if (!lista.length) {
    alvo.innerHTML = vazioHTML('🔎', 'Nada encontrado', 'Nenhuma tarefa com esses filtros.',
      '<button type="button" class="btn btn--ghost" data-acao="limpar-filtros">Limpar filtros</button>');
    return;
  }

  if (ordem === 'prazo') {
    // Agrupa por prazo: Atrasadas, Hoje, Amanhã, Próximos 7 dias…
    lista.sort(compararPrazo);
    const grupos = {};
    lista.forEach(t => { const g = infoPrazo(t).grupo; (grupos[g] = grupos[g] || []).push(t); });
    alvo.innerHTML = GRUPOS.filter(g => grupos[g.id]).map(g => `
      <section class="grupo grupo--${g.id}" aria-label="${esc(g.titulo)}">
        <h2 class="grupo__titulo">${g.titulo} <span class="contagem">${grupos[g.id].length}</span></h2>
        <ul class="lista">${grupos[g.id].map((t, i) => tarefaHTML(t, { indice: i, mostrarSubs: true })).join('')}</ul>
      </section>`).join('');
  } else {
    lista.sort(ordem === 'prioridade'
      ? (a, b) => infoPrioridade(b.prioridade).peso - infoPrioridade(a.prioridade).peso || compararPrazo(a, b)
      : (a, b) => new Date(b.criadaEm) - new Date(a.criadaEm));
    alvo.innerHTML = `<ul class="lista">${lista.map((t, i) => tarefaHTML(t, { indice: i, mostrarSubs: true })).join('')}</ul>`;
  }
}

async function limparConcluidas() {
  const qtd = Store.getTarefas().filter(t => t.concluida).length;
  const ok = await confirmar(`Apagar ${qtd} tarefa(s) concluída(s)?`, 'Elas saem da lista definitivamente. O XP já ganho continua contando apenas para o que ficar salvo.', 'Apagar');
  if (!ok) return;
  Store.limparConcluidas();
  toast('🧹 Concluídas apagadas');
  atualizarTudo();
}

/* ---------------- 7.3 AGENDA ---------------- */
function renderAgenda() {
  const mes = estado.mesAgenda;
  const hojeISO = dataISO(new Date());
  $('#mes-titulo').textContent = maiuscula(mes.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));

  // Agrupa tarefas por dia do prazo
  const porDia = {};
  Store.getTarefas().forEach(t => { if (t.prazo) (porDia[t.prazo.slice(0, 10)] = porDia[t.prazo.slice(0, 10)] || []).push(t); });

  const inicio = somarDias(mes, -mes.getDay()); // domingo antes do dia 1
  const celulas = [];
  for (let i = 0; i < 42; i++) {
    const d = somarDias(inicio, i);
    const iso = dataISO(d);
    const lista = porDia[iso] || [];
    const atrasada = lista.some(t => !t.concluida && new Date(t.prazo) < new Date());
    celulas.push(`
      <button type="button" class="dia ${d.getMonth() !== mes.getMonth() ? 'fora' : ''} ${iso === hojeISO ? 'hoje' : ''} ${atrasada ? 'tem-atrasada' : ''}"
        data-dia="${iso}" aria-pressed="${iso === estado.diaSelecionado}" ${iso === hojeISO ? 'aria-current="date"' : ''}
        aria-label="${rotuloDia(d, lista, iso === hojeISO)}">
        <span>${d.getDate()}</span>
        <span class="pontos" aria-hidden="true">${lista.slice(0, 4).map(t => `<i class="${t.concluida ? 'feito' : ''}" style="--c:${infoPrioridade(t.prioridade).cor}"></i>`).join('')}</span>
      </button>`);
  }
  // remove a última semana se ela for toda do mês seguinte
  const ultimaSemanaFora = somarDias(inicio, 35).getMonth() !== mes.getMonth();
  $('#calendario-dias').innerHTML = celulas.slice(0, ultimaSemanaFora ? 35 : 42).join('');
  renderPainelDia(porDia);
  renderAulasSemana();
}

/** Texto lido pelo leitor de tela em cada dia: data, quantas entregas, quantas altas e se há atraso (a cor não fica sozinha). */
function rotuloDia(d, lista, ehHoje) {
  let txt = `${ehHoje ? 'Hoje, ' : ''}${d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}`;
  if (!lista.length) return `${txt}, sem entregas`;
  const pend = lista.filter(t => !t.concluida);
  const altas = pend.filter(t => t.prioridade === 'alta').length;
  const atrasadas = pend.filter(t => new Date(t.prazo) < new Date()).length;
  txt += `, ${lista.length} entrega${lista.length > 1 ? 's' : ''}`;
  if (altas) txt += `, ${altas} de prioridade alta`;
  if (atrasadas) txt += `, ${atrasadas} atrasada${atrasadas > 1 ? 's' : ''}`;
  if (lista.length - pend.length) txt += `, ${lista.length - pend.length} concluída${lista.length - pend.length > 1 ? 's' : ''}`;
  return txt;
}

function renderPainelDia(porDia) {
  const d = new Date(`${estado.diaSelecionado}T12:00`);
  const lista = (porDia[estado.diaSelecionado] || []).sort(compararPrazo);
  const rel = diffDias(d, new Date());
  const rotulo = rel === 0 ? 'Hoje' : rel === 1 ? 'Amanhã' : rel === -1 ? 'Ontem' : '';
  $('#dia-titulo').textContent = maiuscula(`${rotulo ? `${rotulo} · ` : ''}${d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}`);
  const minutos = lista.filter(t => !t.concluida).reduce((s, t) => s + (t.estimativa || 0), 0);
  $('#dia-resumo').textContent = lista.length
    ? `${lista.length} entrega(s)${minutos ? ` · cerca de ${formatarMin(minutos)} de trabalho pendente` : ''}`
    : 'Nenhuma entrega neste dia.';
  $('#dia-lista').innerHTML = lista.length ? `<ul class="lista">${lista.map((t, i) => tarefaHTML(t, { indice: i })).join('')}</ul>` : '';
  renderAulasELivresDoDia(d);
}

/* ---------------- 7.4 FOCO (POMODORO) ---------------- */
const CIRCUNFERENCIA = 2 * Math.PI * 116;
const ROTULOS_MODO = { foco: 'Hora de focar', curta: 'Pausa curta', longa: 'Pausa longa' };
const timer = { modo: 'foco', rodando: false, fim: 0, restante: 0, tarefaId: '', ciclos: 0, intervalo: null };

const duracaoModo = modo => Store.getConfig()[modo] * 60000;
const formatarRelogio = ms => { const s = Math.ceil(ms / 1000); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

function salvarTimer() {
  Store.salvarTimer({ modo: timer.modo, rodando: timer.rodando, fim: timer.fim, restante: timer.restante, tarefaId: timer.tarefaId, ciclos: timer.ciclos });
}

function definirModo(modo, { manter = false } = {}) {
  timer.modo = modo;
  if (!manter) { timer.rodando = false; timer.restante = duracaoModo(modo); clearInterval(timer.intervalo); }
  $$('input[name="modo"]').forEach(r => { r.checked = r.value === modo; });
  salvarTimer();
  atualizarTimerUI();
}

function iniciarPausar() {
  if (timer.rodando) {
    timer.restante = Math.max(0, timer.fim - Date.now());
    timer.rodando = false;
    clearInterval(timer.intervalo);
    clearTimeout(timeoutFimCiclo);
    atualizarSomFundo();
    avisarFocoNuvem();
    $('#timer-status').textContent = '⏸ Pausado. Respire e volte quando quiser.';
  } else {
    preparaSom();
    if (timer.modo === 'foco') pedirPermissaoDoFoco();
    timer.fim = Date.now() + timer.restante;
    timer.rodando = true;
    timer.intervalo = setInterval(tique, 250);
    agendarFimCiclo();
    atualizarSomFundo();
    avisarFocoNuvem();
    $('#timer-status').textContent = timer.modo === 'foco' ? '🔕 Silencie o celular e foque só nisso.' : '☕ Levante, beba água, alongue-se.';
  }
  salvarTimer();
  atualizarTimerUI();
}

function reiniciarTimer() {
  timer.rodando = false;
  clearInterval(timer.intervalo);
  clearTimeout(timeoutFimCiclo);
  pararFundo();
  avisarFocoNuvem();
  timer.restante = duracaoModo(timer.modo);
  $('#timer-status').textContent = '↺ Timer reiniciado.';
  salvarTimer();
  atualizarTimerUI();
}

function tique() {
  if (!timer.rodando) return;
  if (Date.now() >= timer.fim) { terminarCiclo(); return; }
  atualizarTimerUI();
}

/** Fim de um ciclo: registra a sessão de foco e prepara a próxima etapa. */
function terminarCiclo({ pulou = false } = {}) {
  clearInterval(timer.intervalo);
  clearTimeout(timeoutFimCiclo);
  timer.rodando = false;
  pararFundo();
  avisarFocoNuvem();
  const eraFoco = timer.modo === 'foco';
  if (eraFoco && !pulou) {
    const minutos = Store.getConfig().foco;
    const tarefa = timer.tarefaId ? Store.getTarefa(timer.tarefaId) : null;
    Store.adicionarSessao({ inicio: new Date(timer.fim - minutos * 60000).toISOString(), minutos, materia: tarefa ? tarefa.materia : null, tarefaId: tarefa ? tarefa.id : null, saidas: saidasDoCiclo });
    saidasDoCiclo = 0;
    if (tarefa) Store.adicionarFoco(tarefa.id, minutos);
    timer.ciclos++;
    tocarAlarme('🍅 Ciclo concluído! Hora da pausa.');
    if (document.visibilityState !== 'visible') mostrarNotificacao('🍅 Ciclo concluído! +5 XP', 'Hora da pausa: levante, beba água e alongue-se.', 'pomodoro');
    toast(`🍅 Ciclo concluído! +5 XP. Hora da pausa.`);
    verificarConquistas();
  } else if (!pulou) {
    tocarAlarme('⏰ Pausa encerrada. Bora focar de novo?');
    if (document.visibilityState !== 'visible') mostrarNotificacao('⏰ Pausa encerrada', 'Bora focar de novo?', 'pomodoro');
    toast('⏰ Pausa encerrada. Bora focar de novo?');
  }
  const proximo = eraFoco ? (timer.ciclos > 0 && timer.ciclos % 4 === 0 ? 'longa' : 'curta') : 'foco';
  $('#timer-status').textContent = eraFoco ? `Próximo: ${ROTULOS_MODO[proximo].toLowerCase()}. Clique em Iniciar.` : 'Pronto para mais um ciclo de foco.';
  definirModo(proximo);
  if (estado.view === 'foco') renderFocoHoje();
  if (estado.view === 'hoje') renderHoje();
}

function atualizarTimerUI() {
  const restante = timer.rodando ? Math.max(0, timer.fim - Date.now()) : timer.restante;
  const total = duracaoModo(timer.modo);
  const texto = formatarRelogio(restante);
  $('#timer-tempo').textContent = texto;
  $('#timer-modo').textContent = ROTULOS_MODO[timer.modo];
  $('#anel-progresso').style.strokeDashoffset = String(CIRCUNFERENCIA * (1 - restante / total));
  const card = $('.timer');
  card.classList.toggle('rodando', timer.rodando);
  card.classList.remove('modo-foco', 'modo-curta', 'modo-longa');
  card.classList.add(`modo-${timer.modo}`);
  $('#timer-iniciar').textContent = timer.rodando ? '⏸ Pausar' : restante < total ? '▶ Continuar' : '▶ Iniciar';

  // Pílula no topo + título da aba enquanto o timer roda
  const pilula = $('#timer-pill');
  pilula.hidden = !timer.rodando || estado.view === 'foco';
  $('#timer-pill-tempo').textContent = texto;
  document.title = timer.rodando ? `${saidaDoFoco ? '⏳ Volta pro foco! ' : ''}${texto} · ${ROTULOS_MODO[timer.modo]} — PrazoCerto` : `${TITULOS[estado.view]} · PrazoCerto`;
}

function montarSelectTarefaFoco() {
  const sel = $('#timer-tarefa');
  const pendentes = Store.getTarefas().filter(t => !t.concluida).sort(compararPrazo);
  sel.innerHTML = '<option value="">Sem tarefa específica</option>' +
    pendentes.map(t => `<option value="${t.id}">${esc(t.titulo)} — ${esc(infoMateria(t.materia).nome)}</option>`).join('');
  sel.value = pendentes.some(t => t.id === timer.tarefaId) ? timer.tarefaId : '';
  if (!sel.value) timer.tarefaId = '';
}

function renderFoco() {
  if (window.Nuvem) window.Nuvem.renderEstudandoAgora();
  montarSelectTarefaFoco();
  renderFocoHoje();
  atualizarTimerUI();
}

function renderFocoHoje() {
  const hoje = new Date();
  const sessoes = Store.getSessoes().filter(s => diffDias(new Date(s.inicio), hoje) === 0);
  const meta = 8;
  const minutos = sessoes.reduce((a, s) => a + s.minutos, 0);
  $('#foco-hoje-conteudo').innerHTML = `
    <p class="sub">${sessoes.length} ciclo(s) · ${formatarMin(minutos)} de foco hoje (meta: ${meta} ciclos)</p>
    <div class="tomates" role="img" aria-label="${sessoes.length} de ${meta} ciclos de foco hoje">
      ${Array.from({ length: Math.max(meta, sessoes.length) }, (_, i) => `<span class="${i < sessoes.length ? '' : 'vazio-t'}" aria-hidden="true">🍅</span>`).join('')}
    </div>
    ${sessoes.length ? `<ul class="sessoes">${sessoes.map(s => {
      const t = s.tarefaId ? Store.getTarefa(s.tarefaId) : null;
      return `<li><span>${t ? esc(t.titulo) : s.materia ? esc(infoMateria(s.materia).nome) : 'Foco livre'}</span><span>${hora(new Date(s.inicio))} · ${s.minutos}min</span></li>`;
    }).join('')}</ul>` : '<p class="sub">Nenhum ciclo ainda hoje. Que tal começar agora? 💪</p>'}`;
}

const avisarFocoNuvem = () => { if (window.Nuvem) window.Nuvem.publicarPerfil(); };

/** Estudar junto: começa um foco que termina na mesma hora que o do amigo. */
function focarAte(fim, texto) {
  if (fim - Date.now() < 60000) { toast('O foco do seu amigo já está acabando. Espere o próximo!'); return; }
  if (timer.rodando) { clearInterval(timer.intervalo); clearTimeout(timeoutFimCiclo); timer.rodando = false; }
  definirModo('foco');
  timer.restante = fim - Date.now();
  irPara('foco');
  iniciarPausar();
  $('#timer-status').textContent = texto;
}

function focarEm(id) {
  timer.tarefaId = id;
  if (!timer.rodando) definirModo('foco');
  salvarTimer();
  irPara('foco');
  const t = Store.getTarefa(id);
  $('#timer-status').textContent = t ? `🎯 Foco em: ${t.titulo}` : '';
}

/* ================================================================
   SOM DO ALARME (Web Audio, sem arquivo externo)
   ----------------------------------------------------------------
   Cada toque é uma "rodada" de notas geradas na hora. O alarme repete
   a rodada 1, 3 ou 5 vezes, ou até a pessoa apertar "Parar" (com limite
   de 2 minutos). Pode vibrar junto no Android (navigator.vibrate).
   O navegador só libera o som depois de um toque/clique na página,
   por isso preparaSom() roda em toda interação.
   ================================================================ */
let audioCtx = null;
const alarme = { ativo: false, saida: null, proxima: null };

function preparaSom() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (_) { audioCtx = null; }
}

/** Uma nota com ataque rápido e queda suave. */
function nota(saida, freq, inicio, duracao, { tipo = 'sine', volume = .3, ataque = .008 } = {}) {
  const osc = audioCtx.createOscillator(), env = audioCtx.createGain();
  osc.type = tipo;
  osc.frequency.value = freq;
  env.gain.setValueAtTime(.0001, inicio);
  env.gain.exponentialRampToValueAtTime(volume, inicio + ataque);
  env.gain.exponentialRampToValueAtTime(.0001, inicio + duracao);
  osc.connect(env).connect(saida);
  osc.start(inicio);
  osc.stop(inicio + duracao + .05);
}

/** Toca uma rodada do toque escolhido. Devolve a duração em segundos. */
function tocarRodada(toque, saida) {
  const t0 = audioCtx.currentTime + .03;
  switch (toque) {
    case 'digital': // bip-bip-bip-bip de despertador
      for (let g = 0; g < 2; g++) for (let i = 0; i < 4; i++) nota(saida, 1760, t0 + g * .6 + i * .11, .08, { tipo: 'square', volume: .09, ataque: .004 });
      return 1.1;
    case 'suave': // arpejo tipo marimba
      [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach((f, i) => nota(saida, f, t0 + i * .17, .7, { tipo: 'triangle', volume: .32 }));
      return 1.6;
    case 'alarme': // sirene alternada, insistente
      for (let i = 0; i < 8; i++) nota(saida, i % 2 ? 660 : 880, t0 + i * .2, .19, { tipo: 'sawtooth', volume: .12, ataque: .01 });
      return 1.6;
    case 'classico': // o toque curto das versões antigas
      [660, 880, 990].forEach((f, i) => nota(saida, f, t0 + i * .22, .2, { volume: .25, ataque: .02 }));
      return .7;
    case 'sino':
    default: // duas batidas de sino (fundamental + harmônicos)
      [0, .6].forEach(atraso => {
        [[880, .3], [1760, .12], [2640, .06], [3960, .03]].forEach(([f, v]) => nota(saida, f, t0 + atraso, 1.5, { volume: v, ataque: .004 }));
      });
      return 2.1;
  }
}

/**
 * Toca o alarme. texto aparece na barra com o botão "Parar" quando o toque repete.
 * som = configurações de som (por padrão, as salvas); dá para forçar só 1 rodada.
 */
function tocarAlarme(texto, { som = Store.getConfig(), umaVez = false } = {}) {
  pararAlarme();
  const vezes = umaVez ? 1 : som.repetir === 0 ? Infinity : som.repetir || 1;
  const vibrar = () => { if (som.vibrar && navigator.vibrate) { try { navigator.vibrate([400, 150, 400, 150, 700]); } catch (_) {} } };
  if (!som.som) { vibrar(); return; }
  preparaSom();
  if (!audioCtx) { vibrar(); return; }
  const saida = audioCtx.createGain();
  saida.gain.value = Math.max(.05, (som.volume ?? 80) / 100);
  saida.connect(audioCtx.destination);
  Object.assign(alarme, { ativo: true, saida });
  const limite = Date.now() + 120000; // "até eu parar" toca no máximo 2 minutos
  let rodadas = 0;
  const rodada = () => {
    if (!alarme.ativo || alarme.saida !== saida) return;
    if (rodadas >= vezes || Date.now() > limite) { pararAlarme(); return; }
    rodadas++;
    const dur = tocarRodada(som.toque, saida);
    vibrar();
    alarme.proxima = setTimeout(rodada, (dur + .45) * 1000);
  };
  if (vezes > 1) mostrarBarraAlarme(texto);
  rodada();
}

function pararAlarme() {
  clearTimeout(alarme.proxima);
  if (alarme.saida && audioCtx) {
    const s = alarme.saida;
    try { s.gain.setTargetAtTime(0, audioCtx.currentTime, .03); } catch (_) {}
    setTimeout(() => { try { s.disconnect(); } catch (_) {} }, 400);
  }
  if (alarme.ativo && navigator.vibrate) { try { navigator.vibrate(0); } catch (_) {} }
  Object.assign(alarme, { ativo: false, saida: null, proxima: null });
  const barra = $('#alarme-tocando');
  if (!barra) return;
  barra.hidden = true;
  document.body.appendChild(barra);
}

/* Com uma janela (dialog) aberta, o resto da página fica bloqueado para cliques.
   Por isso a barra do alarme vai para dentro da janela aberta, onde o "Parar" funciona. */
function posicionarBarraAlarme() {
  const barra = $('#alarme-tocando');
  const janela = $$('dialog[open]').pop();
  (janela || document.body).appendChild(barra);
}
function mostrarBarraAlarme(texto) {
  $('#alarme-texto').textContent = texto;
  posicionarBarraAlarme();
  $('#alarme-tocando').hidden = false;
}

/** Som escolhido no formulário de Configurações (para o botão "Ouvir" antes de salvar). */
function somDoFormulario() {
  return {
    som: true, toque: $('#cfg-toque').value, repetir: Number($('#cfg-repetir').value),
    volume: Number($('#cfg-volume').value), vibrar: $('#cfg-vibrar').checked
  };
}

/* O fim do ciclo também é agendado com um setTimeout único: em aba de fundo
   o navegador atrasa os setInterval, mas respeita melhor um timeout só. */
let timeoutFimCiclo = null;
function agendarFimCiclo() {
  clearTimeout(timeoutFimCiclo);
  if (timer.rodando) timeoutFimCiclo = setTimeout(tique, Math.max(0, timer.fim - Date.now()) + 30);
}

/** Restaura o timer salvo (continua contando mesmo depois de recarregar a página). */
function restaurarTimer() {
  const salvo = Store.getTimer();
  if (!salvo) { timer.restante = duracaoModo('foco'); return; }
  Object.assign(timer, salvo);
  if (!['foco', 'curta', 'longa'].includes(timer.modo)) timer.modo = 'foco';
  $$('input[name="modo"]').forEach(r => { r.checked = r.value === timer.modo; });
  if (timer.rodando) {
    if (Date.now() >= timer.fim) terminarCiclo();
    else { timer.intervalo = setInterval(tique, 250); agendarFimCiclo(); }
  } else if (!timer.restante || timer.restante > duracaoModo(timer.modo)) {
    timer.restante = duracaoModo(timer.modo);
  }
}

/* ---------------- 7.5 PROGRESSO ---------------- */
function barrasHTML(linhas, sufixo = '') {
  const max = Math.max(1, ...linhas.map(l => l.valor));
  return `<ul class="barras">${linhas.map(l => `
    <li><div class="barra__top"><span>${esc(l.rotulo)}</span><span>${l.texto ?? l.valor}${sufixo}</span></div>
    <div class="barra__trilho" role="img" aria-label="${esc(l.rotulo)}: ${l.texto ?? l.valor}${sufixo}"><div class="barra__fill" style="width:${(l.valor / max) * 100}%;--cor:${l.cor}"></div></div></li>`).join('')}</ul>`;
}

function renderProgresso() {
  const s = calcularStats();
  const tarefas = Store.getTarefas();
  const sessoes = Store.getSessoes();
  const alvo = $('#progresso-conteudo');

  if (!tarefas.length && !sessoes.length) {
    alvo.innerHTML = metasHTML() + '<div id="ranking"></div>' + vazioHTML('📊', 'Ainda sem dados', 'Conclua tarefas e faça ciclos de foco para ver seu progresso.', BOTOES_VAZIO);
    return;
  }

  const metas = metasHTML();
  // Últimos 7 dias
  const hoje = new Date();
  const dias = Array.from({ length: 7 }, (_, i) => somarDias(hoje, i - 6));
  const concluidasPorDia = dias.map(d => tarefas.filter(t => t.concluida && dataISO(new Date(t.concluidaEm)) === dataISO(d)).length);
  const maxDia = Math.max(1, ...concluidasPorDia);

  // Por matéria
  const materias = Store.getMaterias();
  const focoMateria = materias.map(m => ({ rotulo: m.nome, cor: m.cor, valor: sessoes.filter(x => x.materia === m.id).reduce((a, x) => a + x.minutos, 0) }))
    .filter(l => l.valor).sort((a, b) => b.valor - a.valor).map(l => ({ ...l, texto: formatarMin(l.valor) }));
  const pendMateria = materias.map(m => ({ rotulo: m.nome, cor: m.cor, valor: tarefas.filter(t => !t.concluida && t.materia === m.id).length }))
    .filter(l => l.valor).sort((a, b) => b.valor - a.valor);

  // Prioridade das pendentes (rosca)
  const pend = tarefas.filter(t => !t.concluida);
  const cont = PRIORIDADES.map(p => ({ ...p, n: pend.filter(t => t.prioridade === p.id).length }));
  let acc = 0;
  const fatias = cont.map(p => { const ini = acc; acc += pend.length ? (p.n / pend.length) * 100 : 0; return `${p.cor} ${ini}% ${acc}%`; }).join(', ');

  alvo.innerHTML = `${metas}<div id="ranking"></div>
    <div class="kpis">
      <div class="card kpi"><span class="kpi__valor">Nv. ${s.nivel}</span><span class="kpi__label">🎮 ${tituloNivel(s.nivel)} · ${s.xp} XP</span></div>
      <div class="card kpi"><span class="kpi__valor">${s.concluidas}</span><span class="kpi__label">✅ Tarefas concluídas</span></div>
      <div class="card kpi"><span class="kpi__valor">${s.concluidas ? `${s.pontualidade}%` : '–'}</span><span class="kpi__label">⏰ Entregues no prazo</span></div>
      <div class="card kpi"><span class="kpi__valor">${formatarMin(s.minutosFoco)}</span><span class="kpi__label">🍅 Foco total (${s.pomodoros} ciclos)</span></div>
    </div>
    <div class="graficos">
      <section class="card grafico">
        <h2>📈 Concluídas nos últimos 7 dias</h2>
        <div class="colunas" role="img" aria-label="Tarefas concluídas por dia: ${dias.map((d, i) => `${DIAS_CURTOS[d.getDay()]} ${concluidasPorDia[i]}`).join(', ')}">
          ${dias.map((d, i) => `
            <div class="coluna ${i === 6 ? 'hoje' : ''}">
              <span class="coluna__valor">${concluidasPorDia[i]}</span>
              <div class="coluna__barra ${concluidasPorDia[i] ? '' : 'zero'}" style="height:${(concluidasPorDia[i] / maxDia) * 75 + (concluidasPorDia[i] ? 5 : 0)}%; animation-delay:${i * 60}ms"></div>
              <span class="coluna__dia">${i === 6 ? 'hoje' : DIAS_CURTOS[d.getDay()]}</span>
            </div>`).join('')}
        </div>
        <p class="sub" style="margin-top:12px">🔥 Sequência atual: <strong>${s.sequencia} dia(s)</strong> seguidos concluindo tarefas.</p>
      </section>
      <section class="card grafico">
        <h2>🎯 Pendentes por prioridade</h2>
        ${pend.length ? `<div class="donut-wrap">
          <div class="donut" role="img" aria-label="${cont.map(p => `${p.label}: ${p.n}`).join(', ')}" data-centro="${pend.length}" style="background: conic-gradient(${fatias})"></div>
          <ul class="legenda">${cont.map(p => `<li><i style="background:${p.cor}"></i>${p.label}: ${p.n}</li>`).join('')}</ul>
        </div>` : '<p class="sub">Nenhuma tarefa pendente. 🎉</p>'}
      </section>
      <section class="card grafico">
        <h2>🍅 Tempo de foco por matéria</h2>
        ${focoMateria.length ? barrasHTML(focoMateria) : '<p class="sub">Use o modo Foco escolhendo uma tarefa para ver o tempo por matéria.</p>'}
      </section>
      <section class="card grafico">
        <h2>📚 Pendentes por matéria</h2>
        ${pendMateria.length ? barrasHTML(pendMateria) : '<p class="sub">Nada pendente. 🏖️</p>'}
      </section>
    </div>
    <section class="card grafico">
      <h2>🏆 Conquistas <small class="sub">(${CONQUISTAS.filter(c => c.teste(s)).length}/${CONQUISTAS.length})</small></h2>
      <div class="conquistas">
        ${CONQUISTAS.map(c => {
          const ok = c.teste(s);
          return `<div class="conquista ${ok ? 'ganha' : 'bloqueada'}"><span class="conquista__emoji" aria-hidden="true">${c.emoji}</span>
            <div><strong>${esc(c.nome)}</strong><small>${ok ? '✔ Desbloqueada · ' : '🔒 '}${esc(c.desc)}</small></div></div>`;
        }).join('')}
      </div>
    </section>`;
}

/* ================================================================
   8. CONFIGURAÇÕES, MATÉRIAS, BACKUP E TEMA
   ================================================================ */
function abrirConfig() {
  const c = Store.getConfig();
  $('#cfg-nome').value = c.nome;
  $('#cfg-foco').value = c.foco;
  $('#cfg-curta').value = c.curta;
  $('#cfg-longa').value = c.longa;
  $('#cfg-som').checked = c.som;
  $('#cfg-toque').value = c.toque;
  $('#cfg-repetir').value = String(c.repetir);
  $('#cfg-volume').value = String(c.volume);
  $('#cfg-volume-valor').textContent = `${c.volume}%`;
  $('#cfg-vibrar').checked = c.vibrar;
  $('#cfg-aviso').checked = c.aviso;
  $('#cfg-atalhos').checked = c.atalhos;
  marcarChips('lembrete-padrao', c.lembretesPadrao);
  $('#cfg-resumo').checked = c.resumoDiario;
  $('#cfg-relatorio').checked = c.relatorioSemanal;
  $('#cfg-sem-inicio').value = c.semestreInicio;
  $('#cfg-sem-fim').value = c.semestreFim;
  $('#cfg-media').value = String(c.mediaAprovacao);
  $('#cfg-sistema-notas').value = c.sistemaNotas;
  atualizarCampoMedia();
  $('#cfg-meta-foco').value = String(c.metaFocoMin / 60);
  $('#cfg-meta-tarefas').value = String(c.metaTarefas);
  $('#cfg-estudo-inicio').value = c.estudoInicio;
  $('#cfg-estudo-fim').value = c.estudoFim;
  if (window.Nuvem) window.Nuvem.renderConta();
  else $('#conta-nuvem').innerHTML = '<p class="field__hint" style="margin:0">Para entrar com sua conta e sincronizar, abra o PrazoCerto pelo link do site (<strong>prazocerto.github.io</strong>).</p>';
  atualizarStatusAviso();
  $('#erro-config').hidden = true;
  renderMaterias();
  abrirModal('dlg-config');
}

function salvarConfig(e) {
  e.preventDefault();
  const foco = Number($('#cfg-foco').value), curta = Number($('#cfg-curta').value), longa = Number($('#cfg-longa').value);
  const erro = $('#erro-config');
  if (!(foco >= 5 && foco <= 90) || !(curta >= 1 && curta <= 30) || !(longa >= 5 && longa <= 60)) {
    erro.textContent = 'Use valores entre 5–90 (foco), 1–30 (pausa curta) e 5–60 (pausa longa).';
    erro.hidden = false;
    return;
  }
  const estudoInicio = $('#cfg-estudo-inicio').value, estudoFim = $('#cfg-estudo-fim').value;
  if (!estudoInicio || !estudoFim || estudoInicio >= estudoFim) {
    erro.textContent = 'No horário de estudo, o “Até” precisa ser depois do “Das”.';
    erro.hidden = false;
    return;
  }
  const semestreInicio = $('#cfg-sem-inicio').value, semestreFim = $('#cfg-sem-fim').value;
  if (semestreInicio && semestreFim && semestreInicio >= semestreFim) {
    erro.textContent = 'O fim do semestre precisa ser depois do começo.';
    erro.hidden = false;
    return;
  }
  const mediaAprovacao = numeroBR($('#cfg-media').value);
  if (mediaAprovacao === null || mediaAprovacao < 0 || mediaAprovacao > 10) {
    erro.textContent = 'A média para passar precisa ser um número de 0 a 10.';
    erro.hidden = false;
    return;
  }
  const metaFocoMin = Math.round((numeroBR($('#cfg-meta-foco').value) || 0) * 60);
  const metaTarefas = Math.max(0, Math.round(numeroBR($('#cfg-meta-tarefas').value) || 0));
  erro.hidden = true;
  pararAlarme();
  Store.salvarConfig({ nome: $('#cfg-nome').value.trim(), foco, curta, longa, ...somDoFormulario(), som: $('#cfg-som').checked,
    aviso: $('#cfg-aviso').checked, lembretesPadrao: lerChips('lembrete-padrao'), atalhos: $('#cfg-atalhos').checked,
    resumoDiario: $('#cfg-resumo').checked, estudoInicio, estudoFim,
    relatorioSemanal: $('#cfg-relatorio').checked, semestreInicio, semestreFim, mediaAprovacao, metaFocoMin, metaTarefas,
    sistemaNotas: $('#cfg-sistema-notas').value });
  if (!timer.rodando) timer.restante = duracaoModo(timer.modo);
  salvarTimer();
  toast('⚙️ Configurações salvas');
  fecharModal($('#dlg-config'));
  atualizarTudo();
}

function renderMaterias() {
  const lista = Store.getMaterias();
  const usadas = Store.getTarefas();
  $('#lista-materias').innerHTML = lista.map(m => {
    const n = usadas.filter(t => t.materia === m.id).length;
    return `<li><i style="--cor:${m.cor}"></i><span>${esc(m.nome)} <small class="sub">(${n})</small></span>
      ${lista.length > 1 ? `<button type="button" class="acao-mini" data-acao="excluir-materia" data-id="${m.id}" aria-label="Excluir matéria ${esc(m.nome)}">🗑️</button>` : ''}</li>`;
  }).join('');
  $('#cor-materia').value = CORES_MATERIA[lista.length % CORES_MATERIA.length];
}

function adicionarMateria(e) {
  e.preventDefault();
  const nome = $('#nova-materia').value.trim();
  if (!nome) { toast('Digite o nome da matéria.', { tipo: 'erro' }); $('#nova-materia').focus(); return; }
  if (Store.getMaterias().some(m => normalizar(m.nome) === normalizar(nome))) { toast('Essa matéria já existe.', { tipo: 'erro' }); return; }
  Store.criarMateria(nome, $('#cor-materia').value);
  $('#nova-materia').value = '';
  renderMaterias();
  montarSelectMaterias();
  toast(`📚 Matéria “${nome}” criada`);
}

async function excluirMateria(id) {
  const m = infoMateria(id);
  const n = Store.getTarefas().filter(t => t.materia === id).length;
  const ok = await confirmar(`Excluir “${m.nome}”?`, n ? `As ${n} tarefa(s) dessa matéria vão para “Pessoal”.` : 'Nenhuma tarefa usa essa matéria.', 'Excluir');
  abrirModal('dlg-config');
  if (!ok) return;
  Store.excluirMateria(id);
  renderMaterias();
  montarSelectMaterias();
  atualizarTudo();
}

function exportarBackup() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(Store.exportar(), null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `prazocerto-backup-${dataISO(new Date())}.json` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('⬇️ Backup baixado');
}

function importarBackup(arquivo) {
  const leitor = new FileReader();
  leitor.onload = async () => {
    try {
      const dados = JSON.parse(leitor.result);
      const ok = await confirmar('Restaurar backup?', `Seus dados atuais serão substituídos por ${dados.tarefas?.length ?? 0} tarefa(s) do arquivo.`, 'Restaurar');
      if (!ok) return;
      Store.importar(dados);
      verificarConquistas({ silencioso: true });
      montarSelectMaterias();
      fecharModal($('#dlg-config'));
      atualizarTudo();
      toast('✅ Backup restaurado');
    } catch (_) {
      toast('Arquivo inválido. Use um backup gerado pelo PrazoCerto.', { tipo: 'erro' });
    }
  };
  leitor.readAsText(arquivo);
}

async function carregarExemplo() {
  if (Store.getTarefas().length) {
    const ok = await confirmar('Carregar dados de exemplo?', 'Suas tarefas atuais serão substituídas por tarefas de demonstração.', 'Carregar');
    if (!ok) return;
  }
  Store.carregarExemplo();
  fecharModal($('#dlg-config'));
  montarSelectMaterias();
  atualizarTudo();
  toast('🧪 Dados de exemplo carregados');
  verificarConquistas();
}

async function apagarTudo() {
  const ok = await confirmar('Apagar todos os dados?', 'Tarefas, matérias, sessões de foco, configurações e conquistas serão apagadas deste navegador. Não dá para desfazer — baixe um backup antes, se quiser.', 'Apagar tudo');
  if (!ok) { abrirModal('dlg-config'); return; }
  Store.apagarTudo();
  clearInterval(timer.intervalo);
  Object.assign(timer, { modo: 'foco', rodando: false, restante: duracaoModo('foco'), tarefaId: '', ciclos: 0 });
  montarSelectMaterias();
  fecharModal($('#dlg-config'));
  atualizarTudo();
  toast('🗑️ Tudo apagado. Recomeçando do zero.');
}

/* ================================================================
   8.1 LEMBRETES DE PRAZO (NOTIFICAÇÕES)
   ----------------------------------------------------------------
   Cada tarefa tem os seus lembretes (na hora, 15 min, 30 min, 1 hora,
   2 horas, 1 dia antes). Sem escolha, ela usa os lembretes padrão das
   Configurações. Cada lembrete é avisado UMA vez: a chave "id|minutos"
   e o prazo ficam salvos (se o prazo mudar, ele volta a valer).
   A notificação sai pelo service worker (registration.showNotification),
   que é o único jeito aceito no Android e no app instalado.
   Limite da web: sem servidor, o lembrete só dispara com o PrazoCerto
   aberto (pode estar minimizado ou em outra aba). Para tocar com o
   celular bloqueado, a tarefa pode ir para o calendário do celular.
   ================================================================ */
const suportaNotificacao = () => 'Notification' in window;
const viaLink = () => window.isSecureContext && location.protocol.startsWith('http');
const ehAndroid = () => /android/i.test(navigator.userAgent);
const urlApp = caminho => new URL(caminho, location.href).href;

const lembretesDe = t => (t && Array.isArray(t.lembretes) ? t.lembretes : Store.getConfig().lembretesPadrao);
const ROTULO_CURTO = { 0: 'na hora', 15: '15min', 30: '30min', 60: '1h', 120: '2h', 1440: '1 dia' };
const chipsLembrete = nome => LEMBRETES.map(l => `<label class="chip-check"><input type="checkbox" name="${nome}" value="${l.min}"><span>${l.label}</span></label>`).join('');
const lerChips = nome => $$(`input[name="${nome}"]:checked`).map(i => Number(i.value)).sort((a, b) => b - a);
const marcarChips = (nome, lista) => $$(`input[name="${nome}"]`).forEach(i => { i.checked = lista.includes(Number(i.value)); });

function textoAntecedencia(min) {
  if (min === 0) return 'na hora do prazo';
  if (min >= 1440) return '1 dia antes';
  if (min >= 60) return `${min / 60} hora${min > 60 ? 's' : ''} antes`;
  return `${min} min antes`;
}
function listaLembretes(lista) {
  const partes = lista.map(textoAntecedencia);
  return partes.length > 1 ? `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}` : partes[0];
}
function textoFalta(min) {
  if (min < 60) return `${Math.max(1, min)} min`;
  if (min < 1440) return formatarMin(Math.round(min / 15) * 15);
  const d = Math.round(min / 1440);
  return `${d} dia${d > 1 ? 's' : ''}`;
}

/** Ao salvar uma tarefa, lembretes cujo horário já passou não disparam de uma vez. */
function pularLembretesPassados(t) {
  if (!t || !t.prazo) return;
  const prazo = new Date(t.prazo).getTime(), agora = Date.now();
  lembretesDe(t).forEach(m => { if (agora >= prazo - m * 60000) Store.marcarAvisado(`${t.id}|${m}`, t.prazo); });
}

function verificarAvisos() {
  const c = Store.getConfig();
  if (!c.aviso) return;
  const agora = Date.now();
  const avisados = Store.getAvisos();
  Store.getTarefas().forEach(t => {
    if (t.concluida || !t.prazo) return;
    const prazo = new Date(t.prazo).getTime();
    if (isNaN(prazo)) return;
    const chegaram = lembretesDe(t).filter(m => avisados[`${t.id}|${m}`] !== t.prazo && agora >= prazo - m * 60000);
    if (!chegaram.length) return;
    // se vários venceram juntos (app estava fechado), avisa uma vez só
    chegaram.forEach(m => Store.marcarAvisado(`${t.id}|${m}`, t.prazo));
    if (agora > prazo + 10 * 60000) return; // já passou faz tempo: não adianta tocar
    dispararAviso(t, prazo - agora);
  });
  agendarProximoAviso();
}

/* Agenda a próxima checagem para o minuto exato do próximo lembrete */
let timeoutAviso = null;
function agendarProximoAviso() {
  clearTimeout(timeoutAviso);
  const c = Store.getConfig();
  if (!c.aviso) return;
  const agora = Date.now();
  let proximo = Infinity;
  Store.getTarefas().forEach(t => {
    if (t.concluida || !t.prazo) return;
    const prazo = new Date(t.prazo).getTime();
    lembretesDe(t).forEach(m => { const alvo = prazo - m * 60000; if (alvo > agora && alvo < proximo) proximo = alvo; });
  });
  if (proximo < Infinity) timeoutAviso = setTimeout(verificarAvisos, Math.min(proximo - agora + 500, 6 * 3600000));
}

async function registroSW() {
  if (!('serviceWorker' in navigator) || !viaLink()) return null;
  try { return await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 3000))]); }
  catch (_) { return null; }
}

/** Mostra a notificação do sistema. Devolve true se conseguiu. */
async function mostrarNotificacao(titulo, corpo, tag, { tarefaId = null, insistente = false, url = null } = {}) {
  if (!suportaNotificacao() || Notification.permission !== 'granted') return false;
  const opcoes = {
    body: corpo, tag, renotify: true, requireInteraction: insistente, lang: 'pt-BR',
    icon: urlApp('assets/icons/icon-192.png'), vibrate: [400, 150, 400, 150, 700],
    data: { tarefaId, url: urlApp(url || (tarefaId ? `./?abrir=${encodeURIComponent(tarefaId)}#tarefas` : './#hoje')) }
  };
  const reg = await registroSW();
  if (reg && reg.showNotification) {
    try { await reg.showNotification(titulo, opcoes); return true; } catch (_) { /* tenta do jeito antigo */ }
  }
  try {
    const n = new Notification(titulo, opcoes);
    n.onclick = () => { window.focus(); n.close(); if (tarefaId) abrirTarefaPorId(tarefaId); };
    return true;
  } catch (_) {
    return false;
  }
}

function abrirTarefaPorId(id) {
  pararAlarme();
  const t = Store.getTarefa(id);
  if (t) abrirFormTarefa(t);
}

function dispararAviso(t, falta) {
  const min = Math.round(falta / 60000);
  const titulo = min <= 1 ? `⏰ É agora: ${t.titulo}` : `⏰ Faltam ${textoFalta(min)}: ${t.titulo}`;
  const d = new Date(t.prazo);
  const quando = diffDias(d, new Date()) === 0 ? 'hoje' : diffDias(d, new Date()) === 1 ? 'amanhã' : dataCurta(d);
  const corpo = `${infoMateria(t.materia).nome} · entrega ${quando} às ${hora(d)}`;
  mostrarNotificacao(titulo, corpo, `prazo-${t.id}`, { tarefaId: t.id, insistente: true });
  tocarAlarme(titulo);
  // o aviso dentro da página aparece sempre (também quando a notificação está bloqueada)
  toast(`${titulo} — ${corpo}`, { duracao: 12000, acao: 'Focar', aoClicar: () => { pararAlarme(); focarEm(t.id); } });
}

/** Texto de ajuda para liberar as notificações, conforme o aparelho. */
function passosDesbloquear() {
  if (ehIOS()) return 'Ajustes do iPhone → Notificações → PrazoCerto → Permitir Notificações.';
  if (ehAndroid() && rodandoComoApp()) return 'Configurações do Android → Apps → PrazoCerto → Notificações → Permitir.';
  if (ehAndroid()) return 'Toque no ícone à esquerda do endereço (⚙️ ou 🔒) → Permissões → Notificações → Permitir. Depois recarregue a página.';
  return 'Clique no ícone à esquerda do endereço (🔒 ou ⚙️) → Notificações → Permitir. Depois recarregue a página (F5).';
}

function atualizarStatusAviso() {
  const ligado = $('#cfg-aviso').checked;
  const el = $('#aviso-status');
  const btnPermitir = $('#btn-permitir-aviso');
  $$('input[name="lembrete-padrao"]').forEach(i => { i.disabled = !ligado; });
  btnPermitir.hidden = true;
  let html = 'Desligado: nenhum lembrete de prazo vai tocar.', classe = '';
  if (ligado) {
    if (!viaLink()) {
      html = 'As notificações só funcionam pelo link do site (<strong>prazocerto.github.io</strong>). Aberto direto do arquivo, o lembrete aparece só dentro do app.'; classe = 'erro-api';
    } else if (ehIOS() && !suportaNotificacao()) {
      html = 'No iPhone, as notificações só funcionam com o app instalado: Safari → Compartilhar ⬆️ → <em>Adicionar à Tela de Início</em>, e abra pelo ícone (iOS 16.4 ou mais novo). Enquanto isso, o lembrete aparece só dentro do app.'; classe = 'erro-api';
    } else if (!suportaNotificacao()) {
      html = 'Este navegador não tem notificações: o lembrete aparece só dentro do app (com som).'; classe = 'erro-api';
    } else if (Notification.permission === 'granted') {
      html = '✅ Notificações liberadas. Os lembretes chegam com o PrazoCerto aberto, mesmo minimizado ou em outra aba. Com o celular bloqueado, use 📅 Google Agenda na tarefa.'; classe = 'ok';
    } else if (Notification.permission === 'denied') {
      html = `🚫 O navegador está bloqueando as notificações. Para liberar:<span class="passos-permissao" style="display:block">${esc(passosDesbloquear())}</span>`; classe = 'erro-api';
    } else {
      html = 'Falta liberar: toque em <strong>Permitir notificações</strong> e depois em <em>Permitir</em>.';
      btnPermitir.hidden = false;
    }
  }
  el.innerHTML = html;
  el.className = `aviso-status ${classe}`;
}

/** Pede permissão ao navegador (precisa vir de um clique). */
async function pedirPermissao() {
  if (!suportaNotificacao() || !viaLink() || Notification.permission !== 'default') return;
  try { await Notification.requestPermission(); } catch (_) { /* navegador antigo */ }
  if (Notification.permission === 'default') {
    toast('O navegador não mostrou a pergunta? Procure um sininho 🔕 na barra de endereço e escolha Permitir.', { duracao: 9000 });
  }
}

async function aoMudarAviso() {
  const ligado = $('#cfg-aviso').checked;
  preparaSom(); // aproveita o clique para liberar o som do aviso
  if (ligado) await pedirPermissao();
  Store.salvarConfig({ aviso: ligado });
  atualizarStatusAviso();
  toast(ligado ? '⏰ Lembretes de prazo ligados' : 'Lembretes de prazo desligados');
  if (ligado) verificarAvisos(); else clearTimeout(timeoutAviso);
  atualizarTudo();
}

/** Liga os avisos a partir de outro lugar (ex.: formulário da tarefa). */
async function ligarAvisos() {
  preparaSom();
  await pedirPermissao();
  Store.salvarConfig({ aviso: true });
  toast('⏰ Lembretes de prazo ligados');
  atualizarDicaLembretes();
  verificarAvisos();
}

async function testarAviso() {
  preparaSom();
  await pedirPermissao();
  const ok = await mostrarNotificacao('🔔 Teste do PrazoCerto', 'Tudo certo! É assim que os lembretes de prazo vão chegar.', 'teste');
  tocarAlarme('Testando o alarme', { som: somDoFormulario() });
  atualizarStatusAviso();
  toast(ok ? '🔔 Notificação de teste enviada' : '🔔 Teste: sem permissão de notificação, o lembrete aparece só aqui na página (com som)');
}

/** Dica embaixo dos lembretes no formulário da tarefa */
function atualizarDicaLembretes() {
  const dica = $('#t-lembretes-dica');
  if (!dica) return;
  const lista = lerChips('lembrete');
  const temPrazo = !!$('#t-prazo').value;
  if (!Store.getConfig().aviso) dica.innerHTML = '⚠️ Os lembretes estão desligados. <button type="button" class="chip-btn" data-acao="ligar-avisos">Ligar lembretes</button>';
  else if (!lista.length) dica.textContent = '🔕 Sem lembrete para esta tarefa.';
  else if (!temPrazo) dica.textContent = 'Defina um prazo para os lembretes funcionarem.';
  else dica.textContent = `Você vai ser avisado ${listaLembretes(lista)}.`;
}

/* ---------- Calendário do celular (alarme garantido mesmo com o app fechado) ---------- */
const dataIcs = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const escIcs = t => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function dobrarIcs(linha) { // linhas de no máximo 75 caracteres (regra do formato .ics)
  const partes = [];
  for (let i = 0; i < linha.length; i += 73) partes.push((i ? ' ' : '') + linha.slice(i, i + 73));
  return partes.join('\r\n');
}
function eventoIcs(t) {
  const inicio = new Date(t.prazo);
  const fimEv = new Date(inicio.getTime() + 15 * 60000);
  const descricao = [`Matéria: ${infoMateria(t.materia).nome}`, t.descricao || '', 'Criado no PrazoCerto — https://prazocerto.github.io/'].filter(Boolean).join('\n');
  const linhas = [
    'BEGIN:VEVENT', `UID:${t.id}@prazocerto.github.io`, `DTSTAMP:${dataIcs(new Date())}`,
    `DTSTART:${dataIcs(inicio)}`, `DTEND:${dataIcs(fimEv)}`,
    `SUMMARY:${escIcs(`⏰ ${t.titulo}`)}`, `DESCRIPTION:${escIcs(descricao)}`
  ];
  lembretesDe(t).forEach(m => linhas.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escIcs(`${t.titulo} — ${textoAntecedencia(m)}`)}`, `TRIGGER:${m ? `-PT${m}M` : 'PT0M'}`, 'END:VALARM'));
  linhas.push('END:VEVENT');
  return linhas;
}
function baixarIcs(tarefas, nomeArquivo) {
  const linhas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PrazoCerto//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...tarefas.flatMap(eventoIcs), 'END:VCALENDAR'];
  const ics = linhas.map(dobrarIcs).join('\r\n') + '\r\n';
  if (ehIOS()) { location.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`; return; } // no iPhone abre direto o "Adicionar ao Calendário"
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nomeArquivo });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/** Tarefa com os dados que estão no formulário agora (mesmo sem salvar). */
function tarefaDoFormulario() {
  const titulo = $('#t-titulo').value.trim(), prazo = $('#t-prazo').value;
  if (!prazo) { toast('Defina um prazo primeiro para criar o alarme no calendário.', { tipo: 'erro' }); $('#t-prazo').focus(); return null; }
  return { id: $('#t-id').value || `t-${Date.now().toString(36)}`, titulo: titulo || 'Tarefa', prazo,
    materia: $('#t-materia').value, descricao: $('#t-descricao').value.trim(), lembretes: lerChips('lembrete') };
}
function calendarioGoogle() {
  const t = tarefaDoFormulario();
  if (!t) return;
  const ini = new Date(t.prazo), fimEv = new Date(ini.getTime() + 15 * 60000);
  const lembr = t.lembretes.length ? `Lembretes: ${listaLembretes(t.lembretes)}.` : '';
  const params = new URLSearchParams({ action: 'TEMPLATE', text: `⏰ ${t.titulo}`, dates: `${dataIcs(ini)}/${dataIcs(fimEv)}`,
    details: [`Matéria: ${infoMateria(t.materia).nome}`, t.descricao, lembr, 'Criado no PrazoCerto — https://prazocerto.github.io/'].filter(Boolean).join('\n') });
  window.open(`https://calendar.google.com/calendar/render?${params}`, '_blank', 'noopener');
  toast('📅 No Google Agenda, confira a notificação (ex.: 1 hora antes) e toque em Salvar.', { duracao: 8000 });
}
function calendarioIcs() {
  const t = tarefaDoFormulario();
  if (!t) return;
  baixarIcs([t], `prazo-${normalizar(t.titulo).replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'tarefa'}.ics`);
  toast('📅 Abra o arquivo baixado para adicionar ao calendário, com os alarmes desta tarefa.', { duracao: 8000 });
}
function exportarTodosCalendario() {
  const agora = new Date();
  const futuras = Store.getTarefas().filter(t => !t.concluida && t.prazo && new Date(t.prazo) > agora);
  if (!futuras.length) { toast('Nenhuma tarefa pendente com prazo no futuro para exportar.', { tipo: 'erro' }); return; }
  baixarIcs(futuras, 'prazocerto-prazos.ics');
  toast(`📅 ${futuras.length} prazo(s) exportado(s). Abra o arquivo para adicionar ao seu calendário.`, { duracao: 8000 });
}

/* ================================================================
   9. NOVIDADES: REPETIÇÃO, AULAS, MODO PROVA, RESUMO E COMPARTILHAR
   ================================================================ */

/* ---------- 9.1 Tarefas que se repetem ----------
   Ao concluir uma tarefa com repetição, a próxima é criada com o prazo
   avançado (pulando datas que já passaram). "Desfazer" apaga a próxima. */
const infoRepeticao = id => REPETICOES.find(r => r.id === id) || REPETICOES[0];

function avancarPrazo(prazo, repetir) {
  const d = new Date(prazo);
  const diaDoMes = d.getDate();
  const passo = () => {
    switch (repetir) {
      case 'diaria': d.setDate(d.getDate() + 1); break;
      case 'uteis': do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); break;
      case 'semanal': d.setDate(d.getDate() + 7); break;
      case 'quinzenal': d.setDate(d.getDate() + 14); break;
      case 'mensal': {
        // mantém o dia do mês; em meses mais curtos, usa o último dia (ex.: 31 → 30)
        const alvo = new Date(d.getFullYear(), d.getMonth() + 1, 1, d.getHours(), d.getMinutes());
        const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
        alvo.setDate(Math.min(diaDoMes, ultimo));
        d.setTime(alvo.getTime());
        break;
      }
      default: d.setDate(d.getDate() + 7);
    }
  };
  let guarda = 0;
  do { passo(); } while (d <= new Date() && ++guarda < 1000);
  return paraInput(d);
}

function criarProximaRepeticao(t) {
  if (!t || !t.repetir || !t.prazo) return null;
  if (t.proximaId && Store.getTarefa(t.proximaId)) return null; // já criada
  const base = Date.now().toString(36);
  const nova = Store.salvarTarefa({
    titulo: t.titulo, materia: t.materia, tipo: t.tipo, prioridade: t.prioridade,
    estimativa: t.estimativa, descricao: t.descricao, repetir: t.repetir,
    prazo: avancarPrazo(t.prazo, t.repetir),
    subtarefas: (t.subtarefas || []).filter(x => !x.plano).map((x, i) => ({ id: `s-${base}-${i}`, texto: x.texto, feita: false })),
    ...(Array.isArray(t.lembretes) ? { lembretes: t.lembretes } : {})
  });
  pularLembretesPassados(nova);
  Store.salvarTarefa({ id: t.id, proximaId: nova.id });
  return nova;
}

function desfazerRepeticao(id) {
  const t = Store.getTarefa(id);
  if (!t || !t.proximaId) return;
  const proxima = Store.getTarefa(t.proximaId);
  if (proxima && !proxima.concluida) Store.removerTarefa(proxima.id);
  Store.salvarTarefa({ id, proximaId: null });
}

/* ---------- 9.2 Horário das aulas e horários livres ---------- */
const ORDEM_SEMANA = [1, 2, 3, 4, 5, 6, 0]; // a semana começa na segunda
const paraMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const deMin = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const aulasDoDia = diaSemana => Store.getAulas().filter(a => a.dia === diaSemana);
const minutosAgora = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

function aulaLinhaHTML(a, ehHoje, comFalta = false) {
  const mat = infoMateria(a.materia);
  const agora = minutosAgora();
  const acontecendo = ehHoje && agora >= paraMin(a.inicio) && agora < paraMin(a.fim);
  const passou = ehHoje && agora >= paraMin(a.fim);
  return `<li class="${passou ? 'aula-passou' : ''}">
    <span class="hora-tag">${a.inicio}–${a.fim}</span>
    <span class="materia-tag" style="--cor:${mat.cor}">${esc(mat.nome)}</span>
    ${a.local ? `<span class="sub">📍 ${esc(a.local)}</span>` : ''}
    ${acontecendo ? '<span class="agora-tag">agora</span>' : ''}
    ${comFalta ? botaoFaltaHTML(a) : ''}
  </li>`;
}

/** Blocos livres de um dia (em minutos), sem as aulas e dentro da janela de estudo. */
function horariosLivres(dia, minimo = 45) {
  const c = Store.getConfig();
  const rel = diffDias(dia, new Date());
  if (rel < 0) return [];
  let inicio = paraMin(c.estudoInicio);
  const fim = paraMin(c.estudoFim);
  if (rel === 0) inicio = Math.max(inicio, Math.ceil(minutosAgora() / 15) * 15);
  // 10 minutos antes e depois de cada aula para o deslocamento
  const ocupados = aulasDoDia(dia.getDay()).map(a => [paraMin(a.inicio) - 10, paraMin(a.fim) + 10]).sort((x, y) => x[0] - y[0]);
  const livres = [];
  let cursor = inicio;
  ocupados.forEach(([a, b]) => { if (a - cursor >= minimo) livres.push([cursor, a]); cursor = Math.max(cursor, b); });
  if (fim - cursor >= minimo) livres.push([cursor, fim]);
  return livres;
}

/** Sugestão do que estudar: a revisão de prova do dia ou a tarefa pendente mais urgente. */
function sugestaoDeEstudo() {
  const rev = revisoesDeHoje()[0];
  if (rev) return { tarefa: rev.tarefa, texto: `${rev.tarefa.titulo}: ${rev.sub.texto.split(' — ').pop()}` };
  const t = Store.getTarefas().filter(x => !x.concluida && x.prazo).sort(compararPrazo)[0];
  return t ? { tarefa: t, texto: t.titulo } : null;
}

function renderAulasELivresDoDia(d) {
  const ehHoje = diffDias(d, new Date()) === 0;
  const aulas = aulasDoDia(d.getDay());
  $('#dia-aulas').innerHTML = aulas.length
    ? `<div class="dia-bloco"><h3>🎓 Aulas</h3><ul class="mini-lista">${aulas.map(a => aulaLinhaHTML(a, ehHoje)).join('')}</ul></div>` : '';
  // horários livres: hoje sempre; outros dias só quando há aula (senão seria o dia inteiro)
  if (!(ehHoje || aulas.length) || diffDias(d, new Date()) < 0) { $('#dia-livres').innerHTML = ''; return; }
  const livres = horariosLivres(d).slice(0, 3);
  const sug = ehHoje ? sugestaoDeEstudo() : null;
  $('#dia-livres').innerHTML = `<div class="dia-bloco"><h3>🕒 Horários livres para estudar</h3>${livres.length
    ? livres.map(([a, b], i) => `<div class="livre"><span>🟢 <b>${deMin(a)}–${deMin(b)}</b> · ${formatarMin(b - a)} livre${b - a > 59 ? 's' : ''}</span>
        ${i === 0 && sug ? `<span class="sub">Sugestão: ${esc(sug.texto)}</span><button type="button" class="btn btn--ghost btn--sm" data-acao="focar" data-id="${sug.tarefa.id}">🍅 Focar</button>` : ''}</div>`).join('')
    : '<p class="sub">Sem um intervalo livre de pelo menos 45 minutos neste dia.</p>'}</div>`;
}

function renderAulasSemana() {
  const aulas = Store.getAulas();
  const hojeDia = new Date().getDay();
  if (!aulas.length) {
    $('#aulas-semana').innerHTML = '<p class="sub">Nenhuma aula cadastrada ainda. Toque em <b>＋ Adicionar aula</b>: dá para marcar vários dias de uma vez.</p>';
    return;
  }
  $('#aulas-semana').innerHTML = `<div class="semana-aulas">${ORDEM_SEMANA.filter(d => aulas.some(a => a.dia === d)).map(d => `
    <div class="semana-dia ${d === hojeDia ? 'hoje' : ''}">
      <h3>${DIAS_SEMANA[d]}${d === hojeDia ? ' · hoje' : ''}</h3>
      ${aulas.filter(a => a.dia === d).map(a => {
        const mat = infoMateria(a.materia);
        return `<button type="button" class="aula-chip" style="--cor:${mat.cor}" data-acao="editar-aula" data-id="${a.id}"
          aria-label="Editar aula de ${esc(mat.nome)}, ${DIAS_SEMANA[d]}, das ${a.inicio} às ${a.fim}">
          <b>${esc(mat.nome)}</b><small>${a.inicio}–${a.fim}${a.local ? ` · ${esc(a.local)}` : ''}</small></button>`;
      }).join('')}
    </div>`).join('')}</div>`;
}

function abrirFormAula(aula = null) {
  const editando = !!(aula && aula.id);
  $('#aula-titulo').textContent = editando ? '✏️ Editar aula' : '🎓 Nova aula';
  $('#a-id').value = editando ? aula.id : '';
  $('#a-materia').value = editando ? aula.materia : Store.getMaterias()[0].id;
  marcarChips('aula-dia', editando ? [aula.dia] : []);
  $('#a-inicio').value = editando ? aula.inicio : '19:10';
  $('#a-fim').value = editando ? aula.fim : '20:50';
  $('#a-local').value = editando ? aula.local : '';
  $('#a-dias-dica').textContent = editando ? '(marcando outro dia, a aula é copiada para ele)' : '(marque todos os dias que tem essa aula)';
  $('#btn-excluir-aula').hidden = !editando;
  $('#erro-aula').hidden = true;
  abrirModal('dlg-aula');
}

function salvarFormAula(e) {
  e.preventDefault();
  const id = $('#a-id').value;
  const dias = lerChips('aula-dia');
  const dados = { materia: $('#a-materia').value, inicio: $('#a-inicio').value, fim: $('#a-fim').value, local: $('#a-local').value.trim() };
  const erro = $('#erro-aula');
  const mostrar = msg => { erro.textContent = msg; erro.hidden = false; };
  if (!dias.length) return mostrar('Marque pelo menos um dia da semana.');
  if (!dados.inicio || !dados.fim || dados.inicio >= dados.fim) return mostrar('O horário de término precisa ser depois do início.');
  const conflito = Store.getAulas().find(a => a.id !== id && dias.includes(a.dia) && dados.inicio < a.fim && a.inicio < dados.fim);
  if (conflito) return mostrar(`Já tem aula de ${infoMateria(conflito.materia).nome} na ${DIAS_SEMANA[conflito.dia].toLowerCase()} das ${conflito.inicio} às ${conflito.fim}.`);
  erro.hidden = true;
  const ordenados = ORDEM_SEMANA.filter(d => dias.includes(d));
  ordenados.forEach((dia, i) => Store.salvarAula({ ...dados, dia, ...(id && i === 0 ? { id } : {}) }));
  fecharModal($('#dlg-aula'));
  toast(id ? '✏️ Aula atualizada' : `🎓 Aula adicionada em ${ordenados.length} dia(s)`);
  atualizarTudo();
}

function excluirAula() {
  const id = $('#a-id').value;
  const aula = Store.getAulas().find(a => a.id === id);
  if (!aula) return;
  Store.removerAula(id);
  fecharModal($('#dlg-aula'));
  toast(`🗑️ Aula de ${infoMateria(aula.materia).nome} removida`, { acao: 'Desfazer', aoClicar: () => { Store.salvarAula({ ...aula, id: undefined }); atualizarTudo(); } });
  atualizarTudo();
}

/* ---------- 9.3 Modo prova: plano de revisão ----------
   Divide o estudo pelos dias que faltam (no máximo 7 sessões).
   Cada sessão vira uma etapa do checklist com a data dela. */
function gerarPlanoRevisao(prazo, agora = new Date()) {
  const prova = new Date(prazo);
  if (isNaN(prova) || prova < agora) return null;
  const inicio = agora.getHours() >= 21 ? somarDias(inicioDia(agora), 1) : inicioDia(agora); // de noite, começa amanhã
  const dias = diffDias(prova, inicio); // dias livres antes do dia da prova
  const datas = [];
  if (dias <= 0) datas.push(inicioDia(prova));
  else {
    const n = Math.min(dias, 7);
    for (let i = 0; i < n; i++) datas.push(somarDias(inicio, n === 1 ? 0 : Math.round(i * (dias - 1) / (n - 1))));
  }
  const n = datas.length;
  let textos;
  if (n === 1) textos = [dias <= 0 ? 'Revisão rápida dos pontos principais ⚡' : 'Revisão geral + exercícios 🧪'];
  else if (n === 2) textos = ['Estudar o conteúdo e fazer um resumo 📖', 'Revisão final leve e dormir bem 😴'];
  else if (n === 3) textos = ['Estudar o conteúdo 📖', 'Resolver exercícios / simulado 🧪', 'Revisão final leve e dormir bem 😴'];
  else {
    const partes = n - 3;
    textos = [...Array.from({ length: partes }, (_, i) => `Estudar o conteúdo (parte ${i + 1} de ${partes}) 📖`),
      'Fazer resumo ou mapa mental 🗺️', 'Resolver exercícios / simulado 🧪', 'Revisão final leve e dormir bem 😴'];
  }
  const base = Date.now().toString(36);
  return datas.map((d, i) => ({ id: `p-${base}-${i}`, texto: `${maiuscula(dataCurta(d))} — ${textos[i]}`, feita: false, data: dataISO(d), plano: true }));
}

function atualizarModoProva() {
  const caixa = $('#t-modo-prova');
  const ehProva = $('#t-tipo').value === 'prova';
  caixa.hidden = !ehProva;
  if (!ehProva) return;
  const prazo = $('#t-prazo').value;
  const btn = $('#btn-plano-revisao');
  const temPlano = estado.subtarefasEdicao.some(x => x.plano);
  btn.textContent = temPlano ? '🔄 Refazer plano' : 'Criar plano de revisão';
  if (!prazo || new Date(prazo) < new Date()) {
    $('#modo-prova-texto').textContent = 'Coloque a data e a hora da prova (no futuro) para montar o plano de revisão.';
    btn.disabled = true;
    return;
  }
  btn.disabled = false;
  const plano = gerarPlanoRevisao(prazo) || [];
  const faltam = diffDias(new Date(prazo), new Date());
  $('#modo-prova-texto').textContent = faltam <= 0
    ? 'A prova é hoje: o plano vira uma revisão rápida.'
    : `Faltam ${faltam} dia(s): o plano terá ${plano.length} sessão(ões) de revisão, uma por dia, e cada uma vira uma etapa do checklist.`;
}

function criarPlanoNoFormulario() {
  const plano = gerarPlanoRevisao($('#t-prazo').value);
  if (!plano) { toast('Coloque uma data de prova no futuro.', { tipo: 'erro' }); return; }
  estado.subtarefasEdicao = [...estado.subtarefasEdicao.filter(x => !x.plano), ...plano];
  renderSubtarefasEdicao();
  atualizarModoProva();
  toast(`📚 Plano com ${plano.length} sessão(ões) criado. Salve a tarefa para guardar.`);
}

function criarPlanoDireto(id) {
  const t = Store.getTarefa(id);
  const plano = t && gerarPlanoRevisao(t.prazo);
  if (!plano) return;
  Store.salvarTarefa({ id, subtarefas: [...t.subtarefas.filter(x => !x.plano), ...plano] });
  toast(`📚 Plano de revisão criado: ${plano.length} sessão(ões) até a prova`);
  atualizarTudo();
}

/** Sessões de revisão marcadas para hoje (e atrasadas), da prova mais próxima para a mais distante. */
function revisoesDeHoje() {
  const hoje = dataISO(new Date());
  return Store.getTarefas().filter(t => !t.concluida && t.tipo === 'prova' && t.prazo).sort(compararPrazo)
    .flatMap(t => (t.subtarefas || []).filter(x => x.plano && !x.feita && x.data === hoje).map(sub => ({ tarefa: t, sub })));
}

function renderHojeExtra() {
  const agora = new Date();
  const cards = [];
  const fazer = fazerAgoraHTML();
  if (fazer) cards.push(fazer);
  // Aulas de hoje + intervalo livre agora
  const aulas = aulasDoDia(agora.getDay());
  if (aulas.length) {
    const livreAgora = horariosLivres(agora, 30).find(([a]) => a <= Math.ceil(minutosAgora() / 15) * 15);
    const sug = livreAgora && sugestaoDeEstudo();
    cards.push(`<section class="card extra-card" aria-labelledby="titulo-aulas-hoje">
      <h2 id="titulo-aulas-hoje">🎓 Aulas de hoje</h2>
      <ul class="mini-lista">${aulas.map(a => aulaLinhaHTML(a, true, true)).join('')}</ul>
      ${livreAgora ? `<p class="sub">🟢 Livre agora até ${deMin(livreAgora[1])}${sug ? ` · bom momento para: <b>${esc(sug.texto)}</b>` : ''}</p>
        ${sug ? `<div class="botoes-linha"><button type="button" class="btn btn--ghost btn--sm" data-acao="focar" data-id="${sug.tarefa.id}">🍅 Focar agora</button></div>` : ''}` : ''}
    </section>`);
  }
  // Modo prova: revisão de hoje, ou prova chegando sem plano
  const provas = Store.getTarefas().filter(t => !t.concluida && t.tipo === 'prova' && t.prazo && new Date(t.prazo) >= agora).sort(compararPrazo);
  const prova = provas.find(t => diffDias(new Date(t.prazo), agora) <= 14);
  if (prova) {
    const faltam = diffDias(new Date(prova.prazo), agora);
    const quando = faltam === 0 ? 'é hoje' : faltam === 1 ? 'é amanhã' : `em ${faltam} dias`;
    const plano = prova.subtarefas.filter(x => x.plano);
    const hojeISO = dataISO(agora);
    const deHoje = plano.find(x => x.data === hojeISO && !x.feita);
    const atrasadas = plano.filter(x => x.data < hojeISO && !x.feita).length;
    const feitas = plano.filter(x => x.feita).length;
    let corpo;
    if (!plano.length) {
      corpo = `<p class="sub">Ainda sem plano de revisão. O app divide o estudo pelos dias que faltam.</p>
        <div class="botoes-linha"><button type="button" class="btn btn--primary btn--sm" data-acao="criar-plano" data-id="${prova.id}">📚 Criar plano de revisão</button></div>`;
    } else if (deHoje) {
      corpo = `<div class="revisao-hoje"><span class="sub">Revisão de hoje</span><strong>${esc(deHoje.texto.split(' — ').pop())}</strong>
        <div class="botoes-linha">
          <button type="button" class="btn btn--primary btn--sm" data-acao="sub" data-id="${prova.id}" data-sub="${deHoje.id}">✓ Feito</button>
          <button type="button" class="btn btn--ghost btn--sm" data-acao="focar" data-id="${prova.id}">🍅 Focar</button>
        </div></div>`;
    } else {
      corpo = `<p class="sub">${feitas === plano.length ? '✅ Plano de revisão completo. Boa prova!' : 'Hoje não tem sessão de revisão marcada. Descanse ou adiante a próxima.'}</p>`;
    }
    cards.push(`<section class="card extra-card" aria-labelledby="titulo-prova-hoje">
      <h2 id="titulo-prova-hoje">📚 ${esc(prova.titulo)} ${quando}</h2>
      <p class="sub">${maiuscula(dataCurta(new Date(prova.prazo)))} às ${hora(new Date(prova.prazo))}${plano.length ? ` · ${feitas}/${plano.length} sessões feitas` : ''}${atrasadas ? ` · ⚠️ ${atrasadas} atrasada(s)` : ''}</p>
      ${corpo}
    </section>`);
  }
  $('#hoje-extra').innerHTML = cards.join('');
}

/* ---------- 9.4 Resumo do dia ---------- */
function conteudoResumo() {
  const agora = new Date();
  const pend = Store.getTarefas().filter(t => !t.concluida && t.prazo).sort(compararPrazo);
  const linha = t => `<li><b>${hora(new Date(t.prazo))}</b> · ${esc(t.titulo)} <span class="sub">(${esc(infoMateria(t.materia).nome)})</span></li>`;
  const aulas = aulasDoDia(agora.getDay());
  const atrasadas = pend.filter(t => new Date(t.prazo) < agora);
  const hoje = pend.filter(t => new Date(t.prazo) >= agora && diffDias(new Date(t.prazo), agora) === 0);
  const amanha = pend.filter(t => diffDias(new Date(t.prazo), agora) === 1);
  const revisoes = revisoesDeHoje();
  const s = calcularStats();
  const secoes = [];
  if (atrasadas.length) secoes.push(`<div class="resumo-sec alerta"><h3>⚠️ Atrasadas (${atrasadas.length})</h3><ul>${atrasadas.slice(0, 4).map(t => `<li>${esc(t.titulo)} <span class="sub">· venceu ${dataCurta(new Date(t.prazo))}</span></li>`).join('')}</ul></div>`);
  if (aulas.length) secoes.push(`<div class="resumo-sec"><h3>🎓 Aulas de hoje</h3><ul>${aulas.map(a => `<li><b>${a.inicio}–${a.fim}</b> · ${esc(infoMateria(a.materia).nome)}${a.local ? ` <span class="sub">(${esc(a.local)})</span>` : ''}</li>`).join('')}</ul></div>`);
  if (hoje.length) secoes.push(`<div class="resumo-sec"><h3>📌 Vencem hoje (${hoje.length})</h3><ul>${hoje.map(linha).join('')}</ul></div>`);
  if (revisoes.length) secoes.push(`<div class="resumo-sec"><h3>📚 Revisão de prova</h3><ul>${revisoes.map(r => `<li>${esc(r.tarefa.titulo)}: ${esc(r.sub.texto.split(' — ').pop())}</li>`).join('')}</ul></div>`);
  if (amanha.length) secoes.push(`<div class="resumo-sec"><h3>⏭️ Amanhã (${amanha.length})</h3><ul>${amanha.map(linha).join('')}</ul></div>`);
  const vazio = !atrasadas.length && !hoje.length && !amanha.length && !revisoes.length;
  return `${vazio ? '<p class="resumo-tudo-livre">🏖️ Nada vencendo hoje nem amanhã. Dia tranquilo: que tal adiantar alguma coisa?</p>' : ''}
    ${secoes.join('')}
    ${s.sequencia ? `<p class="resumo-tudo-livre">🔥 Você está há ${s.sequencia} dia(s) seguidos concluindo tarefas. Não quebra a sequência!</p>` : ''}`;
}

function mostrarResumo() {
  const agora = new Date();
  const nome = Store.getConfig().nome;
  $('#resumo-data').textContent = maiuscula(agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }));
  const emoji = agora.getHours() < 12 && agora.getHours() >= 5 ? '☀️' : agora.getHours() < 18 && agora.getHours() >= 5 ? '🌤️' : '🌙';
  $('#resumo-titulo').textContent = `${emoji} ${saudacao()}${nome ? `, ${nome}` : ''}! Seu dia:`;
  $('#resumo-conteudo').innerHTML = conteudoResumo();
  $('#resumo-todo-dia').checked = Store.getConfig().resumoDiario;
  abrirModal('dlg-resumo');
}

function mostrarResumoSeNovoDia() {
  const hojeISO = dataISO(new Date());
  if (!Store.getConfig().resumoDiario || Store.getResumoVisto() === hojeISO || $('dialog[open]')) return;
  if (!Store.getTarefas().some(t => !t.concluida) && !Store.getAulas().length) return; // nada para resumir ainda
  Store.marcarResumoVisto(hojeISO);
  mostrarResumo();
}

/* ---------- 9.5 Compartilhar tarefa por link ----------
   A tarefa vai dentro do próprio link (JSON em base64), sem servidor:
   quem abre vê a prévia e adiciona no PrazoCerto dele. */
const base64url = {
  codificar: texto => { let bin = ''; new TextEncoder().encode(texto).forEach(b => { bin += String.fromCharCode(b); }); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  decodificar: cod => { const bin = atob(cod.replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); }
};
const ESTIMATIVAS = [15, 30, 45, 60, 90, 120, 180, 300];

function pacoteDoFormulario() {
  const mat = infoMateria($('#t-materia').value);
  return {
    v: 1, t: $('#t-titulo').value.trim(), ti: $('#t-tipo').value, p: $('#t-prazo').value,
    pr: $('input[name="prioridade"]:checked')?.value || 'media', e: Number($('#t-estimativa').value),
    d: $('#t-descricao').value.trim(), s: estado.subtarefasEdicao.map(x => x.texto).slice(0, 30),
    r: $('#t-repetir').value, m: { n: mat.nome, c: mat.cor }, de: Store.getConfig().nome
  };
}

/** Lê e valida um pacote vindo de um link (dado de fora: nunca confiar). */
function lerPacote(cod) {
  const bruto = JSON.parse(base64url.decodificar(cod));
  const txt = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const titulo = txt(bruto && bruto.t, 80);
  if (!bruto || typeof bruto !== 'object' || titulo.length < 3) throw new Error('pacote inválido');
  const prazo = typeof bruto.p === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(bruto.p) && !isNaN(new Date(bruto.p)) ? bruto.p : '';
  const m = bruto.m && typeof bruto.m === 'object' ? bruto.m : {};
  return {
    titulo, prazo,
    tipo: TIPOS.some(x => x.id === bruto.ti) ? bruto.ti : 'outro',
    prioridade: PRIORIDADES.some(x => x.id === bruto.pr) ? bruto.pr : 'media',
    estimativa: ESTIMATIVAS.includes(bruto.e) ? bruto.e : 60,
    descricao: txt(bruto.d, 400),
    subtarefas: (Array.isArray(bruto.s) ? bruto.s : []).map(x => txt(x, 80)).filter(Boolean).slice(0, 30),
    repetir: prazo && REPETICOES.some(x => x.id && x.id === bruto.r) ? bruto.r : '',
    materia: { nome: txt(m.n, 30) || 'Compartilhada', cor: /^#[0-9a-f]{6}$/i.test(m.c) ? m.c : CORES_MATERIA[0] },
    de: txt(bruto.de, 20)
  };
}

function previaHTML(d) {
  const tipo = infoTipo(d.tipo), prio = infoPrioridade(d.prioridade);
  const prazo = d.prazo ? `⏰ ${dataCurta(new Date(d.prazo))} às ${hora(new Date(d.prazo))}` : 'Sem prazo';
  return `<h3>${tipo.emoji} ${esc(d.titulo)}</h3>
    <p>${esc(d.materia.nome)} · ${prio.emoji} ${prio.label} · ${prazo}${d.repetir ? ` · 🔁 ${esc(infoRepeticao(d.repetir).curto)}` : ''}</p>
    ${d.descricao ? `<p>${esc(d.descricao)}</p>` : ''}
    ${d.subtarefas.length ? `<ul>${d.subtarefas.slice(0, 6).map(x => `<li>${esc(x)}</li>`).join('')}${d.subtarefas.length > 6 ? `<li>+ ${d.subtarefas.length - 6} etapa(s)</li>` : ''}</ul>` : ''}`;
}

let compartilhamento = { link: '', texto: '', titulo: '' };
function abrirCompartilhar() {
  const pacote = pacoteDoFormulario();
  if (pacote.t.length < 3) { mostrarErroTitulo('Dê um nome para a tarefa antes de compartilhar.'); $('#t-titulo').focus(); return; }
  const base = viaLink() ? `${location.origin}${location.pathname}` : 'https://prazocerto.github.io/';
  const link = `${base}?tarefa=${base64url.codificar(JSON.stringify(pacote))}`;
  const d = lerPacote(base64url.codificar(JSON.stringify(pacote)));
  const prazoTxt = d.prazo ? `⏰ Entrega: ${dataCurta(new Date(d.prazo))} às ${hora(new Date(d.prazo))}\n` : '';
  const texto = `📌 ${d.titulo} (${d.materia.nome})\n${prazoTxt}\nAdiciona no seu PrazoCerto com um toque:`;
  compartilhamento = { link, texto, titulo: d.titulo };
  $('#compartilhar-previa').innerHTML = previaHTML(d);
  $('#btn-whats').href = `https://wa.me/?text=${encodeURIComponent(`${texto}\n${link}`)}`;
  $('#btn-mais-opcoes').hidden = !navigator.share;
  abrirModal('dlg-compartilhar');
}

async function copiarLinkCompartilhado() {
  try { await navigator.clipboard.writeText(compartilhamento.link); toast('🔗 Link copiado! Cole no grupo da turma.'); }
  catch (_) { prompt('Copie o link:', compartilhamento.link); }
}

async function compartilharNativo() {
  try { await navigator.share({ title: `PrazoCerto: ${compartilhamento.titulo}`, text: compartilhamento.texto, url: compartilhamento.link }); }
  catch (_) { /* a pessoa cancelou */ }
}

let tarefaRecebida = null;
function verificarTarefaCompartilhada() {
  const cod = new URLSearchParams(location.search).get('tarefa');
  if (!cod) return;
  history.replaceState(null, '', location.pathname + location.hash);
  try { tarefaRecebida = lerPacote(cod); }
  catch (_) { toast('Esse link de tarefa está incompleto. Peça para mandarem de novo.', { tipo: 'erro', duracao: 7000 }); return; }
  const d = tarefaRecebida;
  const repetida = Store.getTarefas().some(t => normalizar(t.titulo) === normalizar(d.titulo) && t.prazo === d.prazo);
  $('#importar-sub').textContent = `${d.de ? `${d.de} compartilhou` : 'Compartilharam'} esta tarefa com você.${repetida ? ' Você já tem uma tarefa igual a essa.' : ''}`;
  $('#importar-previa').innerHTML = previaHTML(d);
  abrirModal('dlg-importar');
}

function importarTarefaCompartilhada() {
  const d = tarefaRecebida;
  if (!d) return;
  let mat = Store.getMaterias().find(m => normalizar(m.nome) === normalizar(d.materia.nome));
  if (!mat) { mat = Store.criarMateria(d.materia.nome, d.materia.cor); montarSelectMaterias(); }
  const base = Date.now().toString(36);
  const t = Store.salvarTarefa({
    titulo: d.titulo, prazo: d.prazo, tipo: d.tipo, prioridade: d.prioridade, estimativa: d.estimativa,
    descricao: d.descricao, materia: mat.id, repetir: d.repetir,
    subtarefas: d.subtarefas.map((texto, i) => ({ id: `s-${base}-${i}`, texto, feita: false }))
  });
  pularLembretesPassados(t);
  tarefaRecebida = null;
  fecharModal($('#dlg-importar'));
  toast(`✅ “${t.titulo}” adicionada às suas tarefas`, { acao: 'Ver', aoClicar: () => abrirFormTarefa(Store.getTarefa(t.id)) });
  atualizarTudo();
  verificarConquistas();
}

/* ================================================================
   10. ESTUDO: MATÉRIAS (NOTAS, FALTAS, ANOTAÇÕES, FLASHCARDS),
       FAZER AGORA, SEMESTRE, METAS, RELATÓRIO, SONS E IMPORTAÇÃO
   ================================================================ */
const numeroBR = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
const fmtNum = (n, casas = 1) => n.toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: 0 });
const hojeISO = () => dataISO(new Date());
const diaParaData = iso => new Date(`${iso}T12:00`);

function atualizarCampoMedia() {
  const mencao = $('#cfg-sistema-notas').value === 'mencao';
  $('#campo-media').hidden = mencao;
  $('#dica-mencao').hidden = !mencao;
}

function abrirConfigEm(seletor) {
  $('#btn-config').click();
  setTimeout(() => { const el = $(seletor); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } }, 120);
}

/* ---------- 10.1 Semestre ---------- */
function semestreInfo() {
  const c = Store.getConfig();
  if (!c.semestreInicio || !c.semestreFim || c.semestreInicio >= c.semestreFim) return null;
  const ini = diaParaData(c.semestreInicio), fim = diaParaData(c.semestreFim), hoje = diaParaData(hojeISO());
  const total = diffDias(fim, ini) + 1;
  const passados = Math.min(total, Math.max(0, diffDias(hoje, ini) + 1));
  return { ini, fim, total, passados, pct: Math.round(passados / total * 100), restam: Math.max(0, diffDias(fim, hoje)), terminou: hoje > fim, comecou: hoje >= ini };
}

/** Quantas aulas da matéria cabem no semestre (pelo horário cadastrado). */
function encontrosNoSemestre(idMateria) {
  const sem = semestreInfo();
  if (!sem) return null;
  const aulas = Store.getAulas().filter(a => a.materia === idMateria);
  if (!aulas.length) return null;
  let n = 0;
  for (let d = new Date(sem.ini); d <= sem.fim; d = somarDias(d, 1)) n += aulas.filter(a => a.dia === d.getDay()).length;
  return n;
}

/* ---------- 10.2 Notas (número de 0 a 10 ou menções SS…SR) ---------- */
const usaMencao = () => Store.getConfig().sistemaNotas === 'mencao';
const MENCAO_MINIMA = 'MM';
/** Número → menção, pela faixa (SS 9–10, MS 7–8,9, MM 5–6,9, MI 3–4,9, II 0,1–2,9, SR 0). */
function mencaoDe(n) { return (MENCOES.find(m => n >= m.min - 1e-9 && (m.id !== 'SR' || n <= 0)) || MENCOES[MENCOES.length - 1]).id; }
/** Menor menção que alcança a média de que a pessoa precisa nas avaliações que faltam. */
function mencaoNecessaria(precisa) {
  if (precisa > 10 + 1e-9) return null;
  const crescente = [...MENCOES].reverse();
  const m = crescente.find(x => x.valor >= precisa - 1e-9);
  return m ? m.id : 'SS';
}
const nomeMencao = id => { const m = MENCOES.find(x => x.id === id); return m ? `${m.id} (${m.nome})` : id; };

function infoNotas(idMateria) {
  const e = Store.getEstudo(idMateria);
  const minima = MENCOES.find(m => m.id === MENCAO_MINIMA).min;
  const media = usaMencao() ? minima : e.media ?? Store.getConfig().mediaAprovacao;
  const avs = e.avaliacoes;
  if (!avs.length) return { vazio: true, media };
  const pesoTotal = avs.reduce((t, a) => t + a.peso, 0);
  const feitas = avs.filter(a => a.nota !== null);
  const pesoFeito = feitas.reduce((t, a) => t + a.peso, 0);
  const pontos = feitas.reduce((t, a) => t + a.nota * a.peso, 0);
  const pesoRestante = pesoTotal - pesoFeito;
  const faltam = avs.filter(a => a.nota === null);
  const base = { media, mediaAtual: pesoFeito ? pontos / pesoFeito : null, faltam, pesoTotal };
  if (!pesoRestante) {
    const final = pontos / pesoTotal;
    return { ...base, final, situacao: final >= media - 1e-9 ? 'aprovado' : 'reprovado', nivel: final >= media - 1e-9 ? 'ok' : 'perigo' };
  }
  const precisa = (media * pesoTotal - pontos) / pesoRestante;
  if (precisa <= 0) return { ...base, precisa: 0, situacao: 'garantido', nivel: 'ok' };
  if (precisa > 10 + 1e-9) return { ...base, precisa, situacao: 'impossivel', nivel: 'perigo' };
  return { ...base, precisa, situacao: 'precisa', nivel: precisa >= 8 ? 'perigo' : precisa >= 6 ? 'alerta' : 'ok' };
}

function textoNotas(i) {
  if (i.vazio) return { titulo: 'Sem avaliações ainda', texto: `Cadastre as provas e trabalhos com o peso de cada um para saber ${usaMencao() ? 'qual menção' : 'quanto'} precisa tirar.` };
  const nomes = i.faltam.map(a => a.nome);
  const lista = nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}` : nomes[0];
  if (usaMencao()) {
    const atual = i.mediaAtual === null ? '—' : mencaoDe(i.mediaAtual);
    switch (i.situacao) {
      case 'aprovado': return { titulo: `✅ Aprovado com ${mencaoDe(i.final)}`, texto: `Menção final estimada: ${nomeMencao(mencaoDe(i.final))}. Para passar precisava de MM ou melhor.` };
      case 'reprovado': return { titulo: `❌ Menção final ${mencaoDe(i.final)}`, texto: 'Ficou abaixo de MM. Veja com o professor se há prova de recuperação.' };
      case 'garantido': return { titulo: '🎉 Já está aprovado!', texto: `Mesmo com SR em ${lista}, a menção final fica em MM ou melhor.` };
      case 'impossivel': return { titulo: '🚨 Nem com SS dá para chegar a MM', texto: `Só com ${lista} não alcança a menção mínima. Converse com o professor sobre recuperação ou trabalho extra.` };
      default: {
        const precisa = mencaoNecessaria(i.precisa);
        return { titulo: `🎯 Precisa de ${precisa} ou melhor em ${lista}`, texto: `Menção atual: ${atual} · para passar: MM ou melhor.` };
      }
    }
  }
  switch (i.situacao) {
    case 'aprovado': return { titulo: `✅ Aprovado com ${fmtNum(i.final)}`, texto: `Média final ${fmtNum(i.final)} (precisava de ${fmtNum(i.media)}).` };
    case 'reprovado': return { titulo: `❌ Média final ${fmtNum(i.final)}`, texto: `Ficou abaixo de ${fmtNum(i.media)}. Veja com o professor se há prova de recuperação.` };
    case 'garantido': return { titulo: '🎉 Já está aprovado!', texto: `Mesmo tirando 0 em ${lista}, sua média fica acima de ${fmtNum(i.media)}.` };
    case 'impossivel': return { titulo: `🚨 Precisaria de ${fmtNum(i.precisa)}`, texto: `Não dá para chegar a ${fmtNum(i.media)} só com ${lista}. Converse com o professor sobre recuperação ou trabalho extra.` };
    default: return { titulo: `🎯 Precisa de ${fmtNum(i.precisa)} em ${lista}`, texto: `Média atual: ${i.mediaAtual === null ? '—' : fmtNum(i.mediaAtual)} · para passar: ${fmtNum(i.media)}.` };
  }
}

/* ---------- 10.3 Faltas (mínimo de 75% de presença) ---------- */
function infoFaltas(idMateria) {
  const e = Store.getEstudo(idMateria);
  const faltas = e.faltas.length;
  const encontros = encontrosNoSemestre(idMateria);
  const auto = encontros ? Math.floor(encontros * 0.25) : null;
  const limite = e.limiteFaltas ?? auto;
  if (limite === null) return { faltas, limite: null, encontros, auto, nivel: '' };
  const restam = limite - faltas;
  const nivel = restam < 0 ? 'perigo' : faltas >= limite * 0.75 ? 'alerta' : 'ok';
  return { faltas, limite, restam, encontros, auto, nivel, pct: limite ? Math.min(100, faltas / limite * 100) : 100 };
}

function registrarFalta(idMateria, dia, doHoje = false) {
  if (!idMateria || !dia) return;
  Store.alterarEstudo(idMateria, e => { e.faltas.push(dia); });
  const f = infoFaltas(idMateria);
  const nome = infoMateria(idMateria).nome;
  let msg = `🙋 Falta registrada em ${nome}`;
  if (f.limite !== null) msg += f.restam < 0 ? ` · 🚫 passou do limite (${f.faltas}/${f.limite})` : ` · ainda pode faltar ${f.restam}`;
  toast(msg, doHoje ? { acao: 'Desfazer', aoClicar: () => desfazerFaltaHoje(idMateria) } : {});
  atualizarTudo();
  if ($('#dlg-materia').open) renderPainelFaltas();
}

function desfazerFaltaHoje(idMateria) {
  const dia = hojeISO();
  Store.alterarEstudo(idMateria, e => { const i = e.faltas.lastIndexOf(dia); if (i >= 0) e.faltas.splice(i, 1); });
  toast('Falta de hoje removida');
  atualizarTudo();
}

function botaoFaltaHTML(a) {
  const minutosInicio = paraMin(a.inicio);
  if (minutosAgora() < minutosInicio - 30) return ''; // só a partir de pouco antes da aula
  const hoje = hojeISO();
  const faltasHoje = Store.getEstudo(a.materia).faltas.filter(d => d === hoje).length;
  const aulasHoje = aulasDoDia(new Date().getDay()).filter(x => x.materia === a.materia);
  const posicao = aulasHoje.findIndex(x => x.id === a.id);
  return faltasHoje > posicao
    ? `<button type="button" class="chip-btn" data-acao="desfazer-falta" data-materia="${a.materia}" title="Desfazer a falta">✓ Faltou</button>`
    : `<button type="button" class="chip-btn" data-acao="faltei" data-materia="${a.materia}">🙋 Faltei</button>`;
}

/* ---------- 10.4 Flashcards (repetição espaçada, caixas de Leitner) ---------- */
const cartasParaHoje = idMateria => Store.getEstudo(idMateria).flashcards.filter(c => !c.proxima || c.proxima <= hojeISO());
const totalCartasHoje = () => Store.getMaterias().reduce((t, m) => t + cartasParaHoje(m.id).length, 0);

/* ---------- 10.5 Tela Matérias ---------- */
function renderMaterias() {
  const sem = semestreInfo();
  const provas = Store.getTarefas().filter(t => !t.concluida && t.tipo === 'prova' && t.prazo && new Date(t.prazo) >= new Date()).sort(compararPrazo).slice(0, 5);
  if (sem) {
    const titulo = !sem.comecou ? `O semestre começa em ${diffDias(sem.ini, new Date())} dia(s)` : sem.terminou ? '🏖️ Semestre encerrado. Boas férias!' : `${sem.pct}% do semestre concluído`;
    $('#semestre-card').innerHTML = `<section class="card semestre-card" aria-labelledby="titulo-semestre">
      <div class="semestre-card__topo"><h2 id="titulo-semestre">🗓️ ${titulo}</h2>
        <p class="sub">${sem.comecou && !sem.terminou ? `Faltam <b>${sem.restam} dias</b> para as férias · ` : ''}${dataCurta(sem.ini)} a ${dataCurta(sem.fim)}</p></div>
      <div class="barra" role="progressbar" aria-label="Progresso do semestre" aria-valuenow="${sem.pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${sem.pct}%"></span></div>
      ${provas.length ? `<div class="semestre-provas"><span class="sub" style="background:none;padding:0">Próximas provas:</span>${provas.map(t => `<span>📝 ${esc(infoMateria(t.materia).nome)} · ${dataCurta(new Date(t.prazo))}</span>`).join('')}</div>` : ''}
    </section>`;
  } else {
    $('#semestre-card').innerHTML = `<section class="card semestre-card"><p class="sub">🗓️ Coloque as datas do semestre para ver quanto falta para as férias e calcular sozinho o limite de faltas de cada matéria.</p>
      <div class="botoes-linha"><button type="button" class="btn btn--ghost btn--sm" data-acao="semestre">Configurar semestre</button></div></section>`;
  }
  const cartasHoje = totalCartasHoje();
  const lista = Store.getMaterias().map(m => {
    const n = infoNotas(m.id), f = infoFaltas(m.id), c = cartasParaHoje(m.id).length;
    const mencao = usaMencao();
    const notaTxt = n.vazio ? '—' : n.situacao === 'aprovado' || n.situacao === 'reprovado' ? (mencao ? mencaoDe(n.final) : fmtNum(n.final))
      : n.situacao === 'garantido' ? '✓' : n.situacao === 'impossivel' ? '!' : (mencao ? mencaoNecessaria(n.precisa) : fmtNum(n.precisa));
    const notaSub = n.vazio ? 'sem notas' : n.situacao === 'precisa' ? 'precisa tirar' : n.situacao === 'garantido' ? 'já passou' : n.situacao === 'impossivel' ? 'recuperação' : mencao ? 'menção final' : 'média final';
    const dica = n.situacao === 'impossivel' ? '🚨 Nota em risco: veja a aba Notas.'
      : f.nivel === 'perigo' ? '🚫 Passou do limite de faltas.'
      : f.nivel === 'alerta' ? `⚠️ Só pode faltar mais ${f.restam} aula(s).`
      : c ? `🃏 ${c} flashcard(s) para revisar hoje.` : '';
    return `<button type="button" class="card materia-card" style="--cor:${m.cor}" data-acao="abrir-materia" data-id="${m.id}" aria-label="Abrir ${esc(m.nome)}">
      <h2>${esc(m.nome)}</h2>
      <div class="materia-card__stats">
        <div class="mstat mstat--${n.nivel || ''}"><b>${notaTxt}</b><small>📝 ${notaSub}</small></div>
        <div class="mstat mstat--${f.nivel}"><b>${f.faltas}${f.limite !== null ? `/${f.limite}` : ''}</b><small>🙋 faltas</small></div>
        <div class="mstat"><b>${c}</b><small>🃏 para revisar</small></div>
      </div>
      ${dica ? `<p class="materia-card__dica">${dica}</p>` : ''}
    </button>`;
  }).join('');
  $('#materias-lista').innerHTML = lista + (cartasHoje ? '' : '');
  const head = $('#view-materias .section-head');
  let btnTodas = $('#btn-estudar-tudo');
  if (!btnTodas) {
    btnTodas = document.createElement('button');
    btnTodas.type = 'button'; btnTodas.id = 'btn-estudar-tudo'; btnTodas.className = 'btn btn--primary';
    btnTodas.dataset.acao = 'estudar-tudo';
    head.appendChild(btnTodas);
  }
  btnTodas.textContent = `🃏 Revisar flashcards (${cartasHoje})`;
  btnTodas.hidden = !cartasHoje;
}

/* ---------- 10.6 Janela da matéria (abas) ---------- */
let materiaAberta = null;
function abrirMateria(id, aba = 'notas') {
  const m = Store.getMaterias().find(x => x.id === id);
  if (!m) return;
  materiaAberta = id;
  const titulo = $('#materia-titulo');
  titulo.textContent = m.nome;
  titulo.style.setProperty('--cor', m.cor);
  renderPainelNotas(); renderPainelFaltas(); renderPainelAnotacoes(); renderPainelCartas();
  trocarAba(aba, false);
  abrirModal('dlg-materia');
}

function trocarAba(nome, focar = true) {
  $$('#dlg-materia [role="tab"]').forEach(t => {
    const ativa = t.id === `aba-${nome}`;
    t.setAttribute('aria-selected', String(ativa));
    t.tabIndex = ativa ? 0 : -1;
    if (ativa && focar) t.focus();
  });
  $$('#dlg-materia [role="tabpanel"]').forEach(p => { p.hidden = p.id !== `painel-${nome}`; });
}

function renderResultadoNotas() {
  const i = infoNotas(materiaAberta);
  const t = textoNotas(i);
  const caixa = $('#resultado-nota');
  if (!caixa) return;
  caixa.className = `resultado-nota ${i.nivel || ''}`;
  caixa.innerHTML = `<strong>${t.titulo}</strong><span class="sub">${t.texto}</span>`;
}

function renderPainelNotas() {
  const e = Store.getEstudo(materiaAberta);
  const padrao = Store.getConfig().mediaAprovacao;
  const mencao = usaMencao();
  const campoNota = a => mencao
    ? `<select class="select" data-av="${a.id}" data-campo="mencao" aria-label="Menção de ${esc(a.nome)}">
        <option value="">—</option>${MENCOES.map(m => `<option value="${m.id}" ${a.nota !== null && mencaoDe(a.nota) === m.id ? 'selected' : ''}>${m.id}</option>`).join('')}</select>`
    : `<input class="input" data-av="${a.id}" data-campo="nota" value="${a.nota === null ? '' : fmtNum(a.nota, 2)}" inputmode="decimal" placeholder="—" aria-label="Nota de ${esc(a.nome)}">`;
  $('#painel-notas').innerHTML = `
    <div class="seletor-sistema" role="group" aria-label="Sistema de notas">
      <button type="button" data-acao-m="sistema" data-sistema="numero" aria-pressed="${!mencao}">🔢 Notas de 0 a 10</button>
      <button type="button" data-acao-m="sistema" data-sistema="mencao" aria-pressed="${mencao}">🔤 Menções (SS, MS, MM…)</button>
    </div>
    <div class="resultado-nota" id="resultado-nota" role="status" aria-live="polite"></div>
    ${mencao
      ? '<p class="field__hint" style="margin:0">Para passar: <b>MM</b> ou melhor e 75% de presença (Regimento do UniCEUB). Faixas: SS 9–10 · MS 7–8,9 · MM 5–6,9 · MI 3–4,9 · II 0,1–2,9 · SR 0.</p>'
      : `<div class="linha-media">
          <label for="m-media" class="field__label" style="margin:0">Média para passar nesta matéria</label>
          <input type="text" inputmode="decimal" id="m-media" class="input" value="${e.media ?? ''}" placeholder="${fmtNum(padrao)}" aria-describedby="m-media-dica">
          <span class="field__hint" id="m-media-dica" style="margin:0">Em branco = padrão (${fmtNum(padrao)})</span>
        </div>`}
    ${e.avaliacoes.length ? `<table class="tabela-notas">
      <thead><tr><th scope="col">Avaliação</th><th scope="col">Peso</th><th scope="col">${mencao ? 'Menção' : 'Nota'}</th><th scope="col"><span class="sr-only">Remover</span></th></tr></thead>
      <tbody>${e.avaliacoes.map(a => `<tr>
        <td><input class="input" data-av="${a.id}" data-campo="nome" value="${esc(a.nome)}" maxlength="40" aria-label="Nome da avaliação"></td>
        <td><input class="input" data-av="${a.id}" data-campo="peso" value="${fmtNum(a.peso, 2)}" inputmode="decimal" aria-label="Peso de ${esc(a.nome)}"></td>
        <td>${campoNota(a)}</td>
        <td><button type="button" class="btn-icone" data-acao-m="rm-av" data-av="${a.id}" aria-label="Remover ${esc(a.nome)}">✕</button></td>
      </tr>`).join('')}</tbody></table>` : ''}
    <div class="botoes-linha"><button type="button" class="btn btn--ghost btn--sm" data-acao-m="add-av">＋ Adicionar avaliação</button></div>
    <p class="field__hint" style="margin:0">${mencao
      ? 'Deixe “—” nas avaliações que ainda não aconteceram. A menção final é uma estimativa: no UniCEUB o professor combina as menções pelo princípio da progressividade, então confira o plano de ensino.'
      : 'Deixe a nota em branco nas avaliações que ainda não aconteceram. O peso pode ser 1, 2, 3… ou a porcentagem (30, 40…).'}</p>`;
  renderResultadoNotas();
}

function renderPainelFaltas() {
  const f = infoFaltas(materiaAberta);
  const e = Store.getEstudo(materiaAberta);
  let resumo;
  if (f.limite === null) resumo = `<strong>${f.faltas} falta(s)</strong><span class="sub">Para saber o limite, coloque as datas do semestre (⚙️) e o horário das aulas (Agenda), ou digite o limite abaixo.</span>`;
  else resumo = `<strong>${f.faltas} de ${f.limite} faltas permitidas</strong>
    <div class="barra barra--${f.nivel === 'ok' ? 'ok' : f.nivel}" role="progressbar" aria-label="Faltas usadas" aria-valuenow="${f.faltas}" aria-valuemin="0" aria-valuemax="${f.limite}"><span style="width:${f.pct}%"></span></div>
    <span class="sub">${f.restam < 0 ? `🚫 Você passou ${-f.restam} falta(s) do limite. Fale com a coordenação.` : f.restam === 0 ? '⚠️ Você está no limite: não pode faltar mais.' : `Ainda pode faltar <b>${f.restam}</b> aula(s).`}</span>`;
  $('#painel-faltas').innerHTML = `
    <div class="faltas-resumo resultado-nota ${f.nivel}">${resumo}</div>
    <div class="contador-faltas">
      <button type="button" class="btn btn--primary btn--sm" data-acao-m="falta-hoje">＋ Faltei hoje</button>
      <label class="field__hint" style="margin:0" for="m-falta-data">ou em outro dia:</label>
      <input type="date" id="m-falta-data" class="input" style="width:auto" max="${hojeISO()}">
      <button type="button" class="btn btn--ghost btn--sm" data-acao-m="falta-data">Adicionar</button>
    </div>
    <div class="linha-media">
      <label for="m-limite" class="field__label" style="margin:0">Limite de faltas</label>
      <input type="text" inputmode="numeric" id="m-limite" class="input" value="${e.limiteFaltas ?? ''}" placeholder="${f.auto ?? 'auto'}" aria-describedby="m-limite-dica">
      <span class="field__hint" id="m-limite-dica" style="margin:0">${f.auto !== null ? `Automático: 25% de ${f.encontros} aulas no semestre = ${f.auto}. Deixe em branco para usar.` : 'Normalmente é 25% das aulas do semestre.'}</span>
    </div>
    ${e.faltas.length ? `<ul class="lista-faltas" aria-label="Dias em que faltou">${e.faltas.map((d, i) => `<li>${maiuscula(dataCurta(diaParaData(d)))}<button type="button" data-acao-m="rm-falta" data-i="${i}" aria-label="Remover falta de ${dataCurta(diaParaData(d))}">✕</button></li>`).join('')}</ul>` : '<p class="sub" style="margin:0">Nenhuma falta registrada. 👏</p>'}`;
}

function renderPainelAnotacoes() {
  $('#anotacoes-texto').value = Store.getEstudo(materiaAberta).anotacoes;
  $('#anotacoes-status').textContent = 'Salva sozinho enquanto você digita.';
}

function renderPainelCartas() {
  const e = Store.getEstudo(materiaAberta);
  const hoje = cartasParaHoje(materiaAberta).length;
  const quando = c => { if (!c.proxima || c.proxima <= hojeISO()) return 'revisar hoje'; const d = diffDias(diaParaData(c.proxima), new Date()); return d === 1 ? 'rever amanhã' : `rever em ${d} dias`; };
  $('#painel-cartas').innerHTML = `
    <div class="cartas-topo">
      <p style="margin:0"><b>${hoje}</b> para revisar hoje · ${e.flashcards.length} no total</p>
      <button type="button" class="btn btn--primary btn--sm" data-acao-m="estudar" ${hoje ? '' : 'disabled'}>▶ Estudar agora${hoje ? ` (${hoje})` : ''}</button>
    </div>
    <form class="form-carta" id="form-carta" novalidate>
      <label class="field__label" for="c-frente" style="margin:0">Pergunta (frente)</label>
      <textarea id="c-frente" class="input" rows="2" maxlength="300" placeholder="Ex.: O que é a 2ª forma normal?"></textarea>
      <label class="field__label" for="c-verso" style="margin:0">Resposta (verso)</label>
      <textarea id="c-verso" class="input" rows="2" maxlength="600" placeholder="Ex.: Está na 1FN e não tem dependência parcial da chave."></textarea>
      <p class="erro" id="erro-carta" role="alert" hidden></p>
      <div class="botoes-linha"><button type="submit" class="btn btn--ghost btn--sm">＋ Adicionar cartão</button></div>
    </form>
    ${e.flashcards.length ? `<ul class="lista-cartas">${e.flashcards.map(c => `<li>
      <div><b>${esc(c.frente)}</b><br><small>${esc(c.verso)}</small></div>
      <div style="display:grid;gap:4px;justify-items:end"><span class="caixa-tag">Caixa ${c.caixa} · ${quando(c)}</span>
        <button type="button" class="btn-icone" data-acao-m="rm-carta" data-carta="${c.id}" aria-label="Apagar cartão">✕</button></div>
    </li>`).join('')}</ul>` : '<p class="sub" style="margin:0">Crie cartões com perguntas e respostas. O app mostra cada um no dia certo: quem você erra volta logo, quem você acerta demora mais para voltar.</p>'}`;
}

let timerAnotacoes = null;
function registrarEventosMaterias() {
  const dlg = $('#dlg-materia');
  // abas: clique e setas do teclado
  $('#dlg-materia .abas').addEventListener('click', e => { const t = e.target.closest('[role="tab"]'); if (t) trocarAba(t.id.replace('aba-', '')); });
  $('#dlg-materia .abas').addEventListener('keydown', e => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    const abas = $$('#dlg-materia [role="tab"]');
    const i = abas.findIndex(t => t.getAttribute('aria-selected') === 'true');
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? abas.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + abas.length) % abas.length;
    e.preventDefault();
    trocarAba(abas[j].id.replace('aba-', ''));
  });
  // notas e limites: salvam enquanto digita
  dlg.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.av && el.dataset.campo === 'mencao') {
      const m = MENCOES.find(x => x.id === el.value);
      Store.alterarEstudo(materiaAberta, est => { const a = est.avaliacoes.find(x => x.id === el.dataset.av); if (a) a.nota = m ? m.valor : null; });
      renderResultadoNotas();
      return;
    }
    if (el.dataset.av) {
      const campo = el.dataset.campo;
      let valor = el.value;
      if (campo !== 'nome') {
        valor = el.value.trim() === '' ? null : numeroBR(el.value);
        const invalido = campo === 'nota' ? (valor !== null && (valor === null || valor < 0 || valor > 10)) : (valor === null || valor <= 0);
        const lixo = el.value.trim() !== '' && numeroBR(el.value) === null;
        el.setAttribute('aria-invalid', String(invalido || lixo));
        if (invalido || lixo) return;
      }
      Store.alterarEstudo(materiaAberta, est => { const a = est.avaliacoes.find(x => x.id === el.dataset.av); if (a) a[campo] = campo === 'nome' ? valor.trim() || 'Avaliação' : valor; });
      renderResultadoNotas();
    } else if (el.id === 'm-media') {
      const v = el.value.trim() === '' ? null : numeroBR(el.value);
      const ruim = el.value.trim() !== '' && (v === null || v < 0 || v > 10);
      el.setAttribute('aria-invalid', String(ruim));
      if (ruim) return;
      Store.alterarEstudo(materiaAberta, est => { est.media = v; });
      renderResultadoNotas();
    } else if (el.id === 'm-limite') {
      const v = el.value.trim() === '' ? null : numeroBR(el.value);
      const ruim = el.value.trim() !== '' && (v === null || v < 0);
      el.setAttribute('aria-invalid', String(ruim));
      if (ruim) return;
      Store.alterarEstudo(materiaAberta, est => { est.limiteFaltas = v === null ? null : Math.round(v); });
      const foco = document.activeElement === el;
      renderPainelFaltas();
      if (foco) { const novo = $('#m-limite'); novo.focus(); novo.setSelectionRange(novo.value.length, novo.value.length); }
    } else if (el.id === 'anotacoes-texto') {
      $('#anotacoes-status').textContent = 'Digitando…';
      clearTimeout(timerAnotacoes);
      timerAnotacoes = setTimeout(() => {
        Store.alterarEstudo(materiaAberta, est => { est.anotacoes = el.value; });
        $('#anotacoes-status').textContent = `✓ Salvo às ${hora(new Date())}`;
      }, 500);
    }
  });
  // botões dentro da janela
  dlg.addEventListener('click', e => {
    const b = e.target.closest('[data-acao-m]');
    if (!b) return;
    const id = materiaAberta;
    switch (b.dataset.acaoM) {
      case 'add-av': {
        Store.alterarEstudo(id, est => { est.avaliacoes.push({ id: `av-${Date.now().toString(36)}`, nome: `Avaliação ${est.avaliacoes.length + 1}`, peso: 1, nota: null }); });
        renderPainelNotas();
        const nomes = $$('#painel-notas [data-campo="nome"]'); nomes[nomes.length - 1].select();
        break;
      }
      case 'rm-av': {
        const antes = Store.getEstudo(id).avaliacoes;
        Store.alterarEstudo(id, est => { est.avaliacoes = est.avaliacoes.filter(a => a.id !== b.dataset.av); });
        renderPainelNotas();
        toast('Avaliação removida', { acao: 'Desfazer', aoClicar: () => { Store.alterarEstudo(id, est => { est.avaliacoes = antes; }); if (materiaAberta === id) renderPainelNotas(); atualizarTudo(); } });
        break;
      }
      case 'sistema': {
        Store.salvarConfig({ sistemaNotas: b.dataset.sistema });
        renderPainelNotas();
        $(`#painel-notas [data-sistema="${b.dataset.sistema}"]`).focus();
        toast(b.dataset.sistema === 'mencao' ? '🔤 Agora as notas são por menção (SS, MS, MM, MI, II, SR)' : '🔢 Agora as notas são de 0 a 10');
        break;
      }
      case 'falta-hoje': registrarFalta(id, hojeISO()); break;
      case 'falta-data': {
        const d = $('#m-falta-data').value;
        if (!d || d > hojeISO()) { toast('Escolha um dia que já passou.', { tipo: 'erro' }); return; }
        registrarFalta(id, d);
        break;
      }
      case 'rm-falta': {
        Store.alterarEstudo(id, est => { est.faltas.splice(Number(b.dataset.i), 1); });
        renderPainelFaltas(); atualizarTudo();
        break;
      }
      case 'estudar': abrirEstudo(id); break;
      case 'rm-carta': {
        const antes = Store.getEstudo(id).flashcards;
        Store.alterarEstudo(id, est => { est.flashcards = est.flashcards.filter(c => c.id !== b.dataset.carta); });
        renderPainelCartas();
        toast('Cartão apagado', { acao: 'Desfazer', aoClicar: () => { Store.alterarEstudo(id, est => { est.flashcards = antes; }); if (materiaAberta === id) renderPainelCartas(); } });
        break;
      }
    }
    if (!['add-av', 'estudar'].includes(b.dataset.acaoM)) atualizarTudo();
  });
  // novo flashcard
  dlg.addEventListener('submit', e => {
    if (e.target.id !== 'form-carta') return;
    e.preventDefault();
    const frente = $('#c-frente').value.trim(), verso = $('#c-verso').value.trim();
    const erro = $('#erro-carta');
    if (!frente || !verso) { erro.textContent = 'Preencha a pergunta e a resposta.'; erro.hidden = false; (frente ? $('#c-verso') : $('#c-frente')).focus(); return; }
    Store.alterarEstudo(materiaAberta, est => { est.flashcards.unshift({ id: `fc-${Date.now().toString(36)}`, frente, verso, caixa: 1, proxima: hojeISO(), acertos: 0, erros: 0 }); });
    renderPainelCartas();
    $('#c-frente').focus();
    toast('🃏 Cartão criado');
    atualizarTudo();
  });
  dlg.addEventListener('close', () => {
    if (timerAnotacoes) { clearTimeout(timerAnotacoes); Store.alterarEstudo(materiaAberta, est => { est.anotacoes = $('#anotacoes-texto').value; }); timerAnotacoes = null; }
    atualizarTudo();
  });
  // modo estudo
  $('#dlg-estudar').addEventListener('click', e => {
    const b = e.target.closest('[data-estudo]');
    if (b) responderEstudo(b.dataset.estudo);
  });
  $('#dlg-estudar').addEventListener('keydown', e => {
    if (e.target.closest('button') && (e.key === ' ' || e.key === 'Enter')) return; // o botão já trata
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); responderEstudo('mostrar'); }
    else if (e.key === '1') responderEstudo('errei');
    else if (e.key === '2') responderEstudo('acertei');
    e.stopPropagation();
  });
  $('#dlg-estudar').addEventListener('close', () => { atualizarTudo(); if ($('#dlg-materia').open) renderPainelCartas(); });
}

/* ---------- 10.7 Estudar flashcards ---------- */
let estudo = { fila: [], i: 0, mostrando: false, acertos: 0, erros: 0, total: 0 };
function abrirEstudo(idMateria) {
  const ids = idMateria ? [idMateria] : Store.getMaterias().map(m => m.id);
  const fila = ids.flatMap(id => cartasParaHoje(id).map(c => ({ materia: id, id: c.id }))).sort((a, b) => {
    const ca = Store.getEstudo(a.materia).flashcards.find(c => c.id === a.id), cb = Store.getEstudo(b.materia).flashcards.find(c => c.id === b.id);
    return ca.caixa - cb.caixa || Math.random() - .5;
  });
  if (!fila.length) { toast('🎉 Nenhum flashcard para revisar hoje!'); return; }
  estudo = { fila, i: 0, mostrando: false, acertos: 0, erros: 0, total: fila.length, repetidas: new Set() };
  abrirModal('dlg-estudar');
  renderEstudo(); // depois de abrir: o foco vai para "Mostrar resposta" (e não para o ✕)
}
function cartaAtual() {
  const item = estudo.fila[estudo.i];
  return item && { ...item, carta: Store.getEstudo(item.materia).flashcards.find(c => c.id === item.id) };
}
function renderEstudo() {
  const atual = cartaAtual();
  const botoes = $('#estudar-botoes');
  if (!atual || !atual.carta) {
    $('#estudar-progresso').textContent = 'Revisão concluída';
    $('#carta').innerHTML = `<div class="fim-estudo"><span class="grande" aria-hidden="true">🎉</span><strong>Revisão concluída!</strong>
      <span class="sub">Você acertou ${estudo.acertos} de ${estudo.acertos + estudo.erros} respostas. Os cartões voltam no dia certo para fixar.</span></div>`;
    botoes.innerHTML = '<button type="button" class="btn btn--primary" data-fechar>Fechar</button>';
    botoes.querySelector('button').focus();
    return;
  }
  $('#estudar-progresso').textContent = `Cartão ${Math.min(estudo.i + 1, estudo.fila.length)} de ${estudo.fila.length} · ${infoMateria(atual.materia).nome}`;
  $('#carta').innerHTML = `<div class="carta__frente" id="carta-frente">${esc(atual.carta.frente)}</div>
    ${estudo.mostrando ? `<div class="carta__verso" id="carta-verso">${esc(atual.carta.verso)}</div>` : ''}`;
  botoes.innerHTML = estudo.mostrando
    ? '<button type="button" class="btn btn--errei" data-estudo="errei">😕 Errei</button><button type="button" class="btn btn--acertei" data-estudo="acertei">😄 Acertei</button>'
    : '<button type="button" class="btn btn--primary" data-estudo="mostrar">👀 Mostrar resposta</button>';
  botoes.querySelector('button:last-child').focus();
}
function responderEstudo(acao) {
  const atual = cartaAtual();
  if (!atual || !atual.carta) return;
  if (acao === 'mostrar') { if (!estudo.mostrando) { estudo.mostrando = true; renderEstudo(); } return; }
  if (!estudo.mostrando) return;
  const acertou = acao === 'acertei';
  Store.alterarEstudo(atual.materia, est => {
    const c = est.flashcards.find(x => x.id === atual.id);
    if (!c) return;
    if (acertou) {
      c.acertos++;
      c.caixa = Math.min(5, c.caixa + 1);
      c.proxima = dataISO(somarDias(new Date(), INTERVALOS_CAIXA[c.caixa]));
    } else {
      c.erros++;
      c.caixa = 1;
      c.proxima = hojeISO();
    }
  });
  if (acertou) estudo.acertos++; else estudo.erros++;
  // quem errou volta no fim da fila (uma vez por sessão)
  if (!acertou && !estudo.repetidas.has(atual.id)) { estudo.repetidas.add(atual.id); estudo.fila.push({ materia: atual.materia, id: atual.id }); }
  estudo.i++;
  estudo.mostrando = false;
  renderEstudo();
  if (!cartaAtual()) verificarConquistas();
}

/* ---------- 10.8 Fazer agora ---------- */
function motivosEPontos(t, agora) {
  const motivos = [];
  let pontos = infoPrioridade(t.prioridade).peso * 10;
  if (t.prioridade === 'alta') motivos.push('🔴 prioridade alta');
  if (t.prazo) {
    const horas = (new Date(t.prazo) - agora) / 3600000;
    if (horas < 0) { pontos += 60; motivos.push('⚠️ atrasada'); }
    else {
      pontos += 45 * Math.exp(-horas / 48);
      motivos.push(horas < 24 ? `⏰ vence em ${horas < 1 ? `${Math.max(1, Math.round(horas * 60))} min` : `${Math.round(horas)}h`}` : diffDias(new Date(t.prazo), agora) === 1 ? '⏰ vence amanhã' : `📅 vence em ${diffDias(new Date(t.prazo), agora)} dias`);
    }
    if (t.tipo === 'prova' && horas >= 0 && horas < 24 * 7) { pontos += 10; motivos.push('📚 prova chegando'); }
  }
  if ((t.estimativa || 60) <= 30) { pontos += 6; motivos.push(`⚡ rápida (${formatarMin(t.estimativa)})`); }
  if ((t.subtarefas || []).some(x => x.plano && !x.feita && x.data === hojeISO())) { pontos += 15; motivos.push('🗓️ revisão de hoje'); }
  return { pontos, motivos: motivos.slice(0, 3) };
}
function fazerAgoraHTML() {
  const agora = new Date();
  const top = Store.getTarefas().filter(t => !t.concluida).map(t => ({ t, ...motivosEPontos(t, agora) })).sort((a, b) => b.pontos - a.pontos).slice(0, 3);
  if (!top.length) return '';
  return `<section class="card extra-card fazer-agora" aria-labelledby="titulo-fazer">
    <div><h2 id="titulo-fazer">🎯 Fazer agora</h2><p class="sub">Por onde começar, pesando prazo, prioridade e tempo.</p></div>
    <ol class="fazer-lista">${top.map((x, i) => `<li class="fazer-item">
      <span class="fazer-num" aria-hidden="true">${i + 1}</span>
      <div><b>${esc(x.t.titulo)}</b><div class="fazer-motivos">${x.motivos.map(m => `<span>${m}</span>`).join('')}</div></div>
      <div class="botoes-linha">
        <button type="button" class="btn btn--ghost btn--sm" data-acao="focar" data-id="${x.t.id}" aria-label="Focar em ${esc(x.t.titulo)}">🍅 Focar</button>
        <button type="button" class="btn btn--ghost btn--sm" data-acao="concluir" data-id="${x.t.id}" aria-label="Concluir ${esc(x.t.titulo)}">✓</button>
      </div></li>`).join('')}</ol>
  </section>`;
}

/* ---------- 10.9 Metas da semana e relatório ---------- */
function inicioSemana(d = new Date()) { const x = inicioDia(d); const dia = (x.getDay() + 6) % 7; return somarDias(x, -dia); } // segunda-feira
function statsSemana(ini) {
  const fim = somarDias(ini, 7);
  const dentro = iso => { const d = new Date(iso); return d >= ini && d < fim; };
  const sessoes = Store.getSessoes().filter(s => dentro(s.inicio));
  const concluidas = Store.getTarefas().filter(t => t.concluida && t.concluidaEm && dentro(t.concluidaEm));
  const porMateria = {};
  sessoes.forEach(s => { if (s.materia) porMateria[s.materia] = (porMateria[s.materia] || 0) + s.minutos; });
  const porDia = Array(7).fill(0);
  sessoes.forEach(s => { porDia[(new Date(s.inicio).getDay() + 6) % 7] += s.minutos; });
  return {
    minutos: sessoes.reduce((t, s) => t + s.minutos, 0), pomodoros: sessoes.length, tarefas: concluidas.length,
    noPrazo: concluidas.filter(t => !t.prazo || new Date(t.concluidaEm) <= new Date(t.prazo)).length,
    saidas: sessoes.reduce((t, s) => t + (s.saidas || 0), 0), porMateria, porDia
  };
}
function metasOk(st, c = Store.getConfig()) {
  const ativas = [c.metaFocoMin > 0, c.metaTarefas > 0];
  if (!ativas.some(Boolean)) return false;
  return (!ativas[0] || st.minutos >= c.metaFocoMin) && (!ativas[1] || st.tarefas >= c.metaTarefas);
}
function contarMetasBatidas(sessoes, concluidas) {
  const c = Store.getConfig();
  if (!(c.metaFocoMin > 0 || c.metaTarefas > 0)) return 0;
  const semanas = {};
  const chave = d => dataISO(inicioSemana(new Date(d)));
  sessoes.forEach(s => { const k = chave(s.inicio); semanas[k] = semanas[k] || { minutos: 0, tarefas: 0 }; semanas[k].minutos += s.minutos; });
  concluidas.forEach(t => { if (!t.concluidaEm) return; const k = chave(t.concluidaEm); semanas[k] = semanas[k] || { minutos: 0, tarefas: 0 }; semanas[k].tarefas++; });
  return Object.values(semanas).filter(st => metasOk(st, c)).length;
}
function metasHTML() {
  const c = Store.getConfig();
  if (!(c.metaFocoMin > 0 || c.metaTarefas > 0)) return '';
  const st = statsSemana(inicioSemana());
  const barra = (atual, meta, rotulo, texto) => {
    const pct = Math.min(100, Math.round(atual / meta * 100));
    return `<div class="meta"><div class="meta__linha"><span>${rotulo}</span><span>${texto}</span></div>
      <div class="barra ${pct >= 100 ? 'barra--ok' : ''}" role="progressbar" aria-label="${rotulo}" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div></div>`;
  };
  const diasRestantes = 7 - ((new Date().getDay() + 6) % 7);
  return `<section class="card metas-card" aria-labelledby="titulo-metas">
    <div class="metas-card__topo"><h2 id="titulo-metas">🎯 Metas da semana ${metasOk(st, c) ? '· ✅ batidas!' : ''}</h2>
      <div class="botoes-linha"><button type="button" class="btn btn--ghost btn--sm" data-acao="relatorio">📊 Semana passada</button><button type="button" class="btn btn--text btn--sm" data-acao="metas">Mudar metas</button></div></div>
    ${c.metaFocoMin > 0 ? barra(st.minutos, c.metaFocoMin, '🍅 Horas de foco', `${formatarMin(st.minutos)} de ${formatarMin(c.metaFocoMin)}`) : ''}
    ${c.metaTarefas > 0 ? barra(st.tarefas, c.metaTarefas, '✅ Tarefas concluídas', `${st.tarefas} de ${c.metaTarefas}`) : ''}
    <p class="sub" style="margin:0">${metasOk(st, c) ? 'Mandou bem! 🎉 O que vier agora é bônus.' : `Faltam ${diasRestantes} dia(s) para a semana acabar (domingo).`}</p>
  </section>`;
}

function conteudoRelatorio(ini) {
  const st = statsSemana(ini), ant = statsSemana(somarDias(ini, -7));
  const c = Store.getConfig();
  const variacao = (a, b) => {
    if (!b) return a ? '<span class="variacao sobe">novo</span>' : '';
    const p = Math.round((a - b) / b * 100);
    return p === 0 ? '<span class="variacao">igual</span>' : `<span class="variacao ${p > 0 ? 'sobe' : 'desce'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p)}%</span>`;
  };
  const materias = Store.getMaterias();
  const top = Object.entries(st.porMateria).sort((a, b) => b[1] - a[1])[0];
  const pendentesPorMateria = new Set(Store.getTarefas().filter(t => !t.concluida).map(t => t.materia));
  const esquecida = materias.find(m => pendentesPorMateria.has(m.id) && !st.porMateria[m.id] && m.id !== 'm-pessoal');
  const diaTop = st.porDia.indexOf(Math.max(...st.porDia));
  const nomesDias = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
  const dicas = [];
  if (metasOk(st, c)) dicas.push('🎯 Você bateu as metas da semana. Que tal subir um pouco a meta?');
  else if (c.metaFocoMin > 0 && st.minutos < c.metaFocoMin) dicas.push(`🍅 Faltaram ${formatarMin(c.metaFocoMin - st.minutos)} para a meta de foco. Tente reservar um horário fixo nos dias livres.`);
  if (top) dicas.push(`📚 A matéria mais estudada foi <b>${esc(infoMateria(top[0]).nome)}</b> (${formatarMin(top[1])}).`);
  if (esquecida) dicas.push(`👀 <b>${esc(esquecida.nome)}</b> tem tarefas pendentes, mas não teve nenhum foco. Separe um Pomodoro para ela.`);
  if (st.minutos) dicas.push(`📈 Seu dia mais focado foi <b>${nomesDias[diaTop]}</b>.`);
  if (st.saidas) dicas.push(`📵 Você saiu do app ${st.saidas} vez(es) durante o foco. Deixar o celular longe ajuda!`);
  if (st.tarefas && st.noPrazo === st.tarefas) dicas.push('⏰ Tudo o que você concluiu foi dentro do prazo. 👏');
  if (!st.minutos && !st.tarefas) dicas.push('🌱 Semana parada. Comece com uma tarefa pequena: o primeiro passo é o mais difícil.');
  return `<div class="relatorio-kpis">
      <div><b>${formatarMin(st.minutos) || '0min'}</b><small>🍅 de foco ${variacao(st.minutos, ant.minutos)}</small></div>
      <div><b>${st.tarefas}</b><small>✅ tarefas ${variacao(st.tarefas, ant.tarefas)}</small></div>
      <div><b>${st.tarefas ? Math.round(st.noPrazo / st.tarefas * 100) : 0}%</b><small>⏰ no prazo</small></div>
      <div><b>${st.pomodoros}</b><small>🔁 Pomodoros</small></div>
    </div>
    <ul class="relatorio-dicas">${dicas.map(d => `<li>${d}</li>`).join('')}</ul>`;
}
function mostrarRelatorio(ini = somarDias(inicioSemana(), -7)) {
  const fim = somarDias(ini, 6);
  $('#relatorio-periodo').textContent = `Semana de ${dataCurta(ini)} a ${dataCurta(fim)}`;
  $('#relatorio-conteudo').innerHTML = conteudoRelatorio(ini);
  abrirModal('dlg-relatorio');
}
function mostrarRelatorioSeNovaSemana() {
  const c = Store.getConfig();
  const semana = dataISO(inicioSemana());
  if (!c.relatorioSemanal || Store.getRelatorioVisto() === semana || $('dialog[open]')) return;
  const passada = statsSemana(somarDias(inicioSemana(), -7));
  if (!passada.minutos && !passada.tarefas) return; // nada para contar
  Store.marcarRelatorioVisto(semana);
  mostrarRelatorio();
  // ao fechar o relatório, o resumo do dia aparece em seguida (se ainda não apareceu hoje)
  $('#dlg-relatorio').addEventListener('close', () => setTimeout(mostrarResumoSeNovoDia, 250), { once: true });
}

/* ---------- 10.10 Sons de fundo do foco (Web Audio) ---------- */
let fundo = { ctx: null, saida: null, fontes: [], tipo: '' };
function bufferRuido(ctx, tipo, segundos = 4) {
  const buf = ctx.createBuffer(2, ctx.sampleRate * segundos, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let ultimo = 0;
    for (let i = 0; i < d.length; i++) {
      const branco = Math.random() * 2 - 1;
      if (tipo === 'marrom') { ultimo = (ultimo + 0.02 * branco) / 1.02; d[i] = ultimo * 3.5; }
      else d[i] = branco;
    }
  }
  return buf;
}
function iniciarFundo(tipo, volume) {
  if (fundo.tipo === tipo && fundo.saida) { ajustarVolumeFundo(); return; }
  pararFundo();
  preparaSom();
  if (!audioCtx) return;
  const ctx = audioCtx;
  const saida = ctx.createGain();
  saida.gain.value = 0;
  saida.gain.setTargetAtTime(volume / 100 * 0.6, ctx.currentTime, 0.8); // entra suave
  saida.connect(ctx.destination);
  const fontes = [];
  const fonte = (t, filtros = []) => {
    const s = ctx.createBufferSource(); s.buffer = bufferRuido(ctx, t); s.loop = true;
    let no = s; filtros.forEach(f => { no.connect(f); no = f; });
    fontes.push(s);
    return { s, fim: no };
  };
  const filtro = (type, freq, Q = 0.7) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q; return f; };
  if (tipo === 'chuva') {
    const chiado = fonte('branco', [filtro('highpass', 900), filtro('lowpass', 7000)]);
    const g1 = ctx.createGain(); g1.gain.value = 0.35; chiado.fim.connect(g1).connect(saida);
    const grave = fonte('marrom', [filtro('lowpass', 500)]);
    const g2 = ctx.createGain(); g2.gain.value = 0.5; grave.fim.connect(g2).connect(saida);
  } else if (tipo === 'mar') {
    const onda = fonte('marrom', [filtro('lowpass', 1100)]);
    const g = ctx.createGain(); g.gain.value = 0.55;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09; // uma onda a cada ~11 s
    const prof = ctx.createGain(); prof.gain.value = 0.4;
    lfo.connect(prof).connect(g.gain); lfo.start();
    fontes.push(lfo);
    onda.fim.connect(g).connect(saida);
  } else if (tipo === 'marrom') {
    const r = fonte('marrom', [filtro('lowpass', 1500)]); r.fim.connect(saida);
  } else {
    const r = fonte('branco', [filtro('lowpass', 9000)]); const g = ctx.createGain(); g.gain.value = 0.35; r.fim.connect(g).connect(saida);
  }
  fontes.forEach(f => { if (f.start && f.buffer) f.start(); });
  fundo = { ctx, saida, fontes, tipo };
}
function ajustarVolumeFundo() {
  if (fundo.saida) fundo.saida.gain.setTargetAtTime(Store.getConfig().volumeFundo / 100 * 0.6, fundo.ctx.currentTime, 0.2);
}
function pararFundo() {
  if (!fundo.saida) return;
  const { saida, fontes, ctx } = fundo;
  saida.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
  setTimeout(() => { fontes.forEach(f => { try { f.stop(); } catch (_) {} }); try { saida.disconnect(); } catch (_) {} }, 1500);
  fundo = { ctx: null, saida: null, fontes: [], tipo: '' };
}
let previaFundo = null;
function atualizarSomFundo(previa = false) {
  const c = Store.getConfig();
  const deveTocar = timer.rodando && timer.modo === 'foco' && c.somFundo;
  clearTimeout(previaFundo);
  if (deveTocar) { iniciarFundo(c.somFundo, c.volumeFundo); return; }
  if (previa && c.somFundo) { // ouvir 4 segundos ao escolher, com o timer parado
    iniciarFundo(c.somFundo, c.volumeFundo);
    previaFundo = setTimeout(() => { if (!timer.rodando) pararFundo(); }, 4000);
    return;
  }
  pararFundo();
}

/* ---------- 10.11 Foco sem distração ----------
   Ao sair do app (outra aba, outro app no celular ou outra janela no computador)
   durante o foco, o aviso sai NA HORA: no celular o código é congelado logo depois.
   No computador, um segundo lembrete vem 20 s depois se a pessoa continuar fora. */
let saidaDoFoco = null, avisoSaida = null, avisoBlur = null, saidasDoCiclo = 0;
const focandoAgora = () => timer.rodando && timer.modo === 'foco' && Store.getConfig().focoRigido;
const minutosRestantesFoco = () => Math.max(1, Math.round((timer.fim - Date.now()) / 60000));

function notificarSaida(segunda = false) {
  if (!saidaDoFoco || !focandoAgora()) return;
  mostrarNotificacao(segunda ? '⏳ Ainda fora do foco…' : '🍅 Volta pro foco!', `Faltam ${minutosRestantesFoco()} min. Toque aqui para voltar. 💪`, 'foco-saida', { insistente: true, url: './#foco' });
}
function saiuDoFoco(imediato) {
  if (!focandoAgora() || saidaDoFoco) return;
  saidaDoFoco = Date.now();
  atualizarTimerUI();
  if (imediato) notificarSaida();
  clearTimeout(avisoSaida);
  avisoSaida = setTimeout(() => notificarSaida(!imediato ? false : true), imediato ? 20000 : 4000);
}
async function voltouAoFoco() {
  clearTimeout(avisoSaida); clearTimeout(avisoBlur);
  if (!saidaDoFoco) return;
  const fora = Date.now() - saidaDoFoco;
  saidaDoFoco = null;
  atualizarTimerUI();
  try { const reg = await registroSW(); if (reg) (await reg.getNotifications({ tag: 'foco-saida' })).forEach(n => n.close()); } catch (_) {}
  if (!timer.rodando || timer.modo !== 'foco' || fora < 3000) return;
  saidasDoCiclo++;
  const faltam = Math.max(0, Math.round((timer.fim - Date.now()) / 60000));
  toast(`👀 Você ficou ${fora < 60000 ? `${Math.round(fora / 1000)} s` : `${Math.round(fora / 60000)} min`} fora do foco. ${faltam ? `Faltam ${faltam} min, bora!` : 'O foco já está acabando!'}`, { duracao: 6000 });
}
function vigiarSaidaDoFoco() {
  if (document.visibilityState === 'hidden') saiuDoFoco(true);
  else voltouAoFoco();
}
// computador: trocar de janela não esconde a página, então também vale perder o foco da janela
window.addEventListener('blur', () => {
  if (!focandoAgora()) return;
  clearTimeout(avisoBlur);
  avisoBlur = setTimeout(() => { if (!document.hasFocus()) saiuDoFoco(false); }, 1500);
});
window.addEventListener('focus', () => { clearTimeout(avisoBlur); if (document.visibilityState === 'visible') voltouAoFoco(); });

/** A primeira vez que a pessoa começa um foco, pede a permissão de notificação (precisa de um clique). */
async function pedirPermissaoDoFoco() {
  if (!Store.getConfig().focoRigido || !suportaNotificacao() || !viaLink() || Notification.permission !== 'default') return;
  if (localStorage.getItem('prazocerto:pediu-notif-foco')) return;
  localStorage.setItem('prazocerto:pediu-notif-foco', '1');
  toast('🔔 Permita as notificações para o app te chamar de volta se você sair durante o foco.', { duracao: 6000 });
  await pedirPermissao();
  renderStatusFocoRigido();
}
function renderStatusFocoRigido() {
  const el = $('#foco-rigido-status');
  if (!el) return;
  if (!$('#foco-rigido').checked) { el.innerHTML = ''; return; }
  let html = '';
  if (!viaLink()) html = 'O aviso para voltar só funciona pelo link do site (prazocerto.github.io).';
  else if (ehIOS() && !suportaNotificacao()) html = 'No iPhone, instale o app na Tela de Início para receber o aviso.';
  else if (!suportaNotificacao()) html = 'Este navegador não tem notificações: você verá só o aviso ao voltar.';
  else if (Notification.permission === 'granted') html = '✅ Notificações liberadas: o aviso chega na hora em que você sair.';
  else if (Notification.permission === 'denied') html = `🚫 As notificações estão bloqueadas. ${esc(passosDesbloquear())}`;
  else html = '⚠️ Falta liberar as notificações. <button type="button" class="chip-btn" id="btn-permitir-foco">🔔 Permitir</button>';
  el.innerHTML = html;
}

/* ---------- 10.12 Atalhos do ícone e textos vindos de outros apps ---------- */
function tratarAcaoDaUrl() {
  const p = new URLSearchParams(location.search);
  const acao = p.get('acao');
  const recebido = [p.get('titulo'), p.get('texto'), p.get('link')].filter(Boolean).join(' ').trim();
  if (!acao && !recebido) return;
  history.replaceState(null, '', location.pathname + location.hash);
  if ($('dialog[open]')) return;
  if (acao === 'nova') { abrirFormTarefa(); return; }
  if (acao === 'focar') { irPara('foco'); if (!timer.rodando) iniciarPausar(); return; }
  if (acao === 'cartas') { irPara('materias'); abrirEstudo(null); return; }
  if (recebido) {
    // texto compartilhado de outro app (ex.: mensagem do grupo): vira uma tarefa para conferir
    const r = interpretarRapida(recebido.slice(0, 200));
    abrirFormTarefa({ titulo: r.titulo.slice(0, 80), prazo: r.prazo || '', prioridade: r.prioridade, materia: r.materia || undefined, descricao: recebido.slice(0, 1000) });
    toast('📥 Texto recebido de outro app. Confira e salve a tarefa.', { duracao: 7000 });
  }
}

/* ---------- 10.13 Importar calendário (.ics) ---------- */
let eventosIcs = [];
function lerIcs(texto) {
  const linhas = texto.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const eventos = [];
  let ev = null;
  const desescapar = v => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
  linhas.forEach(l => {
    if (l === 'BEGIN:VEVENT') ev = {};
    else if (l === 'END:VEVENT') { if (ev && ev.inicio && ev.titulo) eventos.push(ev); ev = null; }
    else if (ev) {
      const i = l.indexOf(':');
      if (i < 0) return;
      const [nome, ...params] = l.slice(0, i).split(';');
      const valor = l.slice(i + 1);
      if (nome === 'SUMMARY') ev.titulo = desescapar(valor).trim();
      else if (nome === 'DESCRIPTION') ev.descricao = desescapar(valor).trim();
      else if (nome === 'UID') ev.uid = valor.trim();
      else if (nome === 'DTSTART') {
        const m = valor.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
        if (!m) return;
        const [, a, me, d, h, mi, , z] = m;
        if (!h) ev.inicio = new Date(+a, +me - 1, +d, 23, 59); // dia inteiro: entrega até o fim do dia
        else ev.inicio = z ? new Date(Date.UTC(+a, +me - 1, +d, +h, +mi)) : new Date(+a, +me - 1, +d, +h, +mi);
        ev.diaInteiro = !h || params.includes('VALUE=DATE');
      }
    }
  });
  return eventos;
}
function adivinharTipo(t) {
  const n = normalizar(t);
  if (/prova|avaliacao|exame|teste|quiz|p1|p2|ap1|ap2/.test(n)) return 'prova';
  if (/semin|apresenta/.test(n)) return 'apresentacao';
  if (/lista|exercic|atividade/.test(n)) return 'lista';
  if (/trabalho|projeto|entrega|relatorio/.test(n)) return 'trabalho';
  if (/leitura|ler |capitulo/.test(n)) return 'leitura';
  return 'outro';
}
function adivinharMateria(t) {
  const n = normalizar(t);
  const m = Store.getMaterias().find(x => n.includes(normalizar(x.nome)) || normalizar(x.nome).split(' ').some(p => p.length >= 5 && n.includes(p)));
  return m ? m.id : (Store.getMaterias().find(x => x.id === 'm-pessoal') || Store.getMaterias()[0]).id;
}
async function lerArquivoIcs(e) {
  const arq = e.target.files[0];
  e.target.value = '';
  if (!arq) return;
  if (arq.size > 5e6) { toast('Arquivo grande demais (máximo 5 MB).', { tipo: 'erro' }); return; }
  let eventos;
  try { eventos = lerIcs(await arq.text()); } catch (_) { eventos = []; }
  const desde = somarDias(new Date(), -1);
  const existentes = Store.getTarefas();
  eventosIcs = eventos.filter(ev => ev.inicio >= desde).sort((a, b) => a.inicio - b.inicio).slice(0, 300)
    .map((ev, i) => ({ ...ev, i, prazo: paraInput(ev.inicio), repetida: existentes.some(t => (ev.uid && t.icsUid === ev.uid) || (normalizar(t.titulo) === normalizar(ev.titulo).slice(0, 80) && t.prazo === paraInput(ev.inicio))) }));
  if (!eventosIcs.length) { toast(eventos.length ? 'Nenhum evento futuro nesse calendário.' : 'Não encontrei eventos nesse arquivo. Confira se é um .ics.', { tipo: 'erro' }); return; }
  const academico = /prova|trabalho|entrega|lista|atividade|exerc|semin|apresenta|teste|avalia|quiz|tarefa|projeto|relat/;
  $('#ics-sub').textContent = `${eventosIcs.length} evento(s) a partir de hoje. Marquei os que parecem provas e entregas: confira antes de importar.`;
  $('#ics-lista').innerHTML = eventosIcs.map(ev => `<label class="ics-item">
    <input type="checkbox" data-ics="${ev.i}" ${!ev.repetida && academico.test(normalizar(ev.titulo)) ? 'checked' : ''} ${ev.repetida ? 'disabled' : ''}>
    <span><b>${esc(ev.titulo.slice(0, 80))}</b><small>${maiuscula(dataCurta(ev.inicio))}${ev.diaInteiro ? '' : ` às ${hora(ev.inicio)}`} · ${infoTipo(adivinharTipo(ev.titulo)).emoji} ${infoTipo(adivinharTipo(ev.titulo)).label}${ev.repetida ? ' · já está nas suas tarefas' : ''}</small></span>
  </label>`).join('');
  abrirModal('dlg-ics');
}
function importarIcsSelecionados() {
  const escolhidos = $$('#ics-lista input[data-ics]:checked').map(i => eventosIcs[Number(i.dataset.ics)]);
  if (!escolhidos.length) { toast('Marque pelo menos um evento.', { tipo: 'erro' }); return; }
  escolhidos.forEach(ev => {
    const t = Store.salvarTarefa({
      titulo: ev.titulo.slice(0, 80), prazo: ev.prazo, tipo: adivinharTipo(ev.titulo), prioridade: adivinharTipo(ev.titulo) === 'prova' ? 'alta' : 'media',
      materia: adivinharMateria(ev.titulo), estimativa: 60, descricao: (ev.descricao || '').slice(0, 1000), subtarefas: [], icsUid: ev.uid || ''
    });
    pularLembretesPassados(t);
  });
  fecharModal($('#dlg-ics'));
  toast(`📅 ${escolhidos.length} tarefa(s) importada(s) do calendário`);
  atualizarTudo();
}

function aplicarTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  const escuro = tema === 'dark';
  const btn = $('#btn-tema');
  btn.setAttribute('aria-pressed', escuro);
  btn.removeAttribute('aria-label'); // o nome acessível passa a ser o próprio texto visível (WCAG 2.5.3)
  btn.title = escuro ? 'Light Mode: voltar ao tema claro (T)' : 'Dark Mode: ativar o tema escuro (T)';
  $('.btn-tema__icone', btn).textContent = escuro ? '☀️' : '🌙';
  $('.btn-tema__texto', btn).textContent = escuro ? 'Light Mode' : 'Dark Mode';
  $('meta[name="theme-color"]').setAttribute('content', escuro ? '#0b1020' : '#4f46e5');
}

function alternarTema() {
  const novo = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  aplicarTema(novo);
  Store.salvarTema(novo);
  toast(novo === 'dark' ? '🌙 Dark Mode ativado' : '☀️ Light Mode ativado', { duracao: 1800 });
}

/* ================================================================
   9. NAVEGAÇÃO, ATALHOS E EVENTOS
   ================================================================ */
const VIEWS = ['hoje', 'tarefas', 'agenda', 'materias', 'foco', 'progresso'];
const TITULOS = { hoje: 'Hoje', tarefas: 'Tarefas', agenda: 'Agenda', materias: 'Matérias', foco: 'Foco', progresso: 'Progresso' };
const RENDER = { hoje: renderHoje, tarefas: renderTarefas, agenda: renderAgenda, materias: renderMaterias, foco: renderFoco, progresso: renderProgresso };

function irPara(view) {
  if (!VIEWS.includes(view)) view = 'hoje';
  if (location.hash !== `#${view}`) history.pushState(null, '', `#${view}`);
  mostrarView(view);
}

function mostrarView(view, focar = true) {
  if (!VIEWS.includes(view)) view = 'hoje';
  estado.view = view;
  VIEWS.forEach(v => { $(`#view-${v}`).hidden = v !== view; });
  $$('.nav__link').forEach(a => (a.dataset.view === view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  RENDER[view]();
  if (window.Nuvem) window.Nuvem.renderSocial();
  atualizarTimerUI();
  window.scrollTo(0, 0);
  if (focar) { const h = $(`#view-${view} h1`); h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
}

/** Re-renderiza a tela atual e os indicadores globais. */
function atualizarTudo() {
  const s = calcularStats();
  const badge = $('#badge-atrasadas');
  badge.textContent = s.atrasadas;
  badge.hidden = !s.atrasadas;
  RENDER[estado.view]();
  if (window.Nuvem) window.Nuvem.renderSocial();
  if (estado.view !== 'foco') montarSelectTarefaFoco();
  verificarAvisos();
}

function aoClicar(e) {
  const alvo = e.target.closest('[data-acao], [data-fechar], [data-dia], [data-prazo], [data-remover-sub], [data-eu-faco], a[href^="#"]');
  if (!alvo) return;

  if (alvo.hasAttribute('data-fechar')) return fecharModal(alvo.closest('dialog'));
  if (alvo.dataset.dia) { estado.diaSelecionado = alvo.dataset.dia; renderAgenda(); $(`[data-dia="${alvo.dataset.dia}"]`)?.focus(); return; }
  if (alvo.hasAttribute('data-prazo')) { definirPrazoRapido(alvo.dataset.prazo); atualizarDicaLembretes(); return; }
  if (alvo.hasAttribute('data-eu-faco')) {
    const sub = estado.subtarefasEdicao[Number(alvo.dataset.euFaco)];
    const u = window.Nuvem && window.Nuvem.usuario;
    if (sub && u) {
      if (sub.responsavel === u.uid) { sub.responsavel = null; sub.responsavelNome = ''; }
      else { sub.responsavel = u.uid; sub.responsavelNome = u.displayName || 'Eu'; }
      renderSubtarefasEdicao();
    }
    return;
  }
  if (alvo.hasAttribute('data-remover-sub')) { estado.subtarefasEdicao.splice(Number(alvo.dataset.removerSub), 1); renderSubtarefasEdicao(); return; }

  if (alvo.matches('a[href^="#"]') && !alvo.dataset.acao) {
    const destino = alvo.getAttribute('href').slice(1);
    if (VIEWS.includes(destino)) { e.preventDefault(); fecharModal(alvo.closest('dialog')); irPara(destino); }
    return;
  }

  const { acao, id } = alvo.dataset;
  switch (acao) {
    case 'nova-tarefa': abrirFormTarefa(); break;
    case 'editar': abrirFormTarefa(Store.getTarefa(id)); break;
    case 'concluir': concluir(id, alvo); break;
    case 'excluir': excluir(id); break;
    case 'focar': focarEm(id); break;
    case 'sub': alternarSub(id, alvo.dataset.sub); break;
    case 'exemplo': carregarExemplo(); break;
    case 'ligar-avisos': ligarAvisos(); break;
    case 'nova-aula': abrirFormAula(); break;
    case 'editar-aula': abrirFormAula(Store.getAulas().find(a => a.id === id)); break;
    case 'resumo': mostrarResumo(); break;
    case 'criar-plano': criarPlanoDireto(id); break;
    case 'abrir-materia': abrirMateria(id); break;
    case 'semestre': abrirConfigEm('#cfg-sem-inicio'); break;
    case 'faltei': registrarFalta(alvo.dataset.materia, dataISO(new Date()), true); break;
    case 'desfazer-falta': desfazerFaltaHoje(alvo.dataset.materia); break;
    case 'relatorio': mostrarRelatorio(); break;
    case 'estudar-tudo': abrirEstudo(null); break;
    case 'metas': abrirConfigEm('#cfg-meta-foco'); break;
    case 'excluir-materia': excluirMateria(id); break;
    case 'limpar-filtros':
      $('#busca').value = ''; $('#filtro-prioridade').value = ''; $('#filtro-materia').value = ''; $('#filtro-status').value = 'pendentes';
      renderTarefas(); break;
  }
}

function definirPrazoRapido(tipo) {
  const campo = $('#t-prazo');
  if (!tipo) { campo.value = ''; return; }
  campo.value = paraInput(prazoPadrao({ hoje: 0, amanha: 1, semana: 7 }[tipo]));
}

function aoPressionarTecla(e) {
  if (e.key === 'Escape' && alarme.ativo) { pararAlarme(); if (!$('dialog[open]')) return; }
  const el = document.activeElement;
  const digitando = /INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable;
  if (digitando || e.ctrlKey || e.metaKey || e.altKey || $('dialog[open]')) return;
  if (!Store.getConfig().atalhos) return; // o usuário pode desligar os atalhos de uma tecla (WCAG 2.1.4)
  const k = e.key.toLowerCase();
  if (e.key >= '1' && e.key <= '6') irPara(VIEWS[Number(e.key) - 1]);
  else if (k === 'n') { e.preventDefault(); abrirFormTarefa(); }
  else if (k === 't') alternarTema();
  else if (e.key === '/') { e.preventDefault(); irPara('tarefas'); $('#busca').focus(); }
  else if (e.key === '?') abrirModal('dlg-ajuda');
  else if (e.key === ' ' && estado.view === 'foco' && el.tagName !== 'BUTTON') { e.preventDefault(); iniciarPausar(); }
}

function registrarEventos() {
  document.addEventListener('click', aoClicar);
  document.addEventListener('keydown', aoPressionarTecla);
  window.addEventListener('popstate', () => mostrarView(location.hash.slice(1), false));

  // Topo
  $('#btn-tema').addEventListener('click', alternarTema);
  $('#btn-ajuda').addEventListener('click', () => abrirModal('dlg-ajuda'));
  $('#btn-config').addEventListener('click', abrirConfig);

  // Hoje
  $('#form-rapido').addEventListener('submit', adicionarRapida);

  // Formulário de tarefa
  $('#form-tarefa').addEventListener('submit', salvarFormTarefa);
  $('#t-titulo').addEventListener('input', () => { if ($('#t-titulo').value.trim().length >= 3) mostrarErroTitulo(''); });
  $('#btn-add-sub').addEventListener('click', adicionarSubtarefaEdicao);
  $('#t-nova-sub').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); adicionarSubtarefaEdicao(); } });
  $('#t-subtarefas').addEventListener('change', e => {
    const i = e.target.dataset.subIndex;
    if (i !== undefined) estado.subtarefasEdicao[Number(i)].feita = e.target.checked;
  });
  $('#btn-excluir-tarefa').addEventListener('click', () => excluir($('#t-id').value));

  // Tarefas: filtros
  $('#busca').addEventListener('input', debounce(renderTarefas, 180));
  ['#filtro-status', '#filtro-prioridade', '#filtro-materia', '#ordem'].forEach(s => $(s).addEventListener('change', renderTarefas));
  $('#btn-limpar-concluidas').addEventListener('click', limparConcluidas);

  // Agenda
  const mudarMes = n => { estado.mesAgenda = new Date(estado.mesAgenda.getFullYear(), estado.mesAgenda.getMonth() + n, 1); renderAgenda(); };
  $('#mes-anterior').addEventListener('click', () => mudarMes(-1));
  $('#mes-proximo').addEventListener('click', () => mudarMes(1));
  $('#mes-hoje').addEventListener('click', () => {
    const h = new Date(); estado.mesAgenda = new Date(h.getFullYear(), h.getMonth(), 1); estado.diaSelecionado = dataISO(h); renderAgenda();
  });
  $('#btn-nova-no-dia').addEventListener('click', () => {
    const d = new Date(`${estado.diaSelecionado}T23:59`);
    abrirFormTarefa({ prazo: paraInput(d) });
  });
  // Setas do teclado navegam entre os dias do calendário
  $('#calendario-dias').addEventListener('keydown', e => {
    const passos = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!passos || !e.target.dataset.dia) return;
    e.preventDefault();
    const novo = somarDias(new Date(`${e.target.dataset.dia}T12:00`), passos);
    estado.diaSelecionado = dataISO(novo);
    if (novo.getMonth() !== estado.mesAgenda.getMonth()) estado.mesAgenda = new Date(novo.getFullYear(), novo.getMonth(), 1);
    renderAgenda();
    $(`[data-dia="${estado.diaSelecionado}"]`)?.focus();
  });

  // Foco
  $('#timer-iniciar').addEventListener('click', iniciarPausar);
  $('#timer-reiniciar').addEventListener('click', reiniciarTimer);
  $('#timer-pular').addEventListener('click', () => { $('#timer-status').textContent = ''; terminarCiclo({ pulou: true }); });
  $('#modos').addEventListener('change', e => {
    if (timer.rodando) { toast('Pause o timer antes de trocar de modo.', { tipo: 'erro' }); $$('input[name="modo"]').forEach(r => { r.checked = r.value === timer.modo; }); return; }
    definirModo(e.target.value);
  });
  $('#timer-tarefa').addEventListener('change', e => { timer.tarefaId = e.target.value; salvarTimer(); });

  // Configurações
  $('#form-config').addEventListener('submit', salvarConfig);
  $('#form-materia').addEventListener('submit', adicionarMateria);
  $('#btn-exportar').addEventListener('click', exportarBackup);
  $('#input-importar').addEventListener('change', e => { if (e.target.files[0]) importarBackup(e.target.files[0]); e.target.value = ''; });
  $('#btn-apagar-tudo').addEventListener('click', apagarTudo);
  $('#cfg-aviso').addEventListener('change', aoMudarAviso);
  $('#btn-testar-aviso').addEventListener('click', testarAviso);
  $('#btn-permitir-aviso').addEventListener('click', async () => { await pedirPermissao(); atualizarStatusAviso(); if (suportaNotificacao() && Notification.permission === 'granted') testarAviso(); });
  $('#btn-cal-todas').addEventListener('click', exportarTodosCalendario);
  $('#btn-ouvir-toque').addEventListener('click', () => tocarAlarme('▶ Ouvindo o toque', { som: somDoFormulario(), umaVez: true }));
  $('#cfg-volume').addEventListener('input', e => { $('#cfg-volume-valor').textContent = `${e.target.value}%`; });
  $('#btn-parar-alarme').addEventListener('click', pararAlarme);
  $('#dlg-config').addEventListener('close', pararAlarme);
  // fechou uma janela com o alarme tocando: a barra volta para a página (ou para a janela de baixo)
  $$('dialog').forEach(d => d.addEventListener('close', () => { if (alarme.ativo) posicionarBarraAlarme(); posicionarAvisos(); }));

  // Novidades: aulas, modo prova, resumo e compartilhar
  $('#form-aula').addEventListener('submit', salvarFormAula);
  $('#btn-excluir-aula').addEventListener('click', excluirAula);
  $('#t-tipo').addEventListener('change', atualizarModoProva);
  $('#t-prazo').addEventListener('input', atualizarModoProva);
  $('#btn-plano-revisao').addEventListener('click', criarPlanoNoFormulario);
  $('#btn-compartilhar-tarefa').addEventListener('click', abrirCompartilhar);
  $('#btn-copiar-link').addEventListener('click', copiarLinkCompartilhado);
  $('#btn-mais-opcoes').addEventListener('click', compartilharNativo);
  $('#btn-importar-tarefa').addEventListener('click', importarTarefaCompartilhada);
  $('#resumo-todo-dia').addEventListener('change', e => {
    Store.salvarConfig({ resumoDiario: e.target.checked });
    toast(e.target.checked ? '📋 O resumo vai aparecer todo dia' : 'Resumo diário desligado. Ele continua no botão “📋 Resumo do dia”.');
  });

  // Matérias, flashcards, relatório, foco e calendário
  registrarEventosMaterias();
  $('#input-ics').addEventListener('change', lerArquivoIcs);
  $('#cfg-sistema-notas').addEventListener('change', atualizarCampoMedia);
  $('#btn-ics-importar').addEventListener('click', importarIcsSelecionados);
  $('#foco-som').addEventListener('change', e => { Store.salvarConfig({ somFundo: e.target.value }); atualizarSomFundo(true); });
  $('#foco-volume').addEventListener('input', e => {
    $('#foco-volume-valor').textContent = `${e.target.value}%`;
    Store.salvarConfig({ volumeFundo: Number(e.target.value) });
    ajustarVolumeFundo();
  });
  $('#foco-rigido').addEventListener('change', async e => {
    Store.salvarConfig({ focoRigido: e.target.checked });
    if (e.target.checked && suportaNotificacao() && viaLink() && Notification.permission === 'default') await pedirPermissao();
    renderStatusFocoRigido();
  });
  document.addEventListener('click', async e => { if (e.target.id === 'btn-permitir-foco') { await pedirPermissao(); renderStatusFocoRigido(); } });
  document.addEventListener('visibilitychange', vigiarSaidaDoFoco);

  // Lembretes no formulário da tarefa
  $('#t-lembretes').addEventListener('change', atualizarDicaLembretes);
  $('#t-prazo').addEventListener('input', atualizarDicaLembretes);
  $('#btn-cal-google').addEventListener('click', calendarioGoogle);
  $('#btn-cal-ics').addEventListener('click', calendarioIcs);

  // Som: o navegador só libera o áudio depois de uma interação
  document.addEventListener('pointerdown', preparaSom, { passive: true });
  // Ao voltar para a aba/app, confere na hora o timer e os lembretes
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (timer.rodando) tique();
    verificarAvisos();
  });
  // Clique numa notificação com o app já aberto: o service worker avisa qual tarefa abrir
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data && e.data.tipo === 'notificacao' && e.data.tarefaId) abrirTarefaPorId(e.data.tarefaId);
    });
  }

  // Modais: fechar clicando fora e devolver o foco
  $$('dialog').forEach(dlg => {
    dlg.addEventListener('click', e => { if (e.target === dlg) fecharModal(dlg); });
    dlg.addEventListener('close', () => { if (!$('dialog[open]') && estado.ultimoFoco && document.contains(estado.ultimoFoco)) estado.ultimoFoco.focus({ preventScroll: true }); });
  });

  // Relógio: contagem regressiva e textos "faltam Xh" sempre atualizados
  setInterval(() => {
    if (estado.view === 'hoje') {
      const t = Store.getTarefa($('#proximo-conteudo').dataset.id || '');
      if (t) atualizarContador(t);
    }
  }, 1000);
  setInterval(() => { if (!$('dialog[open]')) atualizarTudo(); }, 60000);
  setInterval(verificarAvisos, 30000); // avisos de prazo
}

/* ================================================================
   10. INICIALIZAÇÃO
   ================================================================ */
/** Roda uma etapa da inicialização sem deixar um erro derrubar as outras. */
function etapaSegura(nome, fn) {
  try { fn(); } catch (erro) { console.warn(`[PrazoCerto] Falha ao iniciar: ${nome}`, erro); }
}

/* ---------- App instalável (PWA) ---------- */
let pedidoInstalacao = null; // evento guardado para abrir a janela de instalação do navegador

const rodandoComoApp = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ehIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/* ---------- Atualizações automáticas ----------
   O app instalado fica "dormindo" em segundo plano e, ao voltar, mostra a mesma tela
   (com o código antigo). Por isso ele procura versão nova ao abrir, ao voltar para
   ele e a cada 30 minutos. Quando acha, troca sozinho se você não estiver no meio
   de algo; senão, mostra o botão "Atualizar". */
let atualizacaoPronta = false;
function registrarAtualizacoes() {
  const jaTinhaVersao = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    const procurar = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') procurar(); });
    window.addEventListener('online', procurar);
    setInterval(procurar, 30 * 60000);
  }).catch(erro => console.warn('[PrazoCerto] Service worker não registrado', erro));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!jaTinhaVersao || atualizacaoPronta) return; // 1ª instalação não é "atualização"
    atualizacaoPronta = true;
    aplicarAtualizacao();
  });
  mostrarVersao();
}
function podeRecarregarSozinho() {
  return !$('dialog[open]') && !timer.rodando && !alarme.ativo && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA';
}
function aplicarAtualizacao() {
  if (document.visibilityState === 'hidden' || podeRecarregarSozinho()) {
    // app em segundo plano ou parado numa tela: troca na hora, sem perder nada (os dados ficam no aparelho)
    if (document.visibilityState === 'hidden') { location.reload(); return; }
    toast('🆕 PrazoCerto atualizado! Carregando a versão nova…', { duracao: 2500 });
    setTimeout(() => location.reload(), 1200);
    return;
  }
  toast('🆕 Tem uma versão nova do PrazoCerto.', { duracao: 60000, acao: 'Atualizar', aoClicar: () => location.reload() });
  // se a pessoa sair do app, atualiza quando voltar
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') location.reload(); }, { once: true });
}
async function mostrarVersao() {
  try {
    const nomes = await caches.keys();
    const v = nomes.map(n => (n.match(/^prazocerto-v(\d+)$/) || [])[1]).filter(Boolean).sort((a, b) => b - a)[0];
    if (v) $('#versao-app').textContent = `Versão ${v}`;
  } catch (_) { /* sem cache (aberto pelo arquivo) */ }
}

function prepararInstalacao() {
  const btn = $('#btn-instalar');
  // Guarda os arquivos no aparelho para abrir sem internet (só funciona em http/https, não em file://)
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    registrarAtualizacoes();
  }
  if (rodandoComoApp()) return; // já está instalado e aberto como app

  // Chrome/Edge (computador e Android): o navegador avisa que dá para instalar
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    pedidoInstalacao = e;
    btn.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    pedidoInstalacao = null;
    btn.hidden = true;
    toast('📲 PrazoCerto instalado! Agora ele abre como app, até sem internet.');
  });
  // iPhone/iPad não tem janela de instalação: o botão mostra o passo a passo do Safari
  if (ehIOS()) btn.hidden = false;

  btn.addEventListener('click', async () => {
    if (pedidoInstalacao) {
      pedidoInstalacao.prompt();
      const { outcome } = await pedidoInstalacao.userChoice;
      pedidoInstalacao = null;
      if (outcome === 'accepted') btn.hidden = true;
      else toast('Tudo bem! Você pode instalar depois pelo botão 📲 ou pelo menu do navegador.');
    } else {
      abrirModal('dlg-ajuda');
      $('#ajuda-instalar').scrollIntoView({ block: 'start' });
    }
  });
}

function iniciar() {
  montarCamposFixos();
  etapaSegura('matérias', montarSelectMaterias);
  registrarEventos(); // logo no começo: botões e abas funcionam mesmo se algo abaixo falhar
  etapaSegura('tema', () => aplicarTema(document.documentElement.getAttribute('data-theme') || 'light'));
  etapaSegura('timer', restaurarTimer);
  etapaSegura('conquistas', () => verificarConquistas({ silencioso: true }));
  etapaSegura('tela inicial', () => mostrarView(location.hash.slice(1), false));
  etapaSegura('telas', atualizarTudo);
  etapaSegura('instalação', prepararInstalacao);
  etapaSegura('lembretes', () => { Store.limparAvisos(); agendarProximoAviso(); });
  etapaSegura('notificação clicada', () => {
    const params = new URLSearchParams(location.search);
    const id = params.get('abrir');
    if (!id) return;
    history.replaceState(null, '', location.pathname + location.hash);
    abrirTarefaPorId(id);
  });
  etapaSegura('tarefa compartilhada', verificarTarefaCompartilhada);
  etapaSegura('atalhos do ícone', tratarAcaoDaUrl);
  etapaSegura('relatório da semana', mostrarRelatorioSeNovaSemana);
  etapaSegura('resumo do dia', mostrarResumoSeNovoDia);
  etapaSegura('foco extras', () => {
    const c = Store.getConfig();
    $('#foco-som').innerHTML = SONS_FUNDO.map(x => `<option value="${x.id}">${x.label}</option>`).join('');
    $('#foco-som').value = c.somFundo;
    $('#foco-volume').value = String(c.volumeFundo);
    $('#foco-volume-valor').textContent = `${c.volumeFundo}%`;
    $('#foco-rigido').checked = c.focoRigido;
    renderStatusFocoRigido();
  });
}

document.addEventListener('DOMContentLoaded', iniciar);
