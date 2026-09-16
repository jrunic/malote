---
id: 202608241253
projeto: malote
tipo: arquitetura
escopo: repo:malote
plataforma: "*"
status: ativo
dominios: [tecnologia]
descricao: Mapa estrutural do repo malote — módulos, fluxos críticos, schema, deploy. Carga sob demanda.
tags: [arquitetura, Node]
---

# Arquitetura do Projeto: malote

> **Mapa fino (espinha de navegação, ADR 20260713).** Este arquivo diz *o que existe e onde* e
> **aponta** para `explicacoes/` — nunca duplica conteúdo de design. Se uma seção crescer em prosa
> de "por quê", mova para `docs/explicacoes/` e deixe só o ponteiro. O `dev-08 auditar`
> fiscaliza mapa gordo.

## Visão geral

[Descrição de uma frase do tipo de arquitetura: monólito? CLI? lib? web app? Quem fala com quem.]

```
malote/
├── README.md         — entrypoint humano
├── CONTEXTO.md       — padrões técnicos + restrições (carga default; raiz — jd-agente lê aqui)
├── GLOSSARIO.md      — linguagem do domínio (quando existir)
├── docs/
│   ├── arquitetura.md — mapa fino
│   ├── decisoes/      — ADRs de contrato
│   ├── dominio/       — modelo de domínio
│   └── {tutoriais,guias,referencias,explicacoes}/ — documentação Diátaxis
└── [src/, tests/, migrations/, scripts/, ...]
```

Roadmap, spec, plano e diário: pasta de trabalho `13-processos/manter-malote/`.

## Módulos principais

[Tabela de módulos/pastas/arquivos críticos com responsabilidade de cada um. Atualize quando criar/mover/renomear.]

| Módulo | Responsabilidade |
|---|---|
| [exemplo] | [exemplo] |

## Fluxos críticos

[Descrição passo-a-passo do fluxo principal — o caminho mais quente do código. Sequencie chamadas/decisões.]

## Schema/persistência

[Se houver banco: tabelas, FKs, índices. Se for arquivo: formato, naming. Se for API externa: endpoints consumidos.]

## Deploy

[Onde, como, owner. Inclua referência ao script de deploy se houver.]

## Testes

[Framework, pastas, fixtures principais. Runner canônico (`.venv/bin/pytest`, `npm test`, `bats tests/`, etc.).]

## Estado atual

Projeto criado em 2026-08-24 via `dev-01-define-padroes`. Aguardando primeira spec.
