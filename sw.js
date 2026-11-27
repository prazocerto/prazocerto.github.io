/* =========================================================
 * PrazoCerto — Service Worker (app instalável e offline)
 * ---------------------------------------------------------
 * - Na instalação, guarda no aparelho todos os arquivos do app.
 * - Com internet: busca sempre a versão mais nova, conferindo com o servidor
 *   (cache: 'no-cache'), e atualiza a cópia.
 * - Sem internet: usa a cópia guardada, então o app abre normalmente.
 * - Clique numa notificação de lembrete: abre o app na tarefa.
 * Os dados do aluno continuam no LocalStorage; aqui ficam só os arquivos.
 * ========================================================= */
const VERSAO = 'prazocerto-v10';
const ARQUIVOS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/data.js',
  './js/storage.js',
  './js/app.js',
  './js/nuvem.js',
  './js/firebase-config.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-192.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon-32.png'
];

self.addEventListener('install', evento => {
  evento.waitUntil(caches.open(VERSAO).then(cache => cache.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

// Apaga cópias de versões antigas
self.addEventListener('activate', evento => {
  evento.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.filter(c => c !== VERSAO).map(c => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro (sempre a versão mais nova); sem rede, a cópia guardada
self.addEventListener('fetch', evento => {
  const req = evento.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  evento.respondWith(
    // 'no-cache': confere com o servidor em vez de usar a cópia de 10 min do GitHub Pages
    fetch(req, { cache: 'no-cache' })
      .then(resp => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(VERSAO).then(cache => cache.put(req, copia));
        }
        return resp;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});

// Clique na notificação: volta para o app (ou abre) já na tarefa do lembrete
self.addEventListener('notificationclick', evento => {
  evento.notification.close();
  const dados = evento.notification.data || {};
  const escopo = new URL(self.registration.scope).pathname;
  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(janelas => {
      const aberta = janelas.find(j => new URL(j.url).pathname.startsWith(escopo));
      if (aberta) {
        if (dados.tarefaId) aberta.postMessage({ tipo: 'notificacao', tarefaId: dados.tarefaId });
        return aberta.focus();
      }
      return self.clients.openWindow(dados.url || './');
    })
  );
});
