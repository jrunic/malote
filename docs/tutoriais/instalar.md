---
id: 202609160010
projeto: malote
tipo: tutorial
escopo: repo:malote
plataforma: "*"
status: ativo
dominios: [tecnologia]
descricao: "Tutorial — do zero à primeira consulta: instalar, criar a Chave de Operador, o Inquilino, importar material e ler o Acervo"
tags: [tutorial, instalacao]
---

# Tutorial: instalar o malote e ver suas conversas

Este tutorial leva você da máquina limpa à primeira consulta ao Acervo. Ao final, você terá
o produto instalado, um Inquilino criado, um material importado e a lista de conversas na
tela. Para o porquê de cada decisão de armazenamento, veja o
[guia de instalação e armazenamento](../guias/instalacao-e-armazenamento.md).

## Pré-requisitos

- **Node.js 22 ou mais novo** (`node --version` confirma)
- **git** e acesso ao repositório
- ~1 GB livres para uma primeira instalação de teste

## 1. Obter o código

```bash
git clone https://github.com/jrunic/malote.git
cd malote
npm ci
```

O produto roda da fonte, sem passo de build.

## 2. Confirmar a versão

```bash
node --import tsx src/cli/index.ts --versao
```

```
0.17.0
```

Este comando não exige instalação: ele responde antes de abrir base nenhuma.

## 3. Criar a Chave de Operador

```bash
node --import tsx src/cli/index.ts operador chave criar
```

```
Chave de Operador criada.
  id:    e428fdfe-6055-4f42-b161-f6b765c04763
  valor: rwehjrnbF5ycv9JnZtiN6y2Nr9w__M37gx9XEY4Aioo
Guarde agora: este valor nao e recuperavel depois.
```

O valor **não é recuperável** depois — quem perde, cria outra. A partir daqui, os comandos
de administração exigem `--chave <valor>`.

**Se algo der errado:** `Recusado: ja existe Chave de Operador nesta instalacao` significa
que esta instalação já tem uma. Use-a (o valor que você guardou) ou informe `--chave` para
criar outra.

## 4. Criar o Inquilino

O malote é multi-inquilino: cada pessoa (ou conta) com Acervo próprio.

```bash
node --import tsx src/cli/index.ts inquilino criar \
  --chave rwehjrnbF5ycv9JnZtiN6y2Nr9w__M37gx9XEY4Aioo \
  --titular "Ana Exemplo"
```

```
Inquilino criado.
  id: d8765d15-8c83-4b8f-bec6-d33cedfb31e7
```

Anote o `id` — ele identifica o Inquilino nos comandos seguintes.

Confira com:

```bash
node --import tsx src/cli/index.ts inquilino listar --chave rwehjrnbF5ycv9JnZtiN6y2Nr9w__M37gx9XEY4Aioo
```

```
d8765d15-8c83-4b8f-bec6-d33cedfb31e7  Ana Exemplo  criado em 2026-09-15T23:38:01.709Z
```

## 5. Onde está o dado

Sem nenhuma variável declarada, o produto grava:

| o quê | onde |
|---|---|
| dado (Registro, Acervos, mídia, material) | `~/.local/share/malote/` |
| estado do ouvinte (vínculo, derrame, último evento) | `~/.local/state/malote/` |

Se você declara `MALOTE_HOME`, **tudo** vive sob essa pasta. As variáveis `XDG_DATA_HOME` e
`XDG_STATE_HOME` também são obedecidas. Detalhes no
[guia de instalação e armazenamento](../guias/instalacao-e-armazenamento.md).

## 6. Declarar a Configuração — com material ou só para o ouvinte

O malote ingere material exportado das plataformas (WhatsApp, Instagram, catálogo de
contatos) por uma pasta vigiada. Há dois caminhos, dependendo do que você já tem em mãos.

**Caminho A — já tenho um export e quero importar o histórico:**

```bash
node --import tsx src/cli/index.ts entrada declarar \
  --inquilino d8765d15-8c83-4b8f-bec6-d33cedfb31e7 \
  --fonte whatsapp --configuracao pessoal \
  --pasta /caminho/da/pasta-de-entrada --natureza completo
```

E a importação:

```bash
node --import tsx src/cli/index.ts importar \
  --inquilino d8765d15-8c83-4b8f-bec6-d33cedfb31e7 \
  --configuracao pessoal --material /caminho/do/material
```

**Se algo der errado:** `Informe --material.` significa que faltou o caminho do material no
comando.

**Caminho B — ainda não tenho o export e quero só parear o dispositivo e começar a
receber ao vivo (passo 8):**

```bash
node --import tsx src/cli/index.ts configuracao criar \
  --inquilino d8765d15-8c83-4b8f-bec6-d33cedfb31e7 \
  --fonte whatsapp --configuracao pessoal --conta pessoal
```

Isso declara a Configuração sem exigir material — o histórico pode ser importado depois,
pelo Caminho A, a qualquer momento.

## 7. A primeira consulta

```bash
node --import tsx src/cli/index.ts conversas \
  --inquilino d8765d15-8c83-4b8f-bec6-d33cedfb31e7 \
  --chave rwehjrnbF5ycv9JnZtiN6y2Nr9w__M37gx9XEY4Aioo
```

Código de saída 0 com a lista de conversas (vazia, se o material ainda não tem conversas).
O Acervo está aberto e é seu.

## 8. Receber ao vivo (opcional)

O ouvinte conecta a uma conta de WhatsApp e recebe mensagens em tempo real. Ele exige que a
Configuração de Adaptador já exista (criada no passo 6, pelo Caminho A ou pelo Caminho B) —
o ouvinte **não cria** Configuração, porque criar conta errada é pior que não subir:

```bash
node --import tsx src/cli/index.ts ouvir \
  --inquilino d8765d15-8c83-4b8f-bec6-d33cedfb31e7 \
  --conta pessoal --configuracao pessoal --numero 5511999999999
```

`--conta` nomeia a pasta do vínculo (credencial do pareamento); `--configuracao` é o apelido
da Configuração no Registro. Em uma instalação séria, o ouvinte roda como serviço de sistema
— o caminho está no guia.

## Próximos passos

- [Guia de instalação e armazenamento](../guias/instalacao-e-armazenamento.md) — XDG,
  `MALOTE_HOME`, permissões, serviço de sistema e backup por categoria
- [`GLOSSARIO.md`](../../GLOSSARIO.md) — o vocabulário do domínio, que os comandos usam
