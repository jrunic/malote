---
id: 202610261600
projeto: malote
tipo: decisao
status: aprovado
data: 2026-10-26
escopo: repo:malote
plataforma: "*"
dominios: [tecnologia]
descricao: "ADR — o Acervo ganha um Diário de Chegadas, só de acréscimo e com número de sequência próprio, lido por Marcador: quem acompanha o Acervo lê pela ordem de gravação, e não pela ordem em que as coisas aconteceram; o que o Diário guarda, o que não guarda e por que não é o hook que executa rotina no ouvinte"
tags: [adr, decisao, acervo, chegadas, marcador, rede, agentes]
---

# ADR — O Diário de Chegadas

## Status

Aprovado — 2026-10-26. Muda a forma do Acervo (v29 para v30) e acrescenta uma superfície de leitura à rede e à CLI.

## Contexto

Quem reage ao que entra no Acervo (um agente de apoio, um painel, uma rotina) precisa de uma pergunta que o produto não sabia responder: **o que chegou desde a última vez que eu olhei?** A resposta que existia era a leitura de Mensagens por janela de tempo, com dois defeitos medidos:

- **O Cursor ordena pelo instante em que a Mensagem aconteceu, não pelo em que foi gravada.** Entrega atrasada (os Pendentes da Plataforma depois de uma queda, a importação de um backup, uma edição) entra com instante antigo e passa despercebida a quem avança por tempo. Nas últimas 50.000 gravações de um Acervo de 1,7 milhão de Mensagens (cerca de 14,7 dias), 85 Mensagens (0,17%) chegaram mais de 1 minuto atrás do maior instante já visto na mesma Conversa; 79 com mais de 1 hora e 62 com mais de 1 dia. Quem consulta por janela contorna com dedupe e idade máxima, e cada um refaz isso.
- **Só havia leitura de Mensagem.** Edição, Anexo que passa a existir, entrada e saída de participante e Etiqueta mudam o Acervo e não tinham leitura por ordem de gravação.

Cogitou-se registrar, no próprio produto, um gancho que executa uma rotina quando uma Mensagem casa um filtro. Foi descartado: o ouvinte guarda a credencial e o socket, e seu código de saída é contrato com o supervisor; rotina lenta ou com defeito travaria a recepção; um comando registrado pelo usuário cria uma fronteira de privilégio que a Chave de Acesso (sem Escopo) não cobre; e a recuperação depois de uma queda dispararia o gancho em rajada (3.581 itens num experimento). O produto expõe o que entrou, e quem opera decide o que fazer.

## Decisão

1. **O Acervo tem um Diário de Chegadas**: uma tabela só de acréscimo, com número de sequência `AUTOINCREMENT` que nunca se reaproveita. A coluna de sequência em `mensagens` e o `rowid` implícito ficam descartados: o `rowid` é reaproveitado quando a última linha é apagada (medido), e uma garantia que vale por convenção do código não sobrevive à primeira operação que apague Mensagem.
2. **Cada fato gravado vira uma Chegada, na mesma transação, pela porta de escrita do núcleo**: Mensagem, Edição, Anexo que passou a ter o arquivo, Transição de Participação e Etiqueta de Participação. Só quando o fato nasce; a reentrega não gera Chegada, e a falha da Chegada desfaz o fato. As portas abrem a própria transação (ponto de salvamento, se já houver uma), porque as importações não têm transação externa.
3. **A Chegada declara a origem** (`ao-vivo`, `importacao` ou `reprocesso`), campo obrigatório que o compilador cobra de todo chamador, e um teste fixa a origem de cada ponto de entrada de produção. Assim o consumidor ignora um backup importado ou um reprocessamento sem confundi-los com recepção. O derrame que o próprio ouvinte drena é `ao-vivo`. Não existe origem "Pendentes": a idade se mede pelo instante de gravação menos o do fato.
4. **O Diário guarda referências, não conteúdo** (ids, autor, direção, instantes). A leitura **com conteúdo** liga a Mensagem por junção, na forma que a leitura de Mensagens já entrega, e corta a página em 1,5 MB (ao menos uma Chegada sai sempre; o `proximo` acompanha a última incluída). Não há cópia do texto da conversa numa segunda tabela com retenção própria.
5. **A leitura é por Marcador opaco** (época e número da última Chegada lida), em ordem de gravação, na rede (`GET /chegadas`, verbo solto, no worker de leitura) e na CLI (`malote chegadas`). Marcador malformado é erro de uso; **Marcador expirado** (outra época, abaixo do Piso, acima da última Chegada) é 410 e código de saída 8, distinto de qualquer falha de rede ou de uso, e o consumidor pede o ponto de partida e recomeça dali.
6. **O Piso é o maior número removido**, e a aparagem (30 dias) remove um prefixo da ordem de gravação, em lotes de 5.000, e nunca a Chegada de maior número. O ouvinte apara depois da subida (10 minutos, depois a cada hora), e `malote chegadas aparar` serve a quem não tem ouvinte. A Operação `aparar-chegadas` é irreversível e só é gravada quando algo foi removido.
7. **Sem retroativo.** O Diário começa na migração. Um evento reconstruído para as Mensagens anteriores seria inventado (não existe o instante de gravação nem a origem), e um pedido "desde o começo" acidental dispararia o consumidor para o Acervo inteiro. Um comando opcional, com origem própria, pode vir depois.

## Consequências

- **Custo na gravação.** A Chegada acrescenta de 0,15 a 0,3 ms por Mensagem na recepção inteira (medido em bancada: de 0,87–1,18 ms para 1,14–1,38 ms), pelo ponto de salvamento, pelo `INSERT`, pelo contador do `AUTOINCREMENT` e pelo índice por Conversa. Uma otimização que dispensa o ponto de salvamento quando já há transação foi descartada: tiraria a atomicidade de quem captura a exceção dentro da transação do chamador.
- **Volume.** Da ordem de 100 mil Chegadas em 30 dias num Acervo grande, algumas dezenas de MB. A leitura de uma página de 500 num Diário de 100 mil Chegadas leva 2 ms sem conteúdo (163 KB) e 13 ms com conteúdo (364 KB).
- **O Anexo duplicado por um chamador que não checa duplicata gera Chegada duplicada**, como já gera Anexo duplicado: a tabela de Anexos não tem unicidade, e a checagem é do chamador.
- **Atualização.** O Acervo muda de forma (v30); a migração roda na primeira abertura e é idempotente. Quem usa atualização automática que recusa release que muda a forma do Acervo atualiza à mão, com cópia consistente.
- **Revogação de Mensagem não é Chegada ainda.** Ela não existe como agregado (o evento cru fica só na guarda de descartes); quando for modelada, ganha tipo próprio.
- **Fora de escopo:** espera longa (long-poll), SSE, webhook e a chamada de qualquer agente. O produto não entrega por push; quem consome consulta em intervalo curto.
