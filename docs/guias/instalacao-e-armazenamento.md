---
id: 202609160030
projeto: malote
tipo: guia
escopo: repo:malote
plataforma: "*"
status: ativo
dominios: [tecnologia]
descricao: "Guia — onde o malote guarda cada coisa (XDG por categoria, MALOTE_HOME), permissões, serviço de sistema e backup por categoria"
tags: [guia, instalacao, xdg, backup, systemd]
---

# Guia: instalação, armazenamento e operação contínua

Como instalar o malote para uso contínuo, onde ele guarda cada coisa, e como operar isso —
backup, serviço de sistema, movimentação de instalação. Para o primeiro contato, comece pelo
[tutorial](../tutoriais/instalar.md). A decisão de armazenamento está registrada na
[ADR de armazenamento por categoria](../decisoes/20260916-armazenamento-por-categoria-xdg.md).
A arquitetura completa num host 24/7 — ouvinte por conta e servidor de consulta — está no
[guia do host contínuo](host-continuo-ouvinte-e-api.md).

## Onde está cada coisa

**Tudo desta seção vive na máquina servidora** — a que guarda o Acervo e roda os serviços.
A máquina cliente não tem pasta do produto, não guarda conversa e não precisa de backup de
Acervo (ver [cliente × servidor](cliente-e-agente.md)).

| variável | o que guarda | se perder |
|---|---|---|
| `XDG_DATA_HOME` (default `~/.local/share`) | `malote/` com Registro, Acervos, mídia, material — **dado** | não se reconstrói |
| `XDG_STATE_HOME` (default `~/.local/state`) | `malote/` com vínculo do ouvinte, fila de derrame, guarda de descartes, último evento — **estado** | em parte se refaz; o vínculo é credencial e o derrame e a guarda não se recriam |
| `MALOTE_HOME` | **tudo** numa pasta só | — |

Regras que o produto segue (e testa):

- variável **vazia** = ausente (usa o default);
- caminho **relativo** é ignorado — cai no default;
- as pastas que o produto cria nascem `0700`; os arquivos de conversa em claro do estado do
  ouvinte (o derrame e o `.envenenado.jsonl`) seguem hoje a `umask` do processo, e só a guarda
  de descartes é `0600`, então crie a pasta da conta com `mkdir -m 700` (#1289);
- os caminhos são os mesmos em qualquer sistema operacional.

Dentro de `XDG_DATA_HOME/malote/`, o Envio de imagem ou documento usa uma pasta de
trabalho: `envios-pendentes/`. Cada arquivo ali é a cópia que um pedido de Envio ainda
vai enviar. Quando a mensagem sai e o eco chega, o malote **move** a cópia para
`envios-pendentes/processados/` e nunca a apaga — limpar `processados/` é seu. Um arquivo
que ficar em `envios-pendentes/` fora de `processados/` depois de o Envio estar
`enviado` é resíduo de um `malote ouvir` que caiu entre o envio e o eco: o produto não o
detecta nem o limpa, e removê-lo à mão é seguro.

## Backup — por categoria, não por lista

A pergunta que separa as duas categorias: *se eu apagar isto, o que se perde?*

- **`XDG_DATA_HOME/malote/` é irrecuperável.** É o que entra no backup. A mídia costuma ser a
  maior parte e vive **onde o Destino de Mídia aponta** (`inquilino destino --endereco`), que é
  um caminho qualquer e pode estar fora desta pasta: inclua esse caminho no backup à parte. Se
  o material original ainda existe na fonte, o custo/benefício de incluir a mídia é seu.
- **`XDG_STATE_HOME/malote/` não vai para backup rotineiro.** O que ali se refaz, se refaz;
  as exceções são `ouvinte/<conta>/vinculo` — credencial de sessão cuja perda custa um
  pareamento novo na frente do aparelho; `nao-gravados.jsonl` (o derrame: eventos que o Acervo
  ocupado não aceitou e que a plataforma não reentrega) e o `.envenenado.jsonl` que ele pode
  gerar; e `descartados.jsonl` (a guarda do evento cru, deliberadamente fora do backup). Os três
  últimos têm conversa em claro. Copie o vínculo (por **cópia**, nunca movendo) quando for mexer
  na instalação.

### Cópia consistente do Acervo

O Acervo é um banco em modo WAL, e o ouvinte e o servidor o mantêm aberto. Copiar o arquivo
`.db` com o serviço no ar não é backup: a cópia pode sair sem o que ainda está no arquivo
`-wal`. Antes de **atualizar para uma versão que muda a forma do Acervo** (o changelog diz),
faça uma cópia consistente. Depois de migrado, a versão anterior do produto não abre o
Acervo, e a cópia é a volta. Duas formas, ambas corretas:

- **Com o serviço parado,** copie o `.db` **junto** dos arquivos `-wal` e `-shm` da mesma
  pasta, nunca só o `.db`.
- **Com o serviço no ar,** use `VACUUM INTO`, a partir da pasta do produto e com a base aberta
  **somente para leitura**: ele tira uma fotografia consistente numa só transação de leitura, sem
  parar quem escreve, e grava um arquivo novo (o destino não pode existir):
  `node -e "const D=require('better-sqlite3');
  new D(process.argv[1],{readonly:true}).prepare('VACUUM INTO ?').run(process.argv[2])"
  <origem.db> <destino.db>`. **Não use a API de backup do SQLite** (`db.backup`) com o serviço
  no ar: ela recomeça a cada escrita de outro processo e, num Acervo que recebe mensagens, não
  termina (medido: 60 s sem concluir num banco de 300 MB com um escritor a cada 20 ms,
  contra 380 ms do `VACUUM INTO`).

Confira a cópia abrindo-a somente leitura e rodando `PRAGMA integrity_check`.

## Serviço de sistema

Em uma instalação de uso contínuo, o ouvinte roda como serviço. O produto roda da fonte:

```ini
[Service]
User=voce
WorkingDirectory=/caminho/do/malote
ExecStart=/usr/bin/node --import tsx src/cli/index.ts ouvir \
  --inquilino <id> --conta <nome> --configuracao <apelido>
Restart=on-failure
RestartSec=10
RestartPreventExitStatus=0 1 2
```

Propriedades do encerramento que valem para o supervisor:

- saída **0** = parada pedida (sinal) — não é caso de reiniciar;
- saída **1** = vínculo invalidado pela plataforma (exige pareamento humano) ou falha local de
  subida (Inquilino desconhecido, não consegui conectar); reiniciar em laço não resolve e pode
  agravar;
- saída **2** = erro de configuração, ou vínculo de outra conta que a da Configuração;
  corrija o cadastro, não reinicie;
- saída **70** = exceção que a biblioteca de recepção deixou escapar — o ouvinte loga a causa
  (`EXCECAO NAO TRATADA`), fecha o Acervo e sai por um código que o supervisor **reinicia**. Não
  a coloque em `RestartPreventExitStatus`.

A pasta `~/.local/state/malote/ouvinte/<conta>/` (com o vínculo dentro) é **pré-condição**:
crie-a antes de subir o serviço. O ouvinte não cria pasta na partida.

## Mover a instalação

Os caminhos das Pastas de Entrada e do Destino de Mídia ficam gravados **absolutos** no
Registro (1 linha de Destino de Mídia + 1 por Pasta de Entrada). Mover pastas exige
atualizar essas linhas — o procedimento seguro é: parar o ouvinte, mover, atualizar,
conferir que nenhuma linha aponta para caminho que não existe, subir. O dado em
`XDG_DATA_HOME/malote/` pode mudar de lugar da mesma forma; o estado em
`XDG_STATE_HOME/malote/` é o que o produto espera encontrar ali.

## Notas de armazenamento e execução

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
- **`bin/malote` resolve o próprio diretório por `import.meta.url`, nunca por CWD.**
  `node --import tsx` resolve o pacote `tsx` pelo CWD do **processo**, não pelo
  caminho do script — medido em 16/09/2026: invocar `node --import tsx <caminho
  absoluto>/src/cli/index.ts` de fora do repositório falha com
  `ERR_MODULE_NOT_FOUND: Cannot find package 'tsx'`, mesmo com o caminho do script
  correto. `bin/malote` contorna isso fixando `cwd` do processo filho na raiz do
  repositório antes de invocar. `tests/bin-malote.test.ts` guarda o efeito de fora:
  spawna `bin/malote` com `cwd` em `os.tmpdir()`.
