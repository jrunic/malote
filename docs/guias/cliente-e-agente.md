---
id: 202609160200
projeto: malote
tipo: guia
escopo: repo:malote
plataforma: "*"
status: ativo
dominios: [tecnologia]
descricao: "Guia — consultar o Acervo de uma máquina cliente: autenticação por Chave de Acesso, as quatro rotas, e como instruir um agente a usar a API"
tags: [guia, cliente, api, agente, http]
---

# Guia: consultar o Acervo de uma máquina cliente — e ensinar um agente

## Cliente × servidor: quem é o quê

São **duas máquinas com papéis diferentes**, e confundi-las é a origem de quase toda
pergunta de instalação:

| | **Servidor** (host 24/7) | **Cliente** (sua máquina de trabalho) |
|---|---|---|
| O que tem | **o dado todo** (Registro, Acervos, mídia, material) + os serviços (ouvinte, `servir`) | **só o código** do repositório + a Chave de Acesso |
| Guarda conversa? | Sim — e é o único lugar | **Não. Nada do Acervo vive aqui.** |
| Instalação | clonar + `npm ci` + unidades systemd ([guia do host](host-continuo-ouvinte-e-api.md)) | clonar + `npm ci` — sem serviço, sem base, sem pasta de estado |
| Como acessa o Acervo | direto no disco | **por rede, com a Chave** — nada é copiado para a cliente |
| Perde a máquina? | perde o dado — backup obrigatório ([guia de armazenamento](instalacao-e-armazenamento.md)) | perde nada: clona de novo e usa a chave de novo (ou emite outra) |

Consequência prática: **a máquina cliente não guarda conversa nenhuma** — nem em banco,
nem em cache. O que ela tem é o código que pergunta e a credencial que autoriza. É por
isso que um cliente não precisa de backup do Acervo, não precisa das pastas XDG do
produto, e não roda ouvinte nem servidor.

Esta guia cobre o lado cliente. O servidor inteiro está no
[guia do host contínuo](host-continuo-ouvinte-e-api.md).

## 1. Instalar a CLI na máquina cliente

O binário é o próprio repositório, rodando da fonte (sem build):

```bash
git clone https://github.com/jrunic/malote.git
cd malote
npm ci
npm link
```

O `npm link` é o que coloca `malote` no PATH — sem ele, `npm ci` sozinho deixa o
código instalado, mas nenhum comando `malote` disponível fora da pasta do
repositório. Sem privilégio para link global, rode direto pelo caminho do
próprio checkout: `./bin/malote conversas --limite 30`.

O que uma consulta por rede usa — duas variáveis de ambiente:

| variável | o que é |
|---|---|
| `MALOTE_SERVIDOR` | endereço do servidor (`https://malote.exemplo.net`) |
| `MALOTE_CHAVE_DE_ACESSO` | a Chave de Acesso — **a identidade da consulta** |

A chave é segredo: uma por consumidor (um por agente/aplicação), revogável no servidor.
Não a escreva em arquivo versionado, script commitado ou log. Com `--servidor <url>` você
declara o endereço por invocação, em vez de env.

Duas coisas que a máquina cliente **não** precisa:

- **nenhuma pasta do produto** — consulta por rede não abre base, não cria diretório, não
  lê XDG (`MALOTE_HOME`/`XDG_*_HOME` são assunto do servidor);
- **nenhuma unidade de serviço** — quem roda 24/7 é o servidor; a cliente só executa o
  comando quando alguém pergunta algo.

## 2. Os comandos

```bash
# Índice do Acervo: id, fonte, natureza, contagem, assunto, configuração
malote conversas --limite 30
malote conversas --busca "relatorio" --fonte whatsapp --coletiva
malote conversas --configuracao orlando        # so a Conversa daquela Configuracao
malote conversas --configuracao orlando --fonte whatsapp  # desempata apelido repetido em Fontes diferentes
malote conversas --fixada true --configuracao orlando  # so as fixadas NAQUELA Configuracao (marca, nao atribuicao)

# Quais Configuracoes existem (apelido + fonte) — antes de filtrar por uma
malote configuracao listar

# Conteúdo de uma conversa, com janela e página
malote mensagens --conversa <id> --limite 50
malote mensagens --conversa <id> --desde 2026-09-01 --ate 2026-09-15
malote mensagens --conversa <id> --favorito true --configuracao orlando  # so as favoritadas — SO EM MODO REDE (MALOTE_SERVIDOR setado)
# Paginação: a resposta traz `proximo` quando há mais; devolva-o:
malote mensagens --conversa <id> --antes "<cursor>"

# Últimas mensagens RECEBIDAS, através de todas as conversas
malote mensagens --direcao recebida --limite 10
malote mensagens --direcao recebida --fonte whatsapp --limite 10

# Busca no conteúdo, com filtros
malote buscar --texto "orçamento" --conversa <id> --desde 2026-09-01 --limite 50

# Bytes de um Anexo (foto/documento) — SO EM MODO REDE (MALOTE_SERVIDOR setado).
# Local, o Anexo já está em disco: leia o campo `caminho` de `mensagens --json`.
malote midia <anexoId> --saida ./foto.jpg

# Resolução de pessoa: texto entra, id sai (os outros comandos pedem o id)
malote pessoas --texto "Bail Organa"

# Participantes de uma conversa coletiva (opcional: posição em uma data)
malote participantes --conversa <id>
malote participantes --conversa <id> --em 2026-09-15

# Totais por fonte e natureza
malote relatorio
```

Datas: `AAAA-MM-DD` (dia, em UTC) ou instant completo `...Z`. `--desde`/`--ate` são
inclusivos. O `--antes` recebe o cursor `proximo` da página anterior — nunca um instante
montado à mão.

## 3. Códigos de saída (o contrato para automação)

| código | significado |
|---|---|
| 0 | consulta respondida |
| 2 | invocação errada (flag faltando, comando de escrita com `--servidor`) |
| 3 | **credencial** recusada — ausente, inválida ou revogada (indistinguível por desenho) |
| 4 | servidor inalcançável |
| 5 | erro do servidor |
| 6 | uso errado da API (4xx que não 401) |
| 7 | tempo esgotado — **resultado desconhecido**; repetir é seguro (somente leitura) |

## 4. Ensinar um agente

Bloco pronto para as instruções do agente (ajuste o endereço):

```markdown
## Consultar o Acervo de conversas

Use a CLI do malote, no modo rede. As variáveis `MALOTE_SERVIDOR` e
`MALOTE_CHAVE_DE_ACESSO` já estão no ambiente — a chave é SEGREDO: nunca a
escreva em arquivo, commit ou log, e nunca a passe adiante.

Comandos (todos somente leitura):
- `malote conversas [--busca T] [--fonte F] [--coletiva true|false] [--configuracao A] [--fixada true] [--limite N]` —
  índice; comece sempre aqui. `--configuracao` sozinho filtra por apelido (`malote
  configuracao listar` mostra o que existe) e só alcança Conversa DIRETA — coletiva
  pertence ao Inquilino inteiro, não a uma Configuração, e nunca casa esse filtro. Com
  `--fixada true`, `--configuracao` muda de sentido: passa a escopar a MARCA de fixada
  daquela Configuração, não a atribuição — por isso coletiva fixada aparece.
  `--fixada` exige `--configuracao` junto, e funciona local ou em modo rede.
- `malote configuracao listar` — lista as Configurações do Inquilino (apelido + fonte).
- `malote mensagens [--conversa <id>] [--desde D] [--ate D] [--limite N] [--direcao enviada|recebida] [--favorito true --configuracao A]` —
  conteúdo. Sem `--conversa`, atravessa todas as Conversas e Fontes do
  Inquilino, ordenado por recência por default — é o comando para "últimas
  mensagens recebidas". Com `--conversa`, ordena cronologicamente por
  default, como sempre. `--favorito` só existe com `--conversa` (precisa da
  Fonte da própria Conversa para resolver a Configuração sem ambiguidade) e
  só em modo rede; exige `--configuracao`.
- `malote buscar --texto T [--conversa <id>] [--desde D] [--ate D]` — busca no conteúdo.
- `malote pessoas --texto T` — resolve nome/endereço para `id`; os outros comandos
  pedem o id, nunca o nome.
- `malote participantes --conversa <id> [--em AAAA-MM-DD]` — quem estava na conversa.
- `malote relatorio` — totais por fonte e natureza.
- `malote midia <anexoId> --saida <arquivo>` — grava os bytes do Anexo (foto/documento)
  no caminho local dado. Só existe em modo rede. **Não imprime** os bytes — não há
  forma de "ler" mídia por esta CLI, só salvar em disco e abrir por fora. Anexo do
  tipo vídeo é recusado (não suportado nesta rota).

Regras:
- Paginação: quando a resposta traz `proximo`, devolva-o em `--antes` na próxima
  chamada. Não monte cursor à mão.
- Código de saída 3 = problema com a credencial: reporte, não tente outra rota.
  Código 7 = resultado desconhecido: repetir é seguro.
- O Inquilino vem da chave — não existe parâmetro de inquilino.
- A API é somente leitura; escrita nem existe no modo rede.
```

---

## Referência: a API HTTP por trás

A CLI fala estas rotas — o `curl` continua válido quando não houver Node na máquina
cliente. Toda consulta apresenta `Authorization: Bearer <chave>`; credencial ausente,
inválida e revogada respondem o mesmo `401` de corpo vazio (não distingue, para não
revelar a existência de Inquilinos alheios); rota desconhecida com chave válida responde
`404`. Somente `GET`.

| rota | parâmetros opcionais | resposta |
|---|---|---|
| `GET /conversas` | `fonte`, `coletiva`, `busca`, `pessoa`, `limite`, `configuracao`, `fixada` | `{ conversas: [{ id, fonte, coletiva, assunto, mensagens, configuracao }] }` |
| `GET /mensagens` | `limite`, `desde`, `ate`, `autor`, `fonte`, `direcao`, `antes`, `ordem` | `{ mensagens: [...], proximo? }` |
| `GET /conversas/<id>/mensagens` | `limite`, `desde`, `ate`, `autor`, `antes`, `ordem`, `direcao`, `favorito`, `configuracao` | `{ mensagens: [...], proximo? }` |
| `GET /buscar?texto=` | `conversa`, `autor`, `desde`, `ate`, `limite` | `{ mensagens: [...] }` |
| `GET /pessoas?texto=` | — | `{ pessoas: [{ id, nome, identificadores }] }` |
| `GET /conversas/<id>/participantes` | `em` | `{ presenca: {...} }` |
| `GET /relatorio` | — | `{ relatorio: { conversas, mensagens } }` |
| `GET /chaves` | — | `{ chaves: [...] }` — as chaves do próprio Inquilino |
| `GET /configuracoes` | — | `{ configuracoes: [{ apelido, fonte }] }` |
| `GET /midia/<anexoId>` | — | o **arquivo** do Anexo, com `content-type` próprio — não é JSON |

`GET /midia/<anexoId>` foge do padrão das demais: sucesso é `200` com os bytes crus
(não `{ ... }`). `404` vazio cobre inexistente, de outro Inquilino e sem bytes
disponíveis (`nunca-obtido`/`descartado`, ou arquivo que sumiu do disco) —
indistinguíveis por desenho, mesma razão das demais rotas. **`415`** é o único sinal
desta rota que não é o 404 genérico: corpo `{ erro }` nomeando o tipo, reservado a
Anexo do tipo `video` — a posse já foi confirmada antes desse sinal disparar, então
nomear o tipo não vaza nada que a posse já não tivesse revelado.

`configuracao` em `/conversas` é o **apelido**, não o id interno — em caso de apelido
repetido entre Fontes diferentes (ex.: `orlando` existindo em `whatsapp` e `instagram`),
informe `fonte` junto ou a rota responde `400` nomeando a ambiguidade. `configuracao`
no campo de saída é `null` para Conversa coletiva, sempre — ela não tem Configuração.
Com `fixada=true`, `configuracao` escopa a Marca, não a atribuição — é o que permite
achar coletiva fixada. `favorito` em `/conversas/<id>/mensagens` exige `configuracao`
junto; a Fonte usada para resolver o apelido é a da própria Conversa (nunca ambígua),
não uma que o chamador precise informar.

`GET /mensagens` atravessa todas as Conversas e Fontes do Inquilino — é a
consulta para "últimas mensagens", sem escolher uma Conversa antes.
`direcao` filtra por quem começou a Mensagem (`enviada` pelo Titular ou
`recebida` de outra Pessoa). Sem `ordem` explícito, o default aqui é
`recentes` — o oposto do default de `/conversas/<id>/mensagens`, que
continua `cronologica` — porque o propósito desta rota é justamente
recência. Vazio é resposta legítima (`200`, lista vazia), nunca `404`: não
há um recurso singular cuja existência esteja em jogo.

Limites conhecidos: conversa vazia e inexistente respondem igual (`404`) em
`/conversas/<id>/mensagens` — distinguir exigiria confirmar existência, e confirmar
existência é o que não pode vazar; `400` para parâmetro malformado é invocação errada, não
"não existe".
