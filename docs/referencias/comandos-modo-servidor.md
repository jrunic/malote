---
id: 202610050310
projeto: malote
tipo: referencia
escopo: repo:malote
plataforma: "*"
status: ativo
dominios: [tecnologia]
descricao: "Referência — os comandos do malote no modo servidor (local, no host): ambiente, autenticação, administração, importação, ouvinte, mídia, transcrição, identidade e o próprio servidor de consulta"
tags: [referencia, servidor, local, comandos, cli]
---

# Referência: comandos do `malote` no modo servidor (local, no host)

O **modo servidor** é o `malote` rodando **na máquina que tem o dado**: ele abre o Registro e os Acervos
direto no disco. É onde se administra, se importa, se ouve o WhatsApp e se sobe o servidor de consulta.
A consulta por rede, de outra máquina, é o [modo cliente](comandos-modo-cliente.md). Instalação, unidades de
serviço e saúde: [guia do host](../guias/host-continuo-ouvinte-e-api.md); onde cada coisa mora no disco:
[guia de armazenamento](../guias/instalacao-e-armazenamento.md).

`malote --ajuda` imprime a lista completa e é a fonte da verdade; esta referência a agrupa e explica.
`malote --versao` imprime a versão sem exigir instalação.

## Como o modo é escolhido, e onde estão os dados

- **Sem `MALOTE_SERVIDOR` no ambiente, o comando roda local.** Com ela, só os comandos de consulta e de
  Envio vão por rede, e o resto é recusado (veja o modo cliente, que lista as exceções de hoje).
- **Onde ficam os dados:** dado irrecuperável (Registro, Acervos, mídia, material) em `XDG_DATA_HOME/malote`;
  estado do ouvinte (vínculo de sessão, derrame, guarda de descartes, último evento) em
  `XDG_STATE_HOME/malote`; parte se refaz e parte não (veja o guia de armazenamento).
  **`MALOTE_HOME`** move a instalação inteira para uma pasta só, e vale para todos os serviços.
- **Quase todo comando pede `--inquilino <id>`**: o Acervo é um por Inquilino.

### Autenticação

- **Comandos administrativos** (`operador`, `inquilino`, `acesso` e `operacao`) exigem **`--chave <Chave de Operador>`**.
  A **primeira** Chave de Operador dispensa credencial: a raiz de confiança é o acesso à máquina. A partir
  dela, toda administração exige `--chave`, inclusive criar outra Chave.
- **Os demais comandos locais** (importar, ouvir, consultar, pessoa...) não pedem chave: quem roda no
  host já tem o dado.
- **Gravam a trilha.** Toda decisão que escreve registra uma **Operação** com o efeito linha a linha, e
  `malote operacao desfazer` a reverte quando o desenho permite.

### Ensaio por padrão

Comando que altera muito, ou que não tem volta, **não faz nada por padrão: mostra o que faria**. Para
valer, `--com-efeito` e `--confirmo` juntos. Vale para `pessoa propostas aplicar`,
`pessoa remover-nomes-invalidos`, `pessoa promover-identificadores-nomeados`, `identidade resolver-enderecos`,
`contato-compartilhado extrair`, `citacao extrair`, `midia extrair-imagem-de-modelo`, `retencao aplicar` e `operacao desfazer`.
`--com-efeito` sem `--confirmo` não executa, mas o código de saída varia: a maioria lança o erro e sai 1,
`retencao aplicar` sai 2 e `operacao desfazer` cai no ensaio e sai 0.
`acervo recriar` exige `--confirmo` e **apaga o Acervo e os arquivos do Inquilino**.

## Administração

| comando | o que faz |
|---|---|
| `operador chave criar [--chave <valor>]` | Cria uma Chave de Operador. O valor impresso **não é recuperável** |
| `operador chave listar --chave <valor>` | Lista as Chaves de Operador |
| `operador chave revogar --chave <valor> --id <id>` | Revoga uma Chave de Operador |
| `operador espaco --chave <valor>` | O espaço que o Acervo de cada Inquilino ocupa em disco |
| `inquilino criar --chave <valor> --titular <nome>` | Cria um Inquilino |
| `inquilino listar --chave <valor> [--json]` | Lista os Inquilinos |
| `inquilino destino --chave <valor> --inquilino <id> --endereco <caminho>` | Declara o **Destino de Mídia**: a pasta onde os arquivos do Inquilino ficam |
| `acesso chave emitir --chave <valor> --inquilino <id>` | Emite uma **Chave de Acesso** para um consumidor (o valor não é recuperável) |
| `acesso chave listar --chave <valor> --inquilino <id>` | Lista as Chaves de Acesso do Inquilino |
| `acesso chave revogar --chave <valor> --id <id>` | Revoga uma Chave de Acesso (vale na requisição seguinte) |

## Configurações, importação e material

A **Configuração de Adaptador** (`--configuracao <apelido>`) é a conta de uma Fonte. **`importar` e `ouvir`
exigem o apelido, sem padrão.**

| comando | o que faz |
|---|---|
| `configuracao criar --inquilino <id> --fonte <nome> --configuracao <apelido> [--conta <nome>] [--telefone <dígitos>]` | Declara a conta, sem exigir material. Para WhatsApp o `--telefone` (só dígitos, com código do país, de 10 a 15) é **obrigatório**; sem ele, ou com valor inválido, sai 2 |
| `configuracao definir-telefone --inquilino <id> --configuracao <apelido> --telefone <dígitos>` | Declara o telefone de uma Configuração de WhatsApp que ainda não o tem (a que nasceu pela importação, ou a que não tem vínculo vivo). Recusa trocar o telefone de uma conta que o vínculo já conferiu |
| `configuracao listar --inquilino <id>` | Lista as Configurações; as de WhatsApp mostram `telefone`, `jid` e `lid` (`(nao declarado)` / `(nao conferido)` até existirem) |
| `importar --inquilino <id> --fonte whatsapp --material <caminho> --configuracao <apelido> [--conta pessoal\|business] [--reprocessar]` | Importa o backup do WhatsApp |
| `importar --inquilino <id> --fonte instagram --material <caminho> --titular <nome> --configuracao <apelido>` | Importa o export do Instagram |
| `importar --inquilino <id> --fonte contatos --material <arquivo.vcf> [--configuracao <apelido>] [--reprocessar]` | Importa o catálogo de contatos (vCard) |
| `entrada declarar --inquilino <id> --fonte <nome> --configuracao <apelido> --pasta <caminho> --natureza completo\|parcial [--titular-na-fonte <nome>]` | Declara uma **Pasta de Entrada** (só Fontes que a varredura lê) |
| `entrada listar --inquilino <id>` | Lista as Pastas de Entrada |
| `material listar --inquilino <id>` | Lista os Materiais já importados |
| `material varrer --inquilino <id> [--configuracao <apelido>]` | Varre as Pastas de Entrada e importa o que chegou. **Nada o chama sozinho**: o gatilho (um timer) é de quem instala |
| `material intervalo --inquilino <id> [--configuracao <apelido>] [--fonte <nome>] --dias <n>` | Declara de quantos em quantos dias se espera um Material novo. **Sem `--fonte` assume `whatsapp`** e, se o apelido não existe nessa Fonte, cria a Configuração (#1287): passe `--fonte` para Instagram e contatos |
| `material atraso --inquilino <id>` | Mostra o atraso do Material em relação ao intervalo declarado |

O mesmo telefone não pode pertencer a duas Configurações de WhatsApp do mesmo Inquilino, e o celular
brasileiro com e sem o nono dígito conta como o mesmo telefone.

## Ouvinte (WhatsApp ao vivo)

| comando | o que faz |
|---|---|
| `ouvir --inquilino <id> --conta <nome> --configuracao <apelido> [--numero <so digitos>]` | O ouvinte: recebe do WhatsApp e grava. **Um processo por conta**; roda como serviço (`malote-ouvinte@<conta>`). Sem `--configuracao` sai 2. No **primeiro pareamento**, `--numero` (só dígitos, com o código do país) é obrigatório para receber o código. Saídas: `0` parada pedida, `1` vínculo invalidado ou falha local de subida (Inquilino desconhecido, não consegui conectar), `2` configuração errada ou vínculo de outra conta, `70` exceção que a biblioteca deixou escapar (o unit reinicia) |
| `ouvinte estado --conta <nome> [--json]` | O instante do último evento recebido, lido de um arquivo, **sem abrir o Acervo**. Conta sem evento registrado sai 1, também com `--json`. É o que a vigilância de silêncio lê; a saída padrão é contrato com ela. O `--json` traz `conta`, `ultimoEvento`, `derramados`, `lotes`, `correspondencia`, `ultimoRetrato` e `pulos`, e também `descartes`: a série diária, por tipo, do que a recepção não gravou como Mensagem (últimos 30 dias, só tipos e números, nunca conteúdo) e `guarda`: quantos eventos (`eventos`) e quantos bytes (`bytes`) a guarda do evento cru ocupa; e `instantesAdiantados`: a série diária, só em números, das Mensagens gravadas apenas por causa da tolerância de relógio da recepção (até 5 s à frente do relógio local; últimos 30 dias); e `ultimoSinalDaConexao`: o instante do último frame que a Conexão recebeu do WhatsApp (ISO), ou `null` quando o sinal está indisponível. Anda mesmo em conta sem Mensagem; é gravado no máximo a cada 15 s; e `pendentes`: o estado dos Pendentes da Plataforma da última Conexão (#1151), só tipos e números: `socketCriadoEm` (que identifica a Conexão: as linhas de resumo do registro levam o mesmo valor em `conexao=`), `abertoEm`, `atualizadoEm` (instantes em milissegundos), `anunciados` (total e por tipo, ou `null` se a Conexão não teve anúncio), `recebidos` por tipo, `falhasDeDecifra` (`null` se a biblioteca não deixou observar), `pedidos`, `nosPorPedido`, `liberadoEm`, `fimDeclaradoEm` e `desfecho` (`em-andamento`, `fim-natural`, `recolheu`, `sem-resposta`, `teto`, `prazo`, `falha-de-envio` ou `encerrou-antes`). `null` é indisponível (arquivo ausente, ilegível ou fora do contrato), nunca "sem pendentes". `em-andamento` com `atualizadoEm` velho e `ultimoSinalDaConexao` parado é processo morto, não Pendentes presos; `teto`, `prazo` e `sem-resposta` não provam entrega, e o aviso de fim que chega depois deles corrige o desfecho para `recolheu`. Não reusa `lotes`, que é do Derrame |
| `ouvinte reprocessar --inquilino <id> --conta <nome> --configuracao <apelido>` | Grava o que caiu no derrame (Acervo ocupado), edição de Mensagem incluída (a saída diz quantas edições entraram). **Recusa com o ouvinte no ar** |
| `ouvinte reprocessar-descartados --inquilino <id> --conta <nome> --configuracao <apelido>` | Reprocessa o evento cru que a recepção guardou por não gravá-lo como Mensagem. **Recusa com o ouvinte no ar.** Sai da guarda o que passou a ser gravado e o que passou a ser ruído (a saída diz quantos foram gravados, mantidos e retirados, e quantas edições de Mensagem entraram); fica o que ainda é descartado |

## Envio de mensagem

| comando | o que faz |
|---|---|
| `enviar --inquilino <id> --configuracao <apelido> (--para <endereco> \| --conversa <id>) (--texto <t> \| --imagem <caminho> \| --documento <caminho>)` | Solicita um Envio, pelo disco. `--imagem` e `--documento` aceitam `--texto` como legenda. A conta (`--configuracao`) é sempre explícita. `--conversa` envia à Conversa pelo id; na direta, a conta tem de ser a dona dela (código 2 se não), e Conversa inexistente, feed de status e lista de transmissão também saem 2. A saída diz a conta e a Conversa |
| `envio estado --inquilino <id> [--json]` | A contagem de Envios por estado |
| `envio reprocessar --inquilino <id> [--json]` | Volta Envios com falha para pendente. **Só local** |

O ouvinte processa a fila de Envios. O mesmo `enviar` e `envio estado`, sem `--inquilino` e com
`MALOTE_SERVIDOR`, pedem **por rede** (veja o modo cliente).

## Mídia, retenção e transcrição

| comando | o que faz |
|---|---|
| `midia trazer --inquilino <id> --material <caminho> [--conta pessoal\|business]` | Traz para o Destino de Mídia os arquivos de um backup do aparelho |
| `midia reprocessar --inquilino <id>` | Tenta de novo os Anexos recebidos ao vivo que falharam ao baixar, **dentro do recorte** que você dá, da Mensagem mais antiga para a mais nova. **Sem recorte e sem `--tudo` recusa** (sai 2) e diz quantos Anexos tentaria. `--ensaio` só conta (candidatos, elegíveis, por tipo e por dia em UTC), sem baixar nem escrever, e funciona sem Destino de Mídia. Recortes, que combinam por E: `--desde D` e `--ate D` (`AAAA-MM-DD` em UTC, inclusivos, sobre o instante da Mensagem), `--tipo image\|video\|audio\|document\|sticker\|other` (ou `imagem`, `documento`), `--mensagem <id>` e `--limite <n>`, que conta **tentativas** (as que falham também) e nunca é gasto por Anexo que não é de recepção ao vivo. `--tudo` só dispensa a exigência de recorte: com um recorte junto, vale o recorte, e sem ele tenta todos os elegíveis. A saída diz quantos elegíveis ficaram de fora pelo limite. O comando não registra Operação e não se desfaz: o arquivo baixado fica no Destino |
| `midia extrair-duracao --inquilino <id> [--json]` | Extrai a duração dos Anexos do Conteúdo Bruto já gravado |
| `midia extrair-imagem-de-modelo --inquilino <id> [--com-efeito --confirmo] [--json]` | Cria o Anexo `nunca-obtido` da imagem do cabeçalho das Mensagens de modelo de conta comercial já gravadas (ensaio por padrão; uma Operação por lote, que `desfazer` remove enquanto o Anexo não foi baixado). Só conta no relatório. Para baixar, `midia reprocessar --mensagem` |
| `citacao extrair --inquilino <id> [--desde <data>] [--ate <data>] [--limite <n>] [--com-efeito --confirmo] [--json]` | Preenche a Citação das Mensagens já gravadas que respondem a outra, a partir do Conteúdo Bruto (id da citada, autor e direção). Ensaio por padrão: conta as que citam, quantas têm a citada no Acervo e quantas ficam só pelo id externo, sem escrever nada. `--desde`, `--ate` (inclusivos) e `--limite` (inteiro maior que zero; outro valor sai com código 2) recortam a passada. A leitura roda fora da transação, em páginas por posição física; a gravação é **uma Operação só, numa transação**, com um efeito por Mensagem, e `desfazer` devolve as colunas a nulo: num Acervo grande com o ouvinte no ar, grave em fatias (`--desde`/`--ate`/`--limite`) para a transação ficar curta, e cada fatia tem o seu `desfazer`. O ensaio conta a parte, em `semContexto`, as Mensagens de WhatsApp com Conteúdo Bruto e sem o contexto de citação (importação de backup, ou que não citam), que o comando ignora. A conta própria é a da Configuração dona da Conversa direta; na coletiva só vale quando o Inquilino tem **uma** conta com endereço conhecido (com duas, a direção da citada que o Acervo não tem fica nula). O `desfazer` não remove os Identificadores que o comando criou |
| `contato-compartilhado extrair --inquilino <id> [--com-efeito --confirmo] [--json]` | Preenche os contatos enviados dentro de Mensagens já gravadas, a partir do Conteúdo Bruto. Ensaio por padrão; `desfazer` remove o que criou |
| `retencao definir --inquilino <id> [--mais-velho-que-dias <n>] [--maior-que-mb <n>] [--tipos video,audio]` | Define a Política de Retenção. Não há como removê-la, só sobrescrever |
| `retencao ver --inquilino <id>` | Mostra a Política |
| `retencao aplicar --inquilino <id> [--com-efeito --confirmo]` | Descarta os arquivos que a Política alcança. **Sem volta** |
| `transcricao estado --inquilino <id> [--json]` | Contagem por estado, e se o motor está configurado |
| `transcricao reprocessar --inquilino <id>` | Volta as falhas para pendente |
| `transcricao incluir-estoque --inquilino <id> --limite <n> [--json]` | Promove o estoque `fora-de-escopo` para a fila, **em lote controlado** |
| `transcricao solicitar --anexo <id> --inquilino <id>` | Prioriza **um** Anexo na fila |

A transcrição roda dentro do `malote servir` e usa binários de sistema declarados por variável de
ambiente: `MALOTE_WHISPER_BINARIO`, `MALOTE_WHISPER_MODELO`, `MALOTE_FFMPEG_BINARIO`; opcionais
`MALOTE_TRANSCRICAO_IDIOMA`, `MALOTE_TRANSCRICAO_THREADS` e `MALOTE_TRANSCRICAO_INTERVALO_MS`.
Sem elas, a fila fica parada e o `servir` diz isso ao subir.

## O servidor de consulta

```bash
malote servir --porta <n> [--endereco <ip>] [--exposto] [--trabalhadores <n>] [--prazo <segundos>]
```

| flag | o que faz |
|---|---|
| `--porta <n>`\* | A porta |
| `--endereco <ip>` | Onde escutar. Padrão `127.0.0.1`. Qualquer outro endereço alcançável de fora é **recusado** sem `--exposto` |
| `--exposto` | Autoriza escutar fora do loopback. O produto **não termina TLS**: a exposição é de quem opera, atrás de um proxy com certificado |
| `--trabalhadores <n>` | Workers de leitura, de 1 a 16 (padrão 4) |
| `--prazo <segundos>` | Prazo de uma leitura, de 1 a 300 (padrão 25). Passou, `504` |

Como dimensionar, o que os `504`, `503` e `500` significam, a recusa de subir com código 1 e a parada em
etapas estão na seção 4.3 do [guia do host](../guias/host-continuo-ouvinte-e-api.md). A variável
`MALOTE_ENVIO_INTERVALO_MS` (padrão 5.000 ms) é do `ouvir`: o intervalo com que ele olha a fila de Envios.

## Acervo e identidade

| comando | o que faz |
|---|---|
| `acervo relatar --inquilino <id>` | O relatório do Acervo: por Fonte, tipo, natureza e idade, com a divergência entre banco e disco |
| `acervo migrar --inquilino <id>` | Sobe a forma do Acervo por passos, e diz o que fez. **O único caminho com as duas bases**; faça backup antes |
| `acervo recriar --inquilino <id> --confirmo` | **Apaga** o Acervo e os arquivos do Inquilino |
| `pessoa listar --inquilino <id> [--incluir-absorvidas]` | Lista as Pessoas |
| `pessoa ver --inquilino <id> --pessoa <id>` | Mostra uma Pessoa |
| `pessoa propostas --inquilino <id> [--produtor telefone\|email\|nome\|multiplos-enderecos] [--limite <n>] [--json]` | Calcula Propostas de identidade a partir do catálogo |
| `pessoa propostas aplicar --inquilino <id> [--produtor <nome>] [--com-efeito --confirmo] [--json]` | Aplica as Propostas, em **uma** Operação |
| `pessoa vincular --inquilino <id> --identificador <id> (--pessoa <id> \| --nome <nome>)` | Vincula um Identificador a uma Pessoa, existente ou nova |
| `pessoa desvincular --inquilino <id> --identificador <id>` | Desfaz o vínculo |
| `pessoa mesclar --inquilino <id> --pessoa <id> --pessoa <id> [--mestre <id>]` | Mescla duas Pessoas: a absorvida **aponta** para a mestre e mantém tudo |
| `pessoa desfazer-mesclagem --inquilino <id> --pessoa <id>` | Desfaz a mesclagem |
| `pessoa conferir --inquilino <id>` | Detector de integridade da mesclagem. Sai 1 se achar Pessoa apontando para quem não é mestre |
| `pessoa remover-nomes-invalidos --inquilino <id> [--com-efeito --confirmo]` | Remove Atribuição de nome que repete o próprio endereço ou duplica outra por marca invisível. Ensaio por padrão. **O `desfazer` desta Operação não restaura os nomes** (#1283) |
| `pessoa promover-identificadores-nomeados --inquilino <id> [--limite <n>] [--com-efeito --confirmo]` | Promove a Pessoa os Identificadores sem Pessoa que já têm nome utilizável. Ensaio por padrão; escreve no Acervo. Nunca foi medido em campo |
| `pessoa precedencia --inquilino <id> [--origem <nome> --peso <n>] [--catalogo-preferido <apelido>]` | Ajusta a precedência entre as origens de nome, e qual catálogo é o preferido |
| `identidade resolver-enderecos --inquilino <id> [--com-efeito --confirmo] [--json]` | Resolve, no Acervo existente, os endereços na forma alternativa para a canônica. Reversível |
| `operacao listar --inquilino <id> --chave <valor>` | Lista as 50 Operações mais recentes da trilha (do Acervo e do Registro) |
| `operacao ver <id> --inquilino <id> --chave <valor>` | O efeito linha a linha de uma Operação |
| `operacao desfazer <id> --inquilino <id> --chave <valor> [--com-efeito --confirmo]` | Desfaz uma Operação. A do Registro (configuração) **não** se desfaz: redefine-se. Só se desfaz o que tem porta de restauração (ver #1283); a linha sem porta volta como recusada, e o resto segue |

## Consulta local

As mesmas consultas do modo cliente, lendo o Acervo direto, com `--inquilino <id>`:
`conversas`, `mensagens`, `anexos`, `exportar`, `buscar`, `pessoas`, `participantes`, `etiquetas`, `chegadas`, `identificar <valor>` e `detalhar`. Flags, formatos e o
significado de `--remetente` e `--autor` estão na [referência do modo cliente](comandos-modo-cliente.md); a
diferença é o `--inquilino` e o fato de **`malote midia <id>`** (os bytes do Anexo) só existir por rede:
local, o arquivo já está em disco, e o caminho vem no campo `caminho` de `mensagens --json`. A resposta de `buscar` traz `truncado`, e `ordem` aceita `recentes` (padrão) ou `cronologica`.

Além delas, só existem locais:

| comando | o que faz |
|---|---|
| `conversas sem-endereco --inquilino <id> [--limite <n>]` | Os endereços que **ainda não têm Pessoa**, do que mais cobre Mensagens para o que menos (Mensagens, Conversas, nome, Fonte, valor e id). É a lista de trabalho de quem vincula: o endereço do próprio Titular costuma vir primeiro |
| `conversa presenca --inquilino <id> --conversa <id> --em <AAAA-MM-DD> [--json]` | Quem estava na Conversa numa data, dentro do Alcance declarado |

## Códigos de saída

`0` deu certo; `1` erro; `2` invocação errada. Os códigos 3 a 7 são do modo cliente. A divisão entre `1` e `2` para
**flag obrigatória faltando** não é uniforme: sai `2` em `ouvinte`, `ouvir`, `servir`, `transcricao`, `midia reprocessar`,
`midia extrair-duracao`, `configuracao criar` e `definir-telefone`, `entrada`, `envio` e `enviar`; sai `1` (o erro cai no
tratamento geral) em `importar`, `pessoa`, `acervo`, `material`, `retencao`, `inquilino`, `operacao` e nas consultas
locais. Alguns `1` são **veredito, não erro**, o que importa a quem os pendura num agendador: `material atraso`
(alguma Configuração atrasada), `material varrer` (houve falha), `ouvinte estado` (sem evento registrado),
`ouvinte reprocessar` (lote parcial), `transcricao solicitar` (recusado) e `pessoa conferir` (achou violação).
