---
id: 202610050300
projeto: malote
tipo: referencia
escopo: repo:malote
plataforma: "*"
status: ativo
dominios: [tecnologia]
descricao: "Referência — os comandos do malote no modo cliente (rede): ambiente, comandos de leitura, comandos de escrita, flags, paginação e códigos de saída"
tags: [referencia, cliente, rede, comandos, cli]
---

# Referência: comandos do `malote` no modo cliente (rede)

O **modo cliente** consulta o Acervo de outra máquina por HTTP, com uma Chave de Acesso. Nada do
Acervo é copiado para a máquina cliente. O contexto (quem é o cliente, quem é o servidor) e os
exemplos de uso estão no [guia do cliente e do agente](../guias/cliente-e-agente.md); o lado do
servidor, em [comandos do modo servidor](comandos-modo-servidor.md).

## Como o modo é escolhido

O modo rede liga quando **`MALOTE_SERVIDOR`** está no ambiente. Sem ela, o mesmo comando roda no modo
local (veja a referência do servidor).

| variável | o que é |
|---|---|
| `MALOTE_SERVIDOR` | endereço do servidor, por exemplo `https://malote.exemplo.com` |
| `MALOTE_CHAVE_DE_ACESSO` | a Chave de Acesso: uma por consumidor, escopada a **um Inquilino**. Vai **só por variável de ambiente**, nunca por flag |

- **O Inquilino vem da Chave.** `--inquilino` não existe no modo rede e é recusado (código 2). Para
  consultar uma instalação local, rode com `env -u MALOTE_SERVIDOR`. Hoje a recusa acontece em
  `identificar`, `detalhar`, `anexos`, `etiquetas`, `exportar`, `enviar` e `envio estado`; em
  `conversas`, `mensagens`, `buscar`, `pessoas`, `participantes`, `relatorio` e `configuracao listar` a
  flag é ignorada em silêncio e vale o Inquilino da Chave (#1284).
- **Comando que só existe local é recusado antes de abrir qualquer base** (código 2, mensagem
  `"<comando>" e uma operacao LOCAL — o modo rede so consulta`). Nenhum arquivo é criado. Hoje escapam
  desta recusa `ouvir`, `servir`, `ouvinte reprocessar*` e `midia reprocessar`, que rodam local mesmo com
  `MALOTE_SERVIDOR` no ambiente (#1284).
- `--servidor <url>` só troca a URL do servidor; o modo rede só liga com `MALOTE_SERVIDOR` no
  ambiente.
- `--chave-em <VARIAVEL>` (só em `enviar` e `envio estado`) usa a Chave que está **na variável
  nomeada**, em vez de `MALOTE_CHAVE_DE_ACESSO`. Serve para quem tem mais de uma Chave (por exemplo, a
  de outro Inquilino).
- `--chave` é a **Chave de Operador**, do modo local. Não é a credencial do modo rede.

## Convenções

- **Datas:** `AAAA-MM-DD` (dia inteiro, em UTC) ou um instante completo terminado em `Z`. `--desde` e
  `--ate` são inclusivos.
- **Paginação:** a resposta traz **`proximo`** quando há mais. Devolva-o em `--antes <cursor>`. O cursor é
  opaco: nunca monte um à mão, e um cursor inválido é erro (código 6), não primeira página.
- **Flag sem valor:** uma flag que pede valor e vem sem ele, no fim da linha ou seguida de outra flag, é erro de uso (código 2, antes de qualquer requisição). Não existe `--flag=valor`, então um valor que comece com `--` não pode ser passado.
- **`--json`:** devolve o corpo da API. Sem ele, a saída é texto, no mesmo formato do modo local, em
  `identificar`, `detalhar`, `anexos`, `etiquetas` e `exportar`; `conversas`, `mensagens`, `buscar`,
  `pessoas`, `participantes`, `relatorio` e `configuracao listar` imprimem o JSON da API com ou sem a flag.
- **`--limite <n>`:** o servidor valida; valor que não é inteiro positivo é erro (código 6). Não há teto: sem
  `--limite`, `mensagens` devolve a Conversa inteira, e só o prazo de 25 s freia uma resposta enorme. O
  teto de página de 500 vale para o padrão de `conversas`, não para um `--limite` maior.
- **`buscar`:** devolve as **mais recentes** primeiro (`--ordem cronologica` inverte), até `--limite` (padrão 100). A resposta traz **`truncado`** (`true` quando havia mais). Uma busca de termo comum sem `--desde` já não devolve só as mais antigas do Acervo.
- **Contato enviado (`mensagens`, `buscar`, `exportar`):** cada Mensagem traz `contatosCompartilhados` — o nome, a organização e os telefones e e-mails do cartão —, lista vazia quando não há. A `buscar` casa o nome, a organização e o nome comercial por **palavra**; o telefone por **trecho de dígitos** (6 ou mais: `99991234` acha `556599991234`, e `(65) 99999-1234` também); o e-mail por **trecho**, sem diferenciar caixa. O que casou por cartão vem com `origemDaCorrespondencia: contato-compartilhado`. Servidor anterior a este campo não o devolve, e o cliente trata a ausência como lista vazia.
- **Mensagem editada (`mensagens`, `buscar`, `exportar`):** cada Mensagem traz `edicoes` — o texto novo, o instante da edição e se chegou `cifrada` ou `aberta` —, em ordem, lista vazia quando não há. O `conteudo` é sempre o texto **original**; na Mensagem editada vem também `textoAtual`, o texto da última edição (vazio quando a legenda foi apagada), e sem edição a chave não existe (use o `conteudo`). Em texto (o modo local, e o `exportar` por rede), `mensagens`, `buscar` e `exportar` mostram o texto atual com a marca `(editada)` e as versões anteriores logo abaixo, a original primeiro; por rede, `mensagens` e `buscar` entregam o JSON com `edicoes` e `textoAtual`. Servidor anterior a este campo não o devolve, e o cliente trata a ausência como lista vazia. A `buscar` acha a Mensagem pelo texto de uma **edição** e segue achando pelo texto original, que não muda; o que casou pela edição vem com `origemDaCorrespondencia: edicao`. Quando o termo casa por mais de um caminho na mesma Mensagem, vale o primeiro desta ordem: `conteudo`, `edicao`, `transcricao`, `contato-compartilhado`. A Mensagem editada conta uma vez, mesmo com várias edições que casam.
- Um único `--limite` pesado por vez: o servidor dá prazo de 25 s a cada leitura (veja `504` abaixo).

## Comandos de leitura

Todos aceitam `--json`. As flags marcadas com `*` são obrigatórias.

| comando | o que faz | flags |
|---|---|---|
| `malote conversas` | Índice do Acervo: id, fonte, natureza, contagem, assunto, Configuração. **Em páginas de 500:** havendo mais, o aviso traz o cursor | `--busca <texto>` `--fonte <nome>` `--coletiva true\|false` `--pessoa <id>` `--configuracao <apelido>` `--fixada true` `--desde <data>` `--limite <n>` `--antes <cursor>` `--tudo` |
| `malote mensagens` | Mensagens de uma Conversa, ou de todas (sem `--conversa`, as últimas por recência) | `--conversa <id>` `--desde` `--ate` `--autor <id-de-pessoa>` `--remetente <valor>` `--fonte` `--direcao enviada\|recebida` `--favorito true` `--configuracao` `--ordem` `--limite` `--antes` |
| `malote anexos` | Os Anexos de **uma** Conversa, em ordem cronológica, com a presença de cada um | `--conversa <id>`\* `--tipo image\|video\|audio\|document\|sticker\|other\|imagem\|documento` `--remetente <valor>` `--desde` `--ate` `--presenca presente\|nunca-obtido\|descartado` `--limite` `--antes` |
| `malote buscar` | Busca no conteúdo, no texto das edições, na Transcrição de áudio e nos contatos enviados dentro de Mensagens (com a proveniência marcada) | `--texto <termo>`\* `--conversa` `--autor` `--desde` `--ate` `--limite` `--ordem` |
| `malote pessoas` | Resolve texto em Pessoa: texto entra, id sai | `--texto <nome>`\* |
| `malote identificar <valor>` | O que o Acervo sabe de um Identificador, com ou sem Pessoa. O valor é comparado exato | `--fonte <fonte>` |
| `malote detalhar` | Uma Conversa por inteiro: id, natureza, nome do outro lado (direta) ou assunto, descrição, quem alterou e quando (coletiva), contagem de Mensagens e a primeira e a última. Na coletiva traz também o **`endereco`** do grupo na Fonte, o mesmo valor que `--para` aceita (a direta não tem o campo). Id inexistente e id de outro Inquilino respondem igual | `--conversa <id>`\* |
| `malote participantes` | Participantes de uma Conversa coletiva, com nome e Pessoa; opcionalmente a posição numa data | `--conversa <id>`\* `--em <AAAA-MM-DD>` |
| `malote etiquetas` | As etiquetas que os membros põem em si em cada grupo: as correntes não vazias, ou o histórico de um membro numa Conversa | `--conversa <id>` `--remetente <valor>` `--busca <texto>` `--historico` `--limite <n>` |
| `malote configuracao listar` | Quais Configurações existem (apelido, fonte e, nas de WhatsApp, telefone, jid e lid), antes de filtrar por uma | — |
| `malote relatorio` | Totais por Fonte e natureza | — |
| `malote exportar` | Uma Conversa para um arquivo, txt ou json, com o nome de quem falou | `--conversa <id>`\* `--formato txt\|json` `--saida <arquivo>` `--sobrescrever` `--remetente <valor>` `--desde` `--ate` |
| `malote midia <anexoId>` | Os **bytes** de um Anexo (foto, documento, áudio). Só existe no modo rede | `--saida <arquivo>`\* |

Observações:

- **`--remetente`** é o **valor do Identificador** (LID ou JID, por exemplo
  `5511999990000@s.whatsapp.net`), com ou sem Pessoa; alcança todas as formas do mesmo endereço.
  **`--autor`** é o id de uma **Pessoa**, e só alcança quem tem Pessoa.
- **`anexos`:** o id da última coluna é o que se passa a `malote midia`. Anexo `nunca-obtido` ou
  `descartado` aparece na lista, mas só `presente` tem bytes.
- **`exportar`:** horários em UTC. O arquivo nasce como `<saida>.parcial` e só vira definitivo ao fim; se
  a conexão cair no meio, o parcial fica indicado e não há arquivo definitivo. Sem `--saida`, escreve na
  saída padrão. `--json` equivale a `--formato json`.
- **`midia`:** vídeo é recusado com `415`; Anexo inexistente, de outro Inquilino ou sem bytes é `404`
  (indistinguíveis, por desenho).
- **`enviar --conversa <id>`** envia à Conversa pelo id, no lugar de `--para`. O id é do Acervo do Inquilino da Chave: o de outro Inquilino responde `404`. A conta (`--configuracao`) vai **sempre explícita**, nunca inferida da Conversa; na Conversa direta ela tem de ser a conta dona dela (`400` se não). Feed de status e lista de transmissão não são destinatários (`400`). Se a Conversa dada é a forma alternativa (`@lid`) de um endereço que tem Conversa de telefone, o Envio vai para a de telefone, e a saída diz qual foi usada no lugar de qual. A saída diz a conta e a Conversa; `--json` traz `configuracao`, `conversa` e `redirecionadaDe`.
- **`mensagens --favorito`** e **`--configuracao`** só valem no modo rede; no modo local a leitura os ignora.
- **`buscar --autor`** só vale no modo rede: o filtro por Pessoa do modo local é `--pessoa <id>`, e cada lado
  ignora a flag do outro (#1290).
- **`midia`:** o `content-type` da resposta é fixo por tipo de Anexo (imagem como `image/jpeg`, áudio como
  `audio/opus`, figurinha como `image/webp`, o resto `application/octet-stream`), e não o tipo MIME gravado
  (#1290).

## Comandos de escrita por rede

São os dois únicos que escrevem (e `envio estado` só consulta). O Inquilino vem da Chave, e o Envio
sai pela Configuração indicada.

| comando | o que faz | flags |
|---|---|---|
| `malote enviar` | Pede o **Envio** de uma mensagem (texto, imagem ou documento) | `--configuracao <apelido>`\* **um** de `--para <endereco>` ou `--conversa <id>`\*, e **um** de `--texto <t>`, `--imagem <caminho>` ou `--documento <caminho>` (imagem e documento aceitam `--texto` como legenda); `--identificador <uuid>` `--chave-em <VARIAVEL>` `--json` |
| `malote envio estado` | A contagem de Envios, ou o estado de um Envio | `[<identificador>]` `--chave-em <VARIAVEL>` `--json` |

- **`--identificador` torna a repetição segura.** O cliente gera um UUID, e repetir o pedido com o mesmo
  valor **não cria um segundo Envio**. Sem ele, o comando gera um UUID novo, e repetir depois de um timeout
  (código 7) **pode duplicar a mensagem**. No timeout, a mensagem do comando traz o identificador e o
  `malote envio estado <identificador>` que confirma o que aconteceu.
- `envio reprocessar` é **só local** (veja a referência do servidor).
- Grupo e mídia por rede têm prova de teste, mas ainda não têm prova de campo.

## Códigos de saída

O contrato para automação: o código diz a **classe** da falha.

| código | significado |
|---|---|
| 0 | consulta respondida |
| 2 | invocação errada: flag faltando, `--inquilino` no modo rede, comando local no modo rede |
| 3 | **credencial** recusada: ausente, inválida ou revogada (indistinguível, por desenho) |
| 4 | servidor inalcançável |
| 5 | erro do servidor, incluindo `504` e `503` (abaixo) |
| 6 | uso errado da API: `4xx` que não é `401` (cursor inválido, `--limite` inválido) |
| 7 | **tempo esgotado, resultado desconhecido**: repetir uma consulta é seguro; repetir um `enviar` é seguro só com o mesmo `--identificador`. O cliente desiste em 30 s por requisição, antes do prazo de 25 s do servidor se este for aumentado com `servir --prazo`. Hoje o estouro na leitura do **corpo** de uma consulta sai 1, não 7 (#1285) |

**`504` e `503` (código 5).** `504`: a consulta passou do prazo do servidor (25 s por padrão); **restrinja
os filtros** (período, remetente, tipo) e não repita a mesma consulta. `503` (com `retry-after`): servidor
ocupado, fila cheia ou subindo; tente de novo daqui a pouco, uma vez. Um Inquilino ocupa no máximo N−1
dos workers e metade da fila, então uma rajada de consultas pesadas atrasa as suas outras consultas,
não as dos outros.

## Para além da CLI

A CLI é uma camada fina sobre a **API HTTP**. Sem Node na máquina cliente, o `curl` com
`Authorization: Bearer <chave>` funciona; as rotas, os parâmetros e as respostas estão em
[Referência: a API HTTP por trás](../guias/cliente-e-agente.md#referência-a-api-http-por-trás).
