---
id: 202609160020
projeto: malote
tipo: decisao
escopo: repo:malote
plataforma: "*"
status: ativo
data: 2026-09-16
dominios: [tecnologia]
descricao: "ADR local — armazenamento por categoria XDG Base Directory, com MALOTE_HOME como única válvula de pasta única"
tags: [adr, decisao, xdg, armazenamento]
---

# ADR — Armazenamento por categoria XDG Base Directory

## Status

Aceito em 2026-09-16, implementado na v0.17.0.

## Contexto

Uma instalação guarda dois tipos de coisa de naturezas diferentes: o dado que quem instala
não pode perder (Registro, Acervos, mídia, material importado) e o estado que o produto
reconstrói ou que é credencial de sessão (vínculo do ouvinte, fila de derrame, último
evento). Uma raiz única esconde essa diferença: backup, política de disco e sincronia não
conseguem tratar as categorias de forma distinta sem saber de dentro do produto onde cada
coisa está.

O padrão [XDG Base Directory](https://specifications.freedesktop.org/basedir/latest/)
existe exatamente para isso — e impõe regras que implementações erram sozinhas.

## Decisão

**1. A categoria sai do ciclo de vida do artefato.** O que perder dói e não se reconstrói é
DADO e vive em `XDG_DATA_HOME/malote/`. O que se refaz (ou é credencial de sessão que se
move com a pasta) é ESTADO e vive em `XDG_STATE_HOME/malote/`. A pergunta que decide é uma
só: *se eu apagar isto, o que se perde?*

**2. As regras do spec valem como comportamento, testado:**

- variável **vazia** conta como ausente — usa o default;
- caminho **relativo** é inválido e se ignora — cai no default, nunca se resolve contra o
  diretório corrente;
- o que o produto cria nasce com permissão **0700**, conferida no modo efetivo após criar
  (o `mode` do `mkdir` sofre umask);
- nenhuma API do sistema operacional "descobre" o caminho — o caminho é o mesmo em todos os
  sistemas operacionais.

**3. `MALOTE_HOME` é a única válvula de escape, e ela colapsa as categorias.** Quando
declarada, vence tudo: dado e estado vivem sob ela, sem separação. É o contrato de
`CARGO_HOME` e `GNUPGHOME`: "esqueça a convenção, é aqui". Quem quer uma pasta só declara
uma variável; quem quer XDG não declara nada.

**4. A subida do ouvinte não cria pasta.** Criar diretório é trabalho de disco no caminho de
partida — e já travou um processo em sistema de arquivos patológico. A pasta do ouvinte é
pré-condição de quem opera, como o próprio vínculo.

## Consequências

- Quem instala aponta `XDG_DATA_HOME`/`XDG_STATE_HOME` e é obedecido.
- Backup e política de disco trabalham **por categoria**: o que está em
  `XDG_DATA_HOME/malote/` é irrecuperável; o que está em `XDG_STATE_HOME/malote/` se refaz.
- `MALOTE_RAIZ` (raiz única anterior) não tem mais efeito. Quem a usava declara
  `MALOTE_HOME`.
- Configuração de instalação escrita em banco (Destino de Mídia, pastas de entrada) grava
  caminho absoluto; mover a instalação é atualizar essas linhas — ver o guia.
