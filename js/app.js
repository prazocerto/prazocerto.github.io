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
function tarefaHTML(t, { indice = 0, mostrarSubs = false } = {}) {
  const p = infoPrazo(t);
  const prio = infoPrioridade(t.prioridade);
  const tipo = infoTipo(t.tipo);
  const mat = infoMateria(t.materia);
  const subs = t.subtarefas || [];
  const feitas = subs.filter(s => s.feita).length;

  return `
    <li class="tarefa prio-${t.prioridade} urg-${t.concluida ? 'ok' : p.urgencia} ${t.concluida ? 'is-done' : ''}" style="--i:${Math.min(indice, 12)}" data-tarefa="${t.id}">
      <button type="button" class="check" data-acao="concluir" data-id="${t.id}" aria-pressed="${t.concluida}"
        aria-label="Concluída: ${esc(t.titulo)}">✓</button>
      <div class="tarefa__main">
        <div class="tarefa__top">
          <span class="materia-tag" style="--cor:${mat.cor}">${esc(mat.nome)}</span>
          <span class="tipo">${tipo.emoji} ${esc(tipo.label)}</span>
          <span class="prio" style="--c:${prio.cor}">${prio.label}</span>
        </div>
        <h3><button type="button" class="tarefa__titulo" data-acao="editar" data-id="${t.id}">${esc(t.titulo)}</button></h3>
        <div class="tarefa__meta">
          <span class="prazo urg-${t.concluida ? 'ok' : p.urgencia}">${p.texto}</span>
          <span>⏱ ${formatarMin(t.estimativa || 60)}</span>
          ${t.focoMin ? `<span>🍅 ${formatarMin(t.focoMin)} de foco</span>` : ''}
          ${subs.length ? `<span>☑️ ${feitas}/${subs.length} etapas</span>` : ''}
        </div>
        ${subs.length && !mostrarSubs ? `<div class="progresso-sub" role="progressbar" aria-label="Etapas concluídas" aria-valuenow="${feitas}" aria-valuemin="0" aria-valuemax="${subs.length}"><span style="width:${(feitas / subs.length) * 100}%"></span></div>` : ''}
        ${subs.length && mostrarSubs ? `<ul class="subs-inline">${subs.map(s => `
          <li><label><input type="checkbox" data-acao="sub" data-id="${t.id}" data-sub="${s.id}" ${s.feita ? 'checked' : ''}>
          <span class="${s.feita ? 'feita' : ''}">${esc(s.texto)}</span></label></li>`).join('')}</ul>` : ''}
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

function toast(mensagem, { tipo = 'info', acao = null, aoClicar = null, duracao = 3500 } = {}) {
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
  estado.subtarefasEdicao = (dados.subtarefas || []).map(s => ({ ...s }));
  renderSubtarefasEdicao();
  $('#btn-excluir-tarefa').hidden = !editando;
  mostrarErroTitulo('');
  abrirModal('dlg-tarefa');
  setTimeout(() => $('#t-titulo').focus(), 50);
}

/** Prazo sugerido: daqui a N dias às 23:59. */
function prazoPadrao(dias) { const d = somarDias(new Date(), dias); d.setHours(23, 59, 0, 0); return d; }

function renderSubtarefasEdicao() {
  $('#t-subtarefas').innerHTML = estado.subtarefasEdicao.map((s, i) => `
    <li>
      <label><input type="checkbox" data-sub-index="${i}" ${s.feita ? 'checked' : ''}> ${esc(s.texto)}</label>
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
    subtarefas: estado.subtarefasEdicao
  };
  if (id) dados.id = id;
  Store.salvarTarefa(dados);
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
    toast(`🎉 Concluída! +${bonus} XP`, { acao: 'Desfazer', aoClicar: () => { Store.alternarConclusao(id); atualizarTudo(); } });
    const item = botao && botao.closest('.tarefa');
    if (item && $('#filtro-status').value === 'pendentes' && estado.view === 'tarefas') {
      botao.setAttribute('aria-pressed', 'true');
      item.classList.add('saindo');
      setTimeout(() => { atualizarTudo(); verificarConquistas(); }, 320);
      return;
    }
  } else {
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
    $('#timer-status').textContent = '⏸ Pausado. Respire e volte quando quiser.';
  } else {
    preparaSom();
    timer.fim = Date.now() + timer.restante;
    timer.rodando = true;
    timer.intervalo = setInterval(tique, 250);
    $('#timer-status').textContent = timer.modo === 'foco' ? '🔕 Silencie o celular e foque só nisso.' : '☕ Levante, beba água, alongue-se.';
  }
  salvarTimer();
  atualizarTimerUI();
}

function reiniciarTimer() {
  timer.rodando = false;
  clearInterval(timer.intervalo);
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
  timer.rodando = false;
  const eraFoco = timer.modo === 'foco';
  if (eraFoco && !pulou) {
    const minutos = Store.getConfig().foco;
    const tarefa = timer.tarefaId ? Store.getTarefa(timer.tarefaId) : null;
    Store.adicionarSessao({ inicio: new Date(timer.fim - minutos * 60000).toISOString(), minutos, materia: tarefa ? tarefa.materia : null, tarefaId: tarefa ? tarefa.id : null });
    if (tarefa) Store.adicionarFoco(tarefa.id, minutos);
    timer.ciclos++;
    tocarSom();
    toast(`🍅 Ciclo concluído! +5 XP. Hora da pausa.`);
    verificarConquistas();
  } else if (!pulou) {
    tocarSom();
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
  document.title = timer.rodando ? `${texto} · ${ROTULOS_MODO[timer.modo]} — PrazoCerto` : `${TITULOS[estado.view]} · PrazoCerto`;
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

function focarEm(id) {
  timer.tarefaId = id;
  if (!timer.rodando) definirModo('foco');
  salvarTimer();
  irPara('foco');
  const t = Store.getTarefa(id);
  $('#timer-status').textContent = t ? `🎯 Foco em: ${t.titulo}` : '';
}

/* Som de fim de ciclo (Web Audio, sem arquivo externo) */
let audioCtx = null;
function preparaSom() {
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (_) { audioCtx = null; }
}
function tocarSom() {
  if (!Store.getConfig().som || !audioCtx) return;
  [0, .22, .44].forEach((atraso, i) => {
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.frequency.value = [660, 880, 990][i];
    gain.gain.setValueAtTime(.0001, audioCtx.currentTime + atraso);
    gain.gain.exponentialRampToValueAtTime(.25, audioCtx.currentTime + atraso + .02);
    gain.gain.exponentialRampToValueAtTime(.0001, audioCtx.currentTime + atraso + .2);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(audioCtx.currentTime + atraso);
    osc.stop(audioCtx.currentTime + atraso + .22);
  });
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
    else timer.intervalo = setInterval(tique, 250);
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
    alvo.innerHTML = vazioHTML('📊', 'Ainda sem dados', 'Conclua tarefas e faça ciclos de foco para ver seu progresso.', BOTOES_VAZIO);
    return;
  }

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

  alvo.innerHTML = `
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
  $('#cfg-aviso').checked = c.aviso;
  $('#cfg-atalhos').checked = c.atalhos;
  $('#cfg-aviso-min').value = String(c.avisoMin);
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
  erro.hidden = true;
  Store.salvarConfig({ nome: $('#cfg-nome').value.trim(), foco, curta, longa, som: $('#cfg-som').checked,
    aviso: $('#cfg-aviso').checked, avisoMin: Number($('#cfg-aviso-min').value), atalhos: $('#cfg-atalhos').checked });
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
   8.1 AVISOS DE PRAZO (NOTIFICAÇÕES DO NAVEGADOR)
   ----------------------------------------------------------------
   A cada 30 segundos o app procura tarefas pendentes cujo prazo vence
   dentro da antecedência escolhida (1 hora por padrão). Cada prazo é
   avisado UMA vez: o id da tarefa e o prazo ficam salvos no LocalStorage
   (se o prazo for alterado, ele volta a ser avisado).
   Com permissão, o aviso é uma notificação do sistema, que aparece mesmo
   com a aba em segundo plano; sem permissão, aparece só dentro da página.
   Limitação: funciona enquanto o PrazoCerto estiver aberto em alguma aba.
   ================================================================ */
const suportaNotificacao = () => 'Notification' in window;
const iconeApp = () => $('link[rel="icon"]').href;

function textoAntecedencia(min) {
  if (min >= 1440) return '1 dia';
  if (min >= 60) return `${min / 60} hora${min > 60 ? 's' : ''}`;
  return `${min} minutos`;
}

function verificarAvisos() {
  const c = Store.getConfig();
  if (!c.aviso) return;
  const agora = Date.now();
  const avisados = Store.getAvisos();
  Store.getTarefas().forEach(t => {
    if (t.concluida || !t.prazo || avisados[t.id] === t.prazo) return;
    const falta = new Date(t.prazo) - agora;
    if (falta <= 0 || falta > c.avisoMin * 60000) return;
    Store.marcarAvisado(t.id, t.prazo);
    dispararAviso(t, falta);
  });
}

function mostrarNotificacao(titulo, corpo, tag, aoClicarNotif) {
  if (!suportaNotificacao() || Notification.permission !== 'granted') return false;
  try {
    const n = new Notification(titulo, { body: corpo, tag, icon: iconeApp() });
    n.onclick = () => { window.focus(); n.close(); if (aoClicarNotif) aoClicarNotif(); };
    return true;
  } catch (_) {
    return false; // alguns navegadores só permitem notificação via service worker
  }
}

function dispararAviso(t, falta) {
  const min = Math.max(1, Math.round(falta / 60000));
  const quanto = min >= 60 ? formatarMin(min) : `${min} min`;
  const titulo = `⏰ Faltam ${quanto}: ${t.titulo}`;
  const corpo = `${infoMateria(t.materia).nome} · entrega às ${hora(new Date(t.prazo))}`;
  mostrarNotificacao(titulo, corpo, `prazo-${t.id}`, () => abrirFormTarefa(Store.getTarefa(t.id)));
  tocarSom();
  // o aviso dentro da página aparece sempre (também quando a notificação está bloqueada)
  toast(`${titulo} — ${corpo}`, { duracao: 9000, acao: 'Focar', aoClicar: () => focarEm(t.id) });
}

function atualizarStatusAviso() {
  const ligado = $('#cfg-aviso').checked;
  const el = $('#aviso-status');
  $('#cfg-aviso-min').disabled = !ligado;
  $('#btn-testar-aviso').disabled = !ligado;
  let texto = 'Desligado.', classe = '';
  if (ligado) {
    const antes = textoAntecedencia(Number($('#cfg-aviso-min').value));
    if (!suportaNotificacao()) {
      texto = `Este navegador não tem notificações: o aviso de ${antes} antes aparece só dentro do app.`; classe = 'erro-api';
    } else if (Notification.permission === 'granted') {
      texto = `✅ Ligado: aviso ${antes} antes de cada prazo, mesmo com a aba em segundo plano (com o app aberto).`; classe = 'ok';
    } else if (Notification.permission === 'denied') {
      texto = 'O navegador bloqueou as notificações. Libere no cadeado ao lado do endereço; enquanto isso, o aviso aparece só dentro do app.'; classe = 'erro-api';
    } else {
      texto = 'Clique em “Permitir” quando o navegador perguntar.';
    }
  }
  el.textContent = texto;
  el.className = `aviso-status ${classe}`;
}

async function aoMudarAviso() {
  const ligado = $('#cfg-aviso').checked;
  preparaSom(); // aproveita o clique para liberar o som do aviso
  if (ligado && suportaNotificacao() && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch (_) { /* navegador antigo */ }
  }
  Store.salvarConfig({ aviso: ligado, avisoMin: Number($('#cfg-aviso-min').value) });
  atualizarStatusAviso();
  toast(ligado ? `⏰ Avisos ligados: ${textoAntecedencia(Store.getConfig().avisoMin)} antes do prazo` : 'Avisos de prazo desligados');
  if (ligado) verificarAvisos();
}

function testarAviso() {
  preparaSom();
  const ok = mostrarNotificacao('🔔 Teste do PrazoCerto', 'Os avisos de prazo estão funcionando.', 'teste');
  tocarSom();
  toast(ok ? '🔔 Notificação de teste enviada' : '🔔 Teste: sem permissão do navegador, o aviso aparece só aqui na página');
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
const VIEWS = ['hoje', 'tarefas', 'agenda', 'foco', 'progresso'];
const TITULOS = { hoje: 'Hoje', tarefas: 'Tarefas', agenda: 'Agenda', foco: 'Foco', progresso: 'Progresso' };
const RENDER = { hoje: renderHoje, tarefas: renderTarefas, agenda: renderAgenda, foco: renderFoco, progresso: renderProgresso };

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
  if (estado.view !== 'foco') montarSelectTarefaFoco();
  verificarAvisos();
}

function aoClicar(e) {
  const alvo = e.target.closest('[data-acao], [data-fechar], [data-dia], [data-prazo], [data-remover-sub], a[href^="#"]');
  if (!alvo) return;

  if (alvo.hasAttribute('data-fechar')) return fecharModal(alvo.closest('dialog'));
  if (alvo.dataset.dia) { estado.diaSelecionado = alvo.dataset.dia; renderAgenda(); $(`[data-dia="${alvo.dataset.dia}"]`)?.focus(); return; }
  if (alvo.hasAttribute('data-prazo')) { definirPrazoRapido(alvo.dataset.prazo); return; }
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
  const el = document.activeElement;
  const digitando = /INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable;
  if (digitando || e.ctrlKey || e.metaKey || e.altKey || $('dialog[open]')) return;
  if (!Store.getConfig().atalhos) return; // o usuário pode desligar os atalhos de uma tecla (WCAG 2.1.4)
  const k = e.key.toLowerCase();
  if (e.key >= '1' && e.key <= '5') irPara(VIEWS[Number(e.key) - 1]);
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
  $('#cfg-aviso-min').addEventListener('change', aoMudarAviso);
  $('#btn-testar-aviso').addEventListener('click', testarAviso);

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

function prepararInstalacao() {
  const btn = $('#btn-instalar');
  // Guarda os arquivos no aparelho para abrir sem internet (só funciona em http/https, não em file://)
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(erro => console.warn('[PrazoCerto] Service worker não registrado', erro));
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
}

document.addEventListener('DOMContentLoaded', iniciar);
