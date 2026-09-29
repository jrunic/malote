---
id: 202609281942
projeto: malote
tipo: decisao
status: aprovado
data: 2026-09-28
escopo: repo:malote
plataforma: "*"
dominios: [tecnologia]
descricao: "ADR — a transcrição de áudio usa whisper.cpp e ffmpeg, binários nativos declarados pelo Operador, opcionais e sem instalação automática"
tags: [adr, decisao, transcricao, audio, whisper, dependencia-nativa, risco]
---

# ADR — Dependência nativa do whisper.cpp e do ffmpeg para transcrição de áudio

## Status

Aprovado — 2026-09-28.

## Contexto

O malote passa a transcrever Anexos de áudio, usando reconhecimento de fala
local via [whisper.cpp](https://github.com/ggml-org/whisper.cpp). Medido
contra Anexos de áudio reais de produção: o modelo multilíngue `small`
transcreve com fidelidade em pt-BR a ~43s de CPU por minuto de áudio e
~830 MB de RAM de pico, no mesmo hardware que hoje roda os processos de
recepção e de consulta.

`whisper.cpp` **não é um pacote do ecossistema Node** — é um binário de
sistema, compilado com `cmake`/`make` a partir de C++. O áudio do WhatsApp
chega em formato Opus, que a build padrão do `whisper.cpp` não decodifica
diretamente — a conversão para o formato que o motor aceita depende de um
**segundo** binário de sistema, o [ffmpeg](https://ffmpeg.org/). As duas são
dependências da mesma natureza de risco, e esta ADR cobre as duas.

Hoje o malote não tem nenhuma dependência nativa: toda a árvore de produção
é JavaScript/TypeScript resolvido pelo `npm`, e o `CONTEXTO.md` do repo
declara que o produto **roda da fonte, sem build no host** — precisamente
para que instalar o malote não exija toolchain de compilação. Introduzir
`whisper.cpp` e `ffmpeg` tensiona esse padrão: mesmo não sendo dependência do
build do próprio malote, é a primeira vez que o produto passa a depender de
binários que só existem compilados para a arquitetura e o sistema
operacional de quem instala.

Essa tensão é análoga à que motivou a ADR de adoção do Baileys para
recepção ao vivo do WhatsApp — outra dependência com risco que recai sobre
quem instala, não sobre quem escreveu o código — e esta ADR segue a mesma
disciplina: risco declarado, fronteira de isolamento nomeada, comportamento
explícito quando a dependência falta, alternativas pesadas.

## Decisão

**O malote não compila, não baixa e não empacota o `whisper.cpp`, o
`ffmpeg`, nem o arquivo de modelo. O Operador declara, explicitamente, os
caminhos de binários e do modelo já instalados na máquina — e sem essa
declaração, o recurso de transcrição simplesmente não roda, sem afetar nada
mais.**

1. **A declaração é configuração, não instalação.** O Operador aponta o
   caminho do binário `whisper.cpp` (ou compatível), do `ffmpeg` e do
   arquivo de modelo (`ggml-*.bin`) — valores de configuração **por
   instalação**, nunca um passo de build do malote. É por instalação, e não
   por Inquilino, porque os binários são recurso da máquina: a mesma
   instalação de `whisper.cpp` e `ffmpeg` serve todos os Inquilinos que ali
   rodarem — diferente do Destino de Mídia, que é por Inquilino porque cada
   um pode guardar seus arquivos em lugar diferente.
2. **Ausência é condição de execução, não erro de instalação.** O processo
   de consulta sobe normalmente com ou sem a declaração presente. Sem ela, o
   trabalho de transcrição fica parado e relatado por um sinal próprio —
   visível a quem consulta o estado do processo, nunca silencioso, nunca um
   erro que derrube o processo.
3. **A dependência é isolada ao trabalho de transcrição, nunca ao núcleo.**
   Nenhum módulo do núcleo do produto invoca os binários externos; só o
   componente responsável pela transcrição os alcança, por subprocesso —
   mesmo espírito da fronteira que já isola o Baileys ao adaptador de
   recepção, adaptado à forma certa aqui: não é "só um adaptador importa a
   biblioteca", é "só um componente invoca o processo externo".
4. **O produto continua completo sem transcrição.** Importar material,
   receber ao vivo, consultar Conversas e Mensagens — todas as operações que
   já existiam continuam funcionando por inteiro sem os binários declarados.
   Transcrição é acréscimo, nunca pré-requisito de nada.
5. **O risco é dito onde a pessoa decide.** Documentação de instalação
   declara, em texto claro, que a transcrição exige dois binários de sistema
   obtidos fora do `npm`, e que a ausência deles não é degradação — é o
   estado default até alguém configurar.

## Consequências

### Positivas

- O malote ganha transcrição sem herdar toolchain de build nem gerência de
  binário por plataforma — quem instala traz `whisper.cpp` e `ffmpeg` pelo
  caminho que já usaria de qualquer forma (gerenciador de pacotes do
  sistema, compilação própria), e o malote só aponta para eles.
- O raio de dano de um binário estar ausente, desatualizado ou incompatível
  é o trabalho de transcrição parado — nunca o processo inteiro.
- Quem não quer lidar com binário nativo nenhum instala e usa o malote assim
  mesmo, sem transcrição, exatamente como hoje se usa sem recepção ao vivo.

### Negativas

- **A experiência de instalação fica menos uniforme entre sistemas
  operacionais.** Obter os dois binários compilados é passo manual, e o
  caminho varia por SO (empacotado no Linux, compilado à mão ou via
  gerenciador no macOS) — o malote não abstrai essa diferença.
- **Sem suporte.** Defeito de compilação, de compatibilidade de CPU
  (variantes de instrução vetorial) ou de versão de modelo é problema de
  quem instalou o binário, não do malote.
- **Drift silencioso de versão.** Nada impede o Operador de trocar um
  binário ou o modelo por outro incompatível; a Transcrição registra qual
  motor/modelo a produziu justamente para que essa troca seja auditável
  depois, mas não é impedida na hora.
- **Custo de CPU real, sem isolamento de recurso do sistema operacional.**
  O trabalho de transcrição roda no mesmo host que já hospeda os demais
  processos do produto — mitigado por processamento sequencial e fração de
  threads, mas esta ADR não impõe isolamento de sistema operacional (cgroup,
  prioridade de processo); fica a critério de quem instala.

### Implementação

- Configuração dos caminhos dos binários e do modelo entra no mesmo
  mecanismo de configuração já usado por outras dependências externas do
  produto.
- Guarda de fronteira dedicada, no mesmo molde da que já isola o Baileys:
  nenhum módulo do núcleo invoca os binários externos; só o componente
  responsável pela transcrição.
- Teste de comportamento com a configuração ausente: o processo sobe, todas
  as rotas respondem, o trabalho de transcrição fica parado e relatado —
  sem exceção não tratada.
- Documentação de instalação declara o requisito e o risco antes de
  instruir a configuração — mesmo lugar e mesmo tom que já declaram o risco
  do Baileys.

## Escopo

Vale para este repositório, e dentro dele apenas para o componente de
transcrição de áudio. Não vincula nenhum outro adaptador nem o núcleo. Uma
dependência nativa futura, de outro recurso, decide o próprio caminho — esta
ADR não é precedente automático para ela, do mesmo jeito que a ADR do
Baileys não é precedente automático para esta.

Não cobre: a escolha de motor de transcrição em si (`whisper.cpp` e o modelo
`small`) — essa decisão está em documentos internos do autor, fora deste
repositório, porque pode mudar sem alterar a natureza do risco que esta ADR
trata (binário externo, declarado, opcional). Não cobre a decisão de a
transcrição rodar dentro do processo de consulta em vez de processo
separado — decisão de arquitetura anterior a esta ADR, registrada em
documento interno do autor.

## Alternativas Consideradas

### Malote compila ou baixa os binários automaticamente na instalação

Rejeitado: exigiria toolchain de build (`cmake`, `make`, compilador C++) na
máquina de instalação, contradizendo o padrão hoje declarado no
`CONTEXTO.md` do repo — "roda da fonte, sem build no host". Baixar binários
pré-compilados automaticamente exigiria o malote manter e servir esses
binários por plataforma e arquitetura, superfície de manutenção que não
existe hoje e que cresceria a cada nova versão de qualquer um dos dois.

### Malote empacota binários pré-compilados por plataforma dentro do próprio pacote/release

Rejeitado: infla o tamanho da distribuição com binários por combinação de
sistema operacional e arquitetura (ao menos macOS/Linux × arm64/x86_64), e
amarra o ciclo de release do malote ao ciclo de release de `whisper.cpp` e
de `ffmpeg` — toda atualização de qualquer um dos dois exigiria uma release
do malote, mesmo sem nenhuma mudança de comportamento do produto.

### Operador declara caminhos de binários e modelo já instalados (decisão adotada)

Aceito: transfere a instalação dos binários para quem já decide instalar
software de sistema na própria máquina — o mesmo lugar de decisão que já
existe para outras dependências externas do produto — e mantém o malote
livre de toolchain de build e de gestão de binário por plataforma.

## Referências

- `docs/decisoes/20260824-adocao-de-biblioteca-nao-oficial-para-recepcao-ao-vivo.md` —
  ADR-precedente: mesma disciplina de risco declarado e fronteira de
  isolamento, para uma dependência de natureza diferente (pacote npm não
  oficial, não binário nativo)
- `CONTEXTO.md` — política de bibliotecas: dependência nova exige ADR; e a
  decisão de que o malote roda da fonte, sem build no host
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) — motor de
  transcrição
- [ffmpeg](https://ffmpeg.org/) — conversão de formato de áudio
- Documentos internos do autor, fora deste repositório: spec e ata que
  motivaram esta decisão, com a medição de viabilidade completa
