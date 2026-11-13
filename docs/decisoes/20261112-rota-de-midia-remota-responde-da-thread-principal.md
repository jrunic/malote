---
id: 202611121945
projeto: malote
tipo: decisao
status: aprovado
data: 2026-11-12
escopo: repo:malote
plataforma: "*"
dominios: [tecnologia]
descricao: "ADR — a rota de mídia que busca o Anexo no armazenamento remoto não responde no worker de leitura: o worker devolve uma instrução e a thread principal pede ao Serviço de Armazenamento por um canal local, com o prazo, a reserva e o abandono da ADR de leituras em workers; o que o Serviço confere antes de entregar, os sinais 413, 502 e 503 e o que isso custa"
tags: [adr, decisao, servidor, armazenamento, destino-remoto, midia, worker, canal-local]
---

# ADR — A rota de mídia remota responde da thread principal

## Status

Aprovado — 2026-11-12. **Refina** a [`20261004-leituras-do-servidor-em-workers-com-prazo.md`](20261004-leituras-do-servidor-em-workers-com-prazo.md) num ponto: aquela ADR diz que a thread principal só autentica, despacha e responde; para a mídia que só existe no remoto, ela também **pede** ao Serviço de Armazenamento. Complementa a [`20261112-destino-remoto-de-midia-e-servico-de-armazenamento.md`](20261112-destino-remoto-de-midia-e-servico-de-armazenamento.md).

## Contexto

Com o Destino Remoto, a cópia local de um Anexo pode já ter saído do disco. A rota `GET /midia/<id>` precisa então buscar os bytes no remoto. Duas restrições decidem o desenho:

1. O worker de leitura é **síncrono** (a rota lê com `readFileSync`, e o contrato do `req` e do `res` dele são duas funções) e a leitura do remoto é assíncrona.
2. Só o Serviço de Armazenamento abre a base da Localização e fala com o remoto: o servidor não guarda credencial do remoto nem executa o `rclone` (decisão da ADR do Destino Remoto).

## Decisão

1. **O worker não responde a mídia remota.** Quando a leitura local do arquivo falha e o Inquilino tem Destino Remoto, a rota não responde: devolve `buscarNoServico` e a thread principal pede o Anexo ao Serviço por um **canal local** (soquete Unix na pasta de estado, pasta 0700 e soquete 0600, sem porta de rede; um pedido por Inquilino e Anexo, nunca por caminho) e responde.
2. **O prazo, a reserva e o abandono da ADR de leituras valem ali, impostos pelo servidor:** o prazo é o mesmo, desde a chegada, e vale **sobre o buscador** (um buscador que não responde vira `504` e recebe o aborto); a reserva é de N−1 buscas por Inquilino, a mesma conta do despachante; o cliente que vai embora aborta a leitura no remoto. O Inquilino do pedido é o da **Chave verificada**.
3. **O Serviço confere o que entrega, com o hash que ele mesmo calcula:** a Localização é do Destino Remoto de agora, o Anexo é o que ela verificou (Impressão de Anexo e tamanho do Acervo) e os bytes lidos têm o tamanho e o SHA-256 dela. Qualquer divergência é `inacessível`.
4. **Sinais distintos de "não existe":** `413` acima do tamanho máximo da rota (50 MiB por padrão); `502` quando o arquivo está guardado no remoto e não veio agora (Serviço fora do ar, remoto indisponível, conteúdo que não confere); `503` com `retry-after` quando o Serviço está no limite de entregas em voo; `504` quando passa do prazo. O `404` continua sendo "não existe".
5. **Só um tipo liga o servidor ao Serviço** (`nucleo/midia-remota.ts`); quem compõe é `src/cli/servir.ts`. O servidor e a transcrição não importam o Serviço nem citam o `rclone` (`tests/fronteira-de-dependencia.test.ts`).

## Alternativas recusadas

- **Esperar de forma síncrona dentro do worker** (bloqueio na thread com `Atomics.wait` e um segundo thread falando com o Serviço): contradiz o contrato simples do worker e esconde o prazo.
- **O worker falar com o soquete:** seria assíncrono dentro de uma rota síncrona, e quebra o `req`/`res` de duas funções.
- **O servidor guardar a credencial do remoto e ler direto:** o servidor passaria a executar o `rclone` e a guardar segredo, o que a ADR do Destino Remoto proíbe.

## Consequências

- **A busca não ocupa um worker de leitura** (a favor), mas **os bytes, até o tamanho máximo, passam pela thread principal** e pelo Serviço (contra). O pico de memória é de uma busca por reserva (N−1 por Inquilino) vezes o tamanho máximo, mais as 4 entregas em voo do Serviço; **não foi medido**, e o teto é parâmetro do Serviço (`MALOTE_ARMAZENAMENTO_MAXIMO_DA_ENTREGA_MB`).
- **O primeiro byte é o fim do download.** O Serviço confere o hash do arquivo inteiro antes de entregar; por isso o "primeiro byte em até 3 s" vale para arquivo pequeno (1,2 a 1,3 s medidos) e não para um de 20 MiB (~5 s a 4 MB/s). É uma escolha: conferir antes de entregar vale mais que o primeiro byte rápido.
- **A mídia que só existe no remoto depende do Serviço no ar.** Com ele parado a rota responde `502`, nunca `404`, e a transcrição desses áudios espera. Nenhum erro aparece no ouvinte.

## O que não conserta

- Um Anexo cuja Impressão errada o Acervo repete na Localização: a entrega confere os bytes contra a Localização, não contra o mundo.
- A banda: um arquivo grande passa do prazo de 25 s a menos de ~2 MB/s, e a resposta é `504`, com o arquivo intacto no remoto.
