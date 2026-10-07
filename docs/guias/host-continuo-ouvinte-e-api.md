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

**Esta é a máquina do dado**: tudo que este guia instala e protege — Acervo, mídia,
Registro, vínculos, serviços — vive AQUI, e em nenhuma outra. As máquinas de quem consulta
(o dia a dia, o agente) são **clientes**: levam só o código e a Chave de Acesso, nunca o
dado — o que elas instalam e o que elas *não* precisam ter está no
[guia do cliente e do agente](cliente-e-agente.md).

É a continuação do [tutorial](../tutoriais/instalar.md) (faça-o primeiro: Chave de
Operador, Inquilino e primeiro material) e do
[guia de instalação e armazenamento](instalacao-e-armazenamento.md) (categorias XDG e
`MALOTE_HOME`).

## Visão da arquitetura

```
                     ┌───────────────────── host 24/7 ─────────────────────┐
WhatsApp ──ao vivo──►│ malote ouvir --conta A          (1 processo/conta)  │
                     │ malote ouvir --conta B          (1 processo/conta)  │
                     │ malote servir --porta 8080      (1 processo; leituras │
                     │                                  em workers)       │
                     └──────────┬──────────────────────────┬───────────────┘
                                │                          │
                 XDG_DATA_HOME/malote          XDG_STATE_HOME/malote
              (Registro, Acervos, mídia,       (vínculo de sessão, derrame,
               material — irrecuperável)        último evento — refaz-se)
```

Três propriedades que o desenho cobra:

1. **Um processo ouvinte por conta** — dois ouvintes sobre a mesma conta derrubam o
   vínculo um do outro. Contas diferentes convivem.
2. **O servidor só lê, com duas exceções nomeadas** — a consulta por rede abre o
   Acervo somente-leitura; as únicas escritas são `POST /transcricoes/solicitar`
   e `POST /envios/solicitar` (ver o guia do cliente e do agente), que abrem uma
   conexão própria, separada, só para essas rotas. Fora delas, quem escreve é a
   CLI no host.
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

### 3.0 Destino de Mídia, para baixar o que chega ao vivo

Sem Destino de Mídia configurado, o Anexo recebido ao vivo (foto, áudio, vídeo,
documento) fica `nunca-obtido` para sempre — o ouvinte avisa uma vez na partida e segue
sem baixar. Configure antes de parear:

```bash
$CLI inquilino destino --chave <valor> --inquilino <id> --endereco <caminho>
```

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

Se a Configuração já tem telefone (`configuracao criar --telefone`), o `--numero` é opcional: vale o
da Configuração, e um `--numero` diferente dele é recusado antes de pedir o código. Se a Configuração
não tem telefone, o `--numero` o declara. Em toda partida o ouvinte confere o vínculo contra o telefone
da Configuração e grava o que o vínculo mostra; `configuracao listar` mostra o resultado. Se o vínculo
for de outra conta, o ouvinte sai com código 2, sem imprimir o número, e não grava nada.

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
#   2  = erro de configuração — invocação errada (inquilino/conta/configuração), ou o vínculo é de
#        outra conta que a da Configuração (o telefone não confere): corrija o cadastro, não reinicie
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
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
```

`TimeoutStopSec=15` cobre a parada em etapas do servidor (ver 4.3): ele espera as leituras em
andamento por até 5 s antes de cortar as conexões, então o padrão do systemd basta, mas um valor
explícito evita `SIGKILL` se alguém aumentar a espera.

Exponha ao mundo por um proxy reverso com TLS (Caddy, nginx…). O servidor responde
**uma recusa de corpo vazio** para credencial ausente, inválida ou revogada — não
distingue, para não revelar a existência de Inquilinos alheios. O lado de quem consome —
autenticação, rotas e como instruir um agente — está no
[guia do cliente e do agente](cliente-e-agente.md).

**A rota de Envio (`POST /envios/solicitar`) eleva o risco de expor sem TLS.**
Ela carrega, no mesmo corpo, a Chave de Acesso e, quando o Envio é imagem ou
documento, os bytes do arquivo. E a Chave deixa de ser só de leitura: quem a
tem pode **falar pela conta** que o malote vigia. Nunca exponha a porta do
`malote servir` sem um proxy reverso com TLS na frente, nem em rede que pareça
confiável.

### 4.3 Dimensionar e vigiar o servidor

O servidor atende cada leitura (`GET`) num **worker** de um pool, e não na thread que recebe as
conexões: uma consulta lenta ocupa um worker e os outros clientes continuam sendo atendidos. As
escritas (`POST`) e a verificação da Chave ficam na thread principal.

| flag | faixa | padrão | o que faz |
|---|---|---|---|
| `--trabalhadores <n>` | 1 a 16 | 4 | tamanho do pool de leituras |
| `--prazo <segundos>` | 1 a 300 | 25 | prazo de uma leitura, **contado desde a chegada** (inclui a espera na fila) |

O que o servidor responde, e o que você faz:

- **`504`** (corpo vazio) — a leitura passou do prazo; o worker foi terminado e substituído. Escreve
  `[leitura] prazo estourado: GET <caminho> (25 s)` no `stderr`. A CLI diz ao cliente para restringir
  os filtros. Se for frequente numa Conversa grande, o problema é a consulta, e não o prazo: aumentar
  `--prazo` só adia o sintoma.
- **`503`** (com `retry-after: 1`) — a fila de 64 pedidos encheu, ou o servidor está subindo ou parando.
  Um Inquilino ocupa no máximo N−1 dos workers e **metade da fila**, de modo que um consumidor com
  muitas consultas pesadas atrasa as suas, e não as dos outros.
- **`500`** (corpo vazio) — exceção da rota ou queda do worker; o worker é substituído e o servidor
  segue. O `stderr` leva a mensagem e o caminho, **nunca a query** (ela pode ter texto de conversa).
- Leitura que leva mais de 2 s escreve `[leitura] lenta: GET <caminho> <tempo>`.

**Subida.** O servidor abre o Registro uma vez (migra, se for o caso) e sobe um worker **antes** de
aceitar pedido. Se o worker não carregar em 5 s, ele escreve `Nao subi: o worker de leitura nao
carregou` e **sai com código 1**. Com `Restart=on-failure` isso vira uma tentativa a cada 10 s: se o
serviço não fica de pé, leia o `journalctl -u malote-servidor` e procure a causa (dependência
ausente, `tsx` não instalado, arquivo do repositório quebrado) antes de mexer em flag.

**Parada.** `SIGTERM` para de aceitar, espera as leituras em andamento por até 5 s, corta o que
sobrar e sai com 0. O restart leva segundos.

**Memória.** Medido num Acervo de 6 GB: ~110 a 140 MB em repouso e até ~230 MB com três consultas
pesadas em paralelo, bem abaixo de 600 MB. **Servir um arquivo grande custa cerca de uma vez o tamanho
dele** em memória residente (um documento de 890 MB levou o processo a ~970 MB), e essa memória pode
ficar residente por um tempo depois. Dimensione o host pelo maior arquivo que `GET /midia` pode servir,
não pela média.

**O que isto não resolve.** Nenhuma consulta fica mais rápida. A verificação da Chave continua na
thread principal e custa ~24 ms por derivação, então o teto é da ordem de 40 requisições por segundo,
o que cobre o uso previsto (loopback atrás de um proxy).

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

## 7. Transcrição de áudio (opcional)

O `malote servir` transcreve, sozinho, todo Anexo de áudio que fica presente — usando
`whisper.cpp` e `ffmpeg`, dois binários de sistema que o malote **não instala nem baixa**. Sem
eles declarados, o produto sobe e funciona por inteiro; só a fila de transcrição fica parada
(o log da subida diz qual dos dois casos é o seu).

Declare, antes de subir o serviço:

```bash
export MALOTE_WHISPER_BINARIO=/caminho/para/whisper-cli
export MALOTE_WHISPER_MODELO=/caminho/para/ggml-small.bin
# Opcionais — os defaults abaixo cobrem a maioria dos casos:
export MALOTE_FFMPEG_BINARIO=ffmpeg               # default: resolvido pelo PATH
export MALOTE_TRANSCRICAO_THREADS=4               # default: 4 núcleos, nunca todos
export MALOTE_TRANSCRICAO_IDIOMA=pt               # default: pt
export MALOTE_TRANSCRICAO_INTERVALO_MS=30000      # default: 30s entre passadas do worker
```

São **por instalação**, não por Inquilino — os binários são recurso da máquina, não do
Acervo. O `.wav` intermediário da conversão nunca entra no Destino de Mídia; vive em pasta
temporária do sistema.

**Risco:** binários de sistema, fora do `npm` — sem suporte do malote se a compilação, a
versão ou o modelo derem problema. Ver a ADR
`docs/decisoes/20260928-dependencia-nativa-do-whisper-cpp-para-transcricao-de-audio.md` para
o risco completo e as alternativas descartadas.

Falha de transcrição (áudio corrompido, binário incompatível) fica registrada com o motivo,
sem travar as próximas da fila. Para tentar de novo:

```bash
$CLI transcricao reprocessar --inquilino <id>
$CLI transcricao estado      --inquilino <id> --json   # contagem por estado + motor configurado
```

O backfill do estoque de áudio já presente antes de instalar esta versão **não acontece
sozinho** — só o áudio que chega depois entra na fila.

## 8. Ingestão contínua (opcional)

Material que chega recorrentemente (exports de plataforma) entra por **Pastas de Entrada**
declaradas e um `material varrer` agendado. Declare cada uma:

```bash
$CLI entrada declarar --inquilino <id> --fonte <fonte> \
  --configuracao <apelido> --pasta <caminho> --natureza completo|parcial
```

O disparo da varredura é **seu** (cron, timer): o produto não agenda nada sozinho. As
pastas gravam caminho absoluto no Registro — mover a instalação exige atualizar essas
linhas (ver o guia de armazenamento).

## 9. Operações que voltam com frequência

| situação | o que fazer |
|---|---|
| vínculo invalidado (unit sai com código 1) | pareamento humano: rode o `ouvir` com `--numero` no terminal, confirme no aparelho, reinicie o unit |
| trocar a versão | `git fetch && git checkout <tag-ou-branch>` + `npm ci` + `systemctl restart` dos units. **Release que muda a forma do Registro** (a 0.31.0 é uma): faça cópia do `registro.db` antes — o servidor e cada ouvinte migram o Registro ao subir, com segurança entre vários abridores, mas a cópia é o que permite voltar |
| conferir o que o ouvinte derramou | `ouvinte estado --json` (campo derrame) e `ouvinte reprocessar` — recusa se o ouvinte estiver no ar |
| segunda conta de WhatsApp | novo material importado com Configuração própria + novo unit `malote-ouvinte@<outra-conta>` |
| revogar quem consulta | `acesso chave revogar` |

## Notas de operação do host

- **O `post_install` do malote RODA: toda release reinicia o ouvinte.** Medido em 12/09/2026
  na release v0.10.0, o comando de distribuição executou `restart:malote-ouvinte@<conta>.service`. Duas
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
