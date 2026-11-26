# ⏰ PrazoCerto — Gestão de Tempo para Estudantes

🔗 **Acesse online:** [https://joaofortesrabelo-ctrl.github.io/PrazoCerto/](https://joaofortesrabelo-ctrl.github.io/PrazoCerto/)

**Tema 9 — Aplicativo de Gestão de Tempo:** agenda e lista de tarefas para estudantes, com cores para prioridade e prazos.

É uma aplicação web feita com **HTML5, CSS3 e JavaScript puro** (sem bibliotecas). Os dados ficam no **LocalStorage** do navegador.

> ⚠️ **Antes de abrir:** extraia o zip (botão direito → *Extrair tudo…*) e abra o `index.html` da pasta extraída.

---

## ▶️ Como rodar

1. Descompacte a pasta `prazocerto/`.
2. Abra o arquivo `index.html` no navegador.

Não precisa instalar nada.

## 📲 Instalar como app (PWA)

O PrazoCerto é um **app instalável**: ganha ícone na tela inicial, abre em janela própria (sem a barra do navegador) e **funciona sem internet**.

1. Abra o link do site: [https://joaofortesrabelo-ctrl.github.io/PrazoCerto/](https://joaofortesrabelo-ctrl.github.io/PrazoCerto/)
2. Instale:
   - **Computador (Chrome ou Edge):** botão **📲 Instalar app** no topo, ou o ícone de instalar na barra de endereço.
   - **Android (Chrome):** botão **📲 Instalar app**, ou menu ⋮ → **Instalar app** / **Adicionar à tela inicial**.
   - **iPhone (Safari):** Compartilhar ⬆️ → **Adicionar à Tela de Início**.

Como funciona:
- `manifest.json` diz ao navegador o nome, os ícones, as cores e que o app abre em tela cheia (`standalone`).
- `sw.js` (*service worker*) guarda os arquivos do app no aparelho. Com internet ele busca sempre a versão mais nova; sem internet, usa a cópia guardada.
- O botão "Instalar app" usa o evento `beforeinstallprompt` do navegador; no iPhone, que não tem esse evento, ele mostra o passo a passo do Safari.
- A instalação só funciona pelo link (https). Abrindo o `index.html` direto do computador, o app funciona normalmente, mas sem a opção de instalar.

> **Dica para a apresentação:** em ⚙️ **Configurações → 🧪 Carregar exemplo**, o app é preenchido com tarefas, prazos e sessões de foco de demonstração. As datas são calculadas a partir do dia de hoje.

---

## 💬 Prévia do link

Ao compartilhar o link no WhatsApp, Instagram, Telegram ou Discord, aparece um cartão com a imagem `assets/og-imagem.jpg` (1200×630), o título e uma frase sobre o app. Isso vem das tags **Open Graph** (`og:`) e **Twitter Card** no `<head>` do `index.html`.

---

## 📁 Estrutura

```
prazocerto/
├── index.html        → estrutura semântica (header, nav, main, section, form, fieldset, dialog, footer)
├── manifest.json     → dados do app instalável (nome, ícones, cores, atalhos)
├── sw.js             → service worker: guarda os arquivos para abrir sem internet
├── css/
│   └── style.css     → tema claro/escuro (variáveis CSS), componentes, animações, responsividade
├── js/
│   ├── app.js        → regras de prazo, telas, Pomodoro, gamificação, eventos
│   ├── data.js       → prioridades, tipos, matérias padrão, conquistas, dados de exemplo
│   └── storage.js    → toda a leitura e gravação no LocalStorage
└── assets/
    ├── images/
    ├── og-imagem.jpg → imagem da prévia do link (WhatsApp, Instagram…)
    ├── icons/        → ícones do app (192, 512, maskable, iPhone, favicon)
    └── screenshots/  → imagens mostradas na janela de instalação
```

---

## ✅ Funcionalidades

| Tela | O que faz |
|---|---|
| 🏠 **Hoje** | Saudação, **contagem regressiva** do próximo prazo, nível/XP, indicadores do dia, **tarefa rápida** em linguagem natural e as listas de atrasadas, de hoje, de amanhã e dos próximos 7 dias |
| ✅ **Tarefas** | Criar, editar, concluir e excluir (com **Desfazer**). Busca, filtros (status, prioridade, matéria), ordenação e agrupamento por prazo. Checklist de etapas com barra de progresso |
| 📅 **Agenda** | Calendário mensal com bolinhas coloridas por prioridade. Mostra as tarefas do dia escolhido e permite criar uma tarefa já com aquela data. Dá para navegar com as setas do teclado |
| 🍅 **Foco** | Timer **Pomodoro** (25/5/15 min, configurável) com anel animado e som ao terminar. Pode ser ligado a uma tarefa e continua contando mesmo depois de recarregar a página |
| 📊 **Progresso** | Gráfico dos últimos 7 dias, pendentes por prioridade (rosca), foco por matéria, pendentes por matéria, nível, pontualidade e **10 conquistas** |
| ⚙️ **Configurações** | Nome, tempos do Pomodoro, som, **avisos de prazo**, **matérias com cor personalizada**, backup (baixar/restaurar JSON), dados de exemplo e apagar tudo |
| ⏰ **Avisos de prazo** | **Notificação do navegador** antes de cada prazo (1 hora por padrão; também 15 min, 30 min, 2 h ou 1 dia). Cada prazo é avisado uma vez só, e se o prazo mudar, avisa de novo. Sem permissão do navegador, o aviso aparece dentro da página. Funciona enquanto o app estiver aberto em alguma aba |
| 🌙 **Tema** | Claro e escuro. Respeita o tema do sistema na primeira visita e fica salvo |

### 🎨 Cores de prioridade e prazo

- **Prioridade** (faixa lateral do card): 🔴 Alta · 🟡 Média · 🟢 Baixa
- **Urgência do prazo** (texto do prazo): vermelho = atrasada · laranja = vence em menos de 24h · amarelo = vence em até 3 dias · cinza = com folga

### ⚡ Tarefa rápida

Escreva tudo numa linha, por exemplo: `Lista de Cálculo amanhã 23:59 !alta #calc`

| Você escreve | Vira |
|---|---|
| `hoje`, `amanhã`, `depois de amanhã` | data |
| `seg`, `sexta`, `sábado`… | o próximo dia da semana |
| `25/11` ou `25/11/2026` | data exata |
| `19h`, `19h30`, `23:59` | horário (sem horário, o prazo fica para 23:59) |
| `!alta`, `!media`, `!baixa`, `!!!` | prioridade |
| `#calc`, `#bd` | matéria (pelo começo do nome ou pelas iniciais) |

### 🎮 Gamificação

- **XP:** cada tarefa concluída vale 10 XP. Entregar no prazo dá +5 e prioridade alta dá mais +5. Cada ciclo Pomodoro vale 5 XP.
- **Níveis:** cada nível precisa de 100 XP (Calouro → Organizado → Focado → Produtivo → Mestre do tempo → Lenda do campus).
- **Sequência:** conta os dias seguidos com pelo menos uma tarefa concluída.
- **Conquistas:** são 10 (Primeiro passo, Pontual, Maratona de foco, Madrugador…). Cada uma é comemorada com notificação e confete.

---

## 📋 Requisitos funcionais

| Requisito | Onde está |
|---|---|
| RF01 – Cadastrar tarefa (título, matéria, tipo, prioridade, prazo, estimativa, anotações, etapas) | Modal "Nova tarefa" e tarefa rápida |
| RF02 – Editar tarefa | Clicar no título ou no ✏️ |
| RF03 – Concluir / reabrir tarefa | Botão ✓ (com Desfazer) |
| RF04 – Excluir tarefa | Botão 🗑️ (com Desfazer) |
| RF05 – Visualizar tarefas por prazo, prioridade e matéria | Tela Tarefas (filtros) e Agenda |
| RF06 – Destacar prazos por cor | Cores de prioridade e de urgência |
| RF07 – Cronometrar sessões de estudo | Tela Foco (Pomodoro) |
| RF08 – Exibir estatísticas | Tela Progresso |
| RF09 – Alternar tema claro/escuro | Botão no topo ou tecla `T` |
| RF10 – Salvar dados localmente | `storage.js` (tarefas, matérias, sessões, configurações, tema, timer, conquistas, avisos) |
| RF11 – Avisar antes do prazo | Notificação do navegador (Notification API) configurada em ⚙️ |

---

## 🧠 Heurísticas de Nielsen aplicadas

| # | Heurística | Como foi aplicada |
|---|---|---|
| 1 | Visibilidade do status do sistema | Contagem regressiva ao vivo, anel do Pomodoro, pílula 🍅 no topo e tempo na aba enquanto o timer roda, contador de atrasadas no menu, notificação após cada ação |
| 2 | Correspondência com o mundo real | Termos do dia a dia do estudante (prova, lista, entrega), cores de semáforo para prioridade, tarefa rápida em português ("amanhã 19h") |
| 3 | Controle e liberdade do usuário | **Desfazer** ao concluir ou excluir, reabrir tarefa concluída, pausar/reiniciar/pular o timer, Esc e clique fora fecham janelas |
| 4 | Consistência e padrões | O mesmo card de tarefa em Hoje, Tarefas e Agenda. Cores e ícones com o mesmo significado em todo o app |
| 5 | Prevenção de erros | Validação do título, aviso ao criar tarefa com prazo no passado, confirmação antes de apagar concluídas, matérias, backup ou todos os dados, limites nos tempos do Pomodoro |
| 6 | Reconhecer em vez de lembrar | Atalhos de data (Hoje, Amanhã, +7 dias), matérias em lista, tarefas agrupadas por prazo, dica de sintaxe embaixo da tarefa rápida |
| 7 | Flexibilidade e eficiência | Tarefa rápida, atalhos de teclado (`N`, `1`–`5`, `/`, `T`, `Espaço`, `?`), 🍅 direto no card, setas no calendário |
| 8 | Estética e design minimalista | Uma ação principal por tela, cores só onde trazem informação, muito espaço em branco |
| 9 | Ajudar a reconhecer e corrigir erros | Mensagens claras ao lado do campo com foco automático, aviso "Atrasada há X dias" com sugestão do que fazer |
| 10 | Ajuda e documentação | Botão **?** com o passo a passo e os atalhos, dicas nos campos, dados de exemplo para conhecer o app |

---

## ♿ Acessibilidade

**Auditoria com axe-core 4.14 (padrão WCAG 2.2 AA): 0 violações** em 48 verificações, cobrindo as 5 telas e as 3 janelas nos temas claro e escuro, em 1366, 390 e 320 px.

- Tags semânticas, `fieldset`/`legend` nos grupos de opções, `label` em todos os campos.
- Link "Pular para o conteúdo", `aria-current` no menu, `aria-pressed` nos botões de alternar, `role="progressbar"` nas barras, `aria-live` nas notificações.
- Navegação completa por teclado, foco visível e foco devolvido ao fechar janelas.
- Respeita `prefers-reduced-motion`: sem animações nem confete para quem desativa movimento.
- Contraste de pelo menos 4.5:1 em todos os textos, inclusive nas cores de prazo e nas etiquetas de matéria (a cor do texto é escurecida automaticamente a partir da cor escolhida).
- A cor nunca fica sozinha: cada prazo tem texto ("Atrasada há 2 dias") e cada dia da agenda é lido como "Hoje, quarta-feira, 18 de novembro, 2 entregas, 1 de prioridade alta, 1 atrasada".
- Os atalhos de uma tecla podem ser desligados em Configurações (WCAG 2.1.4).
- As notificações param de contar enquanto o mouse ou o foco do teclado estão sobre elas (WCAG 2.2.1); os erros são anunciados na hora (`role="alert"`).
- Alvos de toque com pelo menos 24 px (WCAG 2.5.8) e suporte ao modo de alto contraste do Windows.

## 📱 Responsividade

- **Desktop (> 1024px):** menu no topo, painéis lado a lado (calendário + dia, timer + resumo).
- **Tablet (≤ 1024px):** painéis empilhados e indicadores em 2 colunas. A partir de 860px o menu vira uma **barra inferior** (estilo app).
- **Celular (≤ 600px):** formulários em 1 coluna, calendário compacto, botões grandes para o toque.
- **Instalado como app:** abre em tela cheia com ícone próprio, inclusive sem internet (veja "Instalar como app").

## 💾 Chaves no LocalStorage

`prazocerto:tarefas` · `prazocerto:materias` · `prazocerto:sessoes` · `prazocerto:config` · `prazocerto:tema` · `prazocerto:timer` · `prazocerto:conquistas` · `prazocerto:avisos`
