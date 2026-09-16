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
```

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
# Índice do Acervo: id, fonte, natureza, contagem, assunto
malote conversas --limite 30
malote conversas --busca "relatorio" --fonte whatsapp --coletiva

# Conteúdo de uma conversa, com janela e página
malote mensagens --conversa <id> --limite 50
malote mensagens --conversa <id> --desde 2026-09-01 --ate 2026-09-15
# Paginação: a resposta traz `proximo` quando há mais; devolva-o:
malote mensagens --conversa <id> --antes "<cursor>"

# Busca no conteúdo, com filtros
malote buscar --texto "orçamento" --conversa <id> --desde 2026-09-01 --limite 50

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
- `malote conversas [--busca T] [--fonte F] [--coletiva true|false] [--limite N]` —
  índice; comece sempre aqui.
- `malote mensagens --conversa <id> [--desde D] [--ate D] [--limite N]` — conteúdo.
- `malote buscar --texto T [--conversa <id>] [--desde D] [--ate D]` — busca no conteúdo.
- `malote pessoas --texto T` — resolve nome/endereço para `id`; os outros comandos
  pedem o id, nunca o nome.
- `malote participantes --conversa <id> [--em AAAA-MM-DD]` — quem estava na conversa.
- `malote relatorio` — totais por fonte e natureza.

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
| `GET /conversas` | `fonte`, `coletiva`, `busca`, `pessoa`, `limite` | `{ conversas: [{ id, fonte, coletiva, assunto, mensagens }] }` |
| `GET /conversas/<id>/mensagens` | `limite`, `desde`, `ate`, `autor`, `antes`, `ordem` | `{ mensagens: [...], proximo? }` |
| `GET /buscar?texto=` | `conversa`, `autor`, `desde`, `ate`, `limite` | `{ mensagens: [...] }` |
| `GET /pessoas?texto=` | — | `{ pessoas: [{ id, nome, identificadores }] }` |
| `GET /conversas/<id>/participantes` | `em` | `{ presenca: {...} }` |
| `GET /relatorio` | — | `{ relatorio: { conversas, mensagens } }` |
| `GET /chaves` | — | `{ chaves: [...] }` — as chaves do próprio Inquilino |

Limites conhecidos: sem paginação fora de `/conversas/<id>/mensagens`; conversa vazia e
inexistente respondem igual (`404`) — distinguir exigiria confirmar existência, e confirmar
existência é o que não pode vazar; `400` para parâmetro malformado é invocação errada, não
"não existe".
