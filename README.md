# ⏰ PrazoCerto — Gestão de Tempo para Estudantes

🔗 **Acesse online:** [https://prazocerto.github.io/](https://prazocerto.github.io/)

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

1. Abra o link do site: [https://prazocerto.github.io/](https://prazocerto.github.io/)
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
├── firestore.rules   → regras de segurança do Firestore (cada um só vê os próprios dados)
├── css/
│   └── style.css     → tema claro/escuro (variáveis CSS), componentes, animações, responsividade
├── js/
│   ├── data.js       → prioridades, tipos, matérias padrão, conquistas, dados de exemplo
│   ├── storage.js    → toda a leitura e gravação no LocalStorage
│   ├── app.js        → regras de prazo, telas, Pomodoro, gamificação, eventos
│   └── nuvem.js      → conta Google e sincronização (Firebase)
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
| ⚙️ **Configurações** | Nome, tempos do Pomodoro, **som do alarme** (toque, repetição, volume, vibração), **lembretes padrão**, **matérias com cor personalizada**, backup (baixar/restaurar JSON), dados de exemplo e apagar tudo |
| 🔔 **Lembretes por tarefa** | Cada tarefa escolhe os seus lembretes: **na hora, 15 min, 30 min, 1 hora, 2 horas ou 1 dia antes** (quantos quiser, ou nenhum). O cartão mostra o sininho com os horários. Tarefas novas vêm com os lembretes padrão das Configurações |
| ⏰ **Notificações** | Saem pelo *service worker* (`showNotification`), o jeito aceito no Android e no app instalado. Ficam na tela até a pessoa ver e, ao tocar, abrem a tarefa. O app explica como liberar quando o navegador bloqueia (computador, Android ou iPhone) |
| 🎵 **Som do alarme** | 5 toques gerados com Web Audio (sino, despertador digital, melodia suave, alarme forte, clássico), repetição de 1, 3 ou 5 vezes ou **até a pessoa parar**, volume e vibração no Android. Vale para o Pomodoro e para os lembretes; a barra "🔕 Parar" fica por cima de tudo |
| 📅 **Calendário do celular** | Na tarefa: **Google Agenda** ou arquivo **.ics** (iPhone, Outlook, Samsung) já com os alarmes escolhidos. Em Configurações: exportar todos os prazos de uma vez. Assim o alarme toca mesmo com o celular bloqueado e o app fechado |
| 🔁 **Tarefas que se repetem** | Todo dia, dias úteis, toda semana, a cada 2 semanas ou todo mês. Ao concluir, a próxima é criada com o novo prazo (pulando datas que já passaram); *Desfazer* apaga a próxima. O cartão mostra a etiqueta 🔁 |
| 🎓 **Horário das aulas** | Cadastro das aulas por dia da semana (vários dias de uma vez), com sala e aviso de conflito de horário. Aparecem na Agenda, na tela Hoje e no resumo do dia |
| 🕒 **Horários livres** | Para cada dia, o app calcula os intervalos livres para estudar (sem as aulas, dentro da janela de estudo das Configurações) e sugere o que focar: a revisão da prova ou a tarefa mais urgente |
| 📚 **Modo prova** | Numa tarefa do tipo Prova, *Criar plano de revisão* divide o estudo pelos dias que faltam (até 7 sessões: conteúdo, resumo, simulado e revisão leve na véspera). Cada sessão vira uma etapa com data, e a de hoje aparece na tela Hoje com **✓ Feito** |
| 📋 **Resumo do dia** | Na primeira abertura do dia: atrasadas, aulas de hoje, o que vence hoje e amanhã, revisão de prova e a sequência de dias. Pode ser desligado e também aberto pelo botão 📋 |
| 📤 **Compartilhar tarefa** | Gera um link com a tarefa (título, prazo, matéria, etapas e anotações) para mandar no WhatsApp do grupo. Quem abre vê a prévia e adiciona no PrazoCerto dele. Funciona sem servidor: a tarefa vai dentro do próprio link (JSON em base64), e tudo que vem do link é validado e escapado |
| ☁️ **Conta e sincronização** | Login com Google (Firebase Authentication) e sincronização em tempo real entre celular e computador (Cloud Firestore). Sem internet, as mudanças ficam pendentes e sobem quando a conexão volta. Na primeira vez num aparelho que já tem tarefas, o app pergunta se junta, usa só as da conta ou só as do aparelho. Sem conta, tudo continua funcionando só no aparelho |
| 📒 **Matérias** | Tela própria com um cartão por matéria e uma janela com 4 abas: **Notas** (calculadora com pesos: mostra quanto precisa tirar nas avaliações que faltam, se já passou ou se precisa de recuperação), **Faltas** (limite automático de 25% das aulas do semestre, calculado pelo horário cadastrado, com barra e alertas), **Anotações** (salvam sozinhas) e **Flashcards** (repetição espaçada em 5 caixas: quem erra volta logo, quem acerta demora mais) |
| 🔤 **Menções** | Na aba Notas (ou em ⚙️), troca o sistema para **menções SS, MS, MM, MI, II e SR**, como no UniCEUB e na UnB: cada avaliação recebe uma menção, e o app mostra qual menção você precisa tirar para chegar a **MM** (mínimo para passar, pelo Regimento Geral do UniCEUB, junto com 75% de presença) |
| 🙋 **Faltei** | No cartão "Aulas de hoje", um toque registra a falta e mostra quantas ainda pode ter |
| 🎯 **Fazer agora** | A tela Hoje escolhe as 3 tarefas mais importantes, pesando prazo, prioridade, tempo e revisão de prova, e mostra o porquê de cada uma |
| 🗓️ **Semestre** | Datas de começo e fim: barra de progresso, dias para as férias, próximas provas e limite de faltas automático |
| 🎯 **Metas da semana** | Horas de foco e tarefas concluídas (segunda a domingo), com barras no Progresso e a conquista "Meta batida" |
| 📊 **Relatório da semana** | Na primeira abertura da semana: horas de foco, tarefas, pontualidade e Pomodoros, comparação com a semana anterior, matéria mais estudada, matéria esquecida e dicas |
| 🎧 **Sons de fundo** | Chuva, ondas do mar, ruído marrom e ruído branco, gerados com Web Audio (sem arquivos). Tocam só com o foco rodando, com volume próprio |
| 🚫 **Foco sem distração** | Ao sair do app durante o foco (outro app no celular, outra aba ou outra janela no computador), a notificação "Volta pro foco!" sai na hora e o título da aba também chama de volta. Ao voltar, o app mostra quanto tempo você ficou fora. No 1º foco, o app pede a permissão de notificação. As saídas entram no relatório da semana |
| 📲 **Atalhos do ícone** | Segurando o ícone do app instalado: Nova tarefa, Começar foco, Flashcards e Agenda. O app também aparece no menu "Compartilhar" do celular: um texto compartilhado de outro app (ex.: mensagem do grupo) vira tarefa |
| 📅 **Importar calendário** | Arquivo .ics do Google Agenda, Outlook ou AVA/Moodle: provas e entregas viram tarefas, com tipo e matéria reconhecidos pelo nome e sem duplicar |
| 👥 **Trabalho em grupo em tempo real** | Uma tarefa vira compartilhada: o grupo entra pelo link, cada um usa "✋ Eu faço" para pegar etapas, e o que alguém marca aparece na hora para todos, com aviso de quem fez. Mudanças ao mesmo tempo são juntadas sem perder nada (transação + junção por etapa) |
| 🏆 **Ranking dos amigos** | Convite por link; a amizade vale para os dois lados. Pontos da semana = minutos de foco + 20 por tarefa concluída, e zera toda segunda |
| 🟢 **Estudando agora** | Na tela Foco, os amigos que estão focando naquele momento e o botão **Focar junto**, que começa um foco terminando na mesma hora |
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

### 🔔 Como os lembretes funcionam

- A cada 30 segundos, e também num horário agendado para o minuto exato do próximo lembrete, o app confere as tarefas pendentes.
- Cada lembrete é avisado **uma vez**: a chave `idDaTarefa|minutos` e o prazo ficam salvos em `prazocerto:avisos`. Se o prazo mudar, os lembretes voltam a valer.
- Se vários lembretes venceram enquanto o app estava fechado, ele avisa uma vez só. Lembretes cujo horário já tinha passado quando a tarefa foi salva não disparam.
- **Limite da web:** sem um servidor de notificações (push), o navegador só consegue avisar com o PrazoCerto aberto, mesmo que minimizado ou em outra aba. Com o celular bloqueado ou o app fechado, o alarme garantido é o do calendário do celular (botões 📅).

### ☁️ Como a sincronização funciona

- O **LocalStorage continua sendo a memória principal**: o app abre e funciona sem internet, com ou sem conta.
- Ao entrar com o Google, o módulo `js/nuvem.js` baixa o Firebase (só nessa hora, pela CDN oficial) e guarda uma cópia dos dados no documento `usuarios/{uid}` do Firestore.
- Cada mudança é enviada 1,5 s depois. Os outros aparelhos recebem na hora (`onSnapshot`) e a tela se atualiza sozinha.
- Som, volume e avisos ficam por aparelho; tarefas, matérias, aulas, sessões de foco, conquistas e preferências gerais sincronizam.
- **Social:** `perfis/{uid}` guarda nome, foto, números da semana, se está focando e a lista de amigos (qualquer pessoa logada lê; só o dono grava). `grupos/{id}` guarda os trabalhos em grupo: quem tem o link vê a prévia e só pode se adicionar; só membros editam e listam.
- **Segurança:** as regras em `firestore.rules` só deixam cada pessoa ler e gravar o próprio documento de tarefas. A `apiKey` do Firebase não é secreta: ela só identifica o projeto, e quem protege os dados são as regras.

## 💾 Chaves no LocalStorage

`prazocerto:tarefas` · `prazocerto:materias` · `prazocerto:sessoes` · `prazocerto:aulas` · `prazocerto:estudo` · `prazocerto:resumo` · `prazocerto:relatorio` · `prazocerto:nuvem` · `prazocerto:aparelho` · `prazocerto:config` · `prazocerto:tema` · `prazocerto:timer` · `prazocerto:conquistas` · `prazocerto:avisos`
