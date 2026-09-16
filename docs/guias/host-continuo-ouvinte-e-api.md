---
id: 202609160100
projeto: malote
tipo: guia
escopo: repo:malote
plataforma: "*"
status: ativo
dominios: [tecnologia]
descricao: "Guia — instalar e operar o malote num host contínuo: ouvinte por conta, servidor de consulta por rede, unidades systemd, chaves, backup e verificação de saúde"
tags: [guia, servidor, systemd, api, operacao]
---

# Guia: o malote num host contínuo (ouvinte + consulta por rede)

Este guia instala o malote num servidor que fica ligado — a arquitetura para a qual o
produto foi desenhado. Ao final você terá:

- o **ouvinte** recebendo mensagens ao vivo, uma unidade de serviço por conta;
- o **servidor de consulta** expondo o Acervo por rede, autenticado;
- dado protegido por categoria e saúde verificável de fora.

É a continuação do [tutorial](../tutoriais/instalar.md) (faça-o primeiro: Chave de
Operador, Inquilino e primeiro material) e do
[guia de instalação e armazenamento](instalacao-e-armazenamento.md) (categorias XDG e
`MALOTE_HOME`).

## Visão da arquitetura

```
                     ┌───────────────────── host 24/7 ─────────────────────┐
WhatsApp ──ao vivo──►│ malote ouvir --conta A          (1 processo/conta)  │
                     │ malote ouvir --conta B          (1 processo/conta)  │
                     │ malote servir --porta 8080      (1 processo, rede)  │
                     └──────────┬──────────────────────────┬───────────────┘
                                │                          │
                 XDG_DATA_HOME/malote          XDG_STATE_HOME/malote
              (Registro, Acervos, mídia,       (vínculo de sessão, derrame,
               material — irrecuperável)        último evento — refaz-se)
```

Três propriedades que o desenho cobra:

1. **Um processo ouvinte por conta** — dois ouvintes sobre a mesma conta derrubam o
   vínculo um do outro. Contas diferentes convivem.
2. **O servidor só lê** — a consulta por rede abre o Acervo somente-leitura; quem escreve
   é a CLI no host.
3. **Categorias separadas** — o que é dado irrecuperável e o que é estado que se refaz
   vivem em raízes diferentes (ver o guia de armazenamento).

## Pré-requisitos

- host Linux com **systemd**, ligado 24/7
- **Node.js ≥ 22** e **git**
- espaço em disco para mídia (costuma ser a maior parte por ordens de grandeza)
- o número de telefone em mãos para o pareamento de cada conta (código chega no aparelho)

## 1. Instalar o produto

```bash
git clone https://github.com/jrunic/malote.git /opt/malote   # caminho a seu critério
cd /opt/malote
npm ci
node --import tsx src/cli/index.ts --versao
```

O produto roda da fonte, sem build. Instale como um usuário dedicado (os exemplos usam
`malote`; troque pelo seu).

## 2. Fundamentos da instalação (uma vez)

Do [tutorial](../tutoriais/instalar.md): Chave de Operador, Inquilino, importação do
primeiro material de cada conta. Resumo dos comandos:

```bash
CLI="node --import tsx src/cli/index.ts"
$CLI operador chave criar                    # guarde o valor — não é recuperável
$CLI inquilino criar --chave <valor> --titular "Nome do Titular"
$CLI importar --inquilino <id> --configuracao <apelido> --material <caminho>
```

A importação do material cria a **Configuração de Adaptador** que o ouvinte exige — o
ouvinte não cria Configuração, de propósito.

## 3. O ouvinte, como serviço

### 3.1 Pasta de estado é pré-condição

O ouvinte **não cria pasta** na partida (criação de diretório no caminho de subida é o que
travou processos em sistemas de arquivos patológicos). Crie antes:

```bash
mkdir -p ~/.local/state/malote/ouvinte/<conta>
```

`<conta>` é o nome que identifica a pasta do vínculo — um rótulo seu, uma palavra por
conta.

### 3.2 Primeiro pareamento

Ainda no terminal, uma vez por conta:

```bash
cd /opt/malote
node --import tsx src/cli/index.ts ouvir \
  --inquilino <id> --conta <conta> --configuracao <apelido> --numero <dígitos com país>
```

O código de pareamento chega no aparelho da conta. **Leia o aviso que o comando imprime**:
a biblioteca de recepção é não-oficial; a plataforma pode bloquear a conta; e o produto
não promete confidencialidade do conteúdo contra quem administra o host — o operador do
servidor, por desenho, pode ler tudo que está no disco.

### 3.3 Unidade de serviço (uma por conta)

`/etc/systemd/system/malote-ouvinte@.service` — template, `%i` é o nome da conta:

```ini
[Unit]
Description=Malote Ouvinte (%i)
After=network-online.target
Wants=network-online.target

[Service]
User=malote
WorkingDirectory=/opt/malote
ExecStart=/usr/bin/node --import tsx src/cli/index.ts ouvir \
  --inquilino <id-do-inquilino> --conta %i --configuracao <apelido>
Restart=on-failure
RestartSec=10
# Contrato de saída medido no produto:
#   0  = parada pedida (sinal) — não é falha
#   1  = vínculo invalidado pela plataforma — exige pareamento humano no aparelho
#   2  = invocação errada (inquilino/conta/configuração) — erro de configuração
# Reiniciar em laço um vínculo invalidado não resolve e pode agravar.
RestartPreventExitStatus=0 1 2
StandardOutput=append:/var/log/malote/ouvinte-%i.log
StandardError=append:/var/log/malote/ouvinte-%i.log

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /var/log/malote && sudo chown malote: /var/log/malote
sudo systemctl daemon-reload
sudo systemctl enable --now malote-ouvinte@<conta>
```

Se você prefere tudo numa pasta só, declare `Environment=MALOTE_HOME=/srv/malote` no unit
(e crie a pasta antes) — vale para os dois serviços.

## 4. O servidor de consulta, como serviço

### 4.1 Chave de Acesso (quem consulta)

A consulta por rede é autenticada por **Chave de Acesso** — uma por consumidor, escopada ao
Inquilino que ela abre. O Inquilino vem da credencial, nunca do chamador.

```bash
$CLI acesso chave criar --chave <chave-de-operador> --inquilino <id>
```

Guarde o valor impresso: como a Chave de Operador, não é recuperável.

### 4.2 Unidade de serviço

`/etc/systemd/system/malote-servidor.service`:

```ini
[Unit]
Description=Malote Servidor de Consulta
After=network-online.target
Wants=network-online.target

[Service]
User=malote
WorkingDirectory=/opt/malote
ExecStart=/usr/bin/node --import tsx src/cli/index.ts servir --porta 8080 --endereco 127.0.0.1
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Exponha ao mundo por um proxy reverso com TLS (Caddy, nginx…). O servidor responde
**uma recusa de corpo vazio** para credencial ausente, inválida ou revogada — não
distingue, para não revelar a existência de Inquilinos alheios.

## 5. Verificar a saúde de fora

O contrato de monitoramento do ouvinte é a saída de:

```bash
node --import tsx src/cli/index.ts ouvinte estado --conta <conta>
```

**Uma linha, um instante ISO** — o comando não abre o Acervo e é barato de bater. Silêncio
por mais que o intervalo tolerado é o sinal de alarme (cair e religar é rotina do ouvinte;
o que vigia é o instante andar). Com `--json` vêm derrame acumulado, série de
correspondência e o último retrato — para painel, não para alarme de silêncio.

Do servidor, bata na porta e confira que sem credencial a resposta é a recusa de corpo
vazio.

## 6. Backup por categoria

- `~/.local/share/malote/` — **irrecuperável**; é o que entra no backup (Registro, Acervos,
  mídia, material). A mídia é o volume; a política de incluí-la é sua.
- `~/.local/state/malote/ouvinte/<conta>/vinculo` — credencial de sessão. Perder custa um
  pareamento novo na frente do aparelho. Copie **por cópia** antes de qualquer manutenção
  da instalação; não inclua em rotação automática sem saber o que faz.
- O resto de `~/.local/state/malote/` se refaz sozinho.

## 7. Ingestão contínua (opcional)

Material que chega recorrentemente (exports de plataforma) entra por **Pastas de Entrada**
declaradas e um `material varrer` agendado. Declare cada uma:

```bash
$CLI entrada declarar --inquilino <id> --fonte <fonte> \
  --configuracao <apelido> --pasta <caminho> --natureza completo|parcial
```

O disparo da varredura é **seu** (cron, timer): o produto não agenda nada sozinho. As
pastas gravam caminho absoluto no Registro — mover a instalação exige atualizar essas
linhas (ver o guia de armazenamento).

## 8. Operações que voltam com frequência

| situação | o que fazer |
|---|---|
| vínculo invalidado (unit sai com código 1) | pareamento humano: rode o `ouvir` com `--numero` no terminal, confirme no aparelho, reinicie o unit |
| trocar a versão | `git fetch && git checkout <tag-ou-branch>` + `npm ci` + `systemctl restart` dos units |
| conferir o que o ouvinte derramou | `ouvinte estado --json` (campo derrame) e `ouvinte reprocessar` — recusa se o ouvinte estiver no ar |
| segunda conta de WhatsApp | novo material importado com Configuração própria + novo unit `malote-ouvinte@<outra-conta>` |
| revogar quem consulta | `acesso chave revogar` |
