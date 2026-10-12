---
id: 202610065583
projeto: malote
tipo: explicacao
escopo: repo:malote
plataforma: "*"
status: ativo
dominios: [tecnologia]
descricao: Regras da recepção ao vivo, do ouvinte, da mídia e do Envio, com motivo e medição — carga sob demanda.
tags: [explicacao, invariantes, Node]
---

# Invariantes da recepção ao vivo, da mídia e do Envio

Regras e decisões do repo **com o motivo e a medição que as sustentam**, movidas do `CONTEXTO.md` para que a carga default da sessão fique pequena. Leia antes de mexer no assunto; o `CONTEXTO.md` aponta para cá e nomeia as regras mais perigosas.

- **A Etiqueta de Participação é evento que a Fonte declara, e o ramo da recepção vem ANTES do descarte por tipo, com o tipo aceito por nome E por número.** O evento chega como `protocolMessage`, que a recepção ignora e conta; sem o ramo próprio ele some. Medido em campo (05/10/2026, três rodadas de uma conta de teste): o tipo chega como o **nome** do enum depois do round-trip de JSON, e `label` e `labelTimestamp` chegam string; a captura diagnóstica que filtrava só o número perdeu todos os eventos reais. Remover é um evento de `label` vazio, nunca a ausência do campo, e a etiqueta própria só se grava quando o Acervo já conhece o LID da conta (Endereço da Conta conferido). Etiqueta não é Participação, não é Atribuição de Nome e nunca entra na precedência de nome (há teste que o fixa, e outro que fixa o filtro de nome em bloco de `contacts.upsert`).
- **O texto da etiqueta é dado pessoal declarado: aparece na saída dos comandos de consulta e NUNCA em log, mensagem de erro ou relatório de recepção.** O relatório e o log do ouvinte só contam (`N gravada(s), M removida(s)`); há teste que procura o texto de uma etiqueta sintética na saída do ouvinte e não o acha. O derrame em arquivo guarda o evento cru, como guarda toda mensagem.
- **A saída default de `ouvinte estado` é contrato com quem vigia a instalação.** O health-check passa a
  linha **inteira** para `date -u -d`; qualquer linha a mais e a conversão falha, o instante
  vira zero, e a idade calculada vira alarme de silêncio em todas as contas. Sinal novo entra
  por `--json`, nunca na saída default. Medido em 09/09/2026, lendo o consumidor antes de
  mexer.
- **Grava no Acervo antes de tirar do Derrame, nunca o contrário.** Invertido, morrer no meio
  apaga o que nunca entrou; nesta ordem o pior caso é repetição, e a unicidade de
  `(fonte, id_externo)` a descarta. Vale para qualquer consumo de fila persistida.
- **Recurso com estado exclusivo tem um dono por vez.** `reprocessar` recusa com ouvinte no
  ar — os dois escrevem no Derrame, e o lote derramado entre a leitura e o descarte some sem
  ter sido gravado. O guard olha o unit **e** o processo solto, porque o repareamento sobe
  `malote ouvir` fora do unit. Sem a ferramenta que mede, ele responde que **há** escritor:
  ausência de ferramenta não é estado benigno.
- **Disputa de escrita NÃO é recusa, e o `catch` que a trata é estreito.** `SQLITE_BUSY` é
  infraestrutura; recusa é sobre **dado** que o modelo não aceita. O discriminante é
  `ehBancoOcupado` em `nucleo/erro-de-banco.ts`, e ele olha o **código** do erro, nunca a
  mensagem. Quem trata é a camada de comando (`cli/derrame.ts`), que grava o evento cru em
  `<raiz>/ouvinte/<conta>/nao-gravados.jsonl` e o recupera por `malote ouvinte reprocessar`.
  Medido em 08/09/2026: o `catch` por evento de `ao-vivo.ts` engolia `SQLITE_BUSY` e o
  contava como `recusado` — a Mensagem se perdia em silêncio. Qualquer `catch` largo em
  caminho de escrita reintroduz isso.
- **Aumentar `busy_timeout` não resolve disputa longa.** `better-sqlite3` é síncrono e o
  timeout bloqueia a **thread**: esperar minutos congelaria o WebSocket do ouvinte e o
  derrubaria por outro caminho. O valor está explícito em `nucleo/acervo.ts` com o mesmo
  número que já valia (5.000 ms, que era o default da biblioteca, não uma decisão do
  produto). Quem protege é o derrame.
- **A classificação de conteúdo do adaptador de recepção é MEDIDA, nunca deduzida.** O evento
  traz um objeto de conteúdo cujas chaves não têm hierarquia declarada: umas são o assunto da
  Mensagem, outras **acompanham**. Acrescentar chave a `ACOMPANHAM` ou a `VIRAM_MENSAGEM`
  sem medir contra captura real é adivinhar — e o custo de errar é Mensagem descartada em
  silêncio, no caminho ao vivo. O critério que separa as duas é a **razão entre aparecer
  acompanhando e aparecer sozinha**: em 04/09/2026 a chave de distribuição de chave de grupo
  media 27 para 1, e classificá-la como assunto descartava 40% das conversas coletivas. A
  suíte estava verde o tempo todo.
- **Trabalho de disco no caminho de SUBIDA do ouvinte pode travar a subida — e
  travou.** Medido no Linux em 13/09/2026: `mkdirSync(dir, { recursive: true })`
  sobre um caminho patológico do sistema de arquivos virtual **não lança e não
  retorna**. Pendura. O CI ficou 30 minutos preso na suíte, e no macOS o mesmo
  código falhava limpo porque `/proc` não existe lá — verde em segundos.
  O que abre a captura roda antes de o ouvinte conectar: um travamento ali é o
  ouvinte que nunca sobe, por causa de um diagnóstico desligado por padrão.
  **Criação de diretório é pré-condição do operador, não trabalho do produto na
  partida.** Há teste que exige que abrir NÃO crie pasta.
- **A biblioteca de recepção entra por UM portão, e por import dinâmico.** `src/adaptadores/whatsapp/conexao.ts` é o único arquivo autorizado a alcançá-la, e nem ele pode importá-la estaticamente: import estático carrega os 120 pacotes da árvore em **todo** comando — `malote conversas` incluso — e faz o produto inteiro parar de subir no dia em que a biblioteca quebrar. As duas guardas estão em `tests/fronteira-de-dependencia.test.ts` e foram verificadas com a violação reintroduzida em 02/09/2026. O adaptador de recepção continua **puro**: ele recebe a mensagem já decodificada, e é isso que o mantém testável sem socket.
- **O que a Fonte entrega sem conteúdo decifrável NÃO vira Mensagem.** `registrarMensagem` é primeiro escritor vence: gravar o envelope vazio **trava** o identificador contra quem souber preenchê-lo depois — a própria biblioteca, que reenvia decifrado, ou o backup. Medido em 02/09/2026: 90 dos 4.167 eventos de 11h23 de captura, na ordem de 190 por dia. Pular e **contar** é a política; o envelope não vale o lugar.
- **Aprender endereço vem ANTES do laço que escreve — e vale para o lote inteiro, não por registro.** A Restrição da forma canônica já dizia a ordem, e o adaptador ao vivo a violava aprendendo dentro do laço. Achado pelo aceite de 02/09/2026 contra 1.018.130 Mensagens: a **segunda** passagem sobre a mesma captura criou 10 Transições novas — um evento processado antes de o par aparecer gravava o membro na forma alternativa, e no reprocessamento já resolvia para a canônica. A Mensagem não sofria, porque a chave de conflito dela não inclui o autor; a Transição sofria, porque a dela inclui. O sintoma dessa classe é **idempotência que quebra na segunda passagem sem nada ter mudado no mundo**, e ela só aparece medindo por `SELECT COUNT(*)` antes e depois — o relato conta chamadas, não linhas criadas: medido no mesmo dia, `gravados: 2.463` contra **2.447** Mensagens reais.
- **O identificador do evento administrativo NÃO converge entre as Fontes, e o produto mede em vez de prometer.** A convergência por Referência Externa está provada para a **Mensagem**; para a **Transição de Participação**, não: 10.569 de 10.569 identificadores de evento no material exportado têm 20 caracteres maiúsculos, e os 34 recebidos ao vivo têm 9 ou 10 minúsculos. A ponte que decidiria a questão **não é mensurável** — a sobreposição entre as duas fontes é de 3 eventos. `conferirTransicoesRepetidas` conta o mesmo evento sob identificadores diferentes, **agrupando por segundo** porque 6,9% dos instantes do material têm fração; ele responde zero hoje e responde o número no primeiro backup posterior, que é quando a troca da chave de unicidade se decide. O número **não** muda o código de saída de `pessoa conferir`: guarda violada sai 1, medição de consequência conhecida só relata.
- **Adaptador não decide onde arquivo cai — nem para efeito operacional.** A guarda `nenhum adaptador conhece o layout de arquivo em disco` nasceu para o layout de mídia e reprovou, em 02/09/2026, o módulo do efeito de observabilidade do ouvinte, colocado sob `src/adaptadores/` por engano. Ela estava certa: quem decide layout é quem monta a instalação, e o módulo mora em `src/cli/`.
- **`pgrep -f` casa também com o shell que invoca o programa — e matar o shell é indistinguível de sucesso.** Em 03/09/2026, testando o desligamento limpo do ouvinte contra a conta real, o `kill -TERM` foi para o shell do painel `tmux`; o processo caiu por arrasto, o Acervo destravou, tudo pareceu certo — e a linha `SIGTERM recebido` **nunca saiu do log**, porque o manipulador nunca rodou. Só a ausência dela denunciou. Ao testar sinal, o painel roda o programa com `exec`, para que ele substitua o shell e o pid não tenha ambiguidade; e a evidência de que o caminho limpo rodou é **a linha que ele imprime**, nunca o processo ter sumido.
- **Baixar mídia ao vivo usa a mensagem CRUA, nunca a normalizada, e só o módulo de
  conexão pode chamar `downloadMediaMessage`.** O round-trip de JSON que normaliza a
  mensagem antes de `aoReceber` (necessário para o resto do adaptador) transforma
  `mediaKey` — um `Uint8Array` de verdade — num objeto `{type:'Buffer',data:[...]}`
  que o decrypt da biblioteca não consegue usar. `MidiaAoVivo.baixar(indice)` fecha
  sobre o lote CRU, de propósito; guardado por mutação em `tests/conexao.test.ts`
  (#1068). `receberEvento` devolve `anexosNuncaObtidos` com o índice no lote de
  entrada — é o que liga o Anexo que `ao-vivo.ts` gravou ao índice que `conexao.ts`
  sabe baixar, sem o adaptador puro conhecer a biblioteca.
- **Sem Destino de Mídia, o ouvinte AVISA e segue — não recusa subir.** Diferente de
  `malote midia trazer`, que recusa sem Destino: recusar a subida do ouvinte quebraria
  toda instalação que nunca configurou um. O Anexo fica `nunca-obtido`, como sempre foi.
- **A referência de mídia do WhatsApp expira em ~30 dias, não minutos — e `mediaKey`
  chega em DUAS formas no `bruto` gravado.** Medido em 29-30/09/2026 (#1084), contra
  dois Anexos reais de produção que tinham falhado no dia anterior: a URL carrega o
  próprio prazo (parâmetro `oe=`, epoch em hex) — decodificado, ~30 dias a partir do
  recebimento. `downloadMediaMessage` da biblioteca funciona **sem socket vivo**, só
  com a mensagem reconstruída (confirmado baixando de verdade, 1,89 MB, ~1 dia depois
  da falha original). `mediaKey` aparece como **string base64 pura** (os dois casos
  reais) ou como `{type:'Buffer',data:[...]}` (o que o round-trip de JSON do
  `aoReceber` produz — ver item acima) — as duas formas acontecem, nenhuma é "a"
  certa; `reconstituirMensagemParaRetry` (`retry-de-midia.ts`) trata as duas.
  **A causa original da falha (ETIMEDOUT, bad decrypt) NÃO prevê se o retry funciona**
  — nos dois casos medidos o resultado esperado se inverteu (o "fácil" falhou de
  novo, o "difícil" recuperou) — por isso `malote midia reprocessar` tenta TODOS os
  elegíveis, sem filtrar por motivo anterior.
- **`ZSESSIONTYPE` do backup de iOS tem CINCO naturezas, não duas.** 0=direta,
  1=grupo, 2=lista-de-transmissão, 3=status, 4=comunidade — medido em 21/09/2026 para
  o adaptador macOS de outro produto, contra o **mesmo formato de backup**, decisão confirmada
  pelo Titular. `!= 0` (coletiva) continua certo para 1/2/4; **status (3) nunca vira
  Conversa nenhuma** — não é chat de verdade, é o feed de acompanhamento de stories de
  um contato. `=== 1` seria o fix errado: demoveria lista de transmissão e comunidade a
  Conversa direta, contradizendo a #825/#826 (broadcast tem Mensagem real, 29.035
  medidas, e fica coletiva). Ver `DescartesDoMaterial.conversas['status']` (#1069).
- **A decisão acima vale para os DOIS caminhos que podem criar Conversa — e só
  cobria um.** O #1069 corrigiu a IMPORTAÇÃO (`material.ts`); a RECEPÇÃO AO VIVO
  (`ao-vivo.ts`) tinha uma decisão própria e mais antiga (critério 11a do #825:
  "os feeds de status caem do lado compartilhado"), que classificava
  `<numero>@status`/`<lid>@lid.status` como coletiva e deixava a Conversa **e**
  a Mensagem serem gravadas normalmente — com evidência de que isso já aconteceu
  em produção (11 Conversas diretas de broadcast/status nascidas ao vivo, antes
  do fix de `@g.us`). **Revertido em 29/09/2026 (#1094)**, decisão direta do
  Titular: "status não faz sentido em malote; o critério da 11a está errado".
  `enderecoEhFeedDeStatus` descarta o evento inteiro no laço principal de
  `receberEvento`, antes de resolver endereço ou abrir Operação — nenhuma
  Conversa, nenhuma Mensagem, para nenhuma das duas formas. **`@broadcast`
  (lista de transmissão e o feed agregado `status@broadcast`) não foi tocado** —
  critério 11a nunca cobriu essa forma, e ela continua tendo Mensagem real.
- **Envio nunca abre conexão própria — `Conexao.enviar` discrimina falha de
  transporte de falha definitiva, e a diferença decide o estado.** Boom 428
  (`connectionClosed`) e 408 (`connectionLost`) são rotina de transporte, não
  falha de dado: `conexao.enviar` os filtra e devolve `undefined`
  (indeterminado), nunca propaga como exceção. Qualquer outra exceção
  (destinatário inválido, rejeição da plataforma) sobe para
  `processarEnvios`, que marca `falhou` — nunca o contrário. Confundir os
  dois faria toda janela de religação com um Envio pendente virar falha
  definitiva em silêncio.
- **A Conversa de um Envio nasce no PROCESSAMENTO (dentro do `ouvir`), nunca
  na solicitação.** `solicitar-envio` grava só a linha do pedido, com o
  endereço cru quando a Conversa ainda não existe; `processarEnvios` é quem
  resolve ou cria, e só DEPOIS de confirmar sucesso do envio — destinatário
  errado nunca deixa Conversa imortal no Acervo (Conversa nunca é apagada).
  É o que permite a rota de rede (`/envios/solicitar`) gravar só uma linha,
  sem precisar do mesmo mecanismo de escrita de domínio que criar Conversa
  exigiria.
- **A fila de Envio prioriza por `tentativas` antes de `solicitada_em`.** Um
  Envio que já tentou e voltou indeterminado cede a vez aos que nunca
  tentaram — sem isso, um Envio problemático trava a fila inteira daquela
  Configuração atrás de si, porque o poller sempre pegaria o mesmo primeiro.
- **O eco do Envio de mídia pode chegar ANTES de `aoEnviar` rodar, e o laço
  de `anexosNuncaObtidos` espera a passada de Envio em curso.** Medido lendo
  a biblioteca vendorizada: o `sendMessage` emite o eco num `process.nextTick`
  atrás de um mutex, e nada garante que a continuação do `await` que chama
  `aoEnviar` rode antes dele. Sem a espera, o eco não acharia o `keyId` no mapa
  `bytesOriginados` e baixaria de volta do WhatsApp os bytes que o malote acabou
  de enviar, em silêncio — o Anexo ficaria `presente` do mesmo jeito, então só
  um teste que emite o eco **de dentro** do `sendMessage` pega. A passada é
  publicada (`passadaDeEnvio`) ANTES de começar, porque o eco pode vir do
  primeiro trecho síncrono dela. O staging é movido para `processados/` depois
  de gravar o Anexo, nunca apagado; se o processo cair entre o envio e o eco,
  o mapa de processo morre e o arquivo fica órfão em `envios-pendentes/`
  (janela aceita e nomeada, sem detecção).
- **Envio órfão por vínculo invalidado nunca vira `falhou`.** Quando o
  adaptador invalida o vínculo (`loggedOut`), o poller para, mas nenhum
  Envio `pendente` daquela Configuração é tocado — a causa é do vínculo, não
  do Envio, e ele fica pendente até reparear.

- **A recepção ao vivo é idempotente também no Anexo.** A Mensagem é idempotente por `(fonte, id_externo)` e devolve o id que já existe; o Anexo não tem restrição de unicidade, então `gravarUma` confere `anexoJaExiste` antes do laço de Anexo (a importação já fazia). Sem isso, o mesmo evento passando de novo (reentrega offline, lote drenado do derrame, `ouvinte reprocessar`) gravava outro Anexo `nunca-obtido` e pedia outro download: medido em 07/10/2026, uma Mensagem e dois Anexos. A Mensagem que já tem Anexo, inclusive o `presente` vindo de backup, não ganha outro; a reentrega continua contada como gravada em `relato.gravados`.

- **O que a recepção não grava como Mensagem é contado, por evento, em `descartados`.** O relato lista cada descarte e cada recusa com o motivo (`protocolMessage` leva o tipo do protocolo, porque um balde só não mede nada); `parametro-sem-endereco` não é descarte de evento (o evento já é Mensagem) e só entra no contador. A lista de ruído conhecido (`cifrada`, `status`, distribuição de chave sozinha) mora num só lugar, no adaptador, e a camada de comando nunca a duplica. A série diária (`descartes.json`) tem só tipos e números, teto de tipos distintos por dia, e a escrita falhar nunca derruba o ouvinte nem a Mensagem do mesmo lote. O reprocessar do derrame só anota a rodada completa, porque é tudo-ou-nada.

- **A guarda do evento cru é por EXCLUSÃO.** Guarda tudo que não vira Mensagem, **incluindo o recusado, com a causa**, menos o ruído conhecido (`cifrada`, `status`, distribuição de chave sozinha), cuja lista mora só no adaptador. Tipo novo e embrulho desconhecido são guardados por padrão, que é o que teria salvo o documento com legenda. Cada escrita (o contador e a guarda) tem a sua própria falha, e nenhuma derruba a outra, o ouvinte ou a Mensagem do mesmo lote.
- **O reprocessar da guarda LÊ e não escreve nela.** Passa um evento por vez por `receberEvento` (o relato devolve `gravados` como contagem), grava no Acervo **antes** de reescrever o arquivo por troca atômica, mantém a linha original do que continua descartado e a linha ilegível. Escrever na guarda reanexaria o descartado a cada rodada. A Etiqueta grava sem Mensagem, então o critério de sair da guarda é o evento deixar de ser descartado, não `gravados === 1`.
- **Entre classificar e guardar há uma janela, e ela é aceita.** O adaptador classifica dentro de `receberEvento` e a camada de comando só guarda depois que o relato volta; o processo que morre nesse intervalo perde os descartes daquele lote. A garantia é que **nenhuma decisão de classificação** perde evento, não que nenhum evento se perca.
- **A rotação apaga o arquivo anterior mais antigo.** Exceção nomeada à regra de que o produto não apaga, decisão do Titular: o disco é finito e a guarda está fora do backup.

## Pontos conhecidos

- **O oráculo de classificação depende da NATUREZA que se testa, e confundi-los custou quase 8.323 eventos.** Para estabelecer que um código da Fonte é **saída**, a fração de membros que escreveu **antes** dele tem de ser alta e a que escreveu depois, baixa. Para **entrada**, o inverso — e a fração que escreveu antes tem de ser quase zero, porque ninguém escreve num grupo antes de ser adicionado. Em 30/08/2026 o mapa nasceu usando só os oráculos de saída e aplicando-os a todos os códigos; num código de entrada eles medem outra coisa (se a pessoa saiu depois) e devolvem um valor intermediário sem significado. O código 15 ficou de fora com "10,5%" e a spec chegou a afirmar que a Fonte não declarava entrada. **Ao acrescentar código ao mapa em `src/adaptadores/whatsapp/codigos-de-evento.ts`, escolher o oráculo pela natureza que se hipotetiza — e rodar os dois.**
- **`--em <AAAA-MM-DD>` é o FIM daquele dia, capado ao fim do Alcance.** Data sem hora é um **dia**, e comparar meia-noite com o instante de um evento fez, em 30/08/2026, uma data dentro do Alcance ser reportada como fora — nas duas bordas. A regra atual está em `src/cli/index.ts`, no ramo `conversa presenca`; ao mexer nela, testar contra Conversa cujo Alcance começa e termina **no mesmo dia**, que é onde as duas bordas colidem. Fixture sintética com alcance de vários dias passa verde e não protege.
