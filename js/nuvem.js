/* =========================================================
 * PrazoCerto — nuvem.js
 * Conta Google + sincronização entre aparelhos (Firebase)
 * ---------------------------------------------------------
 * - O app continua funcionando 100% sem conta: o LocalStorage
 *   segue sendo a "memória" principal (funciona sem internet).
 * - Com a conta, cada mudança é enviada para o Firestore
 *   (documento usuarios/{uid}) e os outros aparelhos recebem
 *   na hora (onSnapshot).
 * - O Firebase só é baixado quando a pessoa entra (ou já tinha
 *   entrado antes), para não pesar no carregamento.
 * - Mudanças feitas sem internet ficam "pendentes" e são
 *   enviadas quando a conexão volta.
 * Segurança: as regras do Firestore (arquivo firestore.rules)
 * só deixam cada pessoa ler e gravar o próprio documento.
 * ========================================================= */

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyC35fxaCjcWTMZ98pPOlNeozwdkbuNVMy0',
  authDomain: 'prazocerto-estudos.firebaseapp.com',
  projectId: 'prazocerto-estudos',
  storageBucket: 'prazocerto-estudos.firebasestorage.app',
  messagingSenderId: '870390730109',
  appId: '1:870390730109:web:846758ac44f2d6a4c6d014'
};
const VERSAO_SDK = '13.4.0';
const CDN = `https://www.gstatic.com/firebasejs/${VERSAO_SDK}/`;
const CHAVE_META = 'prazocerto:nuvem';      // { uid, pendente, ultimaSync }
const CHAVE_APARELHO = 'prazocerto:aparelho'; // identifica este aparelho
const LIMITE_BYTES = 900000;                // documento do Firestore aceita até ~1 MB

/* ---------- Estado ---------- */
let fb = null;            // funções do SDK
let auth = null, db = null;
let usuario = null;
let refDoc = null;
let pararOuvinte = null;
let timerEnvio = null;
let enviando = false;
let status = 'deslogado'; // deslogado | carregando | sincronizado | enviando | offline | erro
let mensagemErro = '';

const lerMeta = () => { try { return JSON.parse(localStorage.getItem(CHAVE_META)) || {}; } catch (_) { return {}; } };
const gravarMeta = parcial => localStorage.setItem(CHAVE_META, JSON.stringify({ ...lerMeta(), ...parcial }));
const aparelho = (() => {
  let id = localStorage.getItem(CHAVE_APARELHO);
  if (!id) { id = `ap-${Math.random().toString(36).slice(2, 10)}`; localStorage.setItem(CHAVE_APARELHO, id); }
  return id;
})();
const pelaInternet = () => window.isSecureContext && location.protocol.startsWith('http');
const temDados = d => !!(d && ((d.tarefas && d.tarefas.length) || (d.aulas && d.aulas.length)));

/* ---------- Carrega o Firebase (só quando precisa) ---------- */
async function carregarSDK() {
  if (fb) return fb;
  const [app, a, f] = await Promise.all([
    import(`${CDN}firebase-app.js`), import(`${CDN}firebase-auth.js`), import(`${CDN}firebase-firestore.js`)
  ]);
  fb = { ...a, ...f };
  const appFb = app.initializeApp(FIREBASE_CONFIG);
  auth = a.getAuth(appFb);
  auth.languageCode = 'pt';
  db = f.getFirestore(appFb);
  a.onAuthStateChanged(auth, aoMudarUsuario);
  return fb;
}

/* ---------- Entrar e sair ---------- */
async function entrar() {
  if (!pelaInternet()) { toast('Para entrar, abra o PrazoCerto pelo link do site (prazocerto.github.io).', { tipo: 'erro' }); return; }
  if (!navigator.onLine) { toast('Sem internet agora. Conecte-se para entrar.', { tipo: 'erro' }); return; }
  mudarStatus('carregando');
  try {
    await carregarSDK();
    const provedor = new fb.GoogleAuthProvider();
    provedor.setCustomParameters({ prompt: 'select_account' });
    try {
      await fb.signInWithPopup(auth, provedor);
    } catch (erro) {
      // celular que bloqueia janela extra: entra redirecionando a página
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(erro.code)) {
        gravarMeta({ redirecionando: true });
        await fb.signInWithRedirect(auth, provedor);
        return;
      }
      throw erro;
    }
  } catch (erro) {
    tratarErro(erro);
    if (!usuario) mudarStatus('deslogado');
  }
}

async function sair() {
  if (!auth) return;
  await enviarAgora(); // garante que nada fica para trás
  if (pararOuvinte) { pararOuvinte(); pararOuvinte = null; }
  await fb.signOut(auth);
  localStorage.removeItem(CHAVE_META);
  toast('Você saiu da conta. As tarefas continuam salvas neste aparelho.');
}

function tratarErro(erro) {
  const codigo = (erro && erro.code) || '';
  console.warn('[PrazoCerto] Nuvem:', codigo, erro);
  const mensagens = {
    'auth/popup-closed-by-user': '',
    'auth/cancelled-popup-request': '',
    'auth/unauthorized-domain': `Este endereço (${location.hostname}) ainda não foi autorizado no Firebase (Authentication → Configurações → Domínios autorizados).`,
    'auth/network-request-failed': 'Sem conexão com o Google. Confira a internet e tente de novo.',
    'auth/operation-not-allowed': 'O login com Google ainda não foi ativado no Firebase (Authentication → Método de login → Google).',
    'permission-denied': 'O Firebase recusou o acesso: falta publicar as regras do Firestore (arquivo firestore.rules).',
    'unavailable': 'Sem conexão com a nuvem agora. Suas mudanças ficam guardadas e sobem quando a internet voltar.'
  };
  const msg = codigo in mensagens ? mensagens[codigo] : 'Não deu para conectar com a nuvem agora. Tente de novo em instantes.';
  if (!msg) return; // a pessoa só fechou a janela de login
  mensagemErro = msg;
  toast(`☁️ ${msg}`, { tipo: 'erro', duracao: 9000 });
}

/* ---------- Quando a conta muda (entrou, saiu, voltou ao abrir o app) ---------- */
async function aoMudarUsuario(u) {
  usuario = u;
  if (!u) {
    if (pararOuvinte) { pararOuvinte(); pararOuvinte = null; }
    refDoc = null;
    pararSocial();
    mudarStatus('deslogado');
    if (lerPendente()) mostrarConvitePedindoLogin();
    return;
  }
  const meta = lerMeta();
  const primeiraVez = meta.uid !== u.uid; // primeira vez desta conta neste aparelho
  refDoc = fb.doc(db, 'usuarios', u.uid);
  mudarStatus('carregando');
  try {
    const snap = await fb.getDoc(refDoc);
    const remoto = snap.exists() ? lerJson(snap.data().json) : null;
    const local = Store.instantaneo();
    if (primeiraVez) {
      if (!temDados(remoto)) await enviarAgora(true);
      else if (!temDados(local)) aplicarRemoto(remoto, '☁️ Suas tarefas da nuvem chegaram neste aparelho');
      else if (JSON.stringify(local) !== JSON.stringify(remoto)) {
        const escolha = await perguntarComoJuntar(local, remoto);
        if (escolha === 'nuvem') aplicarRemoto(remoto, '☁️ Agora este aparelho usa as tarefas da nuvem');
        else if (escolha === 'aparelho') await enviarAgora(true);
        else { aplicarRemoto(juntar(local, remoto), '☁️ Tarefas juntadas: as deste aparelho e as da nuvem'); await enviarAgora(true); }
      }
      gravarMeta({ uid: u.uid, pendente: false, redirecionando: false });
      if (!meta.uid) toast(`☁️ Conectado como ${u.displayName || u.email}. Suas tarefas agora sincronizam.`);
    } else if (meta.pendente) {
      await enviarAgora(true); // o que foi feito sem internet vale
    } else if (remoto && JSON.stringify(local) !== JSON.stringify(remoto)) {
      aplicarRemoto(remoto);
    }
  } catch (erro) {
    tratarErro(erro);
    mudarStatus(navigator.onLine ? 'erro' : 'offline');
  }
  ouvirNuvem();
  if (status === 'carregando') mudarStatus('sincronizado');
  iniciarSocial();
}

const lerJson = texto => { try { return JSON.parse(texto); } catch (_) { return null; } };

/* Tempo real: mudanças feitas em outro aparelho chegam aqui */
function ouvirNuvem() {
  if (pararOuvinte || !refDoc) return;
  pararOuvinte = fb.onSnapshot(refDoc, snap => {
    if (snap.metadata && snap.metadata.hasPendingWrites) return;
    const d = snap.data();
    if (!d) return;
    if (d.aparelho === aparelho) { if (!lerMeta().pendente) mudarStatus('sincronizado'); return; }
    if (lerMeta().pendente) return; // mudanças daqui ainda vão subir e valem mais
    const remoto = lerJson(d.json);
    if (remoto && JSON.stringify(remoto) !== JSON.stringify(Store.instantaneo())) {
      aplicarRemoto(remoto, '☁️ Atualizado com o seu outro aparelho');
    }
    mudarStatus('sincronizado');
  }, erro => { tratarErro(erro); mudarStatus('erro'); });
}

/* ---------- Enviar ---------- */
function agendarEnvio() {
  gravarMeta({ pendente: true });
  if (!usuario) return;
  clearTimeout(timerEnvio);
  timerEnvio = setTimeout(() => enviarAgora(), 1500);
  if (navigator.onLine) mudarStatus('enviando'); else mudarStatus('offline');
}

async function enviarAgora(forcar = false) {
  clearTimeout(timerEnvio);
  if (!usuario || !refDoc) return;
  if (!forcar && !lerMeta().pendente) return;
  if (!navigator.onLine) { gravarMeta({ pendente: true }); mudarStatus('offline'); return; }
  if (enviando) { timerEnvio = setTimeout(() => enviarAgora(forcar), 800); return; }
  const json = JSON.stringify(Store.instantaneo());
  if (json.length > LIMITE_BYTES) {
    mensagemErro = 'Seus dados passaram do limite da nuvem. Exclua tarefas concluídas antigas e tente de novo.';
    mudarStatus('erro');
    return;
  }
  enviando = true;
  mudarStatus('enviando');
  try {
    await fb.setDoc(refDoc, { json, atualizadoEm: fb.serverTimestamp(), aparelho, versao: 1 });
    gravarMeta({ pendente: false, ultimaSync: Date.now() });
    mensagemErro = '';
    mudarStatus('sincronizado');
  } catch (erro) {
    gravarMeta({ pendente: true });
    tratarErro(erro);
    mudarStatus(navigator.onLine ? 'erro' : 'offline');
  } finally {
    enviando = false;
  }
}

/* ---------- Aplicar o que veio da nuvem ---------- */
function aplicarRemoto(dados, aviso = '') {
  Store.aplicarInstantaneo(dados);
  juntarTarefasRepetidasDeGrupo();
  try { montarSelectMaterias(); } catch (_) {}
  try { atualizarTudo(); } catch (_) {}
  if (aviso) toast(aviso);
}

/** Junta duas versões sem perder nada: une as listas pelo id (o item deste aparelho vale em caso de empate). */
function juntar(local, remoto) {
  const unir = (a = [], b = []) => {
    const mapa = new Map(b.map(x => [x.id, x]));
    a.forEach(x => {
      const outro = mapa.get(x.id);
      // se um dos lados já concluiu a tarefa, fica concluída
      mapa.set(x.id, outro && outro.concluida && !x.concluida ? outro : x);
    });
    return [...mapa.values()];
  };
  const c1 = local.conquistas || {}, c2 = remoto.conquistas || {};
  return {
    tarefas: unir(local.tarefas, remoto.tarefas),
    materias: unir(local.materias, remoto.materias),
    sessoes: unir(local.sessoes, remoto.sessoes).sort((x, y) => String(y.inicio).localeCompare(String(x.inicio))).slice(0, 500),
    aulas: unir(local.aulas, remoto.aulas),
    conquistas: { ...c2, ...c1, vistas: [...new Set([...(c1.vistas || []), ...(c2.vistas || [])])], nivel: Math.max(c1.nivel || 1, c2.nivel || 1) },
    config: { ...remoto.config, ...local.config },
    estudo: juntarEstudo(local.estudo || {}, remoto.estudo || {})
  };
}

/** Estudo por matéria: notas e anotações deste aparelho; faltas e flashcards dos dois lados */
function juntarEstudo(local, remoto) {
  const r = { ...remoto };
  Object.entries(local).forEach(([id, l]) => {
    const o = remoto[id];
    if (!o) { r[id] = l; return; }
    const cartas = new Map((o.flashcards || []).map(c => [c.id, c]));
    (l.flashcards || []).forEach(c => cartas.set(c.id, c));
    r[id] = { ...o, ...l, faltas: [...new Set([...(o.faltas || []), ...(l.faltas || [])])].sort(), flashcards: [...cartas.values()],
      avaliacoes: (l.avaliacoes || []).length ? l.avaliacoes : o.avaliacoes, anotacoes: l.anotacoes || o.anotacoes };
  });
  return r;
}

/* Primeira vez desta conta num aparelho que já tem tarefas: pergunta o que fazer */
function perguntarComoJuntar(local, remoto) {
  const conta = d => `${(d.tarefas || []).length} tarefa(s)${(d.aulas || []).length ? ` e ${d.aulas.length} aula(s)` : ''}`;
  $('#nuvem-local').textContent = conta(local);
  $('#nuvem-remoto').textContent = conta(remoto);
  return new Promise(resolver => {
    const dlg = $('#dlg-nuvem');
    let escolha = 'juntar'; // fechar a janela = juntar (não perde nada)
    const aoClicar = e => {
      const b = e.target.closest('[data-escolha]');
      if (!b) return;
      escolha = b.dataset.escolha;
      fecharModal(dlg);
    };
    dlg.addEventListener('click', aoClicar);
    dlg.addEventListener('close', () => { dlg.removeEventListener('click', aoClicar); resolver(escolha); }, { once: true });
    abrirModal('dlg-nuvem');
  });
}

/* ---------- Tela (Configurações → Conta e sincronização) ---------- */
function mudarStatus(novo) {
  status = novo;
  renderConta();
}

function textoStatus() {
  const meta = lerMeta();
  const hora = meta.ultimaSync ? new Date(meta.ultimaSync).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  switch (status) {
    case 'carregando': return ['⏳', 'Conectando com a nuvem…'];
    case 'enviando': return ['⏳', 'Salvando na nuvem…'];
    case 'offline': return ['📴', 'Sem internet: suas mudanças ficam guardadas e sobem quando a conexão voltar.'];
    case 'erro': return ['⚠️', mensagemErro || 'Não deu para sincronizar agora.'];
    default: return ['✅', `Sincronizado${hora ? ` às ${hora}` : ''}. Mudanças aparecem nos outros aparelhos na hora.`];
  }
}

function renderConta() {
  const caixa = document.getElementById('conta-nuvem');
  if (!caixa) return;
  if (!pelaInternet()) {
    caixa.innerHTML = '<p class="field__hint">Para entrar com sua conta, abra o PrazoCerto pelo link do site (<strong>prazocerto.github.io</strong>).</p>';
    return;
  }
  if (!usuario) {
    const carregando = status === 'carregando';
    caixa.innerHTML = `
      <p class="field__hint" style="margin:0">Entre com o Google para ter as <strong>mesmas tarefas no celular e no computador</strong>. Sem conta, tudo continua funcionando e salvo só neste aparelho.</p>
      <button type="button" class="btn btn--google" data-nuvem="entrar" ${carregando ? 'disabled' : ''}>
        <span class="g-logo" aria-hidden="true">G</span>${carregando ? 'Conectando…' : 'Entrar com Google'}</button>`;
    return;
  }
  const [icone, texto] = textoStatus();
  const nome = usuario.displayName || 'Sua conta';
  caixa.innerHTML = `
    <div class="conta">
      ${usuario.photoURL ? `<img class="conta__foto" src="${esc(usuario.photoURL)}" alt="" referrerpolicy="no-referrer" width="44" height="44">` : `<span class="conta__foto conta__foto--letra" aria-hidden="true">${esc(nome[0] || '?')}</span>`}
      <div class="conta__dados"><strong>${esc(nome)}</strong><span>${esc(usuario.email || '')}</span></div>
    </div>
    <p class="conta__status conta__status--${status}" role="status"><span aria-hidden="true">${icone}</span> ${esc(texto)}</p>
    <div class="botoes-linha">
      <button type="button" class="btn btn--ghost btn--sm" data-nuvem="sincronizar">🔄 Sincronizar agora</button>
      <button type="button" class="btn btn--text btn--sm" data-nuvem="sair">Sair da conta</button>
    </div>`;
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-nuvem]');
  if (!b) return;
  switch (b.dataset.nuvem) {
    case 'entrar': entrar(); break;
    case 'sair': sair(); break;
    case 'sincronizar': mensagemErro = ''; enviarAgora(true); break;
    case 'convidar': convidarAmigos(); break;
    case 'remover-amigo': removerAmigo(b.dataset.uid); break;
    case 'focar-junto': focarJunto(b.dataset.uid); break;
    case 'criar-grupo': criarGrupo(); break;
    case 'convidar-grupo': convidarParaGrupo($('#t-grupo-id').value); break;
    case 'sair-grupo': sairDoGrupo($('#t-grupo-id').value); break;
    case 'aceitar-amigo': aceitarAmigo(b.dataset.uid); break;
    case 'entrar-grupo': entrarNoGrupo(b.dataset.gid); break;
    case 'whats': break; // link normal
    case 'copiar': copiarTexto(b.dataset.link); break;
    case 'compartilhar': navigator.share && navigator.share({ title: 'PrazoCerto', text: b.dataset.texto, url: b.dataset.link }).catch(() => {}); break;
  }
});

/* =========================================================
 * SOCIAL: perfis, amigos (ranking e "estudando agora") e
 * trabalhos em grupo em tempo real
 * ---------------------------------------------------------
 * perfis/{uid}  → nome, foto, números da semana, foco agora e
 *                 lista de amigos (lida por quem é amigo)
 * grupos/{id}   → tarefa em grupo: etapas, quem faz cada uma
 *                 e membros (só membros listam; quem tem o
 *                 link vê a prévia e pode entrar)
 * ========================================================= */
let amigosIds = new Set();
const amigosDados = new Map();
const ouvintesAmigos = new Map();
let pararReversos = null, timerPerfil = null, pararGrupos = null, timerGrupos = null, enviandoGrupos = false;
const gruposBase = new Map(); // último estado conhecido de cada grupo (base para juntar mudanças)
const CHAVE_PENDENTE = 'prazocerto:convite';
const CHAVE_REMOVIDOS = 'prazocerto:amigos-removidos';

const baseUrl = () => (pelaInternet() ? `${location.origin}${location.pathname}` : 'https://prazocerto.github.io/');
const primeiroNome = n => String(n || 'Alguém').split(' ')[0];
const meuNome = () => (usuario && usuario.displayName) || Store.getConfig().nome || 'Estudante';
const avatarHTML = (p, extra = '') => (p && p.foto
  ? `<img class="avatar ${extra}" src="${esc(p.foto)}" alt="" referrerpolicy="no-referrer" width="34" height="34">`
  : `<span class="avatar ${extra}" aria-hidden="true">${esc(String((p && p.nome) || '?')[0].toUpperCase())}</span>`);
const lerPendente = () => { try { return JSON.parse(sessionStorage.getItem(CHAVE_PENDENTE)); } catch (_) { return null; } };
const removidos = () => { try { return new Set(JSON.parse(localStorage.getItem(CHAVE_REMOVIDOS)) || []); } catch (_) { return new Set(); } };

async function copiarTexto(texto) {
  try { await navigator.clipboard.writeText(texto); toast('🔗 Link copiado!'); }
  catch (_) { prompt('Copie o link:', texto); }
}

/* ---------- Perfil público (o que os amigos veem) ---------- */
function publicarPerfil() {
  if (!usuario || !db) return;
  clearTimeout(timerPerfil);
  timerPerfil = setTimeout(enviarPerfil, 1200);
}
async function enviarPerfil() {
  if (!usuario || !navigator.onLine) return;
  const st = statsSemana(inicioSemana());
  const s = calcularStats();
  const focando = timer.rodando && timer.modo === 'foco';
  const tarefa = focando && timer.tarefaId ? Store.getTarefa(timer.tarefaId) : null;
  try {
    await fb.setDoc(fb.doc(db, 'perfis', usuario.uid), {
      nome: meuNome().slice(0, 40), foto: usuario.photoURL || '', semana: dataISO(inicioSemana()),
      focoSemanaMin: st.minutos, tarefasSemana: st.tarefas, xp: s.xp, nivel: s.nivel,
      focandoAte: focando ? timer.fim : 0, focandoMateria: tarefa ? infoMateria(tarefa.materia).nome.slice(0, 30) : '',
      amigos: [...amigosIds].slice(0, 100), atualizadoEm: fb.serverTimestamp()
    });
  } catch (erro) { console.warn('[PrazoCerto] perfil:', erro); }
}

async function iniciarSocial() {
  try {
    const snap = await fb.getDoc(fb.doc(db, 'perfis', usuario.uid));
    if (snap.exists()) (snap.data().amigos || []).forEach(id => amigosIds.add(id));
  } catch (_) { /* sem internet: tenta de novo depois */ }
  // quem me adicionou também aparece para mim (amizade dos dois lados)
  try {
    pararReversos = fb.onSnapshot(fb.query(fb.collection(db, 'perfis'), fb.where('amigos', 'array-contains', usuario.uid)), snap => {
      const fora = removidos();
      let mudou = false;
      snap.docs.forEach(d => { if (d.id !== usuario.uid && !amigosIds.has(d.id) && !fora.has(d.id)) { amigosIds.add(d.id); mudou = true; } });
      if (mudou) { ouvirAmigos(); publicarPerfil(); }
    }, () => {});
  } catch (_) {}
  ouvirAmigos();
  publicarPerfil();
  ouvirGrupos();
  renderSocial();
  processarPendente();
}

function pararSocial() {
  ouvintesAmigos.forEach(f => f());
  ouvintesAmigos.clear(); amigosDados.clear(); amigosIds = new Set();
  if (pararReversos) { pararReversos(); pararReversos = null; }
  if (pararGrupos) { pararGrupos(); pararGrupos = null; }
  gruposBase.clear();
  renderSocial();
}

function ouvirAmigos() {
  amigosIds.forEach(id => {
    if (ouvintesAmigos.has(id)) return;
    ouvintesAmigos.set(id, fb.onSnapshot(fb.doc(db, 'perfis', id), snap => {
      if (snap.exists()) amigosDados.set(id, { uid: id, ...snap.data() }); else amigosDados.delete(id);
      renderSocial();
    }, () => {}));
  });
}

/* ---------- Ranking da semana (tela Progresso) ---------- */
const pontosDe = p => (p.focoSemanaMin || 0) + (p.tarefasSemana || 0) * 20; // 1 tarefa = 20 min de foco
function renderSocial() { renderRanking(); renderEstudandoAgora(); }

function renderRanking() {
  const caixa = document.getElementById('ranking');
  if (!caixa) return;
  if (!pelaInternet()) { caixa.innerHTML = ''; return; }
  if (!usuario) {
    caixa.innerHTML = `<section class="card ranking-card" aria-labelledby="titulo-ranking">
      <div class="ranking-card__topo"><h2 id="titulo-ranking">🏆 Ranking com os amigos</h2></div>
      <p class="sub" style="margin:0">Entre com o Google para comparar a sua semana de estudos com a dos seus amigos.</p>
      <div class="botoes-linha"><button type="button" class="btn btn--google btn--sm" data-nuvem="entrar"><span class="g-logo" aria-hidden="true">G</span>Entrar com Google</button></div>
    </section>`;
    return;
  }
  const semana = dataISO(inicioSemana());
  const st = statsSemana(inicioSemana());
  const eu = { uid: usuario.uid, nome: meuNome(), foto: usuario.photoURL || '', focoSemanaMin: st.minutos, tarefasSemana: st.tarefas, focandoAte: timer.rodando && timer.modo === 'foco' ? timer.fim : 0 };
  const lista = [eu, ...[...amigosDados.values()].map(p => ({ ...p, focoSemanaMin: p.semana === semana ? p.focoSemanaMin : 0, tarefasSemana: p.semana === semana ? p.tarefasSemana : 0 }))]
    .sort((a, b) => pontosDe(b) - pontosDe(a));
  const medalha = i => ['🥇', '🥈', '🥉'][i] || `${i + 1}º`;
  caixa.innerHTML = `<section class="card ranking-card" aria-labelledby="titulo-ranking">
    <div class="ranking-card__topo"><h2 id="titulo-ranking">🏆 Ranking da semana</h2>
      <button type="button" class="btn btn--ghost btn--sm" data-nuvem="convidar">＋ Convidar amigos</button></div>
    ${amigosDados.size ? `<ol class="ranking">${lista.map((p, i) => `<li class="${p.uid === usuario.uid ? 'eu' : ''}">
        <span class="pos" aria-label="${i + 1}º lugar">${medalha(i)}</span>${avatarHTML(p)}
        <span class="nome"><b>${esc(p.uid === usuario.uid ? `${primeiroNome(p.nome)} (você)` : p.nome)}</b>
          <small>🍅 ${formatarMin(p.focoSemanaMin) || '0min'} · ✅ ${p.tarefasSemana}${p.focandoAte > Date.now() ? ' · <span class="focando-tag">🟢 focando agora</span>' : ''}</small></span>
        <span class="pontos">${pontosDe(p)} pts${p.uid !== usuario.uid ? ` <button type="button" class="btn-icone" data-nuvem="remover-amigo" data-uid="${esc(p.uid)}" aria-label="Remover ${esc(p.nome)} dos amigos" title="Remover">✕</button>` : ''}</span>
      </li>`).join('')}</ol>
      <p class="field__hint" style="margin:0">Pontos = minutos de foco + 20 por tarefa concluída. Zera toda segunda.</p>`
    : '<p class="sub" style="margin:0">Convide amigos da turma para ver quem estuda mais na semana. 💪</p>'}
  </section>`;
}

function convidarAmigos() {
  if (!usuario) { entrar(); return; }
  const link = `${baseUrl()}?amigo=${encodeURIComponent(usuario.uid)}`;
  const texto = `Bora ver quem estuda mais essa semana? 📚 Entra no meu ranking do PrazoCerto:`;
  abrirConvite('👋 Convidar amigos', `<p class="modal__sub">Mande o link: quem abrir e aceitar entra no seu ranking, e vocês veem quando o outro está estudando.</p>`, linkBotoes(link, texto));
}

function linkBotoes(link, texto) {
  return `<a class="btn btn--whats" href="https://wa.me/?text=${encodeURIComponent(`${texto}\n${link}`)}" target="_blank" rel="noopener">💬 WhatsApp</a>
    <button type="button" class="btn btn--ghost" data-nuvem="copiar" data-link="${esc(link)}">🔗 Copiar link</button>
    ${navigator.share ? `<button type="button" class="btn btn--ghost" data-nuvem="compartilhar" data-link="${esc(link)}" data-texto="${esc(texto)}">📤 Mais</button>` : ''}`;
}

function abrirConvite(titulo, conteudo, acoes) {
  $('#convite-titulo').textContent = titulo;
  $('#convite-conteudo').innerHTML = conteudo;
  $('#convite-acoes').innerHTML = acoes;
  if (!$('#dlg-convite').open) abrirModal('dlg-convite');
}

function removerAmigo(uid) {
  const p = amigosDados.get(uid);
  amigosIds.delete(uid);
  amigosDados.delete(uid);
  const f = ouvintesAmigos.get(uid); if (f) f(); ouvintesAmigos.delete(uid);
  const fora = removidos(); fora.add(uid); localStorage.setItem(CHAVE_REMOVIDOS, JSON.stringify([...fora]));
  publicarPerfil();
  renderSocial();
  toast(`${p ? primeiroNome(p.nome) : 'Amigo'} saiu do seu ranking`);
}

/* ---------- Estudando agora (tela Foco) ---------- */
function renderEstudandoAgora() {
  const caixa = document.getElementById('estudando-agora');
  if (!caixa) return;
  if (!usuario || !pelaInternet()) { caixa.hidden = true; return; }
  caixa.hidden = false;
  const agora = Date.now();
  const focando = [...amigosDados.values()].filter(p => p.focandoAte > agora).sort((a, b) => a.focandoAte - b.focandoAte);
  caixa.innerHTML = `<h2 id="titulo-estudando">👥 Estudando agora</h2>
    ${focando.length ? focando.map(p => {
      const min = Math.max(1, Math.round((p.focandoAte - agora) / 60000));
      return `<div class="amigo-focando">${avatarHTML(p, 'avatar--g')}
        <span><b>${esc(primeiroNome(p.nome))}</b> está focando${p.focandoMateria ? ` em ${esc(p.focandoMateria)}` : ''}<small>🟢 faltam ${min} min</small></span>
        <button type="button" class="btn btn--primary btn--sm" data-nuvem="focar-junto" data-uid="${esc(p.uid)}">🍅 Focar junto</button></div>`;
    }).join('')
    : `<p class="sub" style="margin:0">${amigosDados.size ? 'Nenhum amigo focando agora. Comece você e eles vão ver! 😉' : 'Convide amigos para ver quando eles estão estudando e focar junto.'}</p>`}
    ${amigosDados.size ? '' : '<div class="botoes-linha"><button type="button" class="btn btn--ghost btn--sm" data-nuvem="convidar">＋ Convidar amigos</button></div>'}`;
}
setInterval(() => { if (usuario && estado.view === 'foco') renderEstudandoAgora(); }, 30000);

function focarJunto(uid) {
  const p = amigosDados.get(uid);
  if (!p || !(p.focandoAte > Date.now())) { toast('O foco desse amigo já terminou.'); renderSocial(); return; }
  focarAte(p.focandoAte, `👥 Focando junto com ${primeiroNome(p.nome)}! Vocês terminam na mesma hora.`);
}

/* ---------- Convites recebidos por link (?amigo= / ?grupo=) ---------- */
function lerConviteDaUrl() {
  const p = new URLSearchParams(location.search);
  const amigo = p.get('amigo'), grupo = p.get('grupo');
  if (!amigo && !grupo) return;
  p.delete('amigo'); p.delete('grupo');
  history.replaceState(null, '', location.pathname + (p.toString() ? `?${p}` : '') + location.hash);
  sessionStorage.setItem(CHAVE_PENDENTE, JSON.stringify(amigo ? { tipo: 'amigo', id: amigo } : { tipo: 'grupo', id: grupo }));
}

function mostrarConvitePedindoLogin() {
  const pend = lerPendente();
  if (!pend || $('dialog[open]')) return;
  abrirConvite(pend.tipo === 'grupo' ? '👥 Convite para um trabalho em grupo' : '👋 Convite para o ranking',
    `<p class="modal__sub">Para aceitar, entre com a sua conta Google. É rápido, e suas tarefas continuam salvas neste aparelho.</p>`,
    '<button type="button" class="btn btn--text" data-fechar>Agora não</button><button type="button" class="btn btn--google" data-nuvem="entrar"><span class="g-logo" aria-hidden="true">G</span>Entrar com Google</button>');
}

async function processarPendente() {
  const pend = lerPendente();
  if (!pend || !usuario) return;
  sessionStorage.removeItem(CHAVE_PENDENTE);
  try {
    if (pend.tipo === 'amigo') {
      if (pend.id === usuario.uid) { toast('Esse é o seu próprio link de convite 😄'); return; }
      if (amigosIds.has(pend.id)) { toast('Vocês já são amigos no ranking!'); return; }
      const snap = await fb.getDoc(fb.doc(db, 'perfis', pend.id));
      const p = snap.exists() ? { uid: pend.id, ...snap.data() } : { uid: pend.id, nome: 'Seu amigo' };
      abrirConvite('👋 Convite para o ranking',
        `<div class="convite-pessoa">${avatarHTML(p, 'avatar--g')}<p style="margin:0"><b>${esc(p.nome)}</b> te convidou para o ranking de estudos da semana.</p></div>
         <p class="field__hint" style="margin:0">Vocês vão ver as horas de foco e as tarefas concluídas um do outro, e quando o outro está estudando.</p>`,
        `<button type="button" class="btn btn--text" data-fechar>Agora não</button><button type="button" class="btn btn--primary" data-nuvem="aceitar-amigo" data-uid="${esc(p.uid)}">✓ Aceitar</button>`);
    } else {
      const snap = await fb.getDoc(fb.doc(db, 'grupos', pend.id));
      if (!snap.exists()) { toast('Esse grupo não existe mais.', { tipo: 'erro' }); return; }
      const g = snap.data();
      const local = Store.getTarefas().find(t => t.grupoId === pend.id);
      if ((g.membrosIds || []).includes(usuario.uid)) { toast('Você já está nesse grupo!'); if (local) abrirFormTarefa(local); return; }
      const membros = Object.values(g.membros || {});
      abrirConvite('👥 Trabalho em grupo',
        `<div class="compartilhar-previa"><h3>${esc(g.titulo)}</h3>
          <p>${esc(g.materiaNome || '')}${g.prazo ? ` · ⏰ ${dataCurta(new Date(g.prazo))} às ${hora(new Date(g.prazo))}` : ''} · ${(g.etapas || []).length} etapa(s)</p>
          <div class="avatares">${membros.map(m => avatarHTML(m)).join('')}</div></div>
         <p class="field__hint" style="margin:0">Entrando, a tarefa aparece no seu PrazoCerto e tudo que o grupo marcar atualiza na hora para todos.</p>`,
        `<button type="button" class="btn btn--text" data-fechar>Agora não</button><button type="button" class="btn btn--primary" data-nuvem="entrar-grupo" data-gid="${esc(pend.id)}">👥 Entrar no grupo</button>`);
    }
  } catch (erro) { tratarErro(erro); }
}

function aceitarAmigo(uid) {
  amigosIds.add(uid);
  const fora = removidos(); fora.delete(uid); localStorage.setItem(CHAVE_REMOVIDOS, JSON.stringify([...fora]));
  ouvirAmigos();
  publicarPerfil();
  fecharModal($('#dlg-convite'));
  toast('🏆 Amigo adicionado! Vejam o ranking no Progresso.');
}

/* ---------- Trabalho em grupo em tempo real ---------- */
const etapaLimpa = e => ({ id: String(e.id), texto: String(e.texto || '').slice(0, 120), feita: !!e.feita, responsavel: e.responsavel || null, responsavelNome: String(e.responsavelNome || '').slice(0, 40) });
const mesmaEtapa = (a, b) => a.texto === b.texto && a.feita === b.feita && a.responsavel === b.responsavel;

function renderCaixaGrupo(dados = {}) {
  const caixa = $('#t-grupo');
  if (!caixa) return;
  if (!pelaInternet()) { caixa.innerHTML = ''; return; }
  if (!usuario) {
    caixa.innerHTML = '<p class="field__hint">👥 Trabalho em grupo? Entre com o Google (⚙️ Configurações) para dividir as etapas com a turma em tempo real.</p>';
    return;
  }
  if (dados.grupoId) {
    const membros = dados.grupoMembros || [];
    caixa.innerHTML = `<div class="ranking-card__topo"><strong>👥 Trabalho em grupo · ${membros.length} pessoa(s)</strong>
        <div class="avatares">${membros.map(m => avatarHTML(m)).join('')}</div></div>
      <p class="field__hint">Tudo o que alguém marcar nas etapas aparece na hora para o grupo. Use <b>✋ Eu faço</b> para pegar uma etapa.</p>
      <div class="botoes-linha"><button type="button" class="btn btn--primary btn--sm" data-nuvem="convidar-grupo">＋ Convidar para o grupo</button>
        <button type="button" class="btn btn--text btn--sm" data-nuvem="sair-grupo">Sair do grupo</button></div>`;
    return;
  }
  caixa.innerHTML = dados.id
    ? `<p class="field__hint">👥 <b>É trabalho em grupo?</b> Transforme em tarefa compartilhada: a turma entra pelo link e cada um marca a sua parte, em tempo real.</p>
       <div class="botoes-linha"><button type="button" class="btn btn--ghost btn--sm" data-nuvem="criar-grupo">👥 Fazer em grupo</button></div>`
    : '<p class="field__hint">👥 Trabalho em grupo? Salve a tarefa e abra de novo para transformar em tarefa compartilhada.</p>';
}

async function criarGrupo() {
  const id = $('#t-id').value;
  if (!usuario || !id) return;
  const titulo = $('#t-titulo').value.trim();
  if (titulo.length < 3) { toast('Dê um nome para a tarefa antes.', { tipo: 'erro' }); return; }
  const mat = infoMateria($('#t-materia').value);
  const etapas = estado.subtarefasEdicao.map(etapaLimpa);
  const ref = fb.doc(fb.collection(db, 'grupos'));
  const membro = { nome: meuNome().slice(0, 40), foto: usuario.photoURL || '' };
  const dados = {
    titulo: titulo.slice(0, 80), prazo: $('#t-prazo').value, tipo: $('#t-tipo').value, descricao: $('#t-descricao').value.trim().slice(0, 1000),
    materiaNome: mat.nome, materiaCor: mat.cor, etapas, membros: { [usuario.uid]: membro }, membrosIds: [usuario.uid],
    criadoPor: usuario.uid, atualizadoEm: fb.serverTimestamp()
  };
  try {
    await fb.setDoc(ref, dados);
    gruposBase.set(ref.id, { ...dados, atualizadoEm: null });
    Store.salvarTarefa({ id, grupoId: ref.id, grupoMembros: [{ uid: usuario.uid, ...membro }], titulo: dados.titulo, prazo: dados.prazo, subtarefas: estado.subtarefasEdicao });
    $('#t-grupo-id').value = ref.id;
    renderCaixaGrupo(Store.getTarefa(id));
    renderSubtarefasEdicao();
    atualizarTudo();
    convidarParaGrupo(ref.id);
  } catch (erro) { tratarErro(erro); }
}

function convidarParaGrupo(gid) {
  if (!gid) return;
  const link = `${baseUrl()}?grupo=${encodeURIComponent(gid)}`;
  const titulo = $('#t-titulo').value.trim() || 'nosso trabalho';
  abrirConvite('👥 Chamar o grupo', `<p class="modal__sub">Mande o link no grupo da turma. Quem entrar vê as etapas e marca a própria parte, e tudo atualiza na hora para todos.</p>`,
    linkBotoes(link, `👥 Bora dividir o “${titulo}” no PrazoCerto? Cada um marca a sua parte:`));
}

async function entrarNoGrupo(gid) {
  if (!usuario) return;
  const ref = fb.doc(db, 'grupos', gid);
  const membro = { nome: meuNome().slice(0, 40), foto: usuario.photoURL || '' };
  try {
    await fb.runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw { code: 'not-found' };
      const g = snap.data();
      if ((g.membrosIds || []).includes(usuario.uid)) return;
      tx.update(ref, { membrosIds: [...(g.membrosIds || []), usuario.uid], [`membros.${usuario.uid}`]: membro, atualizadoEm: fb.serverTimestamp() });
    });
    const snap = await fb.getDoc(ref);
    aplicarGrupo(gid, snap.data(), { silencioso: true });
    fecharModal($('#dlg-convite'));
    toast('👥 Você entrou no grupo! A tarefa já está nas suas tarefas.');
    const t = Store.getTarefas().find(x => x.grupoId === gid);
    if (t) setTimeout(() => abrirFormTarefa(t), 300);
  } catch (erro) {
    if (erro && erro.code === 'not-found') toast('Esse grupo não existe mais.', { tipo: 'erro' }); else tratarErro(erro);
  }
}

async function sairDoGrupo(gid) {
  if (!usuario || !gid) return;
  const ref = fb.doc(db, 'grupos', gid);
  try {
    await fb.runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const g = snap.data();
      const membros = { ...(g.membros || {}) };
      delete membros[usuario.uid];
      tx.update(ref, { membrosIds: (g.membrosIds || []).filter(x => x !== usuario.uid), membros, atualizadoEm: fb.serverTimestamp() });
    });
  } catch (erro) { tratarErro(erro); return; }
  gruposBase.delete(gid);
  const t = Store.getTarefas().find(x => x.grupoId === gid);
  if (t) Store.salvarTarefa({ id: t.id, grupoId: null, grupoMembros: [] });
  $('#t-grupo-id').value = '';
  renderCaixaGrupo(t ? Store.getTarefa(t.id) : {});
  renderSubtarefasEdicao();
  atualizarTudo();
  toast('Você saiu do grupo. A tarefa continua com você, agora só sua.');
}

function ouvirGrupos() {
  if (pararGrupos || !usuario) return;
  pararGrupos = fb.onSnapshot(fb.query(fb.collection(db, 'grupos'), fb.where('membrosIds', 'array-contains', usuario.uid)), snap => {
    const ids = new Set();
    snap.docs.forEach(d => { ids.add(d.id); aplicarGrupo(d.id, d.data()); });
    // grupos de que saí (ou que foram apagados): a tarefa vira só minha
    Store.getTarefas().filter(t => t.grupoId && !ids.has(t.grupoId) && gruposBase.has(t.grupoId)).forEach(t => {
      gruposBase.delete(t.grupoId);
      Store.salvarTarefa({ id: t.id, grupoId: null, grupoMembros: [] });
    });
    atualizarTudo();
  }, erro => tratarErro(erro));
}

/** Traz o estado do grupo para a tarefa local (cria a tarefa se for a primeira vez). */
function aplicarGrupo(gid, g, { silencioso = false } = {}) {
  if (!g) return;
  const antes = gruposBase.get(gid);
  gruposBase.set(gid, { ...g, etapas: (g.etapas || []).map(etapaLimpa) });
  const membros = Object.entries(g.membros || {}).map(([uid, m]) => ({ uid, nome: m.nome, foto: m.foto || '' }));
  let etapas = (g.etapas || []).map(etapaLimpa);
  let t = Store.getTarefas().find(x => x.grupoId === gid);
  // chegou mudança do grupo enquanto a minha ainda não subiu: junta as duas (nada se perde)
  let campos = { titulo: g.titulo, prazo: g.prazo || '', descricao: g.descricao || '' };
  if (t && antes) {
    const minhas = (t.subtarefas || []).map(etapaLimpa);
    const pendente = !(minhas.length === antes.etapas.length && minhas.every((m, i) => antes.etapas[i].id === m.id && mesmaEtapa(m, antes.etapas[i])));
    if (pendente) {
      etapas = juntarEtapas(antes.etapas, minhas, (g.etapas || []).map(e => ({ ...etapaLimpa(e), feitaPor: e.feitaPor || null, feitaPorNome: e.feitaPorNome || '' }))).map(etapaLimpa);
      agendarGrupos();
    }
    Object.keys(campos).forEach(k => { if ((t[k] || '') !== (antes[k] || '')) { campos[k] = t[k] || ''; agendarGrupos(); } });
  }
  const local = t ? new Map((t.subtarefas || []).map(x => [x.id, x])) : new Map();
  const subtarefas = etapas.map(e => ({ ...(local.get(e.id) || {}), ...e }));
  const novo = { ...campos, subtarefas, grupoMembros: membros, grupoId: gid };
  if (!t) {
    let mat = Store.getMaterias().find(m => normalizar(m.nome) === normalizar(g.materiaNome || ''));
    if (!mat && g.materiaNome) { mat = Store.criarMateria(g.materiaNome, /^#[0-9a-f]{6}$/i.test(g.materiaCor) ? g.materiaCor : CORES_MATERIA[0]); montarSelectMaterias(); }
    t = Store.salvarTarefa({ ...novo, tipo: g.tipo || 'trabalho', prioridade: 'media', estimativa: 60, materia: (mat || Store.getMaterias()[0]).id });
    pularLembretesPassados(t);
  } else {
    const atual = { titulo: t.titulo, prazo: t.prazo, descricao: t.descricao, subtarefas: t.subtarefas, grupoMembros: t.grupoMembros };
    if (JSON.stringify(atual) !== JSON.stringify({ titulo: novo.titulo, prazo: novo.prazo, descricao: novo.descricao, subtarefas: novo.subtarefas, grupoMembros: novo.grupoMembros })) {
      Store.salvarTarefa({ id: t.id, ...novo });
    }
  }
  juntarTarefasRepetidasDeGrupo();
  // avisos do que os outros fizeram
  if (antes && !silencioso) {
    const feitasAntes = new Set((antes.etapas || []).filter(e => e.feita).map(e => e.id));
    (g.etapas || []).filter(e => e.feita && !feitasAntes.has(e.id) && e.feitaPor && e.feitaPor !== usuario.uid)
      .forEach(e => toast(`👥 ${primeiroNome(e.feitaPorNome)} concluiu “${e.texto}” (${g.titulo})`));
    (g.membrosIds || []).filter(id => !(antes.membrosIds || []).includes(id) && id !== usuario.uid)
      .forEach(id => toast(`👥 ${primeiroNome((g.membros[id] || {}).nome)} entrou no grupo “${g.titulo}”`));
  }
  // se a tarefa está aberta no formulário, atualiza as etapas na tela
  const dlg = $('#dlg-tarefa');
  if (dlg.open && $('#t-grupo-id').value === gid) {
    estado.subtarefasEdicao = Store.getTarefas().find(x => x.grupoId === gid).subtarefas.map(x => ({ ...x }));
    renderSubtarefasEdicao();
    renderCaixaGrupo(Store.getTarefas().find(x => x.grupoId === gid));
  }
}

/** Duas cópias da mesma tarefa de grupo (ex.: chegou pela sincronização e pelo grupo ao mesmo tempo): fica uma. */
function juntarTarefasRepetidasDeGrupo() {
  const vistos = new Set();
  Store.getTarefas().forEach(t => {
    if (!t.grupoId) return;
    if (vistos.has(t.grupoId)) Store.removerTarefa(t.id); else vistos.add(t.grupoId);
  });
}

/* Mudanças feitas aqui nas tarefas de grupo sobem para o grupo */
function agendarGrupos() {
  if (!usuario || !gruposBase.size) return;
  clearTimeout(timerGrupos);
  timerGrupos = setTimeout(enviarGrupos, 700);
}

/** Junta as etapas: o que eu mudei vale; o resto fica como os outros deixaram. */
function juntarEtapas(base, minhas, remotas) {
  const B = new Map(base.map(e => [e.id, e])), M = new Map(minhas.map(e => [e.id, e])), R = new Map(remotas.map(e => [e.id, e]));
  const resultado = [];
  remotas.forEach(r => {
    const b = B.get(r.id), m = M.get(r.id);
    if (!m) { if (!b) resultado.push(r); return; } // apaguei aqui: sai | nova de outra pessoa: fica
    if (b && mesmaEtapa(m, b)) { resultado.push(r); return; } // não mexi nesta: vale a do grupo
    const concluiAgora = m.feita && !r.feita;
    resultado.push({ ...r, ...etapaLimpa(m), feitaPor: m.feita ? (concluiAgora ? usuario.uid : r.feitaPor || usuario.uid) : null,
      feitaPorNome: m.feita ? (concluiAgora ? meuNome() : r.feitaPorNome || meuNome()) : '' });
  });
  minhas.forEach(m => { if (!R.has(m.id) && !B.has(m.id)) resultado.push({ ...etapaLimpa(m), feitaPor: m.feita ? usuario.uid : null, feitaPorNome: m.feita ? meuNome() : '' }); });
  return resultado.slice(0, 50);
}

async function enviarGrupos() {
  if (!usuario || enviandoGrupos || !navigator.onLine) return;
  enviandoGrupos = true;
  try {
    for (const t of Store.getTarefas().filter(x => x.grupoId && gruposBase.has(x.grupoId))) {
      const base = gruposBase.get(t.grupoId);
      const minhas = (t.subtarefas || []).map(etapaLimpa);
      const campos = { titulo: t.titulo, prazo: t.prazo || '', descricao: t.descricao || '' };
      const etapasIguais = minhas.length === base.etapas.length && minhas.every((m, i) => base.etapas[i].id === m.id && mesmaEtapa(m, base.etapas[i]));
      const mudouCampo = Object.keys(campos).filter(k => campos[k] !== (base[k] || ''));
      if (etapasIguais && !mudouCampo.length) continue;
      const ref = fb.doc(db, 'grupos', t.grupoId);
      let enviado = null;
      await fb.runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const remoto = snap.data();
        const atualizacao = { etapas: juntarEtapas(base.etapas, minhas, (remoto.etapas || []).map(e => ({ ...etapaLimpa(e), feitaPor: e.feitaPor || null, feitaPorNome: e.feitaPorNome || '' }))), atualizadoEm: fb.serverTimestamp() };
        mudouCampo.forEach(k => { atualizacao[k] = campos[k]; });
        tx.update(ref, atualizacao);
        enviado = { ...remoto, ...atualizacao };
      });
      if (enviado) gruposBase.set(t.grupoId, { ...enviado, etapas: enviado.etapas.map(etapaLimpa) });
    }
  } catch (erro) { tratarErro(erro); }
  finally { enviandoGrupos = false; }
}

/* ---------- Início ---------- */
lerConviteDaUrl();
Store.aoMudar(agendarEnvio);
Store.aoMudar(chave => { if (chave === 'tarefas') agendarGrupos(); if (['tarefas', 'sessoes'].includes(chave)) publicarPerfil(); });
window.addEventListener('online', () => { if (usuario && lerMeta().pendente) enviarAgora(true); else if (usuario) mudarStatus('sincronizado'); });
window.addEventListener('offline', () => { if (usuario) mudarStatus('offline'); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') enviarAgora(); });

window.Nuvem = {
  renderConta, entrar, sair, enviarAgora, juntar, juntarEtapas, renderSocial, renderRanking, renderEstudandoAgora, renderCaixaGrupo, publicarPerfil,
  get status() { return status; }, get usuario() { return usuario; }, get amigos() { return [...amigosDados.values()]; }
};

// Quem já tinha entrado neste aparelho volta conectado sozinho
(async () => {
  const meta = lerMeta();
  if (!pelaInternet() || !(meta.uid || meta.redirecionando)) {
    renderConta();
    renderSocial();
    if (lerPendente()) setTimeout(mostrarConvitePedindoLogin, 600);
    return;
  }
  try {
    mudarStatus('carregando');
    await carregarSDK();
    if (meta.redirecionando) {
      gravarMeta({ redirecionando: false });
      await fb.getRedirectResult(auth).catch(tratarErro);
    }
  } catch (erro) {
    // sem internet ao abrir: o app segue normal com os dados do aparelho
    mudarStatus(navigator.onLine ? 'erro' : 'offline');
  }
})();
