/**
 * data.js — Dados fixos do PrazoCerto
 * ----------------------------------------------------------------
 * Somente dados e configurações (nenhuma lógica de tela):
 *  - PRIORIDADES ...... níveis de prioridade e suas cores
 *  - TIPOS ............ tipos de atividade acadêmica
 *  - MATERIAS_PADRAO .. matérias iniciais (o usuário pode editar)
 *  - CORES_MATERIA .... paleta para novas matérias
 *  - CONFIG_PADRAO .... configurações iniciais (Pomodoro, nome, som, aviso de prazo)
 *  - CONQUISTAS ....... medalhas da gamificação
 *  - FRASES ........... frases motivacionais da tela inicial
 *  - gerarExemplo() ... dados de demonstração (datas relativas a hoje)
 */

const PRIORIDADES = [
  { id: 'alta',  label: 'Alta',  emoji: '🔴', cor: '#ef4444', peso: 3 },
  { id: 'media', label: 'Média', emoji: '🟡', cor: '#f59e0b', peso: 2 },
  { id: 'baixa', label: 'Baixa', emoji: '🟢', cor: '#22c55e', peso: 1 }
];

const TIPOS = [
  { id: 'prova',        label: 'Prova',        emoji: '📝' },
  { id: 'trabalho',     label: 'Trabalho',     emoji: '💼' },
  { id: 'lista',        label: 'Lista de exercícios', emoji: '📚' },
  { id: 'leitura',      label: 'Leitura',      emoji: '📖' },
  { id: 'apresentacao', label: 'Apresentação', emoji: '🎤' },
  { id: 'estudo',       label: 'Estudo',       emoji: '🧠' },
  { id: 'outro',        label: 'Outro',        emoji: '📌' }
];

const CORES_MATERIA = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b'];

const MATERIAS_PADRAO = [
  { id: 'm-interfaces', nome: 'Desenv. de Interfaces', cor: '#6366f1' },
  { id: 'm-bd',         nome: 'Banco de Dados',        cor: '#0ea5e9' },
  { id: 'm-algoritmos', nome: 'Algoritmos',            cor: '#14b8a6' },
  { id: 'm-calculo',    nome: 'Cálculo',               cor: '#f97316' },
  { id: 'm-engsoft',    nome: 'Engenharia de Software', cor: '#a855f7' },
  { id: 'm-pessoal',    nome: 'Pessoal',               cor: '#64748b' }
];

const CONFIG_PADRAO = {
  nome: '',
  foco: 25,   // minutos de foco (Pomodoro)
  curta: 5,   // pausa curta
  longa: 15,  // pausa longa (a cada 4 focos)
  som: true,
  aviso: false,     // notificação do navegador antes do prazo
  avisoMin: 60,     // antecedência do aviso, em minutos
  atalhos: true     // atalhos de uma tecla (podem ser desligados — WCAG 2.1.4)
};

/** Cada conquista recebe o objeto de estatísticas calculado em app.js. */
const CONQUISTAS = [
  { id: 'primeira',   emoji: '🌱', nome: 'Primeiro passo',   desc: 'Conclua sua primeira tarefa.',            teste: s => s.concluidas >= 1 },
  { id: 'dez',        emoji: '🚀', nome: 'Produtivo',        desc: 'Conclua 10 tarefas.',                     teste: s => s.concluidas >= 10 },
  { id: 'pontual',    emoji: '⏰', nome: 'Pontual',          desc: 'Entregue 5 tarefas dentro do prazo.',     teste: s => s.noPrazo >= 5 },
  { id: 'foco1',      emoji: '🍅', nome: 'Primeiro foco',    desc: 'Complete um ciclo Pomodoro.',             teste: s => s.pomodoros >= 1 },
  { id: 'maratona',   emoji: '🔥', nome: 'Maratona de foco', desc: 'Faça 4 Pomodoros no mesmo dia.',          teste: s => s.maxPomodorosDia >= 4 },
  { id: 'constancia', emoji: '📅', nome: 'Constância',       desc: 'Conclua tarefas 3 dias seguidos.',        teste: s => s.sequencia >= 3 },
  { id: 'urgente',    emoji: '🦸', nome: 'Apaga-incêndio',   desc: 'Conclua 3 tarefas de prioridade alta.',   teste: s => s.altasConcluidas >= 3 },
  { id: 'cedo',       emoji: '🌅', nome: 'Madrugador',       desc: 'Conclua uma tarefa antes das 9h.',        teste: s => s.antesDas9 >= 1 },
  { id: 'zerado',     emoji: '✨', nome: 'Tudo em dia',      desc: 'Tenha 5+ concluídas e nenhuma atrasada.', teste: s => s.concluidas >= 5 && s.atrasadas === 0 },
  { id: 'nivel5',     emoji: '👑', nome: 'Mestre do tempo',  desc: 'Chegue ao nível 5.',                      teste: s => s.nivel >= 5 }
];

const FRASES = [
  'Feito é melhor que perfeito. 💪',
  'Uma tarefa de cada vez. 🧘',
  'O seu eu do futuro agradece. 🙌',
  'Comece pelo mais difícil enquanto a energia está alta. ⚡',
  '25 minutos de foco valem mais que 2 horas distraído. 🍅',
  'Prazo anotado é prazo cumprido. ✅',
  'Pequenos passos todo dia levam longe. 🚶'
];

/**
 * Gera tarefas e sessões de exemplo com datas relativas a hoje,
 * para demonstrar o app sem precisar cadastrar tudo à mão.
 */
function gerarExemplo() {
  const agora = new Date();
  const em = (dias, hora = 23, min = 59) => {
    const d = new Date(agora);
    d.setDate(d.getDate() + dias);
    d.setHours(hora, min, 0, 0);
    return d;
  };
  const iso = d => {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  let n = 0;
  const tarefa = (titulo, materia, tipo, prioridade, prazo, extra = {}) => ({
    id: `ex-${++n}`, titulo, materia, tipo, prioridade, prazo: prazo ? iso(prazo) : '',
    estimativa: 60, descricao: '', subtarefas: [], concluida: false, concluidaEm: null,
    criadaEm: em(-6, 10, 0).toISOString(), focoMin: 0, ...extra
  });
  const sub = (...textos) => textos.map((texto, i) => ({ id: `s${n}-${i}`, texto, feita: false }));

  const tarefas = [
    tarefa('Entregar projeto de Interfaces', 'm-interfaces', 'trabalho', 'alta', em(2, 23, 59), {
      estimativa: 180, descricao: 'Código-fonte + relatório + registro dos prompts.',
      subtarefas: sub('Montar HTML semântico', 'Estilizar com CSS', 'Programar o JavaScript', 'Escrever o relatório')
    }),
    tarefa('Prova de Banco de Dados', 'm-bd', 'prova', 'alta', em(5, 19, 10), { estimativa: 120, descricao: 'Normalização, SQL (JOIN, GROUP BY) e modelo ER.' }),
    tarefa('Lista 4 de Cálculo', 'm-calculo', 'lista', 'media', em(0, 23, 59), { estimativa: 90 }),
    tarefa('Ler capítulo 3 de Engenharia de Software', 'm-engsoft', 'leitura', 'baixa', em(1, 19, 0), { estimativa: 45 }),
    tarefa('Exercícios de recursão', 'm-algoritmos', 'lista', 'media', em(-1, 23, 59), { estimativa: 60 }),
    tarefa('Apresentação sobre metodologias ágeis', 'm-engsoft', 'apresentacao', 'media', em(9, 19, 10), {
      estimativa: 120, subtarefas: sub('Pesquisar Scrum e Kanban', 'Montar slides', 'Ensaiar')
    }),
    tarefa('Revisar matéria de Algoritmos', 'm-algoritmos', 'estudo', 'baixa', '', { estimativa: 60 }),
    // já concluídas (para alimentar estatísticas e conquistas)
    tarefa('Modelo ER do trabalho de BD', 'm-bd', 'trabalho', 'alta', em(-3, 23, 59), { concluida: true, concluidaEm: em(-3, 20, 15).toISOString() }),
    tarefa('Lista 3 de Cálculo', 'm-calculo', 'lista', 'media', em(-4, 23, 59), { concluida: true, concluidaEm: em(-4, 22, 40).toISOString() }),
    tarefa('Protótipo no Figma', 'm-interfaces', 'trabalho', 'alta', em(-2, 23, 59), { concluida: true, concluidaEm: em(-2, 8, 30).toISOString() }),
    tarefa('Questionário de Engenharia de Software', 'm-engsoft', 'outro', 'baixa', em(-1, 12, 0), { concluida: true, concluidaEm: em(-1, 10, 5).toISOString() }),
    tarefa('Renovar livro na biblioteca', 'm-pessoal', 'outro', 'baixa', em(-5, 18, 0), { concluida: true, concluidaEm: em(-5, 17, 0).toISOString() })
  ];

  const sessao = (dias, hora, materia, tarefaId) => ({
    id: `sx-${++n}`, inicio: em(dias, hora, 0).toISOString(), minutos: 25, materia, tarefaId
  });
  const sessoes = [
    sessao(-4, 20, 'm-calculo', 'ex-9'), sessao(-3, 18, 'm-bd', 'ex-8'), sessao(-3, 19, 'm-bd', 'ex-8'),
    sessao(-2, 7, 'm-interfaces', 'ex-10'), sessao(-1, 9, 'm-engsoft', 'ex-11'),
    sessao(-1, 20, 'm-interfaces', 'ex-1'), sessao(-1, 21, 'm-interfaces', 'ex-1')
  ];
  return { tarefas, sessoes };
}
