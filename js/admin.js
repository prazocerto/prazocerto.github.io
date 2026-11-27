/* =========================================================
 * PrazoCerto — Painel de admin
 * ---------------------------------------------------------
 * Lê os acessos (presenca/), os perfis (perfis/) e a contagem
 * de grupos, e publica o aviso para todos (app/aviso).
 * Quem pode ver é decidido pelas REGRAS do Firestore (função
 * admin() em firestore.rules): o painel só tenta ler e, se as
 * regras recusarem, mostra "sem acesso".
 * O conteúdo das tarefas das pessoas NUNCA aparece aqui.
 * ========================================================= */
import { FIREBASE_CONFIG, CDN } from './firebase-config.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ms = v => (v && typeof v.toMillis === 'function' ? v.toMillis() : typeof v === 'number' ? v : v instanceof Date ? v.getTime() : 0);
const pad = n => String(n).padStart(2, '0');
const dataISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const diaMenos = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
const fmtNum = n => Number(n || 0).toLocaleString('pt-BR');
const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
const horasMin = m => { m = Math.round(m || 0); const h = Math.floor(m / 60); return h ? `${fmtNum(h)}h${m % 60 ? pad(m % 60) : ''}` : `${m}min`; };
function haQuanto(t) {
  if (!t) return '—';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} dia(s)`;
}

const ONLINE_MS = 3 * 60000; // o app avisa "estou aqui" a cada 2 minutos
const ORIGENS = {
  direto: '🔗 Link direto', instagram: '📸 Instagram', 'instagram-bio': '📸 Bio do Instagram', story: '📸 Story', stories: '📸 Story',
  whatsapp: '💬 WhatsApp', google: '🔎 Google', qrcode: '🔳 QR code', cartaz: '🔳 Cartaz', adesivo: '🔳 Adesivo', cartao: '🔳 Cartão',
  'convite-amigo': '👋 Convite de amigo', 'convite-grupo': '👥 Convite de grupo', 'tarefa-compartilhada': '📤 Tarefa compartilhada',
  facebook: '📘 Facebook', tiktok: '🎵 TikTok', x: '𝕏 X/Twitter', youtube: '▶️ YouTube', github: '🐙 GitHub', 'app-instalado': '📲 App instalado',
  borajogar: '🎮 Bora Jogar', 'bora-jogar': '🎮 Bora Jogar'
};
const nomeOrigem = o => ORIGENS[o] || `🌐 ${o}`;
const TELAS = { hoje: '🏠 Hoje', tarefas: '✅ Tarefas', agenda: '📅 Agenda', materias: '📒 Matérias', foco: '🍅 Foco', progresso: '📊 Progresso' };
const EMOJI_APARELHO = { celular: '📱', computador: '💻', tablet: '📲' };

let fb = null, auth = null, db = null;
let presencas = [], perfis = [], totalVisitantes = null, totalGrupos = null, aviso = null, usuarioAdmin = null;
const desligar = [];
let intervalo = null;

function toast(msg, erro = false) {
  const el = document.createElement('div');
  el.className = `toast ${erro ? 'toast--erro' : ''}`;
  el.innerHTML = `<span class="toast__msg">${esc(msg)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('saindo'); setTimeout(() => el.remove(), 250); }, 3500);
}

function tela(html) { $('#conteudo').innerHTML = `<div class="tela-central"><div class="card">${html}</div></div>`; }

async function carregarSDK() {
  const [app, a, f] = await Promise.all([import(`${CDN}firebase-app.js`), import(`${CDN}firebase-auth.js`), import(`${CDN}firebase-firestore.js`)]);
  fb = { ...a, ...f };
  const appFb = app.initializeApp(FIREBASE_CONFIG);
  auth = a.getAuth(appFb);
  auth.languageCode = 'pt';
  db = f.getFirestore(appFb);
}

function mostrarLogin() {
  $('#adm-acoes').innerHTML = '<a class="btn btn--ghost btn--sm" href="index.html">← Voltar ao app</a>';
  tela(`<span class="grande" aria-hidden="true">🛠️</span><h1 style="margin:0;font-size:1.4rem">Painel de admin</h1>
    <p class="sub" style="margin:0">Entre com a conta Google de administrador para ver os acessos do PrazoCerto.</p>
    <button type="button" class="btn btn--google" id="btn-entrar"><span class="g-logo" aria-hidden="true">G</span>Entrar com Google</button>`);
  $('#btn-entrar').addEventListener('click', async () => {
    try {
      const p = new fb.GoogleAuthProvider();
      p.setCustomParameters({ prompt: 'select_account' });
      await fb.signInWithPopup(auth, p);
    } catch (e) {
      if (e && e.code === 'auth/popup-blocked') { const p = new fb.GoogleAuthProvider(); await fb.signInWithRedirect(auth, p); }
      else if (e && !['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(e.code)) toast('Não deu para entrar. Tente de novo.', true);
    }
  });
}

function mostrarConta(u) {
  const foto = u.photoURL ? `<img src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">` : `<span class="av" aria-hidden="true">${esc((u.displayName || '?')[0])}</span>`;
  $('#adm-acoes').innerHTML = `<span class="adm-conta">${foto}<span>${esc(u.displayName || u.email || '')}</span></span>
    <a class="btn btn--ghost btn--sm" href="index.html">← App</a>
    <button type="button" class="btn btn--text btn--sm" id="btn-sair">Sair</button>`;
  $('#btn-sair').addEventListener('click', async () => { desligar.forEach(f => f()); await fb.signOut(auth); });
}

function semAcesso(u) {
  localStorage.removeItem('prazocerto:admin');
  tela(`<span class="grande" aria-hidden="true">🔒</span><h1 style="margin:0;font-size:1.3rem">Sem acesso</h1>
    <p class="sub" style="margin:0">A conta <b>${esc(u.email || u.displayName || '')}</b> não é a de administrador do PrazoCerto.</p>
    <p class="field__hint" style="margin:0">Se esta é a sua conta de admin, confira se o e-mail dela está na função <code>admin()</code> das regras do Firestore e se as regras foram publicadas.</p>`);
}

/* ---------- Dados ---------- */
async function carregarDados(u) {
  const desde = new Date(Date.now() - 30 * 86400000);
  // a contagem também serve de "porteiro": se as regras não deixarem, cai no "sem acesso"
  totalVisitantes = (await fb.getCountFromServer(fb.collection(db, 'presenca'))).data().count;
  localStorage.setItem('prazocerto:admin', u.uid);
  desligar.push(fb.onSnapshot(fb.query(fb.collection(db, 'presenca'), fb.where('ultimoAcesso', '>=', desde)), snap => {
    presencas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, e => toast(`Erro ao ler acessos: ${e.code || e}`, true)));
  desligar.push(fb.onSnapshot(fb.collection(db, 'perfis'), snap => {
    perfis = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    render();
  }, () => {}));
  desligar.push(fb.onSnapshot(fb.doc(db, 'app', 'aviso'), snap => {
    aviso = snap.exists() ? snap.data() : null;
    preencherAviso();
  }, () => {}));
  try { totalGrupos = (await fb.getCountFromServer(fb.collection(db, 'grupos'))).data().count; } catch (_) { totalGrupos = null; }
  clearInterval(intervalo);
  intervalo = setInterval(async () => {
    render();
    try { totalVisitantes = (await fb.getCountFromServer(fb.collection(db, 'presenca'))).data().count; } catch (_) {}
  }, 30000);
}

/* ---------- Contas ---------- */
function calcular() {
  const agora = Date.now();
  const hoje = dataISO(new Date());
  const dias7 = new Set(Array.from({ length: 7 }, (_, i) => dataISO(diaMenos(i))));
  const usouEm = (p, conjunto) => (p.dias || []).some(d => conjunto.has(d));
  const lista = presencas.map(p => ({ ...p, ultimo: ms(p.ultimoAcesso) }));
  return {
    lista,
    online: lista.filter(p => agora - p.ultimo < ONLINE_MS).sort((a, b) => b.ultimo - a.ultimo),
    hoje: lista.filter(p => (p.dias || []).includes(hoje) || dataISO(new Date(p.ultimo)) === hoje).length,
    semana: lista.filter(p => usouEm(p, dias7)).length,
    mes: lista.length,
    novos7: lista.filter(p => agora - ms(p.primeiraVisita) < 7 * 86400000).length,
    voltaram: lista.filter(p => (p.dias || []).length >= 2).length,
    instalados: lista.filter(p => p.instalado).length,
    logados: lista.filter(p => p.logado).length
  };
}

function contar(lista, chave) {
  const m = new Map();
  lista.forEach(p => { const k = (typeof chave === 'function' ? chave(p) : p[chave]) || 'desconhecido'; m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/* ---------- Desenho ---------- */
function barrasHTML(pares, total, nome = x => x) {
  if (!pares.length) return '<p class="vazio-adm">Ainda sem dados.</p>';
  const max = Math.max(...pares.map(p => p[1]));
  return `<div class="barras">${pares.slice(0, 10).map(([k, v]) => `<div class="barra-linha"><span>${esc(nome(k))}</span>
    <span class="trilho" aria-hidden="true"><span style="width:${Math.max(3, v / max * 100)}%"></span></span>
    <b>${fmtNum(v)} <small style="color:var(--muted)">(${pct(v, total)}%)</small></b></div>`).join('')}</div>`;
}

function graficoDias(lista) {
  const dias = Array.from({ length: 14 }, (_, i) => diaMenos(13 - i));
  const dados = dias.map(d => {
    const iso = dataISO(d);
    return { d, ativos: lista.filter(p => (p.dias || []).includes(iso)).length, novos: lista.filter(p => dataISO(new Date(ms(p.primeiraVisita))) === iso).length };
  });
  const max = Math.max(1, ...dados.map(x => x.ativos));
  const L = 640, A = 170, base = 140, larg = L / 14;
  const nomes = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const barras = dados.map((x, i) => {
    const h = x.ativos / max * 115, hn = Math.min(h, x.novos / max * 115), xx = i * larg + larg * 0.18, w = larg * 0.64;
    return `<g><title>${nomes[x.d.getDay()]} ${pad(x.d.getDate())}/${pad(x.d.getMonth() + 1)}: ${x.ativos} ativo(s), ${x.novos} novo(s)</title>
      <rect x="${xx}" y="${base - h}" width="${w}" height="${h}" rx="5" fill="var(--primary)" opacity=".35"></rect>
      <rect x="${xx}" y="${base - hn}" width="${w}" height="${hn}" rx="5" fill="var(--primary)"></rect>
      ${x.ativos ? `<text class="valor" x="${xx + w / 2}" y="${base - h - 6}" text-anchor="middle">${x.ativos}</text>` : ''}
      <text x="${xx + w / 2}" y="${base + 16}" text-anchor="middle">${pad(x.d.getDate())}</text>
      <text x="${xx + w / 2}" y="${base + 29}" text-anchor="middle">${nomes[x.d.getDay()]}</text></g>`;
  }).join('');
  return `<svg class="grafico" viewBox="0 0 ${L} ${A}" role="img" aria-label="Pessoas que usaram o app em cada um dos últimos 14 dias">
    <line x1="0" x2="${L}" y1="${base}" y2="${base}" stroke="var(--border)"></line>${barras}</svg>
    <div class="legenda"><span><i style="background:var(--primary);opacity:.35"></i>Usaram no dia</span><span><i style="background:var(--primary)"></i>Primeira vez</span></div>`;
}

function avatar(nome, foto, anonimo = false) {
  if (foto) return `<img class="av" src="${esc(foto)}" alt="" referrerpolicy="no-referrer">`;
  return `<span class="av ${anonimo ? 'av--anon' : ''}" aria-hidden="true">${anonimo ? '👤' : esc((nome || '?')[0].toUpperCase())}</span>`;
}

let renderAgendado = false;
function render() {
  if (renderAgendado) return;
  renderAgendado = true;
  requestAnimationFrame(() => { renderAgendado = false; desenhar(); });
}

function desenhar() {
  if (!usuarioAdmin) return;
  const c = calcular();
  const perfilPorUid = new Map(perfis.map(p => [p.uid, p]));
  const total30 = c.mes;
  const usam = f => c.lista.filter(p => p.contagens && f(p.contagens)).length;
  const soma = k => c.lista.reduce((a, p) => a + ((p.contagens && p.contagens[k]) || 0), 0);
  const semana = dataISO(diaMenos(((new Date().getDay() + 6) % 7)));
  const contas = perfis.map(p => ({ ...p, foco: p.semana === semana ? p.focoSemanaMin || 0 : 0, tarefas: p.semana === semana ? p.tarefasSemana || 0 : 0 }))
    .sort((a, b) => (b.foco + b.tarefas * 20) - (a.foco + a.tarefas * 20));
  const versoes = contar(c.lista, p => (p.versao ? `Versão ${p.versao}` : 'Sem versão'));
  const focandoAgora = c.online.filter(p => p.focando).length;

  const foco = document.activeElement && document.activeElement.id;
  const rolagem = window.scrollY;
  const avisoAntes = $('#aviso-texto') ? { texto: $('#aviso-texto').value, tipo: $('#aviso-tipo').value, link: $('#aviso-link').value, sujo: $('#aviso-texto').dataset.sujo } : null;

  $('#conteudo').innerHTML = `<div class="adm">
    <div class="adm-cabecalho">
      <div><h1>🛠️ Painel do PrazoCerto</h1><p class="sub">Acessos dos últimos 30 dias, atualizados em tempo real. Ninguém aqui vê o conteúdo das tarefas.</p></div>
      <span class="ao-vivo">ao vivo · ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
    </div>

    <div class="kpis-adm">
      <div class="card kpi-adm kpi-adm--destaque"><b>${fmtNum(c.online.length)}</b><span>🟢 Online agora</span><small>${focandoAgora ? `${focandoAgora} focando 🍅` : 'nos últimos 3 min'}</small></div>
      <div class="card kpi-adm"><b>${fmtNum(c.hoje)}</b><span>📅 Usaram hoje</span></div>
      <div class="card kpi-adm"><b>${fmtNum(c.semana)}</b><span>🗓️ Últimos 7 dias</span><small>${fmtNum(c.novos7)} novos</small></div>
      <div class="card kpi-adm"><b>${fmtNum(c.mes)}</b><span>📆 Últimos 30 dias</span><small>${pct(c.voltaram, c.mes)}% voltaram mais de 1 dia</small></div>
      <div class="card kpi-adm"><b>${totalVisitantes === null ? '—' : fmtNum(totalVisitantes)}</b><span>👥 Visitantes no total</span><small>desde o começo</small></div>
      <div class="card kpi-adm"><b>${fmtNum(perfis.length)}</b><span>🔐 Contas Google</span><small>${pct(c.logados, c.mes)}% dos ativos</small></div>
      <div class="card kpi-adm"><b>${fmtNum(c.instalados)}</b><span>📲 Instalaram o app</span><small>${pct(c.instalados, c.mes)}% dos ativos</small></div>
      <div class="card kpi-adm"><b>${totalGrupos === null ? '—' : fmtNum(totalGrupos)}</b><span>👥 Trabalhos em grupo</span></div>
    </div>

    <section class="card bloco" aria-labelledby="t-dias"><h2 id="t-dias">📈 Pessoas por dia (14 dias)</h2>${graficoDias(c.lista)}</section>

    <div class="grade-adm">
      <section class="card bloco" aria-labelledby="t-online">
        <h2 id="t-online">🟢 No app agora (${c.online.length})</h2>
        ${c.online.length ? `<ul class="lista-adm">${c.online.map(p => {
          const perfil = perfilPorUid.get(p.id);
          return `<li>${avatar(perfil && perfil.nome, perfil && perfil.foto, !perfil)}
            <div><b>${perfil ? esc(perfil.nome) : 'Visitante anônimo'}</b>
            <small>${EMOJI_APARELHO[p.aparelho] || '❔'} ${esc(p.sistema || '')} · ${esc(nomeOrigem(p.origem))}${p.instalado ? ' · 📲 app' : ''}</small></div>
            <span class="tag ${p.focando ? 'tag--foco' : ''}">${p.focando ? '🍅 Focando' : esc(TELAS[p.tela] || p.tela || '')}</span></li>`;
        }).join('')}</ul>` : '<p class="vazio-adm">Ninguém no app neste momento.</p>'}
      </section>

      <section class="card bloco" aria-labelledby="t-origem">
        <h2 id="t-origem">🧭 De onde vieram</h2>
        <p class="sub">Por onde cada pessoa chegou na primeira vez (30 dias).</p>
        ${barrasHTML(contar(c.lista, 'origem'), total30, nomeOrigem)}
      </section>

      <section class="card bloco" aria-labelledby="t-aparelhos">
        <h2 id="t-aparelhos">📱 Aparelhos</h2>
        ${barrasHTML(contar(c.lista, 'aparelho'), total30, k => `${EMOJI_APARELHO[k] || '❔'} ${k}`)}
        <p class="sub"><b>Sistema</b></p>${barrasHTML(contar(c.lista, 'sistema'), total30)}
        <p class="sub"><b>Navegador</b></p>${barrasHTML(contar(c.lista, 'navegador'), total30)}
      </section>

      <section class="card bloco" aria-labelledby="t-uso">
        <h2 id="t-uso">🧩 Uso das funções</h2>
        <p class="sub">Quantas pessoas (dos últimos 30 dias) já usaram cada parte do app.</p>
        ${barrasHTML([
          ['✅ Criaram tarefas', usam(x => x.tarefas > 0)], ['🍅 Usaram o foco', usam(x => x.focoMin > 0)],
          ['🎓 Cadastraram aulas', usam(x => x.aulas > 0)], ['📝 Lançaram notas', usam(x => x.materiasNotas > 0)],
          ['🃏 Fizeram flashcards', usam(x => x.cartas > 0)], ['👥 Trabalho em grupo', usam(x => x.grupos > 0)]
        ].sort((a, b) => b[1] - a[1]), total30)}
        <p class="sub">No total: <b>${fmtNum(soma('tarefas'))}</b> tarefas criadas, <b>${fmtNum(soma('concluidas'))}</b> concluídas e <b>${horasMin(soma('focoMin'))}</b> de foco.</p>
      </section>

      <section class="card bloco" aria-labelledby="t-versao">
        <h2 id="t-versao">🆕 Versão instalada</h2>
        <p class="sub">Para saber se o pessoal já recebeu a última atualização.</p>
        ${barrasHTML(versoes, total30)}
      </section>

      <section class="card bloco" aria-labelledby="t-aviso">
        <h2 id="t-aviso">📣 Aviso para todos</h2>
        <p class="sub">Aparece no topo do app de todo mundo (cada pessoa pode fechar).</p>
        <div class="form-aviso">
          <label class="field__label" for="aviso-texto" style="margin:0">Mensagem</label>
          <textarea id="aviso-texto" class="input" maxlength="280" placeholder="Ex.: 🆕 Chegou o modo prova! Abra uma prova e crie seu plano de revisão."></textarea>
          <div class="campos-2">
            <div><label class="field__label" for="aviso-tipo">Tipo</label><select id="aviso-tipo" class="select"><option value="novidade">🆕 Novidade</option><option value="info">ℹ️ Informação</option><option value="alerta">⚠️ Alerta</option></select></div>
            <div><label class="field__label" for="aviso-link">Link (opcional)</label><input id="aviso-link" class="input" type="url" placeholder="https://…"></div>
          </div>
          <p class="aviso-previa" id="aviso-status"></p>
          <div class="botoes-linha">
            <button type="button" class="btn btn--primary btn--sm" id="btn-publicar">📣 Publicar aviso</button>
            <button type="button" class="btn btn--ghost btn--sm" id="btn-tirar">Tirar do ar</button>
          </div>
        </div>
      </section>

      <section class="card bloco" aria-labelledby="t-links">
        <h2 id="t-links">🔗 Links para divulgar</h2>
        <p class="sub">Use um link diferente em cada lugar para saber o que traz mais gente (aparece em “De onde vieram”).</p>
        <div class="links-ref">${['instagram-bio', 'story', 'whatsapp', 'qrcode', 'cartaz', 'borajogar'].map(r => linkRefHTML(r)).join('')}</div>
        <div class="campos-2" style="align-items:end">
          <div><label class="field__label" for="ref-novo">Criar outro</label><input id="ref-novo" class="input" placeholder="ex.: turma-cco"></div>
          <button type="button" class="btn btn--ghost btn--sm" id="btn-ref">＋ Gerar link</button>
        </div>
      </section>
    </div>

    <section class="card bloco" aria-labelledby="t-contas">
      <h2 id="t-contas">🔐 Contas Google (${perfis.length})</h2>
      ${contas.length ? `<div class="tabela-rolagem"><table class="tabela-adm">
        <thead><tr><th scope="col">Pessoa</th><th scope="col" class="num">Nível</th><th scope="col" class="num">Foco na semana</th><th scope="col" class="num">Tarefas na semana</th><th scope="col" class="num">Amigos</th><th scope="col">Agora</th></tr></thead>
        <tbody>${contas.map(p => `<tr>
          <td><span class="pessoa">${avatar(p.nome, p.foto)}${esc(p.nome)}</span></td>
          <td class="num">${fmtNum(p.nivel || 1)}</td><td class="num">${horasMin(p.foco)}</td><td class="num">${fmtNum(p.tarefas)}</td>
          <td class="num">${fmtNum((p.amigos || []).length)}</td>
          <td>${ms(p.focandoAte) > Date.now() ? '<span class="tag tag--foco">🍅 Focando</span>' : `<small class="atualizado">${haQuanto(ms(p.atualizadoEm))}</small>`}</td>
        </tr>`).join('')}</tbody></table></div>` : '<p class="vazio-adm">Ninguém entrou com o Google ainda.</p>'}
    </section>
  </div>`;

  ligarFormularios();
  if (avisoAntes) { $('#aviso-texto').value = avisoAntes.texto; $('#aviso-tipo').value = avisoAntes.tipo; $('#aviso-link').value = avisoAntes.link; $('#aviso-texto').dataset.sujo = avisoAntes.sujo || ''; }
  else preencherAviso();
  atualizarStatusAviso();
  window.scrollTo(0, rolagem);
  if (foco && document.getElementById(foco)) document.getElementById(foco).focus();
}

function linkRefHTML(ref) {
  const link = `https://prazocerto.github.io/?ref=${encodeURIComponent(ref)}`;
  return `<div class="link-ref"><div><b>${esc(nomeOrigem(ref))}</b><code title="${esc(link)}">prazocerto.github.io/?ref=${esc(ref)}</code></div><button type="button" class="chip-btn" data-copiar="${esc(link)}">Copiar</button></div>`;
}

/* ---------- Aviso para todos ---------- */
function preencherAviso() {
  if (!$('#aviso-texto') || $('#aviso-texto').dataset.sujo) { atualizarStatusAviso(); return; }
  $('#aviso-texto').value = aviso ? aviso.texto || '' : '';
  $('#aviso-tipo').value = aviso && aviso.tipo ? aviso.tipo : 'novidade';
  $('#aviso-link').value = aviso ? aviso.link || '' : '';
  atualizarStatusAviso();
}
function atualizarStatusAviso() {
  const el = $('#aviso-status');
  if (!el) return;
  el.textContent = aviso && aviso.ativo ? `✅ No ar desde ${new Date(Number(aviso.versao) || Date.now()).toLocaleString('pt-BR')}` : '⏸ Nenhum aviso no ar agora.';
}
async function publicarAviso(ativo) {
  const texto = $('#aviso-texto').value.trim(), link = $('#aviso-link').value.trim();
  if (ativo && texto.length < 3) { toast('Escreva a mensagem do aviso.', true); $('#aviso-texto').focus(); return; }
  if (link && !/^https:\/\//.test(link)) { toast('O link precisa começar com https://', true); $('#aviso-link').focus(); return; }
  try {
    await fb.setDoc(fb.doc(db, 'app', 'aviso'), { texto: texto.slice(0, 280), tipo: $('#aviso-tipo').value, link, ativo, versao: Date.now(), atualizadoEm: fb.serverTimestamp() });
    $('#aviso-texto').dataset.sujo = '';
    toast(ativo ? '📣 Aviso publicado! Já aparece para quem está no app.' : 'Aviso tirado do ar.');
  } catch (e) { toast(e && e.code === 'permission-denied' ? 'As regras não deixaram publicar (confira a função admin()).' : 'Não deu para publicar agora.', true); }
}

function ligarFormularios() {
  $('#btn-publicar').addEventListener('click', () => publicarAviso(true));
  $('#btn-tirar').addEventListener('click', () => publicarAviso(false));
  ['#aviso-texto', '#aviso-tipo', '#aviso-link'].forEach(s => $(s).addEventListener('input', () => { $('#aviso-texto').dataset.sujo = '1'; }));
  $('#btn-ref').addEventListener('click', () => {
    const ref = $('#ref-novo').value.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 30);
    if (!ref) { toast('Digite um nome curto, ex.: turma-cco', true); return; }
    $('.links-ref').insertAdjacentHTML('beforeend', linkRefHTML(ref));
    $('#ref-novo').value = '';
  });
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-copiar]');
  if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copiar); toast('🔗 Link copiado!'); } catch (_) { prompt('Copie o link:', b.dataset.copiar); }
});

/* ---------- Início ---------- */
(async () => {
  try { await carregarSDK(); }
  catch (_) { tela('<span class="grande" aria-hidden="true">📴</span><p class="sub" style="margin:0">Sem conexão com o Firebase. Confira a internet e recarregue.</p>'); return; }
  fb.getRedirectResult(auth).catch(() => {});
  fb.onAuthStateChanged(auth, async u => {
    desligar.splice(0).forEach(f => f());
    usuarioAdmin = null;
    if (!u || u.isAnonymous) { mostrarLogin(); return; }
    mostrarConta(u);
    tela('<span class="grande" aria-hidden="true">⏳</span><p class="sub" style="margin:0">Carregando os acessos…</p>');
    try {
      await carregarDados(u);
      usuarioAdmin = u;
      desenhar();
    } catch (e) {
      if (e && e.code === 'permission-denied') semAcesso(u);
      else tela(`<span class="grande" aria-hidden="true">⚠️</span><p class="sub" style="margin:0">Não deu para carregar o painel (${esc((e && e.code) || 'erro')}). Recarregue a página.</p>`);
    }
  });
})();
