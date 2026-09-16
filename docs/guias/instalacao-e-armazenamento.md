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
| `XDG_STATE_HOME` (default `~/.local/state`) | `malote/` com vínculo do ouvinte, fila de derrame, último evento — **estado** | refaz-se, ou é credencial que se move com a pasta |
| `MALOTE_HOME` | **tudo** numa pasta só | — |

Regras que o produto segue (e testa):

- variável **vazia** = ausente (usa o default);
- caminho **relativo** é ignorado — cai no default;
- o que o produto cria nasce `0700`;
- os caminhos são os mesmos em qualquer sistema operacional.

## Backup — por categoria, não por lista

A pergunta que separa as duas categorias: *se eu apagar isto, o que se perde?*

- **`XDG_DATA_HOME/malote/` é irrecuperável.** É o que entra no backup. Dentro dele,
  `midia/` costuma ser a maior parte — se o material original ainda existe na fonte, o
  custo/benefício de incluir a mídia é seu.
- **`XDG_STATE_HOME/malote/` não vai para backup rotineiro.** O que ali se refaz, se refaz;
  a exceção é `ouvinte/<conta>/vinculo` — credencial de sessão cuja perda custa um
  pareamento novo na frente do aparelho. Copie-a (por **cópia**, nunca movendo) quando for
  mexer na instalação.

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
```

Duas propriedades do encerramento que valem para o supervisor:

- saída **0** = parada pedida (sinal) — não é caso de reiniciar;
- saída **1** = vínculo invalidado pela plataforma — exige pareamento humano; reiniciar em
  laço não resolve e pode agravar.

A pasta `~/.local/state/malote/ouvinte/<conta>/` (com o vínculo dentro) é **pré-condição**:
crie-a antes de subir o serviço. O ouvinte não cria pasta na partida.

## Mover a instalação

Os caminhos das Pastas de Entrada e do Destino de Mídia ficam gravados **absolutos** no
Registro (1 linha de Destino de Mídia + 1 por Pasta de Entrada). Mover pastas exige
atualizar essas linhas — o procedimento seguro é: parar o ouvinte, mover, atualizar,
conferir que nenhuma linha aponta para caminho que não existe, subir. O dado em
`XDG_DATA_HOME/malote/` pode mudar de lugar da mesma forma; o estado em
`XDG_STATE_HOME/malote/` é o que o produto espera encontrar ali.
