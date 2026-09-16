---
id: 202608241253
projeto: malote
tipo: nota
escopo: repo:malote
plataforma: "*"
status: ativo
descricao: README do repo malote — entrypoint humano.
tags: [readme, Node]
---

# malote

Arquivo local das suas conversas — de plataformas diferentes, num formato que humano e
agente consultam. Lê, guarda e cruza; não envia mensagem.

## Instalação

Requisitos: Node.js ≥ 22 e git.

```bash
git clone https://github.com/jrunic/malote.git
cd malote
npm ci
node --import tsx src/cli/index.ts --versao
node --import tsx src/cli/index.ts operador chave criar
```

Daí em diante: crie o Inquilino, importe material e consulte — o
[tutorial](docs/tutoriais/instalar.md) leva do zero à primeira consulta.

### Onde está o dado

| variável | o que guarda |
|---|---|
| _(nada)_ | dado em `~/.local/share/malote/`, estado do ouvinte em `~/.local/state/malote/` |
| `XDG_DATA_HOME`, `XDG_STATE_HOME` | respeitados como base das raízes acima |
| `MALOTE_HOME` | tudo numa pasta só (vence as anteriores) |

Detalhes no [guia de instalação e armazenamento](docs/guias/instalacao-e-armazenamento.md).

## Para agentes e desenvolvedores

- `CONTEXTO.md` — padrões técnicos e restrições (comece aqui)
- `GLOSSARIO.md` — linguagem do domínio
- `docs/` — arquitetura, domínio, decisões e documentação (Diátaxis)
