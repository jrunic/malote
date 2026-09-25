---
id: 202609121730
projeto: malote
tipo: nota
escopo: repo:malote
plataforma: "*"
status: ativo
descricao: Changelog do malote — o que mudou em cada versão publicada, com âncora por tag.
tags: [changelog, release, Node]
---

# Changelog

Todas as mudanças relevantes deste produto, por versão publicada.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
versionamento segue [SemVer](https://semver.org/lang/pt-BR/). Enquanto a versão
maior for `0`, a interface pode mudar entre versões menores.

Cada entrada tem uma tag `vX.Y.Z` no commit publicado. O histórico público começa no
commit "Initial public release": as entradas anteriores são o registro fiel do que foi
publicado antes da abertura, e as tags delas pertencem ao repositório privado de origem.

## [Não publicado]

## [0.21.2] — 2026-09-25

### Corrigido

- **`identidade resolver-enderecos` travava com `UNIQUE constraint failed` em
  `atribuicoes_de_nome`** quando o endereço alternativo (LID) e o canônico
  (JID) já tinham, cada um por conta própria, a mesma Atribuição de Nome —
  cenário comum, porque a plataforma manda o nome de perfil pelos dois
  endereços antes de a correspondência ser aprendida. Achado em produção
  real (Acervo de uma mentorada): a operação travava depois de já ter
  repontado `mensagens.autor_id` para 29 pares, deixando o Acervo em estado
  parcial (recuperável por `operacao desfazer`, que funcionou). Havendo
  colisão, a linha do endereço alternativo agora é absorvida e a do
  canônico prevalece como está — reversível por `operacao desfazer` como
  qualquer outra fusão.

## [0.21.1] — 2026-09-23

### Corrigido

- **`GET /conversas/<id>/mensagens?ordem=recentes` sem cursor** (primeira página)
  ignorava o pedido explícito de ordenação por recência e devolvia a ordem
  cronológica em silêncio — achado consultando produção real: a rota devolveu
  Mensagem de 2021 numa Conversa com Mensagem do mesmo dia. `ordem` agora é
  computado uma única vez, com ou sem cursor; valor explícito no query sempre
  vence. Default sem `ordem` nenhum continua assimétrico por desenho
  (cronológica sem cursor, recentes com cursor).

## [0.21.0] — 2026-09-23

### Adicionado

- **Direção da Mensagem** (`enviada` pelo Titular ou `recebida` de outra
  Pessoa) — conceito de domínio novo, gravado por cada Adaptador no momento
  da escrita, independente do autor estar resolvido. Coluna `direcao` em
  `mensagens`, `NULL` só em Mensagem migrada de um Acervo anterior a esta
  coluna cujo Conteúdo Bruto não trouxe o discriminante.
- **`GET /mensagens`** — últimas Mensagens através de todas as Conversas e
  Fontes do Inquilino, sem exigir uma Conversa antes. `direcao` filtra por
  quem começou a Mensagem; sem `ordem` explícito o default é `recentes`
  (oposto do default de `/conversas/<id>/mensagens`, que continua
  `cronologica`). Espelhado na CLI local (`malote mensagens` sem
  `--conversa`) e no modo rede.
- **`--direcao`** aceito em `malote mensagens` (com ou sem `--conversa`) e em
  `GET /conversas/<id>/mensagens`.
- **`--ordem`** exposto na CLI local, nos dois modos de `mensagens` — a rota
  de rede já aceitava o parâmetro; faltava a CLI repassá-lo.

### Nota de deploy — LEIA ANTES DE INSTALAR ESTA VERSÃO

**Esta release muda a forma do Acervo (schema 18 → 20)**, com um passo de
migração que **exige contexto do Registro** (Configurações do Inquilino) —
o `malote ouvir` (ouvinte) **se recusa a subir** se a migração não tiver
rodado antes, por Inquilino. A ordem de deploy é obrigatória, não
opcional:

1. Parar os serviços (`malote-ouvinte@<conta>`, `malote-servidor`).
2. Fazer backup do Acervo de cada Inquilino.
3. Rodar `malote acervo migrar --inquilino <id>` — **um comando por
   Inquilino**, antes de qualquer restart.
4. Só então reiniciar os serviços.

Instalação com Instagram e mais de uma Configuração daquela Fonte por
Inquilino: Mensagem de Conversa coletiva cujo autor não é determinável sem
ambiguidade entre Configurações recebe `direcao NULL` (não é erro, não
interrompe a migração) — Conversa direta resolve normalmente pela própria
Configuração.

## [0.20.0] — 2026-09-22

### Adicionado

- **`malote configuracao criar`** — declara uma Configuração de Adaptador
  (e, opcionalmente, a conta) sem exigir material de backup em mãos.
  Reaproveita as mesmas portas que `importar` e `entrada declarar` já usam
  (`resolverConfiguracao`, `definirContaDaConfiguracao`), é idempotente, e
  desbloqueia o `ouvir` para quem quer parear o dispositivo e começar a
  receber ao vivo antes de ter um export pronto — o `ouvir` continua sem
  criar Configuração sozinho, comportamento intocado.

### Corrigido

- **`docs/tutoriais/instalar.md`** deixou de ensinar `entrada declarar
  --fonte whatsapp` (recusado pela CLI desde que a varredura passou a ser
  restrita a Fontes varríveis) no passo de configurar o ouvinte — o passo 6
  agora apresenta dois caminhos, com material ou só para o ouvinte.

## [0.19.0] — 2026-09-19

### Adicionado

- **Filtro `--configuracao`/`?configuracao=` nas rotas de leitura**, local e por
  rede: `conversas` e `mensagens` filtram por apelido (`Fonte`+apelido, com
  recusa nomeando a ambiguidade quando o mesmo apelido existe em Fontes
  diferentes, ou quando não casa nenhuma). Conversa direta na saída de
  `conversas` passa a carregar o apelido da Configuração de que veio; Conversa
  coletiva nunca casa esse filtro (pertence ao Inquilino, não a uma
  Configuração) e sai com `configuracao: null`.
- **`GET /configuracoes`**, espelhando `malote configuracao listar` por rede —
  `apelido`+`fonte` de cada Configuração do Inquilino, sem o `id` interno.
- **Filtro `favorito` em `GET /conversas/<id>/mensagens`** (só modo rede) — Marca
  do Titular em Mensagem, resolvendo a Fonte implicitamente pela própria
  Conversa. Exige `configuracao` junto; sem casos, devolve `200` com lista
  vazia quando a Conversa existe (só `404` quando ela não existe).
- **Filtro `fixada` em `GET /conversas`/`malote conversas`**, local e rede —
  Marca do Titular em Conversa. Com `fixada=true`, `configuracao` passa a
  escopar a **Marca**, não a atribuição — é o que faz Conversa coletiva fixada
  aparecer no resultado.
- **`GET /midia/<anexoId>`**, com Chave de Acesso — devolve os bytes do Anexo
  com `content-type` do tipo. Anexo do tipo `video` é recusado com sinal
  dedicado (`415`, corpo nomeando o tipo); inexistente, de outro Inquilino ou
  sem bytes disponíveis devolvem o mesmo `404` vazio das demais rotas.
- **`malote midia <id> --saida <arquivo>`** — baixa os bytes de um Anexo. Só
  existe em modo rede (`MALOTE_SERVIDOR` setado): quem opera local já tem o
  arquivo em disco.

## [0.18.1] — 2026-09-16

### Corrigido

- **`bin/malote` roda da fonte, sem depender de `dist/`.** `package.json.bin`
  apontava para `dist/cli/index.js`, que só existe após build — e o produto
  roda da fonte, sem build, em toda instalação real. `npm link` não chegava a
  criar o symlink global, porque o alvo declarado não existia. `bin/malote`
  agora resolve o próprio diretório por `import.meta.url` (nunca por CWD —
  `node --import tsx` resolve o pacote `tsx` pelo CWD do processo, não pelo
  caminho do script) e roda o filho com `cwd` fixado na raiz do repositório.
  Guia do cliente ganhou o passo `npm link` que faltava.

## [0.18.0] — 2026-09-16

### Adicionado

- **Consulta por rede na CLI.** O mesmo binário consulta o servidor com
  `MALOTE_SERVIDOR` + `MALOTE_CHAVE_DE_ACESSO`: `conversas` (com busca, fonte,
  natureza e limite), `mensagens` (janela, autor, paginação por cursor opaco
  composto — instantes iguais não pulam nem repetem), `buscar` (com filtros),
  `pessoas` (resolução por texto), `participantes` (com a pergunta de Presença
  por data) e `relatorio` (por fonte e natureza). Códigos de saída por classe
  de falha (credencial/conexão/servidor/uso/timeout), no molde do tili.
  Somente leitura: comando de escrita com `--servidor` recusa antes de abrir
  base nenhuma.

## [0.17.0] — 2026-09-16

### Adicionado

- **Armazenamento pelo padrão XDG, por categoria.** O dado (Registro, Acervos,
  mídia, material) vive em `XDG_DATA_HOME/malote/`; o estado do ouvinte
  (vínculo, derrame, último evento, série de correspondência, retrato) em
  `XDG_STATE_HOME/malote/`. `MALOTE_HOME` é a válvula que guarda tudo numa
  pasta só. As regras do spec valem como comportamento: variável vazia conta
  como ausente, caminho relativo é ignorado, e o que o produto cria nasce 0700.
  A subida do ouvinte deixa de criar a pasta do ouvinte — é pré-condição de
  quem opera.

### Removido

- `MALOTE_RAIZ` não tem mais efeito nenhum. Quem apontava pastas por ela
  declara `MALOTE_HOME`.

## [0.16.1] — 2026-09-15

### Corrigido

- Fixação de Conversa ao vivo era lida como desmarcação. O baileys emite
  `pinned` como timestamp (número) quando fixa e `null` quando desfixa — nunca
  boolean. Atualização sem a chave `pinned` (só `archived`) também desmarcava
  fixação que o evento não veio dizer. Achado no aceite de campo do ciclo 19:
  53 mutações decodificadas, zero marcas.

## [0.16.0] — 2026-09-15

### Adicionado

- O ouvinte passa a gravar o Retrato de Estado, o nome de agenda ao vivo e o
  favorito ao vivo. Retrato substitui o conjunto de Conversas fixadas; atualização
  de um item não desmarca as outras. Endereço opaco sem par pula e conta. Nome
  que chega em `contacts.upsert` grava Autoridade `titular`. Favorito marca e
  desmarca Mensagem que já existe.

## [0.15.0] — 2026-09-13

### Adicionado

- **Marca do Titular: o que o dono da conta destacou.** Duas formas no acervo —
  mensagem favoritada e conversa fixada —, cada uma com a conta sob a qual foi
  marcada. A conta não é redundante: conversa coletiva é compartilhada entre
  contas, então marcar numa não afirma nada sobre a outra.

  São **dois verbos**, e a diferença entre eles é o tipo de material que chega:
  *marcar* acrescenta, e é o que uma atualização de um item autoriza; *reconciliar*
  substitui o conjunto, e só um retrato completo autoriza isso — porque só ele
  permite concluir ausência. Confundir os dois não custa um campo errado: custa
  desmarcar o acervo inteiro no primeiro evento de rotina.

- **O favorito que o material sempre trouxe e o produto descartava.** Medido nos
  dois materiais reais: **57** mensagens favoritas em 6 conversas no mais recente,
  90 em 7 no anterior — o número muda entre dois materiais, então o antigo é linha
  de base e nunca expectativa. Reimportar marca o favorito em mensagem que **já
  existe**, que é o caso de toda instalação em uso.

- **Filtro por favorito na consulta de mensagens**, e a contagem no relatório de
  importação.

- **O instante do último retrato de estado, na saída estruturada do ouvinte.**
  Sem ele, *"nenhuma conversa marcada"* e *"o retrato não veio"* são a mesma
  resposta — e só na segunda é que não se pode concluir nada. Ausente é nulo, e
  nunca zero.

  A saída padrão do comando de estado **não muda**: ela é contrato com quem vigia
  o serviço, que converte a saída inteira em data.

### Sobre o que NÃO entrou

A gravação do nome que a plataforma entrega ao vivo, e a fixação de conversa,
foram **recusadas por medição** — não adiadas por falta de tempo. O produto não
grava o que não sabe classificar: a origem daquele nome não pôde ser medida neste
dispositivo, porque as mutações chegam cifradas com chaves que ele não tem. O
instrumento de medição fica instalado e desligado por padrão; quando a medição for
possível, ela decide.


## [0.14.0] — 2026-09-13

### Adicionado

- **Captura diagnóstica de eventos de estado, desligada por padrão.** O ouvinte
  observa a camada de estado da plataforma desde a v0.5.0, e o que ele grava no
  log é **forma, nunca valor** — quantos itens, quais chaves, se um campo difere
  de outro. Essa propriedade não muda.

  Mas decidir de quem é o nome que a plataforma entrega ao vivo não se resolve
  por forma: medido em **21.785 eventos**, o nome só chega num fluxo, e esse
  fluxo **não traz** o campo com que o resumo o compara — o contador devolvia
  zero em 9.625 itens, por vacuidade e não por igualdade.

  Passa a existir um gancho de captura que grava o evento inteiro num arquivo
  próprio, ao lado das credenciais do vínculo, e que **só existe quando a
  variável `MALOTE_CAPTURA_DE_RETRATO` aponta um caminho**. Sem ela, nada é
  escrito. É diagnóstico com prazo, não recurso do produto.

- **O ouvinte passa a observar o fluxo de sincronização de histórico.** Ele
  entrega conversas, contatos e mensagens de uma vez, e nunca havia sido
  assinado — o que torna "não chega" uma afirmação que ninguém tinha medido.


## [0.13.0] — 2026-09-13

### Corrigido

- **Nome de membro de conversa coletiva: campo vazio conta como ausente.** A
  leitura preferia o nome completo ao primeiro nome com `??`, que só cai para o
  segundo quando o primeiro é **nulo** — e a Fonte grava **string vazia** na
  maioria das linhas da coluna do nome completo. O resultado era o membro ficar
  sem nome nenhum.

  Medido contra um acervo real logo depois de publicar a v0.12.0: dos **9.286**
  membros que têm nome no material e existem no acervo, apenas **1.071** haviam
  ganhado o nome. Eram 9.119 nomes humanos esperados — os outros 565 repetem o
  próprio endereço e são recusados por desenho.

  A fixture de teste nunca reproduziu o caso porque gravava ausente em vez de
  vazio. Agora grava vazio, e o teste falha com o código anterior.

- **A recusa de nome que repete o próprio endereço passa a aparecer no
  relatório de importação.** O contador existia desde a v0.12.0 e nunca era
  impresso — recusa que ninguém vê é recusa silenciosa.

## [0.12.0] — 2026-09-13

### Adicionado

- **Autoridade da Atribuição de Nome.** Toda Atribuição passa a declarar quem
  afirmou o nome: `titular`, quando o dono da conta o cadastrou, ou `terceiro`,
  quando o dono do endereço o escolheu para si. É o terceiro nível da
  precedência, depois do peso por Fonte e do catálogo preferido, e **nunca
  atravessa Fontes** — nome de catálogo continua vencendo nome de plataforma.

  Medido contra um acervo real de 22.948 Atribuições: em **154 endereços** o
  nome que o outro escolheu vencia o que o titular cadastrou, só por ser mais
  recente. A recência passa a ser o último critério, nunca o primeiro.

- **O nome de membro de conversa coletiva entra no acervo.** O material do
  WhatsApp traz o nome que o dono da conta cadastrou para cada membro, em dois
  campos; o adaptador lia nenhum dos dois. Passa a ler os dois, preferindo o
  nome completo ao primeiro nome — medido, o completo começa pelo primeiro em
  509 de 510 casos e é mais longo em 510 de 510.

  Alcance medido num material real: **10.168 linhas de roster** trazem nome, e
  **8.151 membros distintos não têm conversa direta nenhuma** — endereços que
  até aqui ficavam anônimos.

- **`malote pessoa remover-nomes-invalidos`**, com ensaio por padrão. Remove as
  Atribuições que não nomeiam ninguém: as que repetem o próprio endereço e as
  que duplicam outra por marca invisível. A saída separa os dois motivos, e
  `--com-efeito` exige `--confirmo`.

### Corrigido

- **Nome que repete o próprio endereço não vira mais Atribuição.** A plataforma
  preenche o campo de nome com o número quando não há contato cadastrado, e
  gravar isso fazia o endereço competir com o nome de verdade. A recusa é
  contada, no relatório de importação e na saída estruturada do receptor —
  nunca silenciosa.

- **Marca invisível deixa de duplicar nome.** Duas escritas do mesmo nome que
  diferem apenas por marca de direção, espaço não-quebrável ou hífen não-ASCII
  passam a ser reconhecidas como a mesma afirmação. O texto gravado continua
  sendo **o que a Fonte entregou** — normalizar vale para comparar, nunca para
  reescrever.

### Forma

- Acervo **v16 → v17**: coluna da Autoridade na Atribuição de Nome, por
  acréscimo de coluna. As linhas anteriores ficam indeterminadas, que é o valor
  certo para elas — quando foram gravadas não havia campo, e ninguém sabe de
  qual campo do material cada nome veio. Quem as resolve é a reimportação.

## [0.11.0] — 2026-09-12

### Adicionado

- `malote --versao` responde a versão publicada. Não exige instalação: pode ser
  a primeira coisa que se roda, antes de existir base alguma.
- Portão de integração contínua: a suíte, o compilador e o lint passam a rodar
  em Linux, em toda proposta de mudança. Até aqui os testes só tinham sido
  exercitados em macOS.
- Este arquivo, com o histórico das versões publicadas.
- `malote ouvinte estado --json` passa a expor uma série diária da fonte de
  correspondência de endereço. O produto aprende a ligar as duas formas de
  endereço a partir de um campo que a plataforma manda junto do evento; se ela
  parar de mandar, o aprendizado para **em silêncio** — nada trava, nada
  reinicia, e cada endereço novo vira uma identidade que não se liga a ninguém.
  A série torna isso observável. A saída sem `--json` não mudou.

### Corrigido

- O leitor de material descartava linha sem conversa **sem contar**. Nada some
  mais sem registro: o descarte é contado por motivo, aparece no relatório e na
  tela, e fica separado das rejeições da importação — que são coisa diferente.
  Medido contra dois acervos reais: 96 linhas num, 3 no outro.
- Linhas que o material repete pelo mesmo identificador eram reportadas como "já
  existentes", o que se lia como "já estavam no acervo". Agora são contadas à
  parte.
- Quatro reprovações de lint que estavam de pé sem ninguém ver, todas em código
  de teste.

### Interno

- O núcleo não pode importar adaptador de fonte — a convenção passou a ter teste
  que a guarda. Sem ela, um módulo do núcleo poderia passar a depender do
  formato de uma fonte específica, e o produto deixaria de ser testável sem ela.

## [0.10.0] — 2026-09-12

### Adicionado

- **Pasta de Entrada**: o produto passa a vigiar uma pasta por Configuração de
  Adaptador. Material colocado nela é reconhecido, importado e movido para
  `processados/`. O produto não busca material e não apaga nada — o transporte
  até a pasta e a limpeza são de quem instala.
- **Identidade entre bases**: o mesmo contato em catálogos diferentes passa a
  ser reconhecido por e-mail, por telefone e por nome, com a régua de fusão
  aplicada por Configuração.
- **Marca de Ausência**: material de natureza completa que deixa de trazer um
  cartão o marca como ausente, sem remover nada — e uma guarda proporcional
  aborta em vez de marcar em massa.

### Corrigido

- Marca invisível de direção no título de material de Instagram fazia o
  adaptador recusar o material inteiro por natureza ambígua.

## [0.9.0] — 2026-09-10

### Adicionado

- O que transborda quando o acervo está ocupado passa a ser visível e a se
  esvaziar sozinho, em vez de ficar esperando intervenção.

## [0.8.0] — 2026-09-09

### Corrigido

- O ouvinte sobrevive à disputa de escrita com outro processo. Antes, o
  processo morria — e, numa segunda forma do mesmo defeito, registrava a
  mensagem como recusada e a perdia em silêncio.

## [0.7.0] — 2026-09-08

### Corrigido

- Um critério que valia para Conversa coletiva estava sendo aplicado a todas.

## [0.6.0] — 2026-09-08

### Adicionado

- Conversa direta passa a ser identificada por Configuração de Adaptador: duas
  contas da mesma Fonte deixam de colidir no mesmo fio. Conversa coletiva
  continua compartilhada, que é o que o dado sustenta.

## [0.5.0] — 2026-09-07

### Adicionado

- O ouvinte observa os fluxos de estado da aplicação (contatos, conversas e
  atualizações de mensagem), registrando o que chega sem escrever no acervo.

## [0.4.0] — 2026-09-07

### Corrigido

- A porta de preparação de comandos passa a valer no repositório inteiro, o que
  elimina a recompilação por operação.

## [0.3.0] — 2026-09-07

### Corrigido

- A importação deixa de crescer em memória com o tamanho do material. Materiais
  grandes derrubavam o processo antes de terminar.

## [0.2.0] — 2026-09-04

### Corrigido

- Perda de mensagem em conversa coletiva: quando o conteúdo trazia uma chave de
  distribuição antes do conteúdo real, a mensagem inteira era descartada em
  silêncio.
- Conteúdo explicitamente nulo derrubava o ouvinte; a guarda só testava
  conteúdo ausente, que é coisa diferente.

## [0.1.0] — 2026-09-03

Primeira versão distribuída.
