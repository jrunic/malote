---
id: 202610051300
projeto: malote
tipo: decisao
status: aprovado
data: 2026-10-04
escopo: repo:malote
plataforma: "*"
dominios: [tecnologia]
descricao: "ADR — as leituras do servidor rodam em workers com prazo duro, abandono pelo cliente, reserva por Inquilino e contenção da falha"
tags: [adr, decisao, servidor, worker, disponibilidade, prazo]
---

# ADR — Leituras do servidor em workers, com prazo

## Status

Aprovado — 2026-10-04.

## Contexto

O servidor de consulta (`malote servir`) é um processo e uma thread, e o `better-sqlite3` é síncrono: cada leitura
roda inteira antes da próxima. Medido num Acervo de 6,2 GB e 271 mil Mensagens por Conversa, um filtro sem achados
custa 1,2 s quente (8 s frio) e a busca de uma palavra comum custa 4 s. Durante esse tempo nenhum outro cliente é
atendido. E a consulta que o cliente abandona continua rodando lá dentro: três consultas abandonadas travaram o
servidor por minutos, e o encerramento só terminou por `SIGKILL`.

## Decisão

- Cada `GET` autenticado roda num worker (`worker_threads`) de um pool de 4, criado sob demanda. A thread principal só
  recebe, verifica a Chave, despacha e responde; o worker recebe o `chaveId` e o `inquilinoId` já verificados, nunca a
  Chave. As escritas (`POST`) ficam na thread principal.
- **Prazo duro** de 25 s desde a chegada do pedido, contando a espera na fila. Passou, o worker é terminado (`terminate`,
  medido em 2 ms, sem vazar descritores) e a resposta é `504` de corpo vazio.
- **Abandono:** o cliente que fecha a conexão antes da resposta mata a consulta dele.
- **Reserva:** um Inquilino ocupa no máximo N−1 workers e metade da fila, de modo que sempre sobra um worker aos outros.
  Quando um worker libera, vai para o Inquilino que menos workers ocupa. A fila tem 64 lugares; acima disso, `503` com
  `retry-after: 1`.
- **Contenção:** exceção da rota ou queda do worker é `500` de corpo vazio, e o worker é substituído.
- As rotas de leitura abrem o Registro somente-leitura. O Registro é aberto uma vez, para escrita, ao subir, e a
  migração, se houver, acontece ali. O `servir` também sobe um worker antes de aceitar pedido e recusa subir (código 1)
  se ele não carregar em 5 s.
- O corpo binário (`GET /midia`) atravessa por transferência do `ArrayBuffer`, sem copiar: o maior arquivo servido
  tem 890 MB.

## Alternativas recusadas

- **Índice:** resolve uma consulta, não a classe.
- **Teto de varredura com cursor:** muda o contrato e não alcança o FTS.
- **Aceitar o bloqueio:** a consulta abandonada seguia rodando e o servidor não encerrava.

## Consequências

- `504` e `503` são códigos novos, de corpo vazio; a CLI sai com 5 e diz o que fazer.
- Mais memória, na ordem de dezenas de MB por worker.
- O `req` e o `res` do worker são um contrato mínimo (`method` e `url`; `writeHead`, `end` e `headersSent`) e lançam em
  qualquer outro membro, para que rota nova que use mais falhe no teste e não só em produção.

## O que não conserta

- Nenhuma consulta fica mais rápida: a de 4 s continua custando 4 s, só deixa de travar os outros.
- A verificação da Chave (23,68 ms por derivação) segue na thread principal, e o teto de ~42 requisições por segundo
  declarado em `servidor.ts` segue valendo.
