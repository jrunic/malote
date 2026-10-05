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

Uma CLI (`malote`) e dois processos de longa duração sobre os mesmos dados: o **ouvinte**
(`malote ouvir`, um por conta, recebe do WhatsApp ao vivo) e o **servidor de consulta**
(`malote servir`, API HTTP autenticada por Chave de Acesso). A CLI escreve no host e lê em dois
modos: **local** (abre o Acervo) ou **rede** (HTTP, quando `MALOTE_SERVIDOR` e a Chave estão no
ambiente). O núcleo é agnóstico de Fonte; cada Fonte entra como Adaptador. Por quê: ver
[visão geral](explicacoes/visao-geral.md) e o [modelo de domínio](dominio/malote.md).

```
malote/
├── README.md         — entrypoint humano
├── CONTEXTO.md       — padrões técnicos + restrições (carga default; raiz — jd-agente lê aqui)
├── GLOSSARIO.md      — linguagem do domínio
├── CHANGELOG.md      — o que mudou em cada release
├── bin/malote        — executável: roda a CLI da fonte (sem build)
├── docs/
│   ├── arquitetura.md — mapa fino
│   ├── decisoes/      — ADRs de contrato
│   ├── dominio/       — modelo de domínio
│   └── {tutoriais,guias,referencias,explicacoes}/ — documentação Diátaxis
├── src/               — o código (abaixo)
└── tests/             — `node --test`; fixtures em `tests/ajuda/`
```

Roadmap, spec, plano e diário: documentos internos do autor, fora deste repositório.

## Módulos principais

| Módulo | Responsabilidade |
|---|---|
| `src/nucleo/` | O modelo: Acervo (SQLite por Inquilino), Conversa, Mensagem, Anexo, Pessoa, Identificador, Operação. **Só ele e `src/registro/` tocam em tabela.** Leitura em `consulta.ts`, escrita em `escrita.ts`, migração por passos em `migracao.ts` e `passos-do-acervo.ts` |
| `src/nucleo/` (consultas por Conversa) | `anexos-da-conversa.ts` (mídia, cursor composto), `autores-da-conversa.ts` (quem escreveu), `remetente.ts` (o Identificador por valor, em todas as formas) e `identificar.ts` ("quem é este valor?") |
| `src/registro/` | O Registro da instalação: Inquilinos, Chaves de Operador e de Acesso, Configurações de Adaptador, Destino de Mídia, política de retenção |
| `src/adaptadores/whatsapp/` | A Fonte WhatsApp: material exportado (`material.ts`, `importar.ts`), recepção ao vivo (`ao-vivo.ts`, `conexao.ts` — o **único** que alcança a biblioteca) e envio (`enviar.ts`) |
| `src/adaptadores/instagram/` | A Fonte Instagram: material exportado |
| `src/adaptadores/contatos/` | O catálogo de contatos (vCard): propõe identidade por telefone, e-mail e nome |
| `src/rede/` | A superfície de rede. `servidor.ts` autentica e despacha; `rotas.ts` tem as rotas; `despachante.ts`, `leitura.ts`, `contrato-da-leitura.ts` e `trabalhador-de-leitura.ts` rodam cada `GET` num worker, com prazo (ver abaixo) |
| `src/cli/` | Os comandos: `index.ts` (despacho e `--ajuda`), `cliente.ts` (o cliente HTTP, **só aqui**, nunca em `src/rede/`), `servir.ts`, `ouvir.ts`, `exportar.ts`, `anexos-texto.ts`, `identificar-texto.ts`, `transcricao.ts`, `varredura.ts` e outros. **Só `src/cli/` compõe mais de uma Fonte** |
| `tests/` | `node --test`; `tests/ajuda/` guarda as fixtures e os servidores de teste |

As fronteiras que têm teste (`tests/fronteira-de-dependencia.test.ts`, `tests/sem-prepare-fora-da-porta.test.ts`,
`tests/sem-exit-direto.test.ts`) estão listadas nas Restrições do `CONTEXTO.md`.

## Fluxos críticos

1. **Ao vivo.** `malote ouvir` → `conexao.ts` recebe o evento → `ao-vivo.ts` classifica e resolve o endereço
   para a forma canônica → portas de escrita do núcleo → Acervo. Disputa de escrita vai para o derrame, e
   não vira recusa.
2. **Consulta por rede.** `GET` → `servidor.ts` verifica a Chave (o Inquilino vem **da credencial**) → o
   despachante manda o pedido a um worker → o worker abre o Acervo somente-leitura e roda a mesma
   `responder` de `rotas.ts` → a resposta volta à thread principal. Prazo de 25 s (`504`), fila de 64
   (`503`), exceção ou queda do worker é `500`. Detalhe e motivo: a
   [ADR das leituras em workers](decisoes/20261004-leituras-do-servidor-em-workers-com-prazo.md).
3. **Escrita por rede.** `POST /transcricoes/solicitar` e `POST /envios/solicitar` rodam na thread principal,
   fora do worker, com conexão própria.
4. **Exportar.** `malote exportar` pagina Mensagens em ordem cronológica, nomeia os autores por
   `GET /conversas/<id>/autores` e escreve num arquivo `.parcial` que só vira definitivo ao fim.

## Schema/persistência

Dois bancos SQLite por instalação, ambos em modo WAL e com migração versionada por passos (a máquina está em
`src/nucleo/migracao.ts`): o **Registro** (`registro.db`, versão em `VERSAO_SCHEMA_REGISTRO`) e um
**Acervo por Inquilino** (`acervos/<inquilino>.db`, versão em `VERSAO_SCHEMA_ACERVO`).
A mídia fica num Destino de Mídia, fora do banco. As tabelas estão em `src/nucleo/schema-acervo.ts` e
`src/registro/schema.ts`; o modelo, em [dominio/malote.md](dominio/malote.md). Onde cada coisa mora no
disco (dado, estado, mídia): [guia de armazenamento](guias/instalacao-e-armazenamento.md).

## Deploy

Host próprio, 24/7: um serviço do ouvinte por conta e um do servidor, rodando **da fonte** com `tsx`, sem
build. Unidades, flags do servidor (`--trabalhadores`, `--prazo`), Chave de Acesso e saúde:
[guia do host](guias/host-continuo-ouvinte-e-api.md). Instalação: [tutorial](tutoriais/instalar.md).
Quem consulta: [guia do cliente e do agente](guias/cliente-e-agente.md).

## Testes

`npm test` compila (`tsc -p tsconfig.check.json`, que cobre `src/` e `tests/`) e roda `node --test` com
`tsx`. `npm run lint` é o `eslint`. O CI roda os dois em Node 22, no Linux.

## Estado atual

Em produção. O histórico do que mudou em cada release está no [CHANGELOG](../CHANGELOG.md).
