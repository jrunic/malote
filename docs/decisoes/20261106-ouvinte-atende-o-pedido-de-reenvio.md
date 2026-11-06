---
id: 202611061200
projeto: malote
tipo: decisao
status: aprovado
data: 2026-11-06
escopo: repo:malote
plataforma: "*"
dominios: [tecnologia]
descricao: "ADR — o ouvinte atende o Pedido de reenvio das mensagens que o malote enviou, pela memória do envio e, depois de um reinício, pelo Acervo, ligado pela Referência Externa que o Envio passa a guardar (Acervo v32); o que isso usa do contrato da biblioteca, os limites e o risco"
tags: [adr, decisao, adaptador, envio, whatsapp, baileys, reenvio, acervo-v32, risco]
---

# ADR — O ouvinte atende o Pedido de reenvio

## Status

Aprovado — 2026-11-06. Complementa a ADR `20260824-adocao-de-biblioteca-nao-oficial-para-recepcao-ao-vivo`, que aceita o risco de usar a biblioteca; esta aceita um uso a mais dela, dentro daquele risco.

## Contexto

Quando o aparelho de quem recebe um Envio não consegue decifrá-lo, ele avisa a plataforma, a plataforma pede ao remetente que reenvie, e a biblioteca de recepção pergunta ao malote qual era a mensagem original. Até aqui o malote não respondia: a pergunta tem resposta padrão "indisponível", o pedido era descartado e a única marca era uma linha de depuração que o registro do ouvinte não grava. O destinatário ficava com "Aguardando mensagem" até abrir o app no aparelho principal, e o malote nunca soube que houve pedido.

Medido em novembro de 2026:

- **Na biblioteca em uso (6.7.24) a pergunta pela mensagem original é o único caminho do reenvio.** Não há cache próprio de mensagens enviadas nem gerenciador de reenvio (isso só existe na linha 7.x). A pergunta só acontece para mensagem **própria** da conta, dentro do limite de 5 reenvios por mensagem e participante, que a biblioteca conta em memória por Conexão. Ela reenvia para o endereço **do recibo**, não para o destino do Envio.
- **O Acervo não distingue o que o malote enviou do que outro aparelho da mesma conta enviou:** de 116 registros `enviada` ao vivo da conta que envia, 96 vieram de outro aparelho. Uma fonte que servisse qualquer `enviada` reenviaria conteúdo que o malote nunca mandou.
- **O registro gravado da Mensagem do eco se reconstitui com o inverso da biblioteca:** a codificação protobuf da mensagem é idêntica à original em 20 de 20 ecos reais e em 11 de 11 casos construídos pela biblioteca (texto, coletiva, endereço opaco, mensagem citada com imagem, imagem, documento, áudio, enumerações, longos acima de 2^53).
- **Não se sabe quantos pedidos chegam:** em 33 dias de registro do ouvinte não há linha de pedido de reenvio.

## Decisão

1. **O Envio guarda a Referência Externa da Mensagem enviada** (campo novo e índice parcial por `(Configuração, Referência Externa)`, Acervo v32), gravada no mesmo ato que o marca `enviado`. É o discriminador do que o malote enviou, por mecanismo e não por heurística, e o vínculo que o ciclo seguinte (recibos e estado de entrega) também usa.
2. **O ouvinte responde ao Pedido de reenvio por duas fontes, em ordem:** a **memória do envio** (a mensagem exatamente como a biblioteca a montou, 256 entradas e 1 hora, que sobrevive à religação do socket) e o **Acervo**, só para a Mensagem cuja Referência Externa consta num Envio **da Configuração do ouvinte** e cujo registro tem a forma do eco local, reconstituída com o inverso da biblioteca. O resto é "indisponível".
3. **O ouvinte só responde quando o chamador passa o gancho.** Sem ele o socket nasce como sempre nasceu.
4. **Cada pedido é contado e registrado, sem endereço nem conteúdo:** uma linha no registro e uma série por dia acumulada entre Conexões, em `ouvinte estado --json` (`reenvios`). O produto mede e quem vigia decide o limiar.
5. **Não se confere o endereço do recibo contra o do Envio; conta-se a divergência.** A biblioteca reenvia para o endereço do recibo, e conferi-lo tropeça no celular brasileiro gravado numa forma e enviado na outra, o que tornaria o reenvio inútil para esses destinos.

## O que isto usa do contrato público da biblioteca, e o que não usa

**Usa, e é superfície pública (6.7.24):** a opção `getMessage` do socket (a biblioteca a chama para repetir uma mensagem), o objeto de mensagem que o envio devolve, e `proto.Message` (`fromObject` e `encode`).

**Está fora do contrato público, e é o risco:** as **frases do registro** da biblioteca que o malote conta (a falha de reenvio por recibo, a recusa por limite de reenvios e a recusa de recibo de mensagem que não é própria), e a **forma gravada** do registro da Mensagem, que é a serialização da própria biblioteca. Uma versão que renomeie uma frase deixa a contagem daquele caso cega, e uma que renomeie uma enumeração ou um campo pode quebrar em silêncio a reconstituição do que já está gravado.

## Consequências e riscos

- **Corrige a recuperação, não a causa.** A causa de o aparelho não decifrar pode estar na sessão. Se o contador mostrar pedidos atendidos e o aparelho continuar ilegível, a causa está na sessão e esta decisão fez o que podia.
- **A memória guarda conteúdo de conversa em claro no processo do ouvinte**; o teto e a vida curta limitam, mas não eliminam. Ela some no reinício.
- **A fonte Acervo é permanente e envelhece com a versão da biblioteca.** Nenhum código apaga Mensagem, então uma mensagem apagada para todos pelo remetente continua reenviável pelo Acervo; retirá-la fica fora desta decisão e o contador é a medida. Uma troca de versão obriga a rodar de novo a prova de ida e volta (o teste pina a versão).
- **Tráfego a mais para quem já não decifra.** Com sessão corrompida o reenvio pode falhar de novo; o limite de 5 vale por Conexão e religações frequentes o repetem; o reenvio para coletiva apaga a memória de chaves do grupo e a redistribui a todos os membros.
- **A conta de leitura não reenvia porque seus Envios não têm Referência Externa e ela não enviou nada no processo, não porque o produto a proíba.** Um Envio novo por ela, contra a política da instalação, seria reenviável por ela. A política de qual conta envia é da instância, não do produto.
- **Pior caso do endereço:** um recibo de reenvio de Y que nomeie o identificador de uma mensagem enviada a X faria o ouvinte entregar a Y o conteúdo enviado a X. O identificador não é adivinhável, e o contador de endereço diferente mede se ocorre.
- **O Envio guarda a Referência Externa da última tentativa.** Se a contabilidade depois do envio falha e a passada seguinte envia de novo com outro identificador, a primeira mensagem entregue fica só na memória.
- **A migração v32 não tem volta de versão sem restaurar cópia:** o código anterior recusa abrir Acervo de forma posterior. Correção urgente da versão anterior sai de um ramo de produção, e quem mantém uma instalação fora da atualização automática a recebe por atualização manual com cópia consistente do Acervo.

## Alternativas consideradas

- **Só a memória.** Não custa migração, mas perde tudo no reinício, que é justamente quando a fila de Pendentes acumula e os pedidos tardios chegam.
- **Só o Acervo, por direção `enviada`.** Reenviaria o que outro aparelho enviou. Reprovada pela medição (96 de 116).
- **Tabela nova ou arquivo em disco para o vínculo.** Mais peças para o mesmo vínculo; o campo no Envio basta e já serve ao ciclo seguinte.
- **Conferir o endereço do recibo.** Ver a decisão 5.
- **Atualizar a biblioteca para a linha 7.x**, que traz cache e gerenciador de reenvio próprios. Fora desta decisão (atualização de dependência com ADR própria).
- **Não fazer nada.** O destinatário segue dependendo de abrir o app no aparelho principal, e o malote segue sem saber quantas vezes isso ocorre.

## Como reverter

Uma nova versão que remove o gancho do `ouvir`: o socket volta a nascer sem `getMessage` e o pedido volta a ser descartado. O campo e o índice do Envio ficam no Acervo (não há volta de versão do Acervo sem restaurar cópia), sem uso.

## Quando se aposenta

Se a biblioteca passar a manter o próprio cache de reenvio e a responder sozinha, a memória e a segunda fonte ficam redundantes e saem por uma ADR de aposentadoria, não em silêncio.

## Referências

- `docs/dominio/malote.md`, operações `receber-ao-vivo` e `solicitar-envio`.
- `docs/explicacoes/invariantes-da-recepcao-e-do-ouvinte.md`.
- `docs/referencias/comandos-modo-servidor.md`, `ouvinte estado`.
- ADR `20260824-adocao-de-biblioteca-nao-oficial-para-recepcao-ao-vivo` e ADR `20261023-ouvinte-recolhe-os-pendentes-da-plataforma`.
