/* PrazoCerto — configuração do Firebase (usada pelo app e pelo painel de admin).
 * A apiKey do Firebase não é segredo: ela só identifica o projeto.
 * Quem protege os dados são as regras do Firestore (firestore.rules), que também
 * dizem qual conta é a de admin (o e-mail fica só nas regras, não no código). */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyC35fxaCjcWTMZ98pPOlNeozwdkbuNVMy0',
  authDomain: 'prazocerto-estudos.firebaseapp.com',
  projectId: 'prazocerto-estudos',
  storageBucket: 'prazocerto-estudos.firebasestorage.app',
  messagingSenderId: '870390730109',
  appId: '1:870390730109:web:846758ac44f2d6a4c6d014'
};
export const VERSAO_SDK = '13.4.0';
export const CDN = `https://www.gstatic.com/firebasejs/${VERSAO_SDK}/`;
