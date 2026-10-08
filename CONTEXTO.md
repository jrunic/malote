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

**O trabalho de desenvolvimento acontece fora deste repositório**, nos documentos internos do autor.

| Artefato | Lar canônico |
|---|---|
| Roadmap de ciclos, spec, plano | fora deste repositório |
| Arquivo de apoio de tarefa, diário de sessão | fora deste repositório |
| Discussão de negócio | fora deste repositório |
| **Código, testes, migrations** | **este repositório** |
| **Documentação do produto** (Diátaxis) | **este repositório**, `docs/` |
| **ADR de contrato** | **este repositório**, `docs/decisoes/` |
| **Modelo de domínio** | **este repositório**, `docs/dominio/` |
| **README, CHANGELOG, GLOSSARIO, CONTEXTO** | **este repositório**, raiz |

**As skills leem esta seção** em vez de inferir por visibilidade. Repositório que não declara deixa a skill sem
informação, e sem informação ela erra.

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
- **Atuais:** `baileys` (recepção ao vivo, só pelo portão de `conexao.ts`), `better-sqlite3` (SQLite) e `tsx` (runtime; ver Restrições). Desenvolvimento: eslint, prettier e TypeScript.

### Estrutura

```
CONTEXTO.md GLOSSARIO.md — contratos vivos (raiz)
docs/decisoes/  — ADRs locais
docs/dominio/   — modelo de domínio
docs/{tutoriais,guias,referencias,explicacoes}/ — quadrantes Diátaxis (ADR 20260620)
docs/explicacoes/invariantes-*.md — regras por subsistema, com motivo e medição

src/         — nucleo (agregados e portas), registro (instalação), adaptadores (Fontes), rede (servidor), cli (comandos)
tests/       — suíte (`node --test`); `ajuda/` guarda as fixtures
```

Roadmap, specs, planos e diários vivem fora deste repositório.

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

Hard limits sempre relevantes durante a sessão. O motivo e a medição de cada regra por subsistema estão em `docs/explicacoes/` (ponteiros ao fim desta seção).

- **Runner de testes canônico:** `npm test`
- **Idioma da saída para humano:** pt-BR
- **Comentários inline:** pt-BR
- **Nome do repo e do binário:** `malote`, nome comercial próprio, sem prefixo de organização nem de ferramenta interna.
- **Nada neste repo nomeia pessoa real, cliente, host ou caminho de máquina do autor** — em código, fixture, comentário, exemplo e mensagem de commit. Dado de exemplo é sintético
- **Nenhum caminho de arquivo do acervo contém dado pessoal** — invariante do agregado Anexo; foi defeito real no repo de origem
- **O núcleo não nomeia ferramenta.** `jid`, `lid`, `handle`, `resource_name`, `etag` são vocabulário de Adaptador e não aparecem em agregado do núcleo
- **Tudo é escopado a Inquilino.** Nenhuma consulta atravessa Inquilino — nem como opção, nem sob flag
- **Só `src/nucleo/` e `src/registro/` tocam em tabela.** Adaptador e CLI usam as portas; falta uma leitura, a porta nasce no núcleo, nunca um `db.prepare` no chamador. A dívida já voltou uma vez; a varredura que a pega atravessa quebra de linha (comando e motivo em [regras de código](docs/explicacoes/regras-de-codigo-teste-e-build.md)).
- **Adaptador preserva o registro original INTEIRO** (`bruto`: `SELECT *`, BLOB em base64, nulo omitido), sem escolher colunas. Exceção: participante de Conversa **direta**, que é derivado e nasce sem `bruto`.
- **O DDL de um passo de migração é fotografia congelada e nunca importa do schema fresco**; a base do piso também. Tabela ou coluna nova leva o passo junto: sem ele `tests/equivalencia-de-forma.test.ts` reprova, de propósito.
- **Endereço se grava na forma CANÔNICA, resolvida antes de escrever** (`resolverEndereco`, com o separador inteiro): a forma alternativa cria segunda identidade. Quem aprende correspondência aprende **antes** do laço que escreve.
- **`tsx` é dependência de RUNTIME; não mover de volta.** O produto roda da fonte (`node --import tsx`); `npm ci --omit=dev` sem ele deixa o host sem como executar (`build` sai 127). O portão do compilador é o `npm test`, que roda `tsc` antes da suíte.
- **Nenhum `process.exit(` direto em `src/`: quem encerra o processo é `cli/encerrar.ts`**, que espera stdout e stderr esvaziarem. `process.exit` logo depois de um `console.log` corta a saída em pipe (~64 KB), e só o agente, que lê por pipe, vê. Os testes que medem isso passam de ~1 MB de saída.
- **SQL se compila pela porta `preparar`, nunca por `db.prepare` direto:** statement compilado por chamada vaza memória que a coleta de lixo não alcança (~3,8 KB por compilação). `iterate`, `pluck`, `raw`, `expand` e `bind` pedem statement próprio. Guarda: `tests/sem-prepare-fora-da-porta.test.ts`.
- **Teste que abre servidor, socket ou timer fecha tudo num `finally`:** asserção que falha antes do `close` deixa o processo vivo e a suíte pendura.
- **Nenhum módulo de `src/nucleo` ou `src/registro` importa `src/adaptadores`** (quem compõe é `src/cli/`); guarda em `tests/fronteira-de-dependencia.test.ts`, inclusive para `import()` dinâmico.
- **O produto não promete confidencialidade contra o Operador da instalação** em nenhuma superfície: código, README, documentação ou mensagem de erro
- **Implementação que contradiz `docs/dominio/` ou `GLOSSARIO.md` atualiza o doc no mesmo commit;** divergência que vira decisão arquitetural ganha ADR própria em `docs/decisoes/`

**Regras por subsistema** (motivo e medição em `docs/explicacoes/`; leia antes de mexer no assunto). Entre parênteses, as mais perigosas de cada uma:

- [Recepção ao vivo, mídia e Envio](docs/explicacoes/invariantes-da-recepcao-e-do-ouvinte.md): a classificação de conteúdo é **medida, nunca deduzida**; a saída default de `ouvinte estado` é contrato com quem vigia a instalação; trabalho de disco na subida do ouvinte pode travá-la.
- [Identidade, nome e catálogo](docs/explicacoes/invariantes-de-identidade-nome-e-catalogo.md): vazio conta como ausente (`??` não serve); o nono dígito brasileiro fica no adaptador; nome-sentinela de biblioteca não é nome.
- [Rede e servidor](docs/explicacoes/invariantes-da-rede-e-do-servidor.md): o modo rede é fail-closed e a guarda morre antes de qualquer I/O; a leitura roda em worker, com prazo, e nunca escreve; o texto do usuário é texto, nunca sintaxe.
- [Acervo, migração e trilha](docs/explicacoes/invariantes-do-acervo-migracao-e-trilha.md): passo que precisa de contexto declara `exigeContexto` e recusa sem ele; a trilha de uma migração se escreve depois dela; verificação contra alvo que se move usa contenção.
- [Ingestão por varredura](docs/explicacoes/invariantes-da-ingestao-por-varredura.md): a varredura invoca a importação em modo de reprocessamento; mover para `processados/` só depois do registro de conclusão.
- [Regras de código, teste e build](docs/explicacoes/regras-de-codigo-teste-e-build.md): o detalhe e as medições das regras de código acima.

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
- **Restart automático no upgrade:** se distribuído por um distribuidor automático, declarar
  `post_install: "restart:<unit1> <unit2> ..."` no entry do config.

## Estado Atual

- **Produção:** v0.33.0 (`production` em `98425a5`); Acervo v26 e Registro v8. A `main` está à frente só com documentação.
- **Suíte:** 1.529 testes, com as 3 falhas pré-existentes de `cli-entrada` e 1 pulado declarado; lint limpo.
- **O histórico de ciclos e releases** vive fora do repositório (documentos internos do autor); as releases estão no `CHANGELOG.md`.

## Pendências

- **A recepção ao vivo descarta, em silêncio, o que não está em `VIRAM_MENSAGEM` (#1158, #1159).** `documentMessage` está na lista e `documentWithCaptionMessage` não: um documento encaminhado com legenda chega embrulhado nesse tipo e é ignorado e contado só em memória (`relato.ignorados`), sem rastro no Acervo. Reproduzido pela função real com evento sintético; o tipo exato do evento de campo não foi inspecionado, e outros embrulhos (mensagem temporária, visualização única, editada) **não foram medidos**. Antes de classificar, medir numa captura real (regra de classificação medida). A #1159 pede guardar cru o que a recepção não grava, para reprocessar.
- **Metadados da coletiva (#1160).** O `assunto` só é gravado na criação da Conversa (`registrarConversa` insere `metadados_de_coletiva` no ramo de INSERT; se a Conversa existe, atualiza só o `bruto`), e a recepção ao vivo não grava assunto nem **descrição** (`descricao` existe na tabela e na porta, e nada a preenche nem a expõe); o ouvinte não escuta `groups.upsert` nem `groups.update`, e o código de evento 2 (troca de assunto) é descartado. Medido: 50 de 820 coletivas sem assunto, incluindo as maiores, todas anteriores ao ouvinte. A tabela de grupo do backup de iOS não tem coluna de descrição.
- **v0.33.0 (flags sem valor e `buscar`, #1136 e #1127) em produção.** Medido depois da publicação, por rede, contra o Acervo real: `buscar` de termo comum em `recentes` mediana 0,99 a 1,01 s contra 0,82 a 0,95 s em `cronologica` (7 execuções de cada, intercaladas; a diferença é de ~0,05 a 0,2 s, bem abaixo do teto de 2 vezes). Flag nova que não leva valor entra em `BANDEIRAS` (`src/cli/bandeiras.ts`): o teste de varredura reprova a que falta ali. Um teste (`varredura.test.ts`, `retencao aplicar sem Política`) é flake sob carga: não perseguir.
- **`--chave-em` só troca a chave em `enviar` e `envio estado`.** Em `conversas`, `mensagens` e as demais leituras ele é ignorado; consultar como outro Inquilino exige a variável de ambiente.
- **O sinal de silêncio do ouvinte é o último evento de mensagem (#1162).** Conta quieta (poucos grupos) fica horas sem mensagem com o ouvinte saudável e gera alarme falso; falta expor o último sinal do socket em `ouvinte estado --json` (a saída default é contrato).
- **Etiqueta: latência da primeira troca.** Uma troca em campo levou ~104 s entre o instante declarado e a aparição por rede; as seguintes, até ~3 s. Se voltar, comparar o `ultimo-evento` do ouvinte com o instante declarado antes de culpar o código.
- **Recepção: evento sem `remoteJid` derrubaria o ouvinte** (leitura fora do `try` por evento; a saída 1 não é reiniciada pelo unit). Não foi medido que a plataforma o entregue; se aparecer, mover a leitura para dentro do tratamento por evento.
- **Sem prova de campo:** envio para **grupo**, imagem/documento **por rede** e a falha
  pós-envio (só teste, com erro injetado).
- **Staging órfão em `envios-pendentes/`** se o `ouvir` cair entre o envio e o
  eco: o mapa de bytes originados é de processo. O produto não detecta nem limpa;
  o guia de armazenamento diz que removê-lo à mão é seguro.
- **Três comandos de decisão do operador nunca rodaram contra o Acervo real:** `malote midia extrair-duracao`, `malote transcricao incluir-estoque` e `malote transcricao solicitar`. Rodar é ato explícito (escreve no Acervo); o backfill de duração do estoque (~270 h de áudio) custa ~195 h de CPU e nunca roda sem `--limite`.
- **#1089 sem medição de campo:** rodar `pessoa promover-identificadores-nomeados` em ensaio (sem `--com-efeito`) e comparar com os 11.043 brutos da spec (a maioria era lixo da #1101, que o filtro já recusa).
- **A promoção pode criar Pessoa com nome EXIBIDO lixo** (limitação conhecida): `titular` = sentinela vence `terceiro` = nome real por rank, e `melhorNome` não filtra sentinela. Só some com a limpeza do estoque da #1101.
- **#1101 corrigiu a escrita, não o estoque:** 14 Pessoas ainda exibem o valor-sentinela (medido em 30/09/2026). `removerNomesInvalidos` cobre só endereço-repetido e marca-duplicata; sentinela e nono dígito são vocabulário de Fonte e pedem comando de limpeza do lado do adaptador antes de rodar em produção.
- **Lote derramado (Acervo ocupado) perde a mídia:** `ouvinte reprocessar` não tem socket vivo nem `MidiaAoVivo`, e a referência pode ter expirado, então o Anexo fica `nunca-obtido`. Limite conhecido, não regressão; se aparecer, é trabalho novo.
- **`GLOSSARIO.md` e o modelo têm ~216 violações de MD013 pré-existentes** (30/08/2026). O gate é `npm run lint`, que não olha markdown: meça a linha de base antes de tratar `markdownlint-cli2` vermelho como regressão.
- **`anexos` sem restrição de unicidade:** no WhatsApp quem impede duplicata é `anexoJaExiste` (o bloco de Anexo roda antes do desvio por Mensagem existente); no Instagram, o `continue`. Ao mexer em importação, conferir os dois.
- **Participante de coletiva do Instagram sem nome na lista de sem-endereço:** o nome está em `nome-exibicao:<Nome>` e nunca virou Atribuição. Deliberado no ciclo 3; uniformizar são duas linhas no adaptador.
- **A impressão do Material do Instagram percorre a árvore inteira** (610 `stat` no material medido): barato hoje, cresce com o número de Conversas. Medir antes de aceitar material de alguns milhares.
- **O detector de integridade da mesclagem não tem chamador automático:** `malote pessoa conferir` (sai 1 ao achar Pessoa apontando para quem não é mestre) só roda à mão. Antes de assumir a estrela íntegra num Acervo antigo, rodá-lo; produtor novo de escrita em `pessoas` pede chamá-lo na abertura.
- **A Política de Retenção só se sobrescreve** (`retencao definir` faz upsert; não há `retencao remover`, e política sem critério é recusada de propósito). Remover seria comando novo, não relaxar a recusa.

## Referências

- [[docs/arquitetura.md]] — mapa estrutural do repo (mapa fino, isento — carga sob demanda)
- [[docs/explicacoes/visao-geral.md]] — o quê e por quê (quadrante explicação, carga sob demanda)
- [[docs/decisoes/]] — ADRs locais
- [[docs/explicacoes/]] — `invariantes-*.md` e `regras-de-codigo-teste-e-build.md`: regras por subsistema, com motivo e medição
- [[GLOSSARIO]] — vocabulário do domínio, `aprovado`
- [[docs/dominio/malote]] — modelo de domínio, `aprovado`
