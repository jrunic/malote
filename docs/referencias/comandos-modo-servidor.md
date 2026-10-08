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
  Envio vão por rede, e o resto é recusado (veja o modo cliente).
- **Onde ficam os dados:** dado irrecuperável (Registro, Acervos, mídia, material) em `XDG_DATA_HOME/malote`;
  estado que se refaz (vínculo de sessão, derrame, último evento) em `XDG_STATE_HOME/malote`.
  **`MALOTE_HOME`** move a instalação inteira para uma pasta só, e vale para todos os serviços.
- **Quase todo comando pede `--inquilino <id>`**: o Acervo é um por Inquilino.

### Autenticação

- **Comandos administrativos** (`operador`, `inquilino`, `acesso`) exigem **`--chave <Chave de Operador>`**.
  A **primeira** Chave de Operador dispensa credencial: a raiz de confiança é o acesso à máquina. A partir
  dela, toda administração exige `--chave`, inclusive criar outra Chave.
- **Os demais comandos locais** (importar, ouvir, consultar, pessoa...) não pedem chave: quem roda no
  host já tem o dado.
- **Gravam a trilha.** Toda decisão que escreve registra uma **Operação** com o efeito linha a linha, e
  `malote operacao desfazer` a reverte quando o desenho permite.

### Ensaio por padrão

Comando que altera muito, ou que não tem volta, **não faz nada por padrão: mostra o que faria**. Para
valer, `--com-efeito` e `--confirmo` juntos. Vale para `pessoa propostas aplicar`,
`pessoa remover-nomes-invalidos`, `identidade resolver-enderecos`, `retencao aplicar` e `operacao desfazer`.
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
| `material intervalo --inquilino <id> [--configuracao <apelido>] --dias <n>` | Declara de quantos em quantos dias se espera um Material novo |
| `material atraso --inquilino <id>` | Mostra o atraso do Material em relação ao intervalo declarado |

O mesmo telefone não pode pertencer a duas Configurações de WhatsApp do mesmo Inquilino, e o celular
brasileiro com e sem o nono dígito conta como o mesmo telefone.

## Ouvinte (WhatsApp ao vivo)

| comando | o que faz |
|---|---|
| `ouvir --inquilino <id> --conta <nome> [--numero <so digitos>]` | O ouvinte: recebe do WhatsApp e grava. **Um processo por conta**; roda como serviço (`malote-ouvinte@<conta>`). No **primeiro pareamento**, `--numero` (só dígitos, com o código do país) é obrigatório para receber o código |
| `ouvinte estado --conta <nome> [--json]` | O instante do último evento recebido, lido de um arquivo, **sem abrir o Acervo**. É o que a vigilância de silêncio lê; a saída padrão é contrato com ela. O `--json` traz também `descartes`: a série diária, por tipo, do que a recepção não gravou como Mensagem (últimos 30 dias, só tipos e números, nunca conteúdo) |
| `ouvinte reprocessar --inquilino <id> --conta <nome> --configuracao <apelido>` | Grava o que caiu no derrame (Acervo ocupado). **Recusa com o ouvinte no ar** |

## Envio de mensagem

| comando | o que faz |
|---|---|
| `enviar --inquilino <id> --configuracao <apelido> --para <endereco> (--texto <t> \| --imagem <caminho> \| --documento <caminho>)` | Solicita um Envio, pelo disco. `--imagem` e `--documento` aceitam `--texto` como legenda |
| `envio estado --inquilino <id> [--json]` | A contagem de Envios por estado |
| `envio reprocessar --inquilino <id> [--json]` | Volta Envios com falha para pendente. **Só local** |

O ouvinte processa a fila de Envios. O mesmo `enviar` e `envio estado`, sem `--inquilino` e com
`MALOTE_SERVIDOR`, pedem **por rede** (veja o modo cliente).

## Mídia, retenção e transcrição

| comando | o que faz |
|---|---|
| `midia trazer --inquilino <id> --material <caminho> [--conta pessoal\|business]` | Traz para o Destino de Mídia os arquivos de um backup do aparelho |
| `midia reprocessar --inquilino <id>` | Tenta de novo os Anexos recebidos ao vivo que falharam ao baixar. Tenta **todos** os elegíveis |
| `midia extrair-duracao --inquilino <id> [--json]` | Extrai a duração dos Anexos do Conteúdo Bruto já gravado |
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
| `pessoa remover-nomes-invalidos --inquilino <id> [--com-efeito --confirmo]` | Remove Atribuição de nome que repete o próprio endereço ou duplica outra por marca invisível. Ensaio por padrão |
| `pessoa precedencia --inquilino <id> [--origem <nome> --peso <n>] [--catalogo-preferido <apelido>]` | Ajusta a precedência entre as origens de nome, e qual catálogo é o preferido |
| `identidade resolver-enderecos --inquilino <id> [--com-efeito --confirmo] [--json]` | Resolve, no Acervo existente, os endereços na forma alternativa para a canônica. Reversível |
| `operacao listar --inquilino <id> [--chave <valor>]` | Lista as Operações da trilha |
| `operacao ver <id> --inquilino <id> [--chave <valor>]` | O efeito linha a linha de uma Operação |
| `operacao desfazer <id> --inquilino <id> [--com-efeito --confirmo]` | Desfaz uma Operação. A do Registro (configuração) **não** se desfaz: redefine-se |

## Consulta local

As mesmas consultas do modo cliente, lendo o Acervo direto, com `--inquilino <id>`:
`conversas`, `mensagens`, `anexos`, `exportar`, `buscar`, `pessoas`, `participantes`, `etiquetas` e `identificar <valor>`. Flags, formatos e o
significado de `--remetente` e `--autor` estão na [referência do modo cliente](comandos-modo-cliente.md); a
diferença é o `--inquilino` e o fato de **`malote midia <id>`** (os bytes do Anexo) só existir por rede:
local, o arquivo já está em disco, e o caminho vem no campo `caminho` de `mensagens --json`. A resposta de `buscar` traz `truncado`, e `ordem` aceita `recentes` (padrão) ou `cronologica`.

Além delas, só existem locais:

| comando | o que faz |
|---|---|
| `conversas sem-endereco --inquilino <id> [--limite <n>]` | Os endereços que **ainda não têm Pessoa**, do que mais cobre Mensagens para o que menos (Mensagens, Conversas, nome, Fonte, valor e id). É a lista de trabalho de quem vincula: o endereço do próprio Titular costuma vir primeiro |
| `conversa presenca --inquilino <id> --conversa <id> --em <AAAA-MM-DD> [--json]` | Quem estava na Conversa numa data, dentro do Alcance declarado |

## Códigos de saída

`0` deu certo; `1` erro; `2` invocação errada (flag faltando, comando desconhecido, valor inválido). Os
códigos 3 a 7 são do modo cliente. Exceção: `pessoa conferir` sai `1` quando encontra violação.
