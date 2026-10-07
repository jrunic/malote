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

## [0.33.0] — 2026-10-06

Não muda a forma do Acervo nem do Registro. **Atualize o servidor antes dos clientes:** um servidor antigo ignora `--ordem` e não devolve `truncado`, e o cliente novo funciona contra ele.

### Corrigido

- **Flag que pede valor e vem sem ele agora é erro de uso (código 2).** Antes, `malote conversas --coletiva` devolvia todas as
  Conversas, `conversas --coletiva --json` lia o `--json` como o valor de `--coletiva` e devolvia só as diretas, e
  `--coletiva banana` virava `false`; o mesmo valia para as outras flags. A validação roda antes de qualquer consulta, nos
  dois modos. `--coletiva` e `--fixada` só aceitam `true` ou `false`, e `--ordem` só `recentes` ou `cronologica`
  (em `mensagens` e `buscar`).

### Alterado

- **`buscar` devolve as mais recentes primeiro** (antes, as mais antigas do Acervo), aceita `--ordem cronologica` para o
  comportamento antigo, e diz quando o limite cortou resultados: `truncado` no JSON da rede e uma linha de aviso na saída
  de texto (no `--json` local, que é uma lista, o aviso vai para a saída de erro). `--desde`, `--ate`, `--limite` e `--ordem`
  passam a constar da ajuda e da documentação.

## [0.32.0] — 2026-10-06

**Muda a forma do Acervo (v25 para v26).** Faça cópia do Acervo antes de atualizar; o servidor e cada ouvinte
migram o Acervo ao subir. O passo só cria uma tabela e um índice e não exige o Registro.

### Adicionado

- **Etiqueta de Participação:** o texto que cada membro põe em si em cada grupo, capturado ao vivo e guardado como
  evento datado (a remoção é um evento de texto vazio). `participantes` traz `etiqueta` e `etiquetaEm` de cada membro
  (e, com `--em`, a vigente naquela data); `identificar` traz as etiquetas do Identificador; o comando novo `etiquetas`
  lista, busca e mostra o histórico, local e por rede (`GET /etiquetas`).
- `pessoa conferir` mede etiquetas do mesmo evento sob duas formas de endereço (só relata).

### Limites

- Só há etiqueta observada depois de o ouvinte entrar; o backup do aparelho não as traz.
- O texto da etiqueta é dado pessoal: aparece na saída dos comandos de consulta e nunca em log nem em relatório.

## [0.31.0] — 2026-10-06

**Muda a forma do Registro (v7 para v8).** Faça cópia do `registro.db` antes de atualizar; o servidor e cada ouvinte migram o
Registro ao subir.

### Adicionado
- A Configuração de WhatsApp conhece o telefone, o endereço do telefone (JID) e o endereço opaco (LID) da própria conta.
  `configuracao criar --fonte whatsapp` passa a exigir `--telefone`; `configuracao definir-telefone` completa a de uma Configuração que
  não o tem; `configuracao listar` (local e por rede) mostra os três.
- O ouvinte confere o vínculo contra o telefone da Configuração e se recusa a subir (código 2, sem imprimir o número) quando o vínculo
  é de outra conta. A conferência aceita o celular brasileiro com e sem o nono dígito. Uma Configuração sem telefone aprende o do
  vínculo na primeira conexão.
- O ouvinte declara ao Acervo o endereço da própria conta e a correspondência entre as duas formas dele.

### Mudado
- `ouvir --numero` deixa de ser uma declaração à parte: vale o telefone da Configuração; um `--numero` diferente dele é recusado, e numa
  Configuração sem telefone ele o declara.
- `GET /configuracoes` ganha os campos `telefone`, `jid` e `lid` (aditivos).
- Mensagens que chegam depois de o ouvinte parar ou recusar a conta deixam de ser processadas.

### Corrigido
- A migração do Registro e do Acervo relê a forma gravada dentro da transação e a abre em modo imediato: dois processos que abrem a base
  de forma antiga ao mesmo tempo (o servidor e cada ouvinte reiniciam juntos) não aplicam mais o mesmo passo, e o segundo não morre com
  `table ... already exists`.

## [0.30.2] — 2026-10-05

Não muda a forma do Acervo nem do Registro. A única mudança de código é a `--ajuda`.

### Mudado

- O repositório deixa de citar caminho interno do autor, nomes de pessoas e de hosts, e nomes de produtos privados: o `CONTEXTO.md` declara que o trabalho acontece fora do repositório (sem caminho), e código, testes e documentação usam termos genéricos (apelido `principal`, agente, instalação de terceiro). Nenhum comportamento muda.
- A `--ajuda` passa a listar `pessoas`, `participantes` e `relatorio` (este só existe por rede), que existiam e não apareciam.
- Um teste amarra as referências de comandos (`docs/referencias/`) à `--ajuda`: comando novo sem linha na referência, ou linha de comando que não existe mais, reprova a suíte.

## [0.30.1] — 2026-10-05

Só documentação: não muda código, nem a forma do Acervo ou do Registro.

### Documentação

- Referência dos comandos do modo servidor e do modo cliente (`docs/referencias/`), a seção 4.3 do guia do host (dimensionar o servidor), o mapa de arquitetura preenchido e a correção do exemplo de `--coletiva` no guia do cliente (a flag leva `true` ou `false`).

## [0.30.0] — 2026-10-04

Não muda a forma do Acervo nem do Registro.

### Adicionado

- As leituras do servidor rodam em workers (4 por padrão), com prazo de 25 s desde a chegada: passou do prazo, `504`.
  Fila de 64 lugares, e `503` com `retry-after` quando enche. `malote servir --trabalhadores <n>` e `--prazo <segundos>`.
- A consulta que o cliente abandona é cancelada no servidor. Um Inquilino ocupa no máximo N−1 workers e metade da fila.

### Mudado

- O servidor para em etapas: espera as leituras em andamento por até 5 s antes de cortar as conexões.
- O Registro é aberto uma vez ao subir, e as rotas de leitura o abrem somente-leitura. O `servir` recusa subir (código 1)
  se o worker de leitura não carregar em 5 s.
- A CLI traduz `504` e `503` em mensagens que dizem o que fazer, com o mesmo código de saída 5.

### Limitação conhecida

- A verificação da Chave continua na thread principal, e o teto de requisições por segundo segue o mesmo. Nenhuma
  consulta fica mais rápida: só deixa de travar as outras.

## [0.29.1] — 2026-10-04

Não muda a forma do Acervo nem do Registro.

### Corrigido

- **`anexos --presenca` varria todos os Anexos daquela presença por Mensagem.** Na maior Conversa a consulta
  passava de um minuto e, como o servidor atende uma requisição por vez, travava todos os clientes até acabar. O
  plano agora entra em `anexos` sempre pelo índice da Mensagem.
- **`GET /buscar` com ponto, `&`, aspas, `AND` ou `*` derrubava o servidor inteiro.** O texto do usuário ia cru
  para a consulta de texto completo, e a sintaxe inválida lançava uma exceção que ninguém tratava. A busca agora
  trata o texto como literal (cada palavra entre aspas, todas por E). Muda só o que nunca foi documentado:
  `AND`, `OR`, `NOT`, `*` e `NEAR` deixam de ser operadores.
- **`limite` inválido derrubava o servidor, e `limite=-1` virava consulta sem limite.** `limite=abc` em `/conversas`,
  `/mensagens`, `/conversas/<id>/mensagens` e `/buscar` virava `LIMIT NaN`, e `limite=0` em `/mensagens` lançava
  uma exceção; as duas matavam o processo. Agora `limite` que não é inteiro maior que zero é `400`.
- **Exceção em qualquer rota vira `500` de corpo vazio, e o servidor segue.** Antes derrubava o processo para
  todos os Inquilinos; o `500` é defeito a corrigir, mas não é mais queda.

## [0.29.0] — 2026-10-04

Não muda a forma do Acervo nem do Registro. Os campos e parâmetros novos são acréscimos: os que já existiam
não mudam de nome nem de sentido.

### Adicionado

- **`malote anexos --conversa <id>`, nos dois modos.** Os Anexos de uma Conversa, em ordem cronológica, com o
  Descritor, a Presença (o Anexo sem arquivo em disco aparece) e a Mensagem de origem. Filtra por tipo,
  remetente, período e presença, e pagina por `proximo` e `--antes`. Por rede é
  `GET /conversas/<id>/anexos`, e `--inquilino` é recusado. Na CLI, `--tipo` aceita também `imagem` e
  `documento`.
- **`--remetente <valor>` em `mensagens`** (comando local, `GET /mensagens` e `GET /conversas/<id>/mensagens`).
  O valor é o do Identificador (LID ou JID), com ou sem Pessoa, e alcança a forma canônica e as alternativas
  que a correspondência de endereço conhece. Valor desconhecido devolve lista vazia.
- **`malote exportar --conversa <id>`, nos dois modos.** Grava a Conversa em `txt` ou `json`, filtrável por
  remetente e período, com o nome de quem escreveu. Com `--saida` o arquivo só vira definitivo na última
  página; uma falha no meio não deixa arquivo que pareça completo.
- **`GET /conversas/<id>/autores`.** Quem escreveu na Conversa, uma vez cada, com `valor`, `nome`,
  `origemDoNome` e `pessoaId`, participante ou não.

### Limitação conhecida

- O remetente sem nome sai pelo valor do Identificador; o de Instagram sem nome sai como
  `nome-exibicao:<Nome>`.
- `exportar` local sem `--saida` acumula a saída em memória; numa Conversa grande, use `--saida`.

## [0.28.0] — 2026-10-04

Não muda a forma do Acervo nem do Registro. Os campos novos das respostas são acréscimos: os que já
existiam não mudam de nome nem de sentido.

### Adicionado

- **`malote identificar <valor>`, nos dois modos.** O que o Acervo sabe de um Identificador, **com ou sem
  Pessoa**: os Identificadores gravados que o valor alcança, as formas que a correspondência de endereço
  conhece (a canônica e as alternativas, gravadas ou não), os nomes com a origem de cada um, o nome
  corrente pela precedência do Inquilino, a Pessoa quando há, e em quantas Conversas e Mensagens aparece.
  O valor é comparado exato; valor desconhecido devolve lista vazia. Por rede é `GET /identificadores?valor=`
  (e `--fonte`), e `--inquilino` é recusado.
- **Nome nos participantes.** `GET /conversas/<id>/participantes` traz, por participante, `valor`, `nome`,
  `origemDoNome` e `pessoaId` (`null` onde não há).
- **Nome na Conversa direta.** A listagem de Conversas traz `nome` e `origemDoNome` nas diretas de WhatsApp,
  e `conversas --busca` passa a achar a Conversa direta pelo nome de qualquer Atribuição do Identificador do
  outro lado, além do assunto das coletivas. O `conversas` local também mostra o nome.

### Limitação conhecida

- Um valor-sentinela que a plataforma grava no lugar do nome aparece como nome, porque a precedência de nome
  não o filtra.

## [0.27.1] — 2026-10-04

Não muda a forma do Acervo nem do Registro.

### Corrigido

- **A saída de mais de 64 KB não é mais cortada quando o stdout é um pipe.** O ponto de entrada
  chamava `process.exit` logo depois de escrever, e o que o pipe ainda não tinha aceitado morria com o
  processo: `malote participantes` por rede entregava 65.536 de 242.481 bytes por pipe, e `jq` ou
  `python` falhavam com JSON incompleto. Afetava o modo rede e o `--json` local, em macOS e Linux;
  redirecionar para arquivo escondia o defeito. O processo agora espera a saída ser entregue antes de
  sair (com teto de 10 s se ninguém ler o pipe).

## [0.27.0] — 2026-10-04

Não muda a forma do Acervo nem do Registro. **Ordem de release:** o servidor recebe esta versão
antes de qualquer cliente — um servidor anterior ignora o identificador novo e duplicaria numa
repetição.

### Adicionado

- **Repetição segura do `malote enviar` por rede.** O cliente gera um Identificador de Envio
  para cada pedido, o manda e o imprime. Repetir o mesmo pedido com o mesmo identificador
  (`--identificador <uuid>`) não cria um segundo Envio: o servidor responde `200` com
  `repetido`. O mesmo identificador com Configuração, destinatário ou conteúdo diferente
  responde `409`. O código de saída 7 do `enviar` passa a dizer o identificador e como
  repetir; um servidor que não confirma o identificador faz o cliente avisar que repetir pode
  duplicar.
- **Consulta do Envio por rede.** `GET /envios/<identificador ou id>` devolve o estado, as
  tentativas e o motivo da falha (sem o texto nem o arquivo), e `GET /envios/contagem` devolve
  a contagem por estado. `malote envio estado [<identificador>]` consulta por rede quando o
  servidor está no ambiente, e aceita `--chave-em <VARIÁVEL>`. `envio reprocessar` continua
  só local.

### Alterado

- `malote envio estado` (local) lista sempre os três estados, `enviado`, `falhou` e
  `pendente`, com zero quando não há.

## [0.26.1] — 2026-10-04

Não muda a forma do Acervo nem do Registro.

### Corrigido

- **`malote servir` não cai mais com Chave válida de um Inquilino sem Acervo.** Abrir o
  Acervo somente-leitura lançava dentro do manipulador e a exceção encerrava o processo,
  para todos os Inquilinos, com uma única requisição autenticada. Agora a requisição recebe
  `503` de corpo vazio e a causa vai para o stderr do servidor. Vale também para Acervo em
  forma divergente.

## [0.26.0] — 2026-10-04

Não muda a forma do Acervo nem do Registro, e não muda o servidor.

### Adicionado

- **`malote enviar` fala por rede.** Com `MALOTE_SERVIDOR` no ambiente, o comando pede o
  Envio ao servidor (`POST /envios/solicitar`) em vez de gravar no Acervo local — texto,
  imagem e documento, com o texto como legenda quando há arquivo. Sem a variável, o
  comando local é o mesmo de antes.
  - O Inquilino vem só da Chave de Acesso: `--inquilino` é **recusado** no modo rede
    (código 2), e a mensagem diz como forçar o modo local (`env -u MALOTE_SERVIDOR`).
  - `--chave-em <VARIÁVEL>` usa a Chave de Acesso guardada na variável **nomeada** (nunca o
    valor na linha de comando). Variável ausente ou vazia recusa, em vez de cair na chave
    padrão.
  - A falha sai nos códigos do cliente: 3 credencial, 4 conexão, 5 servidor, 6 uso (o `404`
    de Configuração diz "não existe neste Inquilino, ou a chave não o alcança"), 7 tempo
    esgotado. **O 7 do `enviar` não é inofensivo:** o pedido pode ter entrado, e repetir
    pode mandar a mensagem duas vezes — a mensagem indica `malote mensagens --direcao
    enviada` como conferência antes de repetir.
  - O pedido inteiro (arquivo em base64 mais o envelope) tem teto de 8 MB, o que deixa o
    arquivo perto de 6 MB; o cliente recusa antes de abrir conexão.
  - `malote --ajuda` passa a listar `enviar`, `envio estado` e `envio reprocessar`.

### Alterado

- O guia do cliente deixa de dizer que não há comando da CLI para o Envio por rede, e
  corrige três afirmações que ficavam falsas: o código 7 como "repetir é seguro" e os
  comandos como "todos somente leitura".
- `enviar` é a única escrita que o cliente despacha por rede; a restrição "comando de
  escrita recusa o modo rede antes de abrir base" continua valendo para todo o resto.

## [0.25.1] — 2026-10-04

Não muda a forma do Acervo.

### Corrigido

- **Uma falha ao gravar o resultado de um Envio, depois de a mensagem já ter
  saído, marcava o Envio como `falhou`.** `falhou` só volta a `pendente` por
  `malote envio reprocessar`, que reenviaria uma mensagem que já foi. Agora o
  Envio continua `pendente` e a próxima passada tenta de novo (ao menos uma
  vez, como já era a garantia declarada).
- `malote envio reprocessar` passa a dizer também quantos Envios continuam
  pendentes (inclui os que esperam um `ouvir` com vínculo ativo), e o `--json`
  ganha o campo `pendentes`.

## [0.25.0] — 2026-10-04

**Muda a forma do Acervo: schema v23 → v25** (tabela nova `envios` na v24;
colunas de mídia nela na v25). Os dois passos são aditivos e não exigem
contexto do Registro: qualquer serviço que abrir o Acervo os aplica sozinho.

### Adicionado

- **O malote passa a enviar mensagem de WhatsApp** — texto, imagem e
  documento — pela conexão que o `malote ouvir` da Configuração já mantém.
  Antes ele só lia, guardava e cruzava.
  - `malote enviar --inquilino <id> --configuracao <apelido> --para <endereco>`
    com `--texto`, `--imagem <caminho>` ou `--documento <caminho>` (o texto vira
    a legenda quando há arquivo). O arquivo é copiado para uma pasta de trabalho
    (`envios-pendentes/`); o original não é tocado.
  - `malote envio estado` e `malote envio reprocessar`.
  - `POST /envios/solicitar`, a segunda rota de escrita da API por rede, com o
    arquivo em base64 no corpo JSON (limite de 8 MB). A Chave de Acesso desta
    rota **fala pela conta**: exponha o servidor só atrás de TLS.
  - O pedido é gravado como um Envio pendente e processado pelo `ouvir`. A
    garantia é de **ao menos uma vez**: uma queda entre o envio e o registro
    pode repetir a mensagem. A Conversa só nasce depois que o envio sai.
  - A mensagem enviada volta pelo mesmo caminho de recepção das demais, e o
    arquivo de staging vira o arquivo do Anexo (movido para
    `envios-pendentes/processados/`, nunca apagado).

### Corrigido

- A mensagem de subida do `malote servir` dizia "Somente leitura" mesmo com a
  rota de solicitação de Transcrição, que escreve. Agora nomeia as duas rotas de
  escrita.

## [0.24.1] — 2026-10-01

### Corrigido

- **O worker de transcrição de áudio falhava sempre, em qualquer instalação
  onde `malote servir` não roda do próprio Destino de Mídia** (o caso
  normal). Ele passava o caminho do Anexo — relativo ao Destino de Mídia por
  desenho — direto para o `ffmpeg`, sem resolver o caminho absoluto antes.
  Toda Transcrição terminava `falhou`, com "No such file or directory",
  mesmo com o arquivo presente no disco.

## [0.24.0] — 2026-10-01

**Muda a forma do Acervo: schema v22 → v23** (coluna `transcricoes.solicitada_em`).

### Adicionado

- **Duração do Anexo de áudio**, extraída do Conteúdo Bruto já preservado
  (`seconds` na recepção ao vivo, `ZMOVIEDURATION` no backup) — sem abrir
  arquivo, sem `ffprobe`. Escrita nova grava automaticamente; o estoque já
  gravado ganha o comando `malote midia extrair-duracao --inquilino <id>
  [--json]`.
- `malote transcricao incluir-estoque --inquilino <id> --limite <n> [--json]`
  — promove, em lote controlado, Anexo de áudio `fora-de-escopo` para a fila
  normal de Transcrição. Só promove quem já tem o arquivo presente.
- `malote transcricao solicitar --anexo <id> --inquilino <id>` — pede a
  Transcrição de um Anexo específico, e ele passa a ser o próximo que o
  worker processa, à frente de qualquer item já pendente. Funciona sobre
  Anexo nunca visto, `fora-de-escopo` ou `falhou`.
- **`POST /transcricoes/solicitar`** — o mesmo pedido acima, pela API por
  rede. **Primeira rota de ESCRITA que a API expõe**: superou de propósito a
  decisão de "só leitura no v1" (recorte original), com autenticação pela
  mesma Chave de Acesso e isolamento por Inquilino estrutural (a conexão de
  escrita abre o Acervo do Inquilino da credencial). O cliente CLI continua
  sem aceitar `--servidor` para este comando — a exceção é só da rota HTTP.

## [0.23.0] — 2026-09-30

### Adicionado

- **Comando `pessoa promover-identificadores-nomeados`.** Promove Identificador
  sem Pessoa que já tem Atribuição de Nome (do WhatsApp ou de outra Fonte) a
  Pessoa própria — sem depender de catálogo de contatos. Ensaio por padrão.
- `malote conversas --desde <data>`, ordenado pela última Mensagem — feed de
  atividade recente.
- Retry de mídia recebida ao vivo que falhou ao baixar (`ETIMEDOUT`/rede).

### Corrigido

- `contacts.upsert` do WhatsApp não grava mais um valor-sentinela do próprio
  app como se fosse nome de contato (58% das Atribuições afetadas em Acervo
  real, antes da correção).
- Nome que repete o próprio endereço pelo nono dígito móvel brasileiro deixa
  de ser gravado como Atribuição de Nome.
- `mensagens --desde <data>` sem resultado no período devolve lista vazia em
  vez de `404`.
- Entrada de Status do WhatsApp (`ZSESSIONTYPE=3`) nunca vira Conversa
  coletiva — corrigido nos dois caminhos, importação e recepção ao vivo;
  migração remove as Conversas fantasma já gravadas em instalações antigas,
  sem perder Conversa com conteúdo real de Status/Stories.

## [0.22.0] — 2026-09-29

### Adicionado

- **Transcrição de áudio via Whisper local, opcional.** `malote servir` roda um
  worker de fundo que transcreve Anexo de áudio recebido ao vivo usando
  `whisper.cpp` (modelo `small`) e `ffmpeg` — binários de sistema, declarados
  por variável de ambiente, nunca instalados pelo produto. Busca por texto
  alcança a Transcrição, com proveniência marcada (`conteudo` ou
  `transcricao`). Comandos novos: `malote transcricao reprocessar` e
  `malote transcricao estado`. Schema do Acervo **20 → 21**; a migração marca
  todo Anexo de áudio já `presente` como `fora-de-escopo`, então não há
  backfill automático do estoque existente.

### Corrigido

- **Mídia recebida ao vivo pelo ouvinte nunca era baixada** — Anexo (áudio,
  imagem, vídeo, documento) ficava `nunca-obtido` para sempre em 94–99,8% dos
  casos, conforme o tipo. O ouvinte agora baixa em segundo plano, usando a
  referência de download que a própria mensagem já trazia.
- **Entrada de Status do WhatsApp virava Conversa coletiva fantasma** na
  importação de backup do iOS — o feed de acompanhamento de stories de um
  contato (`ZSESSIONTYPE=3`) não é um chat de verdade e nunca deveria ter
  criado Conversa. Grupo, lista de transmissão e comunidade continuam
  coletiva, como sempre.

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
