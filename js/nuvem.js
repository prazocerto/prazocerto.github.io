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
    mudarStatus('deslogado');
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
    config: { ...remoto.config, ...local.config }
  };
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
  if (b.dataset.nuvem === 'entrar') entrar();
  else if (b.dataset.nuvem === 'sair') sair();
  else if (b.dataset.nuvem === 'sincronizar') { mensagemErro = ''; enviarAgora(true); }
});

/* ---------- Início ---------- */
Store.aoMudar(agendarEnvio);
window.addEventListener('online', () => { if (usuario && lerMeta().pendente) enviarAgora(true); else if (usuario) mudarStatus('sincronizado'); });
window.addEventListener('offline', () => { if (usuario) mudarStatus('offline'); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') enviarAgora(); });

window.Nuvem = { renderConta, entrar, sair, enviarAgora, juntar, get status() { return status; }, get usuario() { return usuario; } };

// Quem já tinha entrado neste aparelho volta conectado sozinho
(async () => {
  const meta = lerMeta();
  if (!pelaInternet() || !(meta.uid || meta.redirecionando)) { renderConta(); return; }
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
