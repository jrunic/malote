---
id: 202608241253
projeto: malote
tipo: index
escopo: repo:malote
plataforma: "*"
status: ativo
descricao: Padrões técnicos canônicos e restrições do repo malote — carga default da sessão.
tags: [contexto, dev-skills, Node]
---

# CONTEXTO.md — malote

## Propósito

Arquivo local das conversas de uma pessoa — de plataformas diferentes — num formato que humano e agente consultam. Lê, guarda e cruza; não envia mensagem.

## Onde o trabalho acontece

**O trabalho de desenvolvimento acontece fora deste repositório**, em
`13-processos/manter-malote/` — é lá que a sessão abre
(pasta de trabalho do autor).

| Artefato | Lar canônico |
|---|---|
| Roadmap de ciclos, spec, plano | `13-processos/manter-malote/` |
| Arquivo de apoio de tarefa, diário de sessão | `13-processos/manter-malote/` |
| Discussão de negócio | `13-processos/manter-malote/01-discussoes/` |
| **Código, testes, migrations** | **este repositório** |
| **Documentação do produto** (Diátaxis) | **este repositório**, `docs/` |
| **ADR de contrato** | **este repositório**, `docs/decisoes/` |
| **Modelo de domínio** | **este repositório**, `docs/dominio/` |
| **README, CHANGELOG, GLOSSARIO, CONTEXTO** | **este repositório**, raiz |

**As skills leem esta seção** em vez de inferir por visibilidade. Repositório
que não declara deixa a skill sem informação, e sem informação ela erra.

## Agente padrão

**Tech** — agente responsável por este repositório. Outros agentes podem ler e contribuir;
mudança estrutural passa por ele.

## Stack

- **Linguagem:** TypeScript sobre Node, ESM, `strict: true`
- **Versão de Node:** piso declarado em `engines` (`>=22`). **Este repo não pina versão** — ver Decisões Locais Divergentes
- **Banco:** SQLite (um Acervo por Inquilino)
- **Deploy:** host próprio, 24/7 — ouvinte e API. Instalável por terceiros

## Padrões Técnicos

### Naming

Estilo pela convenção da comunidade TypeScript/Node; **vocabulário pelo `GLOSSARIO.md`**:

- **Arquivos:** kebab-case
- **Funções e variáveis:** camelCase
- **Tipos, classes e interfaces:** PascalCase
- **Constantes:** UPPER_SNAKE

**Termo de domínio no código é o termo do glossário, em pt-BR** — `Inquilino`, `Conversa`, `Mensagem`, `Anexo`, `Presenca`, `Acervo`. Não existe `Tenant`, `Conversation`, `Message` nem `Attachment` neste código: são sinônimos, e sinônimo é exatamente o que o glossário existe para impedir. A linguagem ubíqua vale no documento e no identificador, ou não é ubíqua.

Fora do domínio — verbos técnicos, utilitários, tipos de infraestrutura, nomes vindos de biblioteca — vale o inglês da comunidade. A fronteira é o glossário: se o termo está lá, é pt-BR.

Acento não entra em identificador: `Presenca`, `Participacao`, `Referencia`. A prosa mantém o acento.

### Linguagem

- **Nome do repo e do binário:** `malote` — ver Decisões Locais Divergentes
- **Identificadores no código:** termo de domínio em pt-BR pelo glossário; o resto em inglês — ver Naming
- **Comentários inline:** pt-BR
- **Documentação:** pt-BR
- **Commits:** tipo conventional em inglês (`feat:`, `fix:`...), descrição em pt-BR

### Segredos

- **Onde:** `.env` local, nunca commitado, com `.env.example` versionado.
- **Por quê não um cofre externo:** este é um produto instalado por terceiros. Quem instala não tem a infraestrutura de quem escreveu — o produto não pode depender dela.

### Bibliotecas

- **Política:** **requer ADR.** Repo público é superfície de supply chain; dependência nova entra com justificativa registrada em `docs/decisoes/`.
- **Atuais:** nenhuma. O código nasce no ciclo 1.

### Estrutura

```
CONTEXTO.md GLOSSARIO.md — contratos vivos (raiz)
docs/decisoes/  — ADRs locais
docs/dominio/   — modelo de domínio
docs/{tutoriais,guias,referencias,explicacoes}/ — quadrantes Diátaxis (ADR 20260620)

src/         — [descrever]
tests/         — [descrever]
```

Roadmap, specs, planos e diários vivem em `13-processos/manter-malote/`.

### Testes

- **Framework:** `node --test` com `tsx` — runner nativo, zero dependência extra
- **Pasta:** `tests/`, mais `*.test.ts` ao lado do código quando o teste é de unidade
- **`npm test` compila antes de rodar.** Ele encadeia `npm run typecheck` (`tsc -p tsconfig.check.json`, que cobre `src/` **e** `tests/`) com a suíte. Erro de tipo ou de sintaxe para a execução ali, e a suíte não chega a rodar. Medido em 30/08/2026 com o defeito histórico da crase em template literal de SQL: **9 linhas de saída e um `error TS1005` com linha e coluna**, contra 60 testes falhos e uma parede de pilhas repetidas antes
- **São dois `tsconfig` de propósito.** `tsconfig.json` é o BUILD — `rootDir: src`, emite `dist/`, e por isso não pode incluir `tests/`. `tsconfig.check.json` é a VERIFICAÇÃO, com `noEmit` e os dois diretórios. Ao acrescentar pasta de código, acrescentar nos dois

### Build/Run

- **Setup:** `npm install`
- **Testes:** `npm test`
- **Run:** `npm run dev`
- **Build:** `npm run build`

### Lint/Format

- **Lint:** `npm run lint` (eslint)
- **Format:** `npm run format` (prettier)
- **Nota:** o repo de origem não tinha linter. Num repo público, tem.

### CI e versão publicada

- **O portão é o CI**, não uma pessoa: `.github/workflows/ci.yml` roda `npm ci`,
  `npm test` e `npm run lint` em **Node 22, no Linux**, em pull request e em push
  para `main`. Linux porque a suíte só tinha sido exercitada em macOS, e este repo
  já teve suíte macOS-only cujo desfecho não foi vermelho — foi **vacuidade**.
- **Toda release marca tag `vX.Y.Z`** no commit publicado, e a entrada
  correspondente entra no `CHANGELOG.md` **antes** do merge. A tag é o que dá
  âncora ao changelog e o que permite a quem instala de fora dizer qual versão
  roda, ler o que mudou entre duas e relatar defeito. SHA de branch não serve:
  é ruído para quem não tem o repositório.
- **`malote --versao` lê o manifesto**, nunca uma constante — número repetido em
  dois lugares diverge em silêncio. Ele é despachado **antes** de abrir o
  Registro, de propósito: quem instala roda isso antes de existir instalação, e
  despachá-lo depois criaria a base e gravaria Operação para responder um número
  que não depende de nada disso. Há teste que mede o efeito no disco, e ele morre
  se a ordem for invertida.

## Leitura obrigatória antes de spec/plano

- `docs/arquitetura.md` — mapa estrutural
- `GLOSSARIO.md` — vocabulário do domínio (usar estes termos, nunca sinônimos)
- `docs/dominio/` — modelo formal dos contextos que o trabalho toca

## Restrições

- **Processo de fundo dentro de `malote servir` (o worker de transcrição, e qualquer futuro
  análogo) NUNCA abre o Acervo para escrita sem checar a versão gravada primeiro.**
  `abrirAcervo` migra a base — e um processo que atende requisição de fora não pode ter esse
  poder, pelo mesmo motivo que a leitura por rede abre somente-leitura. Sem a checagem
  (`versaoDoAcervoEmDisco` antes de `abrirAcervo`), o primeiro boot pós-deploy migraria a
  base sozinho, antes de qualquer Ação Documentada — repetindo o quase-incidente da v0.21.0
  por desenho, não por acidente. Acervo em forma divergente é pulado e relatado, nunca
  migrado pelo worker; quem migra continua sendo `malote acervo migrar`/o ouvinte.
- **`anexos.caminho` é RELATIVO ao Destino de Mídia do Inquilino, por desenho — o
  Destino nunca entra no Acervo (mesma razão de `midia trazer`/`midia reprocessar`).
  Todo consumidor que toca o arquivo em disco resolve via `lerDestinoDeMidia` + `join`
  ANTES de abrir o arquivo.** Medido em 01/10/2026 (#1106), Acervo real: 20 de 20
  Transcrições falhavam com "No such file or directory" apesar do arquivo existir — o
  worker de transcrição era o único consumidor de disco que pulava esse join, porque
  `malote servir` roda do diretório do checkout, nunca do Destino de Mídia. A guarda
  de teste é não deixar `caminho` de fixture nascer absoluto por conveniência — foi
  assim, em `tests/transcricao-worker.test.ts`, que o defeito ficou invisível por um
  ciclo inteiro (#1070/#1068/#1069).
- **O modo REDE é fail-closed e a guarda morre ANTES de qualquer I/O.** Só os comandos de
  leitura declarados em `COMANDOS_DE_REDE` consultam por HTTP; comando de escrita com
  `--servidor` recusa **antes de abrir Registro ou Acervo** — invocação errada não nasce
  `registro.db` (testado com instalação vazia). A resolução de modo é global: nunca desce
  para dentro de handler.
- **Cliente HTTP mora em `src/cli/`, nunca em `src/rede/`.** `src/rede/` é a zona do
  baileys e a fronteira proíbe `cli` importá-la — a guarda pegou a violação no commit em
  que nasceu (ciclo 21).
- **Paginação de Mensagens usa cursor COMPOSTO `(ocorrida_em, id)`, opaco.** O instante
  sozinho não pagina: instantes iguais pulam ou repetem. O consumidor devolve o token
  `proximo` que recebeu; a rota trata token inválido como **400**, nunca como primeira
  página. O oráculo: três Mensagens no mesmo instante, limite 2, virar a página.
- **Termo do usuário em `LIKE` é literal** — `%` e `_` escapados com `ESCAPE`; busca que
  interpreta curinga é busca errada em silêncio.
- **A CLI no modo rede tem código de saída POR CLASSE de falha** (3 credencial, 4 conexão,
  5 servidor, 6 uso, 7 timeout com resultado desconhecido) — é o que permite agente
  tratar erro de consulta deterministicamente. `--chave` continua sendo Chave de Operador;
  a Chave de Acesso vai só por env.
- **A saída default de `ouvinte estado` é contrato com quem vigia a instalação.** O health-check passa a
  linha **inteira** para `date -u -d`; qualquer linha a mais e a conversão falha, o instante
  vira zero, e a idade calculada vira alarme de silêncio em todas as contas. Sinal novo entra
  por `--json`, nunca na saída default. Medido em 09/09/2026, lendo o consumidor antes de
  mexer.
- **Grava no Acervo antes de tirar do Derrame, nunca o contrário.** Invertido, morrer no meio
  apaga o que nunca entrou; nesta ordem o pior caso é repetição, e a unicidade de
  `(fonte, id_externo)` a descarta. Vale para qualquer consumo de fila persistida.
- **Recurso com estado exclusivo tem um dono por vez.** `reprocessar` recusa com ouvinte no
  ar — os dois escrevem no Derrame, e o lote derramado entre a leitura e o descarte some sem
  ter sido gravado. O guard olha o unit **e** o processo solto, porque o repareamento sobe
  `malote ouvir` fora do unit. Sem a ferramenta que mede, ele responde que **há** escritor:
  ausência de ferramenta não é estado benigno.
- **Disputa de escrita NÃO é recusa, e o `catch` que a trata é estreito.** `SQLITE_BUSY` é
  infraestrutura; recusa é sobre **dado** que o modelo não aceita. O discriminante é
  `ehBancoOcupado` em `nucleo/erro-de-banco.ts`, e ele olha o **código** do erro, nunca a
  mensagem. Quem trata é a camada de comando (`cli/derrame.ts`), que grava o evento cru em
  `<raiz>/ouvinte/<conta>/nao-gravados.jsonl` e o recupera por `malote ouvinte reprocessar`.
  Medido em 08/09/2026: o `catch` por evento de `ao-vivo.ts` engolia `SQLITE_BUSY` e o
  contava como `recusado` — a Mensagem se perdia em silêncio. Qualquer `catch` largo em
  caminho de escrita reintroduz isso.
- **Aumentar `busy_timeout` não resolve disputa longa.** `better-sqlite3` é síncrono e o
  timeout bloqueia a **thread**: esperar minutos congelaria o WebSocket do ouvinte e o
  derrubaria por outro caminho. O valor está explícito em `nucleo/acervo.ts` com o mesmo
  número que já valia (5.000 ms, que era o default da biblioteca, não uma decisão do
  produto). Quem protege é o derrame.

- **Conversa direta pertence a UMA Configuração de Adaptador; coletiva pertence ao Inquilino.**
  A chave de unicidade de `conversas` são **dois índices parciais**, um por natureza — e não
  uma chave de três colunas com valor anulável. O SQLite trata `NULL` como distinto de
  `NULL`, então `UNIQUE (fonte, id_externo, configuracao_id)` deixaria passar **duas coletivas
  idênticas em silêncio**, que é exatamente o defeito que a restrição existe para impedir. O
  mutante está escrito em `tests/conversa-por-configuracao.test.ts`: trocar os dois índices
  pela chave anulável tem de derrubar o teste da coletiva duplicada.
- **A porta `registrarConversa` recusa quatro coisas, e nenhuma delas é disciplina do
  chamador:** direta sem Configuração, coletiva com Configuração, Configuração de outra Fonte,
  e endereço que já existe com a **outra natureza**. A última nasceu do lookup ramificado — o
  `SELECT` antigo por `(fonte, id_externo)` absorvia desencontro de natureza, e o novo não
  absorve: sem a guarda, o mesmo endereço viraria duas Conversas, uma em cada índice parcial,
  sem nada reclamar. Medido: importação classifica coletiva por `ZSESSIONTYPE != 0` e recepção
  ao vivo por `endsWith('@g.us')`, e para `<número>@status` os dois discordam (tarefa #826).
- **Passo de migração que precisa de dado fora do Acervo declara `exigeContexto` e RECUSA sem
  ele.** As Configurações vivem no Registro, que é outro arquivo, e migrar acontece ao **abrir**
  o Acervo — quem abre nem sempre tem o Registro. Escolher um valor por conveniência é o que a
  máquina não faz; a recusa nomeia `malote acervo migrar`, que é o único caminho com as duas
  bases. Corolário: `abrirAcervo` passa `inquilinoId` **undefined** para a trilha do Acervo, que
  não tem essa coluna — só a do Registro tem.
- **`importar` e `ouvir` exigem `--configuracao <apelido>`, sem default.**
  `resolverConfiguracao` **cria** quando não acha; enquanto o default era `padrao` e a
  Configuração de produção também, adivinhar acertava por coincidência. Desde o rename de
  08/09/2026 não acerta mais: adivinhar criaria Configuração paralela em silêncio, e as
  Conversas diretas dela nasceriam num fio à parte. O `ouvir` usa `configuracaoPorApelido`, que
  busca e **nunca cria** — no caminho ao vivo, criar significa gravar na conta errada sem
  alarme.

- **SQL se compila pela porta `preparar`, nunca por `db.prepare` direto.** `Acervo`, `Registro`
  e `AlvoDeTrilha` expõem `preparar`, que compila uma vez por conexão e reusa. Compilar por
  chamada vaza memória que a coleta de lixo **não alcança**: um `sqlite3_stmt` vive fora do
  heap do V8 e o `better-sqlite3` mantém cada statement referenciado na conexão para
  finalizá-lo no `close()`. Medido em 07/09/2026: **~3,8 KB de RSS por compilação**, com o
  `heapUsed` imóvel — o que faz o defeito não parecer problema de memória. Na importação eram
  4 statements por Mensagem; na conversão do acervo, 7,28 — **26 KB por Mensagem**, e um
  processo morto pelo OOM killer com 6,58 GB. A varredura canônica é
  `tests/sem-prepare-fora-da-porta.test.ts`, com o padrão tolerante a quebra de linha e a
  lista de exceções justificada uma a uma. **Quem introduzir `iterate`, `pluck`, `raw`,
  `expand` ou `bind` precisa de statement próprio** — os cinco guardam estado no statement, e
  a segunda chamada herdaria o da primeira.

- **A classificação de conteúdo do adaptador de recepção é MEDIDA, nunca deduzida.** O evento
  traz um objeto de conteúdo cujas chaves não têm hierarquia declarada: umas são o assunto da
  Mensagem, outras **acompanham**. Acrescentar chave a `ACOMPANHAM` ou a `VIRAM_MENSAGEM`
  sem medir contra captura real é adivinhar — e o custo de errar é Mensagem descartada em
  silêncio, no caminho ao vivo. O critério que separa as duas é a **razão entre aparecer
  acompanhando e aparecer sozinha**: em 04/09/2026 a chave de distribuição de chave de grupo
  media 27 para 1, e classificá-la como assunto descartava 40% das conversas coletivas. A
  suíte estava verde o tempo todo.


- **Vazio conta como AUSENTE em campo da Fonte, e `??` não serve.** A coalescência
  nula só cai para o segundo operando quando o primeiro é `null`; a Fonte grava `''`
  para dizer *não tem*. Medido em 13/09/2026: `ZCONTACTNAME ?? ZFIRSTNAME` devolvia
  `''` na maioria das linhas, e o membro ficava sem nome — dos 9.286 membros com
  nome no material, só **1.071** o receberam. A correção é uma função que trata `''`
  como `null`. **E a fixture tem de gravar vazio**, não só ausente: `material-falso.ts`
  escrevia `?? null`, e por isso nenhum teste via o caso. O teste novo falha com o
  código anterior — era o que faltava.
- **A Autoridade da Atribuição de Nome fica FORA da chave de unicidade, e sobe de
  forma monótona.** Com ela na chave, reimportar o material criaria uma linha
  declarada ao lado da indeterminada que já existe, e o histórico mostraria o mesmo
  nome duas vezes em milhares de endereços. Fora da chave, registrar de novo
  **atualiza**: `titular` sempre grava, `terceiro` só grava sobre indeterminado.
  Resolver indeterminado para `terceiro` **baixa** o rank de desempate (1 → 0) e
  mesmo assim é correto — o que sobe é o conhecimento, não a confiança. Tem teste
  próprio para ninguém "consertar" isso como defeito depois.
- **Duas regras de nome, duas casas, e confundi-las trava a execução.** A recusa de
  **nome que repete o próprio endereço** (comparação mecânica de dígitos) fica no
  **núcleo** (`nome-do-endereco.ts`) — nasceu no Adaptador de WhatsApp e subiu quando
  a porta de remoção passou a precisar dela também. A **normalização de marca
  invisível** fica na **porta do núcleo** — reconhecer que a segunda escrita é o
  mesmo nome exige consultar o que já está gravado, e a unicidade do banco é por
  texto exato: marcado e desmarcado são strings diferentes, então a linha gêmea
  nasce sem nada reclamar.
- **Normalizar é para COMPARAR, nunca para reescrever.** O texto gravado continua
  sendo o que a Fonte entregou. O par de testes é o desenho: um prova que a segunda
  escrita não cria linha, o outro **lê de volta** e prova que as marcas ficaram. Sem
  o segundo, normalizar na escrita passaria no primeiro.
- **"Comparar dígitos serve a qualquer Fonte" tem limite, e o nono dígito brasileiro
  mora do lado de fora dele.** `nome-do-endereco.ts` (núcleo) já dizia, desde que
  nasceu: "traduzir a forma escrita do número na forma do endereço é vocabulário de
  Fonte" e não deveria subir. Medido em 30/09/2026 (#1101): 1.110 de 1.110 nomes
  `+55...` que a comparação de sufixo/prefixo do núcleo deixava passar tinham o nono
  dígito móvel (2012) inserido no MEIO do número — nem sufixo nem prefixo alcançam
  isso. A correção fica no ADAPTADOR (`nome-repete-numero-br.ts`, WhatsApp), que
  ENVOLVE a função do núcleo sem alterá-la. Duplica em parte o que
  `contatos/telefone.ts` já resolve para o catálogo — deliberado: adaptador não
  importa adaptador (só `src/cli` compõe mais de uma Fonte), e o caso aqui (comparar
  dois valores já conhecidos) não precisa da máquina de gerar variante para busca,
  que existe lá só para não casar com o número de OUTRA pessoa.
- **Nome vindo de biblioteca de terceiro não é nome só por não ser vazio.** O
  WhatsApp dispara `contactAction` de app-state também para contato nunca nomeado, e
  `fullName` vem com um valor-placeholder em vez de ausente — medido em 30/09/2026
  (#1101): 58% de TODAS as Atribuições `titular`/`whatsapp` do Acervo real são essa
  forma (`+EAA=` sozinho é 81% do lixo em identificadores sem Pessoa), com assinatura
  de sentinela fixo (mesmo texto repetido em massa, comprimento sempre ≡1 mod 4 —
  prefixo `+` mais um bloco base64 válido), não corrupção de parsing. `estado-ao-vivo.ts`
  recusa pela FORMA (`pareceValorSentinela`) antes de gravar — 14 Pessoas já exibiam
  esse lixo como nome corrente antes da correção, e a limpeza do que já está gravado
  ainda não existe (ver Pendências).
- **Trabalho de disco no caminho de SUBIDA do ouvinte pode travar a subida — e
  travou.** Medido no Linux em 13/09/2026: `mkdirSync(dir, { recursive: true })`
  sobre um caminho patológico do sistema de arquivos virtual **não lança e não
  retorna**. Pendura. O CI ficou 30 minutos preso na suíte, e no macOS o mesmo
  código falhava limpo porque `/proc` não existe lá — verde em segundos.
  O que abre a captura roda antes de o ouvinte conectar: um travamento ali é o
  ouvinte que nunca sobe, por causa de um diagnóstico desligado por padrão.
  **Criação de diretório é pré-condição do operador, não trabalho do produto na
  partida.** Há teste que exige que abrir NÃO crie pasta.
- **Verificação contra alvo que se MOVE usa contenção, nunca igualdade.** O
  ouvinte escreve durante um backup: `VACUUM INTO` tira instantâneo consistente
  no instante T e o original é lido em T+minutos. Exigir contagem igual reprova
  toda cópia boa — medido em 13/09/2026, a primeira versão da verificação
  acusou duas tabelas divergentes numa cópia perfeita, porque 53 Mensagens
  chegaram enquanto ela era escrita. O invariante é **a cópia estar contida no
  original**: linha a mais no original é o mundo tendo andado; linha a mais na
  cópia seria corrupção.
- **Mutante que sobrevive por EQUIVALÊNCIA se documenta no código, com a
  medição.** Três nesta casa em 13/09/2026: `ZSTARRED` só assume nulo, zero e um
  nos dois materiais reais, então ler por coerção ou por igualdade explícita dá
  o mesmo; `favorito?: boolean` não distingue `=== true` da forma frouxa em
  input nenhum; e afrouxar a checagem de tipo na leitura do Retrato é barrado
  pelo **compilador**, não por teste. Sem isso escrito ao lado, a próxima sessão
  gasta um teste tentando matar o que nenhum teste separa.
- **A remoção de Atribuição inválida classifica endereço-repetido PRIMEIRO.** Só
  depois marca-duplicata, e essa só remove se sobrar uma irmã que não vá ser
  removida também. Invertido, as linhas que são **as duas coisas** seguram uma à
  outra como irmã e nenhuma sai — eram 595 no acervo real.

Hard limits sempre relevantes durante a sessão.

- **Runner de testes canônico:** `npm test`
- **Idioma da saída para humano:** pt-BR
- **Comentários inline:** pt-BR
- **Nome do repo e do binário:** `malote`, nome comercial próprio, sem prefixo de organização nem de ferramenta interna.
- **Nada neste repo nomeia pessoa real, cliente, host ou caminho de máquina do autor** — em código, fixture, comentário, exemplo e mensagem de commit. Dado de exemplo é sintético
- **Nenhum caminho de arquivo do acervo contém dado pessoal** — invariante do agregado Anexo; foi defeito real no repo de origem
- **O núcleo não nomeia ferramenta.** `jid`, `lid`, `handle`, `resource_name`, `etag` são vocabulário de Adaptador e não aparecem em agregado do núcleo
- **Tudo é escopado a Inquilino.** Nenhuma consulta atravessa Inquilino — nem como opção, nem sob flag
- **Só `src/nucleo/` e `src/registro/` tocam em tabela.** Adaptador e CLI usam as portas; precisando de leitura que não existe, a porta nasce no núcleo — não um `db.prepare` no chamador. Tem histórico: a dívida foi paga em duas etapas (ciclos 4 e 13) e **voltou no meio**, porque o ciclo 9 escreveu um `SELECT 1 FROM conversas` na CLI depois de a classe ter sido declarada quitada nos adaptadores. A varredura é `perl -0ne 'while (/(\\w+)\\.db\\s*\\n?\\s*\\.prepare/g) { print "$ARGV\\n" }' $(find src -name '*.ts' -not -path 'src/nucleo/*' -not -path 'src/registro/*')`, e o esperado é vazio. **Ela atravessa quebra de linha de propósito, e a versão anterior não atravessava** — `grep '\.db\.prepare'` casa numa linha só, e o formatador quebra a cadeia em `acervo.db` / `.prepare(...)` quando ela passa da largura máxima. Medido em 01/09/2026: uma violação real, escrita no ciclo 14, passou invisível pela varredura antiga
- **Adaptador preserva o registro original INTEIRO, e não escolhe colunas.** Mensagem, Conversa, Participação e Anexo têm `bruto`; quem lê a Fonte grava a linha como ela veio (`SELECT *`, BLOB em base64, nulo omitido). Enumerar colunas é decidir hoje o que será útil depois — e foi assim que o produto anterior ficou com 1.007.822 mensagens de payload nulo, irrecuperáveis. Exceção declarada: participante de Conversa **direta** é derivado e não tem linha de roster, então nasce sem `bruto`
- **O DDL de um passo de migração é fotografia congelada, e nunca importa do schema fresco.** Parece duplicação e não é: quando um passo futuro alterar a tabela que outro criou, o antigo tem de continuar criando a forma de **então**, senão a cadeia deixa de reconstruir a história. Quem mantém a duplicação honesta é `tests/equivalencia-de-forma.test.ts` — base migrada por passos contra base criada do zero, comparadas por **estrutura** (`table_info`, `index_list`, `foreign_key_list`, gatilhos), nunca pelo texto de `sqlite_master.sql`, que difere por cosmética. **A base do piso também é fotografia congelada** (`tests/ajuda/{acervo,registro}-no-piso.ts`, extraídas do commit de linha de base): fabricá-la derivando do schema corrente contamina os dois lados da comparação, e foi medido em 01/09/2026 que o teste passa com o defeito presente. Ao acrescentar tabela ou coluna ao schema, escrever o passo junto — sem ele o teste de equivalência reprova, e é essa a intenção
- **Endereço se grava na forma CANÔNICA, sempre — resolvido antes de escrever.** Uma Fonte pode entregar o mesmo destinatário em mais de uma forma. A canônica é a que o material exportado grava, e é a que o catálogo e as Pessoas usam; a outra se traduz por `resolverEndereco` **antes** de virar `id_externo` de Conversa ou `valor` de Identificador. Gravar a forma alternativa cria uma segunda identidade para quem já está no acervo — medido em 02/09/2026: 18.653 Identificadores e 241 Conversas nasceram assim. A ordem não é livre: quem aprende correspondência tem de aprendê-la **antes** do laço que escreve endereço. E o valor é o endereço **inteiro**, com o separador — 5.027 dos 5.171 Identificadores do acervo real guardam assim, e cortar em dígitos reintroduz a duplicação pelo formato.
- **`tsx` é dependência de RUNTIME, e não de desenvolvimento — não mover de volta.** O produto roda **da fonte** no host, sem passo de build: `node --import tsx src/cli/index.ts`. Medido em 03/09/2026, contra o `package-lock.json` real: `npm ci --omit=dev` — que é como uma instalação de produção faz — remove `tsx` **e** `typescript`, e aí `npm run build` sai **127** com `tsc: command not found`; o host fica com um repositório que não sabe se executar, porque `dist/` é ignorado pelo git e não vem no pull. Salvar o caminho do build exigiria a árvore completa no host: **143 pacotes contra 85**, 68% a mais de superfície, dentro da própria política que existe para reduzi-la. Com `tsx` em `dependencies` a árvore de produção fica em **85** e a invocação foi verificada de ponta a ponta. Efeito colateral aceito e nomeado: sem build no host, nada lá verifica que o código compila — o portão do compilador é o `npm test` desta máquina, que roda `tsc` antes da suíte, e `production` só recebe o que passou por ele.
- **`bin/malote` resolve o próprio diretório por `import.meta.url`, nunca por CWD.**
  `node --import tsx` resolve o pacote `tsx` pelo CWD do **processo**, não pelo
  caminho do script — medido em 16/09/2026: invocar `node --import tsx <caminho
  absoluto>/src/cli/index.ts` de fora do repositório falha com
  `ERR_MODULE_NOT_FOUND: Cannot find package 'tsx'`, mesmo com o caminho do script
  correto. `bin/malote` contorna isso fixando `cwd` do processo filho na raiz do
  repositório antes de invocar. `tests/bin-malote.test.ts` guarda o efeito de fora:
  spawna `bin/malote` com `cwd` em `os.tmpdir()`.

- **A biblioteca de recepção entra por UM portão, e por import dinâmico.** `src/adaptadores/whatsapp/conexao.ts` é o único arquivo autorizado a alcançá-la, e nem ele pode importá-la estaticamente: import estático carrega os 120 pacotes da árvore em **todo** comando — `malote conversas` incluso — e faz o produto inteiro parar de subir no dia em que a biblioteca quebrar. As duas guardas estão em `tests/fronteira-de-dependencia.test.ts` e foram verificadas com a violação reintroduzida em 02/09/2026. O adaptador de recepção continua **puro**: ele recebe a mensagem já decodificada, e é isso que o mantém testável sem socket.

- **O que a Fonte entrega sem conteúdo decifrável NÃO vira Mensagem.** `registrarMensagem` é primeiro escritor vence: gravar o envelope vazio **trava** o identificador contra quem souber preenchê-lo depois — a própria biblioteca, que reenvia decifrado, ou o backup. Medido em 02/09/2026: 90 dos 4.167 eventos de 11h23 de captura, na ordem de 190 por dia. Pular e **contar** é a política; o envelope não vale o lugar.

- **Aprender endereço vem ANTES do laço que escreve — e vale para o lote inteiro, não por registro.** A Restrição da forma canônica já dizia a ordem, e o adaptador ao vivo a violava aprendendo dentro do laço. Achado pelo aceite de 02/09/2026 contra 1.018.130 Mensagens: a **segunda** passagem sobre a mesma captura criou 10 Transições novas — um evento processado antes de o par aparecer gravava o membro na forma alternativa, e no reprocessamento já resolvia para a canônica. A Mensagem não sofria, porque a chave de conflito dela não inclui o autor; a Transição sofria, porque a dela inclui. O sintoma dessa classe é **idempotência que quebra na segunda passagem sem nada ter mudado no mundo**, e ela só aparece medindo por `SELECT COUNT(*)` antes e depois — o relato conta chamadas, não linhas criadas: medido no mesmo dia, `gravados: 2.463` contra **2.447** Mensagens reais.

- **O identificador do evento administrativo NÃO converge entre as Fontes, e o produto mede em vez de prometer.** A convergência por Referência Externa está provada para a **Mensagem**; para a **Transição de Participação**, não: 10.569 de 10.569 identificadores de evento no material exportado têm 20 caracteres maiúsculos, e os 34 recebidos ao vivo têm 9 ou 10 minúsculos. A ponte que decidiria a questão **não é mensurável** — a sobreposição entre as duas fontes é de 3 eventos. `conferirTransicoesRepetidas` conta o mesmo evento sob identificadores diferentes, **agrupando por segundo** porque 6,9% dos instantes do material têm fração; ele responde zero hoje e responde o número no primeiro backup posterior, que é quando a troca da chave de unicidade se decide. O número **não** muda o código de saída de `pessoa conferir`: guarda violada sai 1, medição de consequência conhecida só relata.

- **Adaptador não decide onde arquivo cai — nem para efeito operacional.** A guarda `nenhum adaptador conhece o layout de arquivo em disco` nasceu para o layout de mídia e reprovou, em 02/09/2026, o módulo do efeito de observabilidade do ouvinte, colocado sob `src/adaptadores/` por engano. Ela estava certa: quem decide layout é quem monta a instalação, e o módulo mora em `src/cli/`.

- **O produto não promete confidencialidade contra o Operador da instalação** em nenhuma superfície: código, README, documentação ou mensagem de erro
- **Implementação que contradiz `docs/dominio/` ou `GLOSSARIO.md` atualiza o doc no mesmo commit;** divergência que vira decisão arquitetural ganha ADR própria em `docs/decisoes/`
- [Instanciar por CÓPIA as Restrições do documento de padrões da classe de app, quando houver — herança explícita]
- [Adicionar regras com histórico ou alto custo de violar — não documentar o óbvio]

- **`pgrep -f` casa também com o shell que invoca o programa — e matar o shell é indistinguível de sucesso.** Em 03/09/2026, testando o desligamento limpo do ouvinte contra a conta real, o `kill -TERM` foi para o shell do painel `tmux`; o processo caiu por arrasto, o Acervo destravou, tudo pareceu certo — e a linha `SIGTERM recebido` **nunca saiu do log**, porque o manipulador nunca rodou. Só a ausência dela denunciou. Ao testar sinal, o painel roda o programa com `exec`, para que ele substitua o shell e o pid não tenha ambiguidade; e a evidência de que o caminho limpo rodou é **a linha que ele imprime**, nunca o processo ter sumido.

- **O Inquilino de toda consulta por rede vem da CREDENCIAL, e nunca do chamador.** A verificação de Chave devolve **quem** — `{chaveId, inquilinoId}` —, e não um booleano: é dela que sai o alcance. Devolver `true` obrigaria quem chama a perguntar o alcance depois, e a janela entre *"é válida"* e *"o que ela abre"* é onde o isolamento se perde. Enviar `?inquilino=` não muda nada, e há guarda com sinal próprio para isso.

- **A leitura por rede abre o Acervo SOMENTE-LEITURA.** Abrir para escrita **migra** a base, e um servidor que atende requisição de fora não pode ter esse poder — mesma razão pela qual `ouvinte estado` lê um arquivo. A porta recusa forma divergente, e isso é o certo: superfície de consulta não conserta base, avisa.

- **Uma recusa só, com corpo vazio, para credencial ausente, inválida e revogada.** Distinguir vaza a existência de Inquilinos alheios. A promessa é sobre o que a resposta **diz** — corpo e código —, e **não sobre quanto tempo ela leva**: canal lateral de tempo não se elimina, e prometer seria promessa que nenhum código cumpre. Rota desconhecida **com** credencial válida responde 404, e não 401 — quem tem Chave já provou que pode saber que o servidor existe, e separar os códigos dá a cada guarda um sinal próprio.

- **A trilha de uma migração se escreve DEPOIS dela.** A migração abre uma Operação, e uma migração pode estar alterando `operacoes` — foi o que aconteceu ao entrar o Ator. Escrever antes referencia coluna que o passo ainda não criou, e a migração inteira falha. Vale para toda migração futura que toque a trilha. E **abrir a base acontece dentro de um escopo de Ator**, senão a Operação da migração é a única sem autor.

- **O Ator é da SESSÃO, e o vocabulário é fechado por mecanismo.** `operador:<id>` e `acesso:<id>` são provados por credencial; `servico:<nome>` é declarado pelo deploy; `local` é o fato de nenhuma credencial ter sido apresentada. `indeterminado` é **defeito**, nunca declaração — e `NULL` é reservado a linha anterior ao ciclo 11. Escopado por `AsyncLocalStorage`: variável de módulo atribuiria a Operação de uma requisição ao Ator de outra.

- **A varredura invoca a importação em modo de reprocessamento, e isso não é atalho.** A posição do arquivo é o único mecanismo de "é novo": o que está na Pasta de Entrada é o que falta. Sem `reprocessar`, arquivo devolvido à pasta tem a mesma Impressão já em `materiais` e o importador devolve `jaRegistrado` sem percorrer — e todo critério que conte efeito passa contando zero sobre nada. Medido no vCard real: trocar um dígito de telefone preserva o tamanho em bytes, então a Impressão não muda.

- **Mover para `processados/` acontece depois do registro de conclusão, nunca antes — e nunca sobrescreve.** Invertido, material recusado some da Pasta de Entrada parecendo processado, e a importação lê um caminho que já não existe. Export periódico chega sempre com o mesmo nome; mover por cima é apagar com outro nome, e o produto não apaga nada. A colisão desambigua por **contador**, não por carimbo de tempo: duas passadas no mesmo segundo colidiriam de novo, e o defeito só apareceria sob a varredura agendada.

- **Nenhum módulo de `src/nucleo` ou `src/registro` importa `src/adaptadores`.** Medido em 12/09/2026: zero ocorrências. Quem compõe adaptador de mais de uma Fonte é `src/cli/` — `ouvir.ts` e `varredura.ts`. **A guarda existe** em `tests/fronteira-de-dependencia.test.ts` desde a #889, e tem poder provado com violação reintroduzida — inclusive na forma **dinâmica**, `import('...')`, que uma guarda escrita só para `from` deixaria passar. A proteção anti-vacuidade que decide usa `src/cli` como oráculo: se o detector não achar os imports que existem lá, ele não acha nada, e um padrão quebrado devolveria zero violações por não ver nada.

- **`emOperacao` é reentrante por banco.** Envelopar uma chamada que já abre Operação não acrescenta uma: junta o trabalho à que está aberta. Quem quer distinguir execução automática de ato do Titular declara **Ator**, com `comAtor`, e nunca natureza nova — natureza nova aqui apagaria a Operação `importar-material` da trilha.

- **Reconhecer material é da varredura, não do adaptador.** `lerMaterial` do Instagram devolve vazio sem lançar, e a impressão de árvore vazia é constante. Deixar passar custa duas coisas: o que não é material vai para `processados/` e passa a se ler como processado, e `registrarMaterialConcluido` grava um Material de contagens zero que `material listar` mostra e que o watchdog de atraso lê como "chegou material". Pela varredura esse registro falso **não** envenena a leitura seguinte — ela invoca com `reprocessar: true`; pelo `importar` sem `--reprocessar`, envenena.

- **Dotfile não é candidato da varredura.** A Pasta de Entrada é alimentada por transporte que varia por quem instala, e `.DS_Store` e afins aparecem ali sozinhos. Sem o filtro, cada um vira recusa perpétua, impressa a cada varredura agendada — o que treina quem lê a ignorar a saída.

- **`origem` é a FONTE; a Configuração de catálogo é coluna separada.** `melhorNome` faz lookup **exato** por origem contra a tabela de precedência: gravar `contatos:um-catalogo` ali faria o peso cair para zero e o nome de catálogo ficar **abaixo** do nome de plataforma — inclusive para as 11.948 atribuições de origem `whatsapp` já gravadas. A preferência entre catálogos é **segundo nível**, e só desempata quando os pesos empatam: ela nunca atravessa Fontes.

- **Quatro índices parciais em `atribuicoes_de_nome`, não dois.** O SQLite trata `NULL` como distinto de `NULL` em índice único, então o ramo `configuracao_id IS NULL` é o que mantém a idempotência de reimportação das linhas sem Configuração. Mesmo precedente dos dois índices parciais de `conversas`, do #825.

- **E-mail em mais de um cartão da MESMA Configuração é compartilhado**, e sai de **toda** produção de Proposta — inclusive do laço de cartão. A regra é por Configuração e não global, porque o caso legítimo — o que liga duas bases — é justamente um e-mail em dois cartões, um por base. Excluir de um lado só deixa a fusão entrar pela porta dos fundos: `[T,E]` e `[E,U]` fundem gente distinta **por transitividade** na aplicação, sem que nenhuma Proposta pareça errada sozinha.

- **Um produtor que pareia dois Identificadores de e-mail é impossível por construção.** `UNIQUE (fonte, valor)` faz o mesmo e-mail em duas bases ser **uma** linha. O que se liga são os **Cartões**, e é por isso que o inventário devolve **todos** eles, com a Configuração de cada.

- **O laço de telefone discrimina e-mail por `@`.** `variantesDeEndereco` extrai dígitos de qualquer cadeia, e um e-mail com número no nome casaria com uma variante brasileira — produzindo Proposta plausível e errada, que é o pior tipo.

- **A Marca de Ausência é da varredura, não do importador, e roda UMA VEZ AO FINAL da passada.** A Natureza vive na Pasta de Entrada: `malote importar` manual nunca marca. O que estava presente é **derivado do instante** — um instante por passada, compartilhado por todos os materiais daquela Configuração. Marcar depois do primeiro de dois materiais marcaria como ausente tudo o que só o segundo traz.

- **`identificadores.visto_em` é a PRIMEIRA vez, e fica assim.** Quem registra reavistamento é `ultimo_avistamento`, em Cartão e Atribuição. Mover o primeiro faria re-avistar um nome antigo trazê-lo de volta ao topo do desempate por recência.

- **`registrarNome` devolve `changes > 0` como "nome novo", e por isso o reavistamento é UPDATE separado.** Convertê-lo em upsert faria `nomesCriados` contar reavistamento como criação, e o relatório mentiria sem nada acusar. Upsert sobre índice **parcial** ainda exigiria repetir o `WHERE` no alvo do conflito, e são quatro índices.

- **A identidade do Cartão deriva de telefones E e-mails, e mudá-la de novo é caro.** Com e-mail no conjunto, 1.839 dos 6.693 cartões reais mudam de identidade; alterar a regra depois de um import produz ausência e renascimento em massa.

- **Baixar mídia ao vivo usa a mensagem CRUA, nunca a normalizada, e só o módulo de
  conexão pode chamar `downloadMediaMessage`.** O round-trip de JSON que normaliza a
  mensagem antes de `aoReceber` (necessário para o resto do adaptador) transforma
  `mediaKey` — um `Uint8Array` de verdade — num objeto `{type:'Buffer',data:[...]}`
  que o decrypt da biblioteca não consegue usar. `MidiaAoVivo.baixar(indice)` fecha
  sobre o lote CRU, de propósito; guardado por mutação em `tests/conexao.test.ts`
  (#1068). `receberEvento` devolve `anexosNuncaObtidos` com o índice no lote de
  entrada — é o que liga o Anexo que `ao-vivo.ts` gravou ao índice que `conexao.ts`
  sabe baixar, sem o adaptador puro conhecer a biblioteca.
- **Sem Destino de Mídia, o ouvinte AVISA e segue — não recusa subir.** Diferente de
  `malote midia trazer`, que recusa sem Destino: recusar a subida do ouvinte quebraria
  toda instalação que nunca configurou um. O Anexo fica `nunca-obtido`, como sempre foi.
- **A referência de mídia do WhatsApp expira em ~30 dias, não minutos — e `mediaKey`
  chega em DUAS formas no `bruto` gravado.** Medido em 29-30/09/2026 (#1084), contra
  dois Anexos reais de produção que tinham falhado no dia anterior: a URL carrega o
  próprio prazo (parâmetro `oe=`, epoch em hex) — decodificado, ~30 dias a partir do
  recebimento. `downloadMediaMessage` da biblioteca funciona **sem socket vivo**, só
  com a mensagem reconstruída (confirmado baixando de verdade, 1,89 MB, ~1 dia depois
  da falha original). `mediaKey` aparece como **string base64 pura** (os dois casos
  reais) ou como `{type:'Buffer',data:[...]}` (o que o round-trip de JSON do
  `aoReceber` produz — ver item acima) — as duas formas acontecem, nenhuma é "a"
  certa; `reconstituirMensagemParaRetry` (`retry-de-midia.ts`) trata as duas.
  **A causa original da falha (ETIMEDOUT, bad decrypt) NÃO prevê se o retry funciona**
  — nos dois casos medidos o resultado esperado se inverteu (o "fácil" falhou de
  novo, o "difícil" recuperou) — por isso `malote midia reprocessar` tenta TODOS os
  elegíveis, sem filtrar por motivo anterior.

- **`ZSESSIONTYPE` do backup de iOS tem CINCO naturezas, não duas.** 0=direta,
  1=grupo, 2=lista-de-transmissão, 3=status, 4=comunidade — medido em 21/09/2026 para
  o adaptador macOS do charla, contra o **mesmo formato de backup**, decisão confirmada
  pelo Titular. `!= 0` (coletiva) continua certo para 1/2/4; **status (3) nunca vira
  Conversa nenhuma** — não é chat de verdade, é o feed de acompanhamento de stories de
  um contato. `=== 1` seria o fix errado: demoveria lista de transmissão e comunidade a
  Conversa direta, contradizendo a #825/#826 (broadcast tem Mensagem real, 29.035
  medidas, e fica coletiva). Ver `DescartesDoMaterial.conversas['status']` (#1069).
- **A decisão acima vale para os DOIS caminhos que podem criar Conversa — e só
  cobria um.** O #1069 corrigiu a IMPORTAÇÃO (`material.ts`); a RECEPÇÃO AO VIVO
  (`ao-vivo.ts`) tinha uma decisão própria e mais antiga (critério 11a do #825:
  "os feeds de status caem do lado compartilhado"), que classificava
  `<numero>@status`/`<lid>@lid.status` como coletiva e deixava a Conversa **e**
  a Mensagem serem gravadas normalmente — com evidência de que isso já aconteceu
  em produção (11 Conversas diretas de broadcast/status nascidas ao vivo, antes
  do fix de `@g.us`). **Revertido em 29/09/2026 (#1094)**, decisão direta do
  Titular: "status não faz sentido em malote; o critério da 11a está errado".
  `enderecoEhFeedDeStatus` descarta o evento inteiro no laço principal de
  `receberEvento`, antes de resolver endereço ou abrir Operação — nenhuma
  Conversa, nenhuma Mensagem, para nenhuma das duas formas. **`@broadcast`
  (lista de transmissão e o feed agregado `status@broadcast`) não foi tocado** —
  critério 11a nunca cobriu essa forma, e ela continua tendo Mensagem real.

- **Envio nunca abre conexão própria — `Conexao.enviar` discrimina falha de
  transporte de falha definitiva, e a diferença decide o estado.** Boom 428
  (`connectionClosed`) e 408 (`connectionLost`) são rotina de transporte, não
  falha de dado: `conexao.enviar` os filtra e devolve `undefined`
  (indeterminado), nunca propaga como exceção. Qualquer outra exceção
  (destinatário inválido, rejeição da plataforma) sobe para
  `processarEnvios`, que marca `falhou` — nunca o contrário. Confundir os
  dois faria toda janela de religação com um Envio pendente virar falha
  definitiva em silêncio.
- **A Conversa de um Envio nasce no PROCESSAMENTO (dentro do `ouvir`), nunca
  na solicitação.** `solicitar-envio` grava só a linha do pedido, com o
  endereço cru quando a Conversa ainda não existe; `processarEnvios` é quem
  resolve ou cria, e só DEPOIS de confirmar sucesso do envio — destinatário
  errado nunca deixa Conversa imortal no Acervo (Conversa nunca é apagada).
  É o que permite a rota de rede (`/envios/solicitar`) gravar só uma linha,
  sem precisar do mesmo mecanismo de escrita de domínio que criar Conversa
  exigiria.
- **A fila de Envio prioriza por `tentativas` antes de `solicitada_em`.** Um
  Envio que já tentou e voltou indeterminado cede a vez aos que nunca
  tentaram — sem isso, um Envio problemático trava a fila inteira daquela
  Configuração atrás de si, porque o poller sempre pegaria o mesmo primeiro.
- **O eco do Envio de mídia pode chegar ANTES de `aoEnviar` rodar, e o laço
  de `anexosNuncaObtidos` espera a passada de Envio em curso.** Medido lendo
  a biblioteca vendorizada: o `sendMessage` emite o eco num `process.nextTick`
  atrás de um mutex, e nada garante que a continuação do `await` que chama
  `aoEnviar` rode antes dele. Sem a espera, o eco não acharia o `keyId` no mapa
  `bytesOriginados` e baixaria de volta do WhatsApp os bytes que o malote acabou
  de enviar, em silêncio — o Anexo ficaria `presente` do mesmo jeito, então só
  um teste que emite o eco **de dentro** do `sendMessage` pega. A passada é
  publicada (`passadaDeEnvio`) ANTES de começar, porque o eco pode vir do
  primeiro trecho síncrono dela. O staging é movido para `processados/` depois
  de gravar o Anexo, nunca apagado; se o processo cair entre o envio e o eco,
  o mapa de processo morre e o arquivo fica órfão em `envios-pendentes/`
  (janela aceita e nomeada, sem detecção).
- **Envio órfão por vínculo invalidado nunca vira `falhou`.** Quando o
  adaptador invalida o vínculo (`loggedOut`), o poller para, mas nenhum
  Envio `pendente` daquela Configuração é tocado — a causa é do vínculo, não
  do Envio, e ele fica pendente até reparear.

## Decisões Herdadas (explícitas)

Repetidas aqui em vez de herdadas de configuração externa ao repositório — quem lê este arquivo tem o contrato inteiro:

- Kebab-case em caminhos de arquivo; comentários inline em pt-BR
- Nenhum comando git destrutivo sem confirmação explícita
- Camada genérica antes de caso específico: o núcleo nasce agnóstico de fonte, e cada Fonte entra como Adaptador
- Conhecimento destilado em `docs/`; restrições em `CONTEXTO.md`

## Decisões Locais Divergentes

- **Não pina versão de Node.** O contrato é **piso** (`engines: ">=22"`), não pinagem: produto instalado por terceiros não amarra a versão de quem o escreveu. O ambiente de desenvolvimento pode subir para 24 sem tocar neste repo.
- **Sem prefixo de organização no repo e no binário** — a audiência externa define a convenção.

## Service systemd

Repositório expõe services systemd. Convenções:

- **Ownership de .service units:** o script de serviço é mantido pelo repositório de infraestrutura de quem instala, não por este repo. Este repo declara o requisito.
- **Sudo passwordless** para `systemctl restart <unit>`: configurar em `/etc/sudoers.d/` com regra por unit.
- **Restart automático no upgrade:** se distribuído via `upgrade-fleet`, declarar
  `post_install: "restart:<unit1> <unit2> ..."` no entry do config.

## Estado Atual

- 04/10/2026 — **CICLO 27 ACEITO: o malote envia mensagem (texto, imagem,
  documento), RELEASES v0.25.0 E v0.25.1 EM PRODUÇÃO no thinkpad** (#1112, três
  planos, PRs #13 e #14, tags `v0.25.0` e `v0.25.1`). Agregado **Envio** novo
  (Acervo v23→v25, migrou sozinho no host, `quick_check ok`): `malote enviar`
  (`--texto`, `--imagem`, `--documento`), `malote envio estado|reprocessar` e
  `POST /envios/solicitar` (segunda rota de escrita da API; a Chave de Acesso
  agora **fala pela conta**, e a ADR de confidencialidade foi revisada). Quem
  envia é o `ouvir` da Configuração, pela conexão que ele já tem; a Mensagem
  volta pelo eco pela porta de recepção, e o staging vira o arquivo do Anexo.
  Suíte de 1090 para **1144 testes**, baseline de 3 falhas pré-existentes.
  Prova de campo: rodada real contra a conta da Hera em instalação descartável
  no macbook (script `20261003-acao-perigosa-hera-verificacao-de-campo-do-envio.sh`,
  na pasta de trabalho). **O aceite achou três lacunas e o ciclo só fechou
  depois de corrigi-las:** falha ao gravar o resultado depois do envio virava
  `falhou` (agora fica `pendente`), `envio reprocessar` não contava pendentes,
  e grupo não tinha teste. Detalhe por critério: `## Resultado` da spec, na
  pasta de trabalho.

## Pendências

- **Envio em produção, sem uso real ainda.** A Hera ainda não está no thinkpad: a
  verificação rodou numa instalação descartável (`~/malote-hera-verificacao` no
  macbook, vínculo copiado da espiga — pode ser descartada depois de conferir que
  não é mais necessária). O próximo passo é Ação Documentada: Inquilino próprio,
  Configuração e vínculo no thinkpad. Antes de assumir que o Envio funciona em
  produção, **mandar um Envio real por lá** — a release foi verificada só por
  versão, schema e ouvinte vivo.
- **Sem prova de campo:** envio para **grupo** e a rota `POST /envios/solicitar`
  contra o servidor de produção (só teste); a falha pós-envio só tem teste com
  erro injetado.
- **Staging órfão em `envios-pendentes/`** se o `ouvir` cair entre o envio e o
  eco: o mapa de bytes originados é de processo. O produto não detecta nem limpa;
  o guia de armazenamento diz que removê-lo à mão é seguro.

- **#1106 corrigida via `dev-05` — RELEASE v0.24.1 PUBLICADA E DISTRIBUÍDA** (ver
  Estado Atual). O worker de
  transcrição (`src/cli/transcricao.ts`, `processarUmaVez`) passava `elegivel.caminho`
  (sempre RELATIVO ao Destino de Mídia) direto pro motor, sem juntar com
  `lerDestinoDeMidia` antes — toda Transcrição falhava com "No such file or directory"
  em qualquer instalação onde `malote servir` não rode do próprio Destino de Mídia (o
  caso normal). Achado medindo o Acervo real da mentorada Renata (bosgame): 20 de 20
  falhas, mesma causa. Fix lê os Destinos de todos os Inquilinos de uma vez (fecha o
  Registro antes do `await` do motor, preservando o ciclo de vida original), resolve
  `join(destino.endereco, elegivel.caminho)` antes de chamar `transcrever`, e pula —
  sem marcar pendente — Inquilino sem Destino configurado. Suíte: **1090 testes**,
  mesma baseline de 3 falhas pré-existentes (`cli-entrada.test.ts`). Checado no
  thinkpad (produção do Titular): `transcricoes` tem 20.199 linhas, todas
  `fora-de-escopo` — o backfill do #1103 nunca rodou lá, então o Titular não foi
  afetado ainda, mas seria no primeiro `incluir-estoque`/áudio ao vivo processado.
  **Pendente, fora do escopo deste agente:** levar o fix até o bosgame (fora do
  `upgrade-fleet` por desenho, mesma situação do #1052/#1088) e reenfileirar as 20
  falhas lá (`malote transcricao reprocessar --inquilino <id>`) depois que o código
  chegar — ato de outro agente, por decisão do Titular de 25/09/2026 sobre o bosgame.
- **#1103 publicada e distribuída (v0.24.0) — três comandos de decisão do
  operador existem no binário de produção e nunca foram rodados contra o
  Acervo real: `malote midia extrair-duracao`, `malote transcricao
  incluir-estoque`, `malote transcricao solicitar`.** Rodar qualquer um
  deles contra produção é ato explícito (Ação Documentada, por escrever no
  Acervo), não efeito automático do deploy — inclusive o backfill de
  duração do estoque de ~270h de áudio (medido em 01/10/2026 contra o
  mesmo Acervo), que é caro o bastante (~195h de CPU) para nunca rodar sem
  `--limite` e decisão explícita de quando.
- **O Critério 3 da spec #1103 (diferença entre duração gravada e duração
  real do arquivo, sempre < 1s) não tem verificação automatizada — só
  medição manual desta sessão contra o Acervo real do Titular (15 amostras,
  via `ffprobe`), não um teste da suíte.** Se o estoque for incluído via
  `malote transcricao incluir-estoque`/backfill de duração em produção,
  vale reconferir numa amostra maior antes de considerar o critério
  definitivamente fechado.
- **A spec #1103 está "fora do roadmap"** — os 25 ciclos existentes estavam
  todos `aceito` quando ela foi aberta, nenhum `em-execucao`. Falta o
  `neg-05-aceita-ciclo` decidir se ela entra no re-fatiamento do
  `roadmap.md` como ciclo novo, e o `neg-05` confrontar as três entregas
  contra os 17 Critérios de Sucesso da spec.
- **#1089 (`pessoa promover-identificadores-nomeados`) não teve a medição de
  campo rodada ainda — falta saber quantos Identificadores o Acervo real
  promoveria hoje.** Adiada de propósito no `dev-04`: o checkout de
  produção (thinkpad) está na branch `production`, que ainda não tem este
  código (só `main` tem, até a release sair). Rodar em modo ensaio (sem
  `--com-efeito`) depois do release, e conferir se o número fica bem abaixo
  dos 11.043 brutos citados na spec original — a maioria era lixo do #1101,
  e o filtro desta tarefa já recusa promover isso.
- **A promoção pode criar Pessoa cujo nome EXIBIDO é lixo, mesmo com o
  filtro de elegibilidade ativo — limitação conhecida, não bug.** Se um
  Identificador tem Atribuição `titular` = valor-sentinela E `terceiro` =
  nome real, a Pessoa nasce (a elegibilidade não bloqueia por causa de UMA
  Atribuição ruim) e é buscável pelo nome bom (`procurarPessoas` casa em
  qualquer Atribuição pendurada) — mas `nomeDaPessoa`/`melhorNome` não
  filtra sentinela, então o nome CORRENTE exibido pode continuar sendo o
  lixo (autoridade `titular` vence `terceiro` por rank, mesmo peso de
  Fonte). Resolver isso de vez depende da limpeza retroativa do #1101
  (também pendente, ver entrada abaixo) alcançar essas Atribuições — não é
  escopo da #1089.
- **#1101 corrigiu a ESCRITA, não o ESTOQUE — o Acervo real do Titular ainda tem
  o lixo que as duas causas já produziram.** Antes de assumir que "nome ruim"
  sumiu de qualquer Acervo existente: (a) `removerNomesInvalidos`
  (`src/nucleo/identidade.ts:924`, o motor de `pessoa remover-nomes-invalidos`)
  cobre só duas classes (endereço-repetido, marca-duplicata) — o padrão-sentinela
  e o nono-dígito são uma TERCEIRA e QUARTA classe, e não podem subir para lá
  como estão: o núcleo não pode conhecer vocabulário de Fonte (nono dígito
  brasileiro) nem artefato de biblioteca (`+EAA=` do baileys). Precisa de
  comando de limpeza equivalente, do lado do adaptador, antes de rodar contra
  produção. (b) Medido em 30/09/2026 contra o Acervo do Titular: 14 Pessoas
  JÁ exibem o valor-sentinela como nome corrente (`melhorNome` pegou a
  atribuição-lixo mais recente). Nenhuma limpeza rodou ainda — a tarefa #1101
  só impede que o problema cresça a partir de agora.
- **#1070, #1068 e #1069 fechadas, release v0.22.0 publicada e distribuída no
  thinkpad, verificada por efeito — o ciclo 23 (`malote-midia-ao-vivo-e-transcricao`)
  está pronto para `neg-05-aceita-ciclo`.**
- **Sem comando de retry para mídia ao vivo que falhou ao baixar (#1068) — tarefa
  #1084 aberta.** Medido em produção logo após o deploy: 2 falhas reais (`document`
  com `ETIMEDOUT`, `video` com `bad decrypt`), as duas ficaram `nunca-obtido` sem
  derrubar o ouvinte, exatamente como desenhado — mas não há como reprocessá-las.
  `malote midia` só tem `trazer` (backup local), nada que reuse a referência já
  gravada em `bruto`. O `document` (falha de rede) é candidato razoável a recuperar;
  o `video` chegou atrasado (reentrega offline do WhatsApp, horas depois do instante
  original) e a suspeita é referência já expirada — não medido, hipótese. **Não
  cobre o estoque histórico de antes desta correção** (94-99,8% dos Anexos ao vivo)
  — essas referências quase certamente expiraram; o único caminho para elas é
  `malote midia trazer` a partir de um backup do aparelho.
- **RESOLVIDO em 29/09/2026 (#1088): as Conversas fantasma de Status já gravadas
  agora são limpas por migração — passo `REMOVE_STATUS_FANTASMA_V22` (Acervo
  v21→v22).** Critério final, medido contra o thinkpad e mais completo que a
  suspeita original de sufixo de string: `json_extract(bruto, '$.ZSESSIONTYPE')
  = 3`, que cobre as duas formas de endereço (`@status` e `@lid.status`) —
  1060 candidatas em produção, das quais 696 com zero Mensagem (removidas) e
  364 com "mensagem" (conteúdo de Status/Stories do backup, não chat; ficam,
  de propósito — nunca perder dado por engano). A máquina de migração **foi**
  provada para delta negativo — `divergenciasEsperadas` como GETTER (closure
  que `aplicar()` preenche, lido depois de rodar), primeiro uso real desse
  caminho, porque o número de linhas removidas varia por instalação e não dá
  para declarar um `-N` fixo. `participacoes`/`metadados_de_coletiva` cascadeiam
  (`ON DELETE CASCADE`) e entram na mesma declaração. **Isto só limpa
  instalações que rodarem a migração** — o Acervo da Renata (bosgame) continua
  fora do `upgrade-fleet` por desenho (mesma situação da #1052), então levar
  o fix até lá é ato separado, fora do escopo deste agente.
- **Lote que cai no derrame (Acervo ocupado) perde a mídia que trouxer (#1068).** O
  reprocessamento (`malote ouvinte reprocessar`) chama `receberEvento` de novo sobre o
  lote gravado em `nao-gravados.jsonl`, mas não há socket vivo nem `MidiaAoVivo` naquele
  caminho — e a referência de download pode já ter expirado. O Anexo fica
  `nunca-obtido`, do mesmo jeito que ficava antes desta correção. Não é regressão; é
  limite não resolvido. Se aparecer de novo (derrame é raro — só sob disputa de
  escrita), é trabalho novo, não bug da #1068.
- **RESOLVIDO em 23/09/2026, mas o mecanismo que quase doeu fica registrado: o
  `upgrade-fleet` roda a cada 30 min no thinkpad (`*/30 * * * *`, `trust: "immediate"`
  para o pacote `malote`), e aplicou a v0.21.0 sozinho — pull + restart — cerca de 7
  minutos ANTES da Ação Documentada rodar `malote acervo migrar`.** O `malote-ouvinte`
  se recusou a subir exatamente como desenhado (`o passo 19 para 20 precisa das
  Configuracoes de Adaptador... Rode malote acervo migrar --inquilino <id>`) — zero
  corrupção. O `malote-servidor`, porém, **ficou `active` servindo contra Acervo não
  migrado** nesse intervalo — qualquer leitura de Mensagem teria quebrado, porque o
  código novo faz `SELECT` incluindo `direcao`, coluna que só existe a partir do schema
  19. Não houve dano real (0 requisições no log do servidor nessa janela), mas foi
  sorte de tráfego, não garantia. **Formalizado no `ops-10-publica-release`
  (passo 4a, 23/09/2026):** release que muda a forma do Acervo checa `trust` e o
  timer do `upgrade-fleet` no host **antes** do merge — rebaixa o `trust` para essa
  release, ou garante a Ação Documentada pronta e ensaiada antes do merge, para
  caber na mesma janela do automático. Nenhum ajuste feito no `upgrade-fleet.json`
  do malote ainda (segue `immediate`) — a mitigação escolhida foi a disciplina de
  timing no `ops-10`, não a mudança de `trust`; reabrir esta decisão se uma
  próxima corrida real acontecer.

- **O `post_install` do malote RODA: toda release reinicia o ouvinte.** Medido em 12/09/2026
  na release v0.10.0, o `upgrade-now` executou `restart:malote-ouvinte@<conta>.service`. Duas
  consequências que valem para **toda** release:
  - o ouvinte sobe com o código novo e **migra as bases sozinho** ao abri-las. Se a release
    muda a forma do Acervo ou do Registro, pare o serviço e faça backup **antes** — código
    velho escrevendo em tabela recém-reconstruída perde dado em silêncio, pelo `catch` por
    evento. Release que não muda forma não precisa disso: confira comparando
    `VERSAO_SCHEMA_ACERVO` e `VERSAO_SCHEMA_REGISTRO` entre `main` e `origin/production`;
  - o restart **zera a janela contínua** do ouvinte. Medição que exija janela sem reinício
    (paridade por identificador, por exemplo) roda **antes** da release, nunca depois.

- **O unit do ouvinte é de SISTEMA**, em `/etc/systemd/system/`, não de usuário. `systemctl
  --user` responde `inactive` para um unit que nem existe naquele barramento, e isso já
  produziu três diagnósticos errados numa sessão. Reiniciar exige `sudo`.

- **`malote material varrer` não tem gatilho.** As três Pastas de Entrada estão declaradas em
  produção e o comando funciona, mas nada o chama: o timer fica **fora do produto**, por
  decisão de quem instala, e nasce na infraestrutura de quem instala.

- **Duas capacidades rendem zero enquanto houver uma base de catálogo só.** O produtor de
  Proposta por `email` e a preferência entre catálogos exigem **duas** Configurações de
  `contatos`. Estão provados por teste com fixture construída; em produção dão zero, e isso é
  o resultado certo. Não tratar como defeito.

- [ ] **A migração não tem caminho para passo que recrie as tabelas da própria trilha.** A Operação é gravada no início da transação, na forma **velha** dessas tabelas. Nenhum passo de hoje as toca; se um dia precisar, é caminho novo na máquina, não remendo. Consequência medida em 01/09/2026: a linha da Operação entra **antes** de a conferência tomar a linha de base, então ela não aparece como divergência — declarar `+1` para `operacoes` num passo REPROVA a migração.
- [ ] **Acervo importado antes de 02/09/2026 tem endereços na forma antiga, e recriar é o que resolve.** A importação passou a aprender a correspondência que o material declara, mas só a aplica ao que ela escreve — não há resolução retroativa sobre acervo existente. Reimportar num Acervo novo resolve; resolução retroativa é trabalho à parte, e não é deste ciclo.
- [ ] **Sobram endereços que o material não resolve, e o número é conhecido: 16.168.** São membros de Conversa coletiva sem conversa direta — o par deles não está em lugar nenhum do backup, porque a tabela que o declara é a de sessões. As fontes restantes são a recepção ao vivo (aprende de quem voltar a escrever) e o acervo do produto anterior. Antes de supor que a resolução está completa, medir: `SELECT COUNT(*) FROM identificadores WHERE valor LIKE '%@lid'`.
- [ ] **O oráculo de classificação depende da NATUREZA que se testa, e confundi-los custou quase 8.323 eventos.** Para estabelecer que um código da Fonte é **saída**, a fração de membros que escreveu **antes** dele tem de ser alta e a que escreveu depois, baixa. Para **entrada**, o inverso — e a fração que escreveu antes tem de ser quase zero, porque ninguém escreve num grupo antes de ser adicionado. Em 30/08/2026 o mapa nasceu usando só os oráculos de saída e aplicando-os a todos os códigos; num código de entrada eles medem outra coisa (se a pessoa saiu depois) e devolvem um valor intermediário sem significado. O código 15 ficou de fora com "10,5%" e a spec chegou a afirmar que a Fonte não declarava entrada. **Ao acrescentar código ao mapa em `src/adaptadores/whatsapp/codigos-de-evento.ts`, escolher o oráculo pela natureza que se hipotetiza — e rodar os dois.**
- [ ] **`--em <AAAA-MM-DD>` é o FIM daquele dia, capado ao fim do Alcance.** Data sem hora é um **dia**, e comparar meia-noite com o instante de um evento fez, em 30/08/2026, uma data dentro do Alcance ser reportada como fora — nas duas bordas. A regra atual está em `src/cli/index.ts`, no ramo `conversa presenca`; ao mexer nela, testar contra Conversa cujo Alcance começa e termina **no mesmo dia**, que é onde as duas bordas colidem. Fixture sintética com alcance de vários dias passa verde e não protege.
- [ ] **Medir custo de importação por comparação de binários não resolve 5% nesta máquina.** Em 30/08/2026, contra 1.018.130 Mensagens e em **tempo de CPU**, a linha de base oscilou **11,5%** entre rodadas do mesmo binário — mais que o dobro do teto que se queria verificar, e pior que a dispersão sobre o material pequeno. Trocar de material não resolveu. Antes de escrever critério de aceite com teto percentual de desempenho, medir a dispersão do instrumento; quando ela for maior que o teto, o veredito honesto é **não verificável**, e o que resta é o limite estrutural (as Transições acrescentam 7,85% de linhas sobre as Mensagens).
- [ ] **DESATUALIZADO — corrigido em 30/09/2026: a válvula agora é `MALOTE_HOME`, não `MALOTE_RAIZ`.** Esta linha dizia "a raiz vem de `MALOTE_RAIZ`" desde 29/08/2026; a migração para XDG (ADR `20260913`) trocou a válvula sem que ninguém atualizasse a nota — `MALOTE_RAIZ` não redireciona mais nada (há teste pré-existente, `cli-entrada.test.ts`, documentando exatamente isso, numa das 3 falhas conhecidas da suíte). Confirmado ao vivo durante o aceite do ciclo 25: `--raiz` continua não existindo como flag, e `MALOTE_RAIZ` como variável de ambiente também não tem efeito nenhum — só `MALOTE_HOME` move a instalação.
- [ ] **Desfazer não cobre o Registro, de propósito.** Decisão de configuração recusa desfazer e manda **redefinir**, dizendo onde ver o valor anterior — o comando de definir já é a porta. Remontar o objeto de opções de cada upsert seria uma segunda implementação de cada comando. Se isso mudar, é decisão nova, não conserto.
- [ ] **Desfazer um lote não remove as Pessoas que ele criou.** Os vínculos voltam; as Pessoas ficam, porque o produto nunca remove Pessoa. Num lote real isso são centenas de recusas com a mesma causa, e o relatório as agrupa — não é falha.
- [ ] **`GLOSSARIO.md` e o modelo têm ~216 violações de MD013 pré-existentes** (medido em 30/08/2026; o número anterior deste item, ~204, estava velho). O gate canônico do repo é `npm run lint` (eslint), que não olha markdown. Não tratar `markdownlint-cli2` vermelho nesses dois arquivos como regressão da sua mudança sem antes medir a linha de base.
- [ ] **`anexos` não tem restrição de unicidade, e a proteção mudou de forma no ciclo 4.** No WhatsApp o bloco de Anexo passou a rodar **antes** do desvio por Mensagem já existente — senão `anexosJaExistentes` ficaria sempre zero na reimportação —, e quem impede duplicata ali é o `anexoJaExiste`. No Instagram, onde a Mensagem tem N Anexos, quem impede continua sendo o `continue`. Ao mexer em importação, conferir **os dois** mecanismos, que não são o mesmo.
- [ ] **Participante de Conversa coletiva do Instagram aparece na lista de sem-endereço com nome nulo** — o nome está embutido no valor do Identificador (`nome-exibicao:<Nome>`) e nunca virou Atribuição de Nome. Deliberado no ciclo 3; se a lista precisar ficar uniforme, são duas linhas no adaptador.
- [ ] **A impressão do Material do Instagram percorre a árvore inteira de mensagens** — 610 chamadas de `stat` no material de linha de base medido. É barato hoje e cresce com o número de Conversas, não com o volume; se algum material passar de alguns milhares de Conversas, medir antes de assumir que o custo de pular continua desprezível.
- [ ] **O detector de integridade da mesclagem não tem chamador automático.** `malote pessoa conferir` existe e sai 1 ao achar Pessoa apontando para quem não é mestre, mas nada o roda sozinho — nem a importação, nem a abertura do Acervo. A denormalização da mestre é mantida por duas guardas de escrita, e o detector existe justamente porque o inventário de quem escreve pode estar incompleto. Antes de assumir que a estrela está íntegra num Acervo antigo, **rodar o comando**; e se aparecer produtor novo de escrita em `pessoas`, considerar chamá-lo no caminho de abertura.
- [ ] **A Política de Retenção não tem como ser removida — só sobrescrita.** `retencao definir` faz `ON CONFLICT DO UPDATE`, e não existe `retencao remover`. Titular que queira deixar de ter Política precisa mexer no Registro à mão. A Política sem critério é recusada de propósito (a conjunção vazia alcança todo Anexo presente), então "definir vazio" não é a saída. Se aparecer a necessidade, é comando novo, não relaxamento da recusa.
- [ ] **O primeiro nome de membro de grupo do WhatsApp não é gravado** — `ZFIRSTNAME` está preenchido em 3.711 dos 24.330 membros do backup real, e `ZCONTACTNAME` em nenhum. Primeiro nome sozinho é identificação fraca e o ganho não foi medido.
- [ ] **Desfazer um lote de aplicação de Propostas só existe dentro do processo que o aplicou.** `pessoa propostas aplicar --json` devolve a lista do que foi feito — o par de cada vínculo e o `atoId` de cada mesclagem —, e quem opera desfaz item a item por `pessoa desvincular` e `pessoa desfazer-mesclagem`. **Não há comando que desfaça um lote de outra sessão**, porque não há tabela de lote: a Proposta é calculada e a lista vive na memória. Guardar o `--json` é a única forma de reverter em bloco depois. O identificador de operação que resolveria isso é a Trilha, no ciclo seguinte.
- [ ] **A preferência de mestre por catálogo quase nunca decide na prática, e isso é esperado.** Medido em 29/08/2026 sobre 458 mesclagens de material real: **zero** com `regra = 'preferencia-de-catalogo'`, todas por `ordem-de-chamada`. Razão: as propostas por telefone entram primeiro e sempre carregam um Identificador de `contatos`, então quando a mesclagem acontece as duas Pessoas já têm catálogo e o discriminante empata. A regra está correta e testada em unidade nas duas ordens de argumento; ver zero no banco **não** é defeito.
- [ ] **`aplicarConjunto` recusa mesclar quando alguma das Pessoas tem vínculo `humano` em qualquer lugar da família — e a checagem é da FAMÍLIA, não dos membros da Proposta.** A forma por membro deixaria passar a Pessoa construída à mão por um Identificador e ampliada por um lote anterior, cujos outros membros têm procedência `catalogo`. Ao mexer nessa guarda, a mutação que a devolve à forma por membro derruba **um** teste só; é ele que protege o flanco.

- [x] ADRs de contrato criadas em 2026-08-24: recepção ao vivo via Baileys, e confidencialidade não garantida contra o Operador

## Referências

- [[docs/arquitetura.md]] — mapa estrutural do repo (mapa fino, isento — carga sob demanda)
- [[docs/explicacoes/visao-geral.md]] — o quê e por quê (quadrante explicação, carga sob demanda)
- [[docs/decisoes/]] — ADRs locais
- [[GLOSSARIO]] — vocabulário do domínio, `aprovado`
- [[docs/dominio/malote]] — modelo de domínio, `aprovado`
