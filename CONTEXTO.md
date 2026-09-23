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
  **nome que repete o próprio endereço** fica no **Adaptador** — os dois valores
  estão na mão no instante da chamada, sem consulta. A **normalização de marca
  invisível** fica na **porta do núcleo** — reconhecer que a segunda escrita é o
  mesmo nome exige consultar o que já está gravado, e a unicidade do banco é por
  texto exato: marcado e desmarcado são strings diferentes, então a linha gêmea
  nasce sem nada reclamar.
- **Normalizar é para COMPARAR, nunca para reescrever.** O texto gravado continua
  sendo o que a Fonte entregou. O par de testes é o desenho: um prova que a segunda
  escrita não cria linha, o outro **lê de volta** e prova que as marcas ficaram. Sem
  o segundo, normalizar na escrita passaria no primeiro.
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

- 22/09/2026 — **`malote configuracao criar` em produção: declarar a conta sem exigir
  material.** Achado real de uso (mentorado Walter, bloqueado por dificuldade de gerar o
  export do WhatsApp) — tarefa #1042, spec e plano com `dev-10` (0 `bloqueia` na spec, 2
  `bloqueia` corrigidos no plano antes da execução). O comando reaproveita
  `resolverConfiguracao`/`definirContaDaConfiguracao`, sem tocar no guard "busca, nunca
  cria" de `ouvir`. `docs/dominio/malote.md` ganhou as entradas `resolver-configuracao`
  e `definir-conta` (já existiam em código, nunca documentadas), gate recarimbado para
  `2026-09-22`. Tutorial de instalação corrigido: o passo 6 ensinava um comando
  (`entrada declarar --fonte whatsapp`) que a própria CLI recusa desde que a varredura
  ficou restrita a Fontes varríveis — agora tem dois caminhos, com material ou só para
  o ouvinte. **Release v0.20.0**, PR #4 (`main → production`), CI verde, merge `945549d`,
  tag no commit publicado. `production` estava em v0.19.0 (`dbd6c66`). Suíte: 941 testes,
  937 passam (3 falhas pré-existentes, sem relação, confirmadas por `git stash` antes da
  mudança). **Deploy nos hosts da frota (`upgrade-fleet`) não foi feito nesta sessão** —
  release publicada no GitHub, não distribuída; decisão do Titular quando/se propagar.
- 16/09/2026 — **`bin/malote` corrigido: o alvo de `package.json.bin` agora roda da
  fonte, sem `dist/`.** Achado na instalação real da frota (tarefa #991): o `bin`
  apontava pra `dist/cli/index.js`, que só existe após build — e o produto roda **da
  fonte**, sem build, em toda instalação real. `npm link` nem chegava a criar o
  symlink global, porque o alvo não existia. Corrigido com `bin/malote`, que resolve
  o próprio diretório por `import.meta.url` (nunca CWD — `node --import tsx` resolve
  o pacote `tsx` pelo CWD do processo, não pelo caminho do script) e roda o filho com
  `cwd` fixado na raiz do repositório. Guia do cliente ganhou o passo `npm link`.
  Regressão provada de ponta a ponta: clone limpo, sem `dist/`, `npm ci` + `npm link`,
  invocado de fora do repositório. Suíte em 895 testes.
- 16/09/2026 — **repositório público.** O histórico público começa no commit "Initial
  public release"; o histórico de construção anterior pertence ao repositório privado de
  origem. **v0.17.0 em produção**, armazenamento XDG por categoria (`XDG_DATA_HOME` para
  dado, `XDG_STATE_HOME` para estado do ouvinte, `MALOTE_HOME` como válvula). Suíte:
  **873 testes, 0 falhas**. CI verde (Node 22, Linux). Sem tags públicas ainda — a primeira
  sai da próxima release.
- 2026-08-24 — repo criado **privado**. Torna-se público só depois da varredura anti-vazamento de conteúdo E do espaço de refs do remoto — refs de pull request sobrevivem ao squash, e a única remoção confiável é apagar e recriar.
- 2026-08-26 — **ciclo 2 entregue**: segundo adaptador (Instagram, material exportado). Suíte em 138 verdes. O teste de aceite do desenho passou — acrescentar Fonte não alterou uma linha de `src/nucleo/` nem de `src/registro/`, medido por diff contra a linha de base do ciclo.
- 2026-08-28 — **ciclo 4 entregue**: ingestão recorrente. Suíte em 244 verdes. O Acervo passou a lembrar qual Material já entrou (schema v5), a Configuração de Adaptador saiu de tabela morta para chave do Estado de Sincronização, e o adaptador de WhatsApp passou a ler a conta business — que era ilegível.
- 2026-08-29 — **ciclo 7 entregue**: o catálogo de contatos entra como Adaptador comum (vCard), propõe identidade por telefone, por nome e por múltiplos endereços, e aplica — vinculando e mesclando. Suíte em 378 verdes, schema v7 (`cartoes_de_catalogo`). Medido contra 1.018.130 Mensagens: 6.265 de 6.268 propostas aplicadas em 1,9 s, 458 mesclagens, e 3.629 das 5.118 Conversas diretas passaram a ter Pessoa.
- 2026-08-29 — **ciclo 8 entregue**: trilha de auditoria de escrita. Toda decisão grava uma **Operação** com o efeito linha a linha, nas duas bases — Acervo **v8** e Registro **v2**. Suíte em 432 verdes. Medido contra o catálogo real: a aplicação de 922 Propostas passou de **3.102 Operações para 1**, e desfazer o lote de outra sessão reverteu 2.180 vínculos, recusando 922 com a causa dita.
- 2026-08-30 — **ciclo 9 entregue**: Transição de Participação. O evento que a Fonte declara vira registro próprio (Acervo **v9**), e a consulta responde "quem estava nesta Conversa em tal data" em quatro grupos, dentro de um **Alcance** declarado por Conversa. Suíte em 456 verdes. Medido contra os dois backups: **16.402 Transições em 346 Conversas**, com 2 Operações para 2 comandos sobre 1,1 milhão de Mensagens.
- 2026-09-01 — **ciclo 14 entregue**: migração versionada. Forma anterior **sobe por passos** declarados, ordenados e idempotentes, em vez de ser recusada — Acervo **v11** (piso 10) e Registro **v3** (piso 2), na mesma máquina. A execução é atômica, a conferência de contagens reprova divergência não declarada, e a verificação de integridade compara contra a linha de base para não abortar por dano herdado. Suíte em 506 verdes. Medido contra material real (94.346 Mensagens, 22 tabelas): forma 10 subiu para 11 com **zero** linha perdida em tabela de dado, e a segunda execução se anuncia como sem trabalho.
- 2026-09-03 — **ciclo 10 entregue**: recepção ao vivo. O produto recebe do WhatsApp por um processo dedicado, converge com o material exportado na mesma Referência Externa, e grava a Transição de Participação que a Fonte declara. Suíte em **550 verdes**. Verificado contra conta real: religação após queda 428, desligamento limpo por sinal, e o instante do último evento legível de fora sem abrir o Acervo. O identificador do evento administrativo **não** converge entre as Fontes, e o produto mede a duplicação em vez de prometê-la inexistente.
- 2026-09-03 — **ciclo 11 entregue**: superfície de rede e Chave de Acesso. O acervo é consultável por rede, autenticado, com o Inquilino vindo da credencial; e a trilha passou a dizer **por ordem de quem**. Suíte em **593 verdes**, Registro **v5**, Acervo **v13**. Nenhuma dependência nova — o servidor é `node:http`.
- Modelo de domínio e glossário `aprovado` desde 2026-08-24; ciclo 1 aceito em 2026-08-26.

## Pendências

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
- [ ] **A raiz da instalação vem de `MALOTE_RAIZ`, não de `--raiz`.** Não existe essa flag; passá-la manda a instalação para o caminho padrão (`~/.local/state/malote`) sem avisar. Custou uma bateria de medições em 29/08/2026.
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
