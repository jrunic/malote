---
id: 202608241313
projeto: malote
tipo: decisao
status: aprovado
data: 2026-08-24
escopo: repo:malote
plataforma: "*"
dominios: [tecnologia]
descricao: "ADR — o adaptador de recepção ao vivo do WhatsApp usa Baileys, biblioteca não-oficial, confinada ao adaptador e com o risco de bloqueio de conta declarado a quem instala"
tags: [adr, decisao, adaptador, recepcao-ao-vivo, whatsapp, baileys, dependencia, risco]
---

# ADR — Recepção ao vivo do WhatsApp via Baileys

## Status

Aprovado — 2026-08-24.

## Contexto

O malote recebe mensagens por dois caminhos: importação de material exportado pelo usuário e **recepção ao vivo**, que grava o que chega enquanto acontece. A recepção ao vivo é o que impede o acervo de congelar na data do último export.

O WhatsApp, alvo do primeiro adaptador, **não oferece API oficial para conta pessoal**. A WhatsApp Business API atende conta comercial, exige aprovação prévia da Meta e cobre um conjunto de recursos diferente. Para conta pessoal, o único caminho praticável é o [Baileys](https://github.com/WhiskeySockets/Baileys) — biblioteca mantida pela comunidade, construída por engenharia reversa do protocolo multi-dispositivo do cliente oficial.

Usar o Baileys traz consequências que não são de implementação, e sim de produto: ela quebra quando a plataforma muda o protocolo, não tem contrato de suporte, e o risco de bloqueio da conta recai sobre **quem instala o malote**, não sobre quem o escreveu.

## Decisão

**O adaptador de recepção ao vivo do WhatsApp usa o Baileys, e o risco é declarado a quem instala.**

Três limites tornam a decisão sustentável:

1. **A dependência é do adaptador, nunca do núcleo.** Nenhum agregado, operação ou módulo do núcleo importa o Baileys. Se ele morrer, o que sai do produto é um adaptador.
2. **O produto funciona sem recepção ao vivo.** Importar material exportado e consultar o acervo são operações completas por si. A recepção ao vivo acrescenta continuidade; não é pré-requisito de nada.
3. **O risco é dito onde a pessoa decide.** README e primeira execução do adaptador declaram, em texto claro, que a biblioteca é não-oficial e que a conta usada pode ser bloqueada pela plataforma.

## Consequências

### Positivas

- Recepção ao vivo para conta pessoal do WhatsApp passa a ser possível — sem o Baileys, não é.
- O raio de dano de a biblioteca quebrar é um adaptador, não o produto.
- Quem não aceita o risco instala e usa o malote assim mesmo, pelo caminho de importação.

### Negativas

- **Manutenção contra alvo móvel.** Mudança de protocolo do WhatsApp quebra o adaptador sem aviso, em momento que não escolhemos.
- **O risco recai sobre terceiro.** Quem instala expõe a própria conta. Declarar não elimina — apenas transfere a decisão para quem tem o direito de tomá-la.
- **Zona cinzenta de termos de uso.** O WhatsApp não autoriza clientes não-oficiais. A decisão não é um parecer jurídico e não pretende ser.
- **Sem suporte.** Defeito no Baileys é problema de quem o usa.

### Implementação

- `baileys` é importado apenas dentro do adaptador de recepção ao vivo; teste automatizado guarda a fronteira, verificando que nenhum módulo do núcleo o importa.
- A operação de recepção converge para a mesma Referência Externa da importação — a mesma mensagem obtida pelos dois caminhos não vira duas.
- Falha do adaptador é observável **de fora dele**: um processo que só reporta enquanto está vivo não detecta a própria morte.
- Documentar em `docs/` qual versão do Baileys foi validada e como reagir quando o protocolo mudar.

## Revisão de 2026-09-01 — a versão validada, a regra de subida e o custo de árvore

Esta ADR mandava *"documentar qual versão do Baileys foi validada e como reagir quando o
protocolo mudar"*. A medição foi feita ao instalar, e o que ela achou está aqui.

### A versão é `6.7.24`, fixa e sem faixa

Medido em 01/09/2026: a tag `latest` aponta para **`7.0.0-rc14`**, um *release candidate*, e a
versão estável vive sob a tag `legacy`, em `6.7.24`. Produto instalado por terceiros não nasce
sobre candidato a versão.

Fixa e **sem faixa** — `6.7.24`, nunca `^6.7.24`. Faixa em biblioteca não-oficial é atualização
automática para um protocolo que ninguém mediu, e o protocolo é justamente o que muda sem aviso.
A instalação usa `--save-exact` para que o registro no manifesto seja exato.

Compatibilidade conferida: a biblioteca declara `node >= 20`, dentro do piso `>= 22` do repo.

### A regra de subida

Subir de versão exige **duas** condições, e a segunda é a que costuma ser esquecida:

1. A série nova saiu de candidata a versão.
2. **A espiga de medição foi re-rodada contra conta real.** O que se valida não é a biblioteca —
   é o protocolo que ela fala hoje. Subir esperando que resolva é o inverso do método.

### O custo de árvore, medido

| | pacotes de produção |
|---|---|
| antes | **2** |
| depois | **120** |

Medido pelos manifestos de bloqueio dos dois estados, e não pelo diretório instalado — este
último responde "o que está no disco", que é a mesma coisa nos dois casos e não distingue nada.

**Três das quatro dependências de par ficaram de fora**, porque a biblioteca as declara opcionais:
`jimp`, `audio-decode` e `link-preview-js`. **A quarta, `sharp`, entrou** — ela **não** está
marcada como opcional, então o gerenciador a instala como par obrigatório. São **28 MB** e **27
binários de plataforma**, de um total instalado de 149 MB.

E ela é dispensável na prática: a biblioteca a carrega por importação dinâmica com a falha
engolida — `import('sharp').catch(() => {})` —, num único módulo, e só para gerar miniatura ao
**enviar** mídia. O produto não envia. Excluí-la é possível e reduziria a superfície em cerca de
um quinto do disco; **não foi feito** porque omitir pares na instalação muda o que terceiros
recebem, e essa é decisão de política de dependências, não de implementação. Fica medida e
nomeada para a discussão de cadeia de suprimentos que está em aberto.

### A fronteira agora é testada, não declarada

A cláusula 1 desta decisão — *"a dependência é do adaptador, nunca do núcleo"* — passou a ter
guarda: `tests/fronteira-de-dependencia.test.ts` varre `src/nucleo`, `src/registro` e `src/cli`
e reprova qualquer importação da biblioteca. Ela nasceu **no commit anterior ao que instalou a
dependência**, de propósito: escrita depois, haveria um commit inteiro de janela sem guarda.
Verificada por mutação — com uma importação introduzida no núcleo, o teste da pasta violada cai.

### Como reagir quando o protocolo mudar

O sintoma não é o processo morrer; é ele **continuar vivo e parar de receber**. Por isso a
detecção não pode depender de o ouvinte reportar: ele grava o instante do último evento recebido
num efeito que sobrevive a ele, e quem alarma é a camada de operação, comparando esse instante
com o relógio.

A reação é medir de novo — re-rodar a espiga contra conta real — **antes** de subir de versão.
Subir de versão como primeira resposta troca um defeito conhecido por um conjunto de mudanças
não medidas.

## Escopo

Vale para este repositório, e dentro dele apenas para o adaptador de recepção ao vivo. Não vincula os adaptadores de importação nem o núcleo. Adaptador futuro de outra plataforma decide o próprio caminho, e um caso não serve de precedente para o outro.

## Alternativas Consideradas

| Alternativa | Por que não |
|---|---|
| **WhatsApp Business API** | não cobre conta pessoal, que é o caso do produto; exige aprovação prévia da Meta e muda o que o malote é |
| **Só importação de material exportado** | elimina o risco por inteiro, e foi a recomendação inicial. Recusada: o acervo congela na data do export, e continuidade é parte do que o produto entrega |
| **Automação de navegador** | mesma zona cinzenta de termos de uso, com fragilidade maior, custo de recurso maior e superfície de quebra mais ampla |

## Referências

- `docs/dominio/malote.md` — agregado Adaptador, invariante de convergência entre mecanismos da mesma Fonte
- `CONTEXTO.md` — política de bibliotecas: dependência nova exige ADR
- [Baileys](https://github.com/WhiskeySockets/Baileys) — a biblioteca em questão
