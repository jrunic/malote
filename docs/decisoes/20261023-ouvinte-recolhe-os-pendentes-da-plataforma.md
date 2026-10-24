---
id: 202610232300
projeto: malote
tipo: decisao
status: aprovado
data: 2026-10-23
escopo: repo:malote
plataforma: "*"
dominios: [tecnologia]
descricao: "ADR — o ouvinte recolhe os Pendentes da Plataforma: depois da parte que a biblioteca de recepção pede, libera o buffer inicial e pede mais, até a plataforma declarar o fim; o que isso usa do contrato público da biblioteca, o que não usa, e o risco"
tags: [adr, decisao, adaptador, recepcao-ao-vivo, whatsapp, baileys, pendentes, risco]
---

# ADR — O ouvinte recolhe os Pendentes da Plataforma

## Status

Aprovado — 2026-10-23. Complementa a ADR `20260824-adocao-de-biblioteca-nao-oficial-para-recepcao-ao-vivo`, que aceita o risco de usar a biblioteca; esta aceita um uso a mais dela, dentro daquele risco.

## Contexto

Ao criar a Conexão, a plataforma anuncia quantos itens guardou para o ouvinte enquanto ele esteve fora (mensagens, recibos, notificações, status, chamadas): os **Pendentes da Plataforma**. A biblioteca de recepção responde com **um único pedido, de 100 itens**, abre um buffer inicial de eventos e só o libera quando a plataforma declara o **fim**. Em ouvinte saudável o fim chega em segundos.

Medido em outubro de 2026 numa instalação em produção, no registro do ouvinte e em dois experimentos:

- **O fim pode não chegar.** Três episódios em 30 dias de Conexões abertas sem nenhum aviso de fim (93,8 h, 8,8 h e 30,4 h), todos depois de uma interrupção que acumulou fila. O buffer não fecha, nenhuma Mensagem chega à gravação, e a Conexão segue saudável por todos os sinais que o produto tem.
- **O que já foi confirmado se perde.** Cada Conexão presa recebeu uma parte, a biblioteca a confirmou à plataforma, e a parte ficou no buffer, que morreu na queda seguinte. O Acervo ficou 48,8 h sem Mensagem; o que foi confirmado não volta da plataforma.
- **Reiniciar não destrava.** O serviço reiniciado voltou ao mesmo estado.
- **O remédio funcionou, nos dois passos.** Liberar o buffer soltou as 136 Mensagens da parte inicial; pedir mais Pendentes a cada pausa fez a plataforma entregar o resto e declarar o fim (3.581 itens em 35 pedidos, 3 min), e a Conexão voltou a gravar.
- **A causa só está parcialmente entendida.** Duas leituras cabem nos dados: a plataforma espera o próximo pedido, ou espera a confirmação de um item que a biblioteca respondeu com retentativa de decifra. Um único pedido, de 100 itens, já trouxe 859 itens num dos episódios que se resolveram sozinhos, o que enfraquece a primeira.

## Decisão

**O ouvinte recolhe os Pendentes da Plataforma a cada Conexão**, e a decisão mora num módulo do adaptador, sem tocar o núcleo:

1. Depois que a parte inicial assenta (4 s sem nenhum nó, ou 60 s da criação do socket), **libera o buffer** inicial, uma vez, para a gravação.
2. Com anúncio de pendentes, **pede mais** (100 itens) a cada pausa de 4 s sem nó, até a plataforma declarar o fim, o teto de pedidos (2 × anunciados ÷ 100 + 10, piso de 20), três pedidos seguidos sem nenhum nó de volta, ou 10 min.
3. **Só o aviso de fim da plataforma prova que os Pendentes acabaram.** Teto, prazo e falta de resposta terminam o esforço e não provam entrega: o desfecho de cada Conexão diz "pode haver Mensagem retida". O aviso de fim que chega **depois** desses desfechos os corrige para `recolheu`. O prazo e o teto só existem com anúncio.
4. Uma Conexão cujo fim chega antes da primeira pausa **não envia pedido nenhum e não libera nada à força**.
5. O estado de cada Conexão (anunciados e recebidos por tipo, falhas de decifra, pedidos, fim declarado, desfecho) fica em arquivo e sai em `ouvinte estado --json`, só com tipos e números. O produto mede e quem vigia decide o limiar.

## O que isto usa do contrato público da biblioteca, e o que não usa

**Usa, e é superfície exportada pela biblioteca (6.7.24):** enviar um nó pelo transporte (`sendNode`), perguntar e liberar o buffer de eventos (`ev.isBuffering`, `ev.flush`), ouvir o transporte (`ws.on`) e ler o fim por `connection.update` com `receivedPendingNotifications` verdadeiro.

**Está fora do contrato público, e é o risco:** o **conteúdo** do nó do pedido de Pendentes (o mesmo que a biblioteca envia uma vez), os **nomes** dos nós que o transporte emite (aviso de pendentes, mensagem, notificação, recibo, chamada) e o **logger padrão** da biblioteca, que o produto embrulha para contar as falhas de decifra (só o número; nenhum argumento da chamada, que traz identificador, é guardado).

**Se a biblioteca não oferece a superfície** (versão diferente, falso de teste), o módulo fica **inerte**, o estado dos Pendentes é indisponível (`null`) e a subida do ouvinte nunca recusa.

## Consequências e riscos

- **Proteção da conta.** Pedir Pendentes é um uso que a biblioteca não faz sozinha, ainda que o nó seja o dela. O teto, a parada por falta de resposta e o prazo o limitam; relatos de terceiros somam 154 recolhimentos assim, sem sanção, mas é relato, não garantia, e o produto não promete nada a esse respeito, como já não promete sobre o uso da biblioteca.
- **A biblioteca pode mudar.** Uma versão que renomeie os nós ou o logger deixa o módulo inerte ou cego às falhas de decifra, e o estado diz `null`; o ouvinte segue como antes.
- **Não recupera o que já foi confirmado e perdido.** Isto evita perder daqui em diante; a lacuna que já existe só se preenche por importação de material posterior.
- **A causa é parcial.** O recolhimento é um remédio que funcionou, não a correção de um mecanismo plenamente explicado. O resumo de cada Conexão registra as falhas de decifra e quantos nós chegaram a cada pedido, que é o que separa as duas leituras.
- **Mais trabalho depois de uma interrupção longa.** Um ouvinte parado por dias recolhe milhares de itens (a maioria notificações) na primeira Conexão, e o que chega ao vivo no meio disso reinicia a pausa e conta como resposta (o recolhimento não separa o ao vivo do pendente). Um recolhimento de 10 mil itens não foi medido, e o prazo de 10 min não o comporta: o que sobrar fica com a plataforma e a Conexão seguinte recomeça.

## Alternativas consideradas

- **Atualizar a biblioteca para a versão candidata `7.0.0-rc14`.** Traz um timer de 30 s que libera o buffer, o que cobre só a liberação; mantém o pedido único de 100 itens e o tratamento do atributo `offline="0"` como offline, e troca a API e o formato do estado de autenticação. Descartada neste ciclo.
- **Só alarmar** (medir e expor, sem agir). Transforma dias de silêncio em alarme em minutos, mas não recupera nada; a medição entrou de qualquer modo.
- **Reconectar à força** quando o recolhimento termina mal. Reconectar não destrava (medido), e perderia o buffer. Fica para o alarme da frota decidir.
- **Não fazer nada.** O ouvinte volta a depender de um novo pareamento com a pessoa diante do aparelho.

## Como reverter

Uma nova versão que remove o gancho dos Pendentes do `ouvir`: o socket volta a nascer só com a autenticação, sem logger embrulhado, e a Conexão volta ao comportamento da biblioteca. É uma versão, não uma configuração.

## Quando se aposenta

Se a biblioteca passar a pedir os Pendentes até o fim por conta própria, este módulo fica redundante e sai por uma ADR de aposentadoria, não em silêncio.

## Referências

- `docs/dominio/malote.md`, operação `receber-ao-vivo`.
- `docs/explicacoes/invariantes-da-recepcao-e-do-ouvinte.md`.
- `docs/referencias/comandos-modo-servidor.md`, `ouvinte estado`.
- ADR `20260824-adocao-de-biblioteca-nao-oficial-para-recepcao-ao-vivo`.
