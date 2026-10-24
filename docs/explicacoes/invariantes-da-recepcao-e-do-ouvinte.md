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
- **O ouvinte recolhe os Pendentes da Plataforma, e só o fim declarado pela plataforma prova que eles acabaram (#1151).**
  Ao criar a Conexão a plataforma anuncia quantos itens guardou e a biblioteca pede uma só parte, de 100 itens; a
  plataforma entrega e espera o pedido seguinte, o aviso de fim pode não vir, o buffer inicial da biblioteca não fecha,
  nenhuma Mensagem chega à gravação e o que **já foi confirmado** morre com a Conexão (medido em outubro de 2026 numa instalação:
  48,8 h sem Mensagem; três episódios em 30 dias, de 8,8 h a 93,8 h). O recolhimento libera o buffer depois que a
  parte inicial assenta (4 s sem nenhum nó, ou 60 s da criação do socket) e, **com anúncio**, pede mais a cada pausa de 4 s
  até o fim, o teto de 2 × (anunciados ÷ 100) + 10 pedidos (piso de 20), 3 pedidos sem nenhum nó de volta ou 10 min.
  **Teto, prazo e falta de resposta terminam o esforço e não provam entrega:** o desfecho diz "pode haver Mensagem
  retida". O prazo e o teto só existem **com anúncio** (sem anúncio não há recolhimento). **O desfecho pode ser
  corrigido:** o aviso de fim que chega depois do teto, do prazo, da falta de resposta ou da falha de envio o troca por
  `recolheu`, e a Conexão passa a ter duas linhas de resumo no registro, com o mesmo `conexao=` (vale a última). A assinatura é na **criação** do socket, e não no `open`: o anúncio chega antes do `open` em 546 de 553
  Conexões medidas. Conexão saudável (o fim chega antes da primeira pausa) não envia pedido nenhum e não libera nada
  à força. Nó que chega durante o recolhimento reinicia a pausa de 4 s e conta como resposta, **sem separar o ao vivo
  do pendente**: numa conta movimentada depois de uma parada a pausa pode não fechar, a liberação vem aos 60 s, e
  `nosPorPedido` fica contaminado pelo tráfego ao vivo. Biblioteca sem a superfície que o recolhimento usa (enviar nó, perguntar e liberar o buffer, ouvir o
  transporte) deixa o módulo inerte, e a subida nunca recusa. A causa só está parcialmente entendida (a plataforma
  espera o pedido, ou espera a confirmação de um item que a biblioteca respondeu com retentativa), então o
  recolhimento é um remédio que funcionou, e o resumo por Conexão registra as falhas de decifra e os nós por pedido
  para separar as duas leituras. Risco e alternativas em
  `docs/decisoes/20261023-ouvinte-recolhe-os-pendentes-da-plataforma.md`.
- **O estado dos Pendentes é arquivo, só com tipos e números, e `null` é indisponível (#1151).** `ouvinte estado --json`
  traz o campo `pendentes`; ausente, ilegível ou de forma fora do contrato lê como `null`, nunca como "sem pendentes".
  **`em-andamento` com `atualizadoEm` velho e `ultimoSinalDaConexao` também parado é processo morto, não Pendentes
  presos.** O campo não reusa `lotes`, que é do Derrame, e a saída default de `ouvinte estado` não muda.
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
- **O que a Fonte entrega sem conteúdo decifrável NÃO vira Mensagem.** `registrarMensagem` é primeiro escritor vence: gravar o envelope vazio **trava** o identificador contra quem souber preenchê-lo depois — a própria biblioteca, que reenvia decifrado, ou o backup. Medido em 02/09/2026: 90 dos 4.167 eventos de 11h23 de captura, na ordem de 190 por dia. Pular e **contar** é a política; o envelope não vale o lugar. A exceção é o evento de **tipo nulo** (conteúdo ausente, ou só `messageContextInfo`): ele não é descartado e segue para a gravação, que produz uma Mensagem sem texto, porque é por esse caminho que o evento de grupo vira Transição e metadados de coletiva (#1160); são pulados o `cifrada`, o feed de status e o tipo conhecido que não vira Mensagem.
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
- **A referência de mídia do WhatsApp expira em dias, não minutos, e o prazo depende do
  tipo — e `mediaKey` chega em DUAS formas no `bruto` gravado.** Medido em 29-30/09/2026
  (#1084), contra dois Anexos reais de produção que tinham falhado no dia anterior: a URL
  carrega o próprio prazo (parâmetro `oe=`, epoch em hex), que decodificado dá ~30 dias a
  partir do recebimento, mas o servidor responde antes disso (prazo real por tipo, abaixo).
  `downloadMediaMessage` da biblioteca funciona **sem socket vivo**, só
  com a mensagem reconstruída (confirmado baixando de verdade, 1,89 MB, ~1 dia depois
  da falha original). `mediaKey` aparece como **string base64 pura** (os dois casos
  reais) ou como `{type:'Buffer',data:[...]}` (o que o round-trip de JSON do
  `aoReceber` produz — ver item acima) — as duas formas acontecem, nenhuma é "a"
  certa; `reconstituirMensagemParaRetry` (`retry-de-midia.ts`) trata as duas.
  **A causa original da falha (ETIMEDOUT, bad decrypt) NÃO prevê se o retry funciona**
  — nos dois casos medidos o resultado esperado se inverteu (o "fácil" falhou de
  novo, o "difícil" recuperou) — por isso `malote midia reprocessar` tenta todos os
  elegíveis **do recorte que o operador dá**, sem filtrar por motivo anterior. O recorte
  (#1248) escolhe QUAIS Anexos, por data, tipo ou Mensagem, e nunca por causa da falha: a
  regra acima vale dentro dele. Sem recorte e sem `--tudo` o comando recusa, porque
  "todos" era 22.352 Anexos contra a plataforma (medido em 18/10/2026). A ordem é a da
  Mensagem mais antiga para a mais nova, que é a que vence primeiro, e o `--limite` conta
  tentativas: o que não é de recepção ao vivo nunca ocupa uma vaga. O prazo do endereço
  medido em 18/10/2026 **depende do tipo**: figurinha e áudio baixam até ~15 dias (404 aos 17-20, 410 a partir de 21),
  vídeo e documento dão 410 a partir de 21 dias, e só a imagem baixa até ~28 dias (1 de 5 aos 29); não é 30 dias para
  todos. Um lote de 4.135 imagens de 21 a 28/09 recuperou 82% (as que restaram deram 410). O comando não tem
  freio nem retomada: esse lote foi feito por script de quem opera, em fatias, com um freio (parar quando uma
  fatia tenta 30 ou mais e não recupera nenhuma) que acertou: lia um tipo expirado, não um bloqueio. `--limite`
  sozinho já conta como recorte. O download pode falhar com `ETIMEDOUT` de forma intermitente em host de RTT
  alto e sem rota IPv6: a tentativa de conexão do Node 22 (250 ms) é menor que o RTT até a plataforma (~270 ms),
  e `NODE_OPTIONS=--network-family-autoselection-attempt-timeout=3000` a resolveu na medição (#1276). O download
  ao vivo não tem retry próprio: a falha deixa o Anexo `nunca-obtido`, e `midia reprocessar` o recupera dentro do
  prazo do tipo.
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

- **O que a recepção não grava como Mensagem é contado, por evento, em `descartados`.** O relato lista cada descarte e cada recusa com o motivo (`protocolMessage` leva o tipo do protocolo, porque um balde só não mede nada); `parametro-sem-endereco` não é descarte de evento (o evento já é Mensagem) e só entra no contador. A lista de ruído conhecido (`MOTIVOS_DE_RUIDO`, nove rótulos, descrita na guarda abaixo) mora num só lugar, no adaptador, e a camada de comando nunca a duplica. O ruído de protocolo casa pelo **nome** do subtipo: um subtipo que chegue só numérico não é ruído e vai para a guarda. A série diária (`descartes.json`) tem só tipos e números, teto de tipos distintos por dia, e a escrita falhar nunca derruba o ouvinte nem a Mensagem do mesmo lote. O reprocessar do derrame só anota a rodada completa, porque é tudo-ou-nada.

- **A mensagem interativa e a mensagem de modelo de conta comercial viram Mensagem só quando têm corpo de texto (#1235).** Medido em 17/10/2026 (104 eventos na guarda do evento cru, só estrutura): a interativa chega em grupo, de uma conta comercial, com um corpo de texto e um botão de link; o modelo chega em conversa direta, em duas formas, com um campo de corpo cada, às vezes com imagem no cabeçalho, rodapé e botões. O texto da Mensagem é **só o corpo** (nas três posições medidas); rodapé, título, botões, links e o aviso de compartilhamento de dados ficam no Conteúdo Bruto, sem Anexo (a exceção é a imagem do cabeçalho do modelo, abaixo). Sem corpo (ausente ou vazio), o evento segue ignorado e guardado cru com o rótulo do tipo, **mesmo que o modelo tenha imagem no cabeçalho, que então não vira Anexo**: os dois tipos estão num segundo conjunto, consultado no despacho antes do descarte, e não no dos que sempre viram Mensagem, porque gravar Mensagem vazia trava o identificador do evento contra um reprocessar futuro. O nome da empresa verificada não é lido, então a Pessoa da empresa não ganha nome por estas Mensagens. **A imagem do cabeçalho do modelo é Anexo (#1242).** Medido em 18/10/2026 no Acervo real: 25 Mensagens de modelo, 9 com imagem, e a forma é uma só (`templateMessage` › `interactiveMessageTemplate` › `header` › `imageMessage`, com `mediaKey`, `url`/`directPath` e `fileLength`; o reconhecedor exige só a chave legível e um dos dois endereços); as 73 interativas que não são modelo não têm imagem, e a forma hidratada nunca foi vista. A recepção grava **um** Anexo `image` `nunca-obtido` por Mensagem (o bruto do Anexo é o conteúdo da imagem), que entra no download ao vivo; a reentrega não duplica. O reconhecedor (`leituraDoModelo`, puro) **não entra no desembrulhador da recepção**: abrir o modelo ali faria o classificador de tipo devolver `imageMessage` e a leitura do texto perderia o corpo. Imagem em outro lugar do modelo, ou sem chave legível, é `nao-reconhecida`: contada e deixada no bruto, nunca adivinhada. A biblioteca não abre o modelo, então a conexão (download ao vivo) e o retry (`midia reprocessar`) entregam **só a imagem, na raiz**, com a chave do evento e o `mediaKey` como veio; o modelo inteiro junto confundiria a biblioteca. O estoque se preenche por `malote midia extrair-imagem-de-modelo` (ensaio por padrão, uma Operação, `desfazer` que remove o Anexo enquanto `nunca-obtido` e recusa o já baixado), e o download é do `midia reprocessar --mensagem`. O prazo da imagem é de cerca de 28 dias, mas a do cabeçalho do modelo só foi medida com 4 a 5 dias.
- **O envelope de mídia associada é aberto, e só quando o interior vira Mensagem (#1190).** O WhatsApp entrega a versão em alta definição de um vídeo e o trecho de vídeo de uma foto em movimento num segundo evento, embrulhado em `associatedChildMessage`, com a ligação à Mensagem original ao lado, em `messageContextInfo` (medido em 17/10/2026: 3 eventos em 5 dias). O evento vira **uma Mensagem própria**, com o id externo dele e um Anexo de vídeo `nunca-obtido`; a Mensagem original não é tocada e a ligação fica só no Conteúdo Bruto (a API e a exportação não a mostram). Interior vazio ou de tipo que não vira Mensagem **não** se abre: aberto, ele viraria tipo nulo, que o código manda para a gravação de Mensagem, e não para o descarte. Só o envelope do topo conta, nunca o de uma Mensagem citada. A biblioteca não abre o envelope, então a conexão entrega à função de download o conteúdo de dentro, sem copiá-lo (o `mediaKey` binário tem de chegar como veio), e o retry de mídia (`midia reprocessar`), que reconstitui a Mensagem a partir do bruto, abre o mesmo envelope: sem isso ele não acha o vídeo e descarta o Anexo. A versão em alta definição ocupa mais que o dobro do vídeo original (85 contra 38 MB no caso medido).
- **A guarda do evento cru é por EXCLUSÃO.** Guarda tudo que não vira Mensagem, **incluindo o recusado, com a causa**, menos o ruído conhecido (`cifrada`, `status`, distribuição de chave sozinha, e os cinco rótulos de protocolo medidos na #1234: compartilhamento de chave de estado, pedido de boas-vindas, resposta de sincronização de mensagens temporárias, aviso de mídia e aviso de histórico), cuja lista mora só no adaptador e é sempre **contada**. O pai de álbum entrou na lista na #1190, porque só diz quantos itens o álbum tem e os filhos chegam como imagem e vídeo normais, cada um ligado ao pai (medido em 17/10/2026: 28 de 32 álbuns completos por essa ligação e mais 1 sem ela). A revogação fica fora de propósito: é a única fonte para um dia modelar a Mensagem apagada. Tipo novo e embrulho desconhecido são guardados por padrão, que é o que teria salvo o documento com legenda. Cada escrita (o contador e a guarda) tem a sua própria falha, e nenhuma derruba a outra, o ouvinte ou a Mensagem do mesmo lote.
- **O reprocessar da guarda LÊ e não escreve nela.** Passa um evento por vez por `receberEvento` (o relato devolve `gravados` como contagem), grava no Acervo **antes** de reescrever o arquivo por troca atômica, mantém a linha original do que continua descartado e a linha ilegível. Escrever na guarda reanexaria o descartado a cada rodada. A Etiqueta grava sem Mensagem, então o critério de sair da guarda é o evento deixar de ser descartado, não `gravados === 1`.
- **Entre classificar e guardar há uma janela, e ela é aceita.** O adaptador classifica dentro de `receberEvento` e a camada de comando só guarda depois que o relato volta; o processo que morre nesse intervalo perde os descartes daquele lote. A garantia é que **nenhuma decisão de classificação** perde evento, não que nenhum evento se perca.
- **A rotação apaga o arquivo anterior mais antigo.** Exceção nomeada à regra de que o produto não apaga, decisão do Titular: o disco é finito e a guarda está fora do backup.
- **Uma exceção que escapa da biblioteca sai por 70, nunca por 1.** O supervisor lê o 1 como vínculo invalidado e não reinicia. Sem tratador, o Node sai por 1 numa rejeição não tratada: em 30/09/2026 a biblioteca rejeitou `Connection Closed` ao responder a um pedido de retentativa sobre um socket já fechado, o ouvinte caiu e ficou 9h24 fora, sem alarme. `ouvir` instala `unhandledRejection` e `uncaughtException`, loga a causa (`EXCECAO NAO TRATADA`, com a origem), fecha o Acervo e sai por `CODIGO_DE_EXCECAO_NAO_TRATADA` (70, `EX_SOFTWARE`). A queda de rotina (428, 515) não passa por aí: a conexão a trata por dentro e religa. Falha **local de subida** (a biblioteca não carrega, o estado de autenticação não abre) continua saindo 1, de propósito: reiniciar em laço não a resolve. Os tratadores saem do processo quando o `ouvir` termina.
- **O sinal de vida da Conexão é o frame do TRANSPORTE, e nada dele propaga para a Conexão.** O gancho assina em `ws` e não em `ev` (o de domínio é bufferizado enquanto a Conexão sincroniza), de forma síncrona a cada `abrir`: o socket é recriado a cada religação e o `ws` também, e assinar só na primeira vez deixa o sinal parado depois da primeira queda sem nenhum erro. O frame é emitido de dentro do processamento de frame da biblioteca; por isso o `try`/`catch` fica na fronteira do gancho, e uma exceção ali custaria o frame e, com ele, Mensagem. A gravação é estrangulada (no máximo uma a cada 15 s) e a janela conta a partir da tentativa, não do sucesso: disco que falha não leva uma tentativa por frame. `null` no `--json` é sinal indisponível, nunca "Conexão morta".
- **O instante da Mensagem ao vivo é o do APARELHO de quem a enviou, e só a recepção ao vivo tolera relógio adiantado (#1204).** A guarda de instante tem `toleranciaMs` com padrão zero; `receberEvento` (ponto comum do lote do ouvinte, da drenagem do derrame e do reprocessamento dos descartados) é o único que passa `TOLERANCIA_DE_RELOGIO_AO_VIVO_MS` (5 s), e a importação segue sem folga. O instante gravado é o declarado, nunca o do relógio. Medido em 13 e 14/10/2026: 2 de 27 eventos ao vivo vieram à frente (147 e 168 ms) e eram recusados. As Mensagens que só entraram pela janela são contadas numa série diária própria (`instantesAdiantados` em `ouvinte estado --json`); a reentrega não conta.
- **Metadados de Coletiva ao vivo: o evento de grupo escreve, o aviso cobre, e o aviso decide LENDO (#1160).** O evento de grupo continua virando Mensagem sem texto com o Conteúdo Bruto, e os metadados gravam na MESMA Operação. O aviso é independente da Mensagem: lê o que está gravado (`lerMetadadosDeColetiva`) e só abre Operação quando a Conversa não existe ou o texto difere. Medido: sem isso, cada troca de grupo gravava duas Operações, a segunda sem efeito. O aviso só passa `bruto` ao CRIAR a Conversa e nunca reescreve o de uma que existe (o `groups.upsert` real traz `participants`, `owner` e `creation`, que a projeção descartaria). O instante é da linha, não por campo: reentrega fora de ordem entre assunto e descrição pode perder a troca mais velha (risco aceito).
- **O conjunto de cartões de uma Mensagem se grava numa chamada só (#1206).** A porta de Contato Compartilhado SUBSTITUI o conjunto inteiro da Mensagem, não escreve se o conjunto é igual ao gravado e não apaga com lista vazia; gravar um cartão por chamada deixaria só o último. O cartão múltiplo (`contactsArrayMessage`, vários contatos num envio) é Mensagem como o cartão único, só do topo do evento, e o rótulo do envelope ("N contatos") nunca é nome de cartão: o último recurso de nome é o `displayName` do **elemento**. Antes da #1206 o tipo era descartado e guardado cru (3 eventos em produção em 16/10/2026), e `ouvinte reprocessar-descartados` os recupera: ele tira do arquivo só a linha do evento recuperado, e as que continuam descartadas ficam.

- **O Envio por Conversa resolve o destino NA ENTRADA, e o processamento não religa nada (#1323).** O ouvinte manda para o endereço da Conversa em que o Envio ficou gravado e só cria Conversa quando o Envio nasceu por endereço cru. Por isso a rota e a CLI resolvem a Conversa dada antes de gravar: a forma alternativa de um endereço que tem Conversa canônica é redirecionada para ela, porque é na canônica que o eco da mensagem cai (a recepção resolve o endereço à forma canônica). Sem isso o Envio ficaria numa Conversa que nunca mostra o que foi enviado. O caminho por `--para` **não** faz essa resolução: grava o endereço dado, e o Envio por `--para <@lid>` fica ligado à Conversa `@lid` enquanto o eco cai na de telefone (medido em 21/10/2026). Quem é destinatário (grupo, telefone, endereço opaco de pessoa; não o feed de status nem a lista de transmissão) é vocabulário de Fonte e mora em `destinatario-de-envio.ts`.

## Pontos conhecidos

- **A Edição de Mensagem entra por ramo próprio, decide LENDO e a cifrada precisa do portão (#1246).** `secretEncryptedMessage` de edição e `protocolMessage` de edição vão para a Edição, nunca para Mensagem (gravá-las como Mensagem duplicaria o que já existe). A forma cifrada se decifra com o segredo da Mensagem original (`messageContextInfo.messageSecret`, que o Conteúdo Bruto dela guarda); a derivação e o AES-256-GCM usam o `crypto` do Node, e o protobuf do texto claro só o portão da biblioteca lê (`carregarDecodificador`, independente de socket, entregue ao `receberEvento` pelo ouvinte e pela drenagem). Quem edita é o autor da original, então remetente e editor da derivação são o mesmo endereço, **como o envelope o traz** (99 de 99). A Conversa se confere pelo endereço **resolvido** do envelope contra o gravado da original (o envelope traz a forma opaca; medido: 101 de 101 casam). Tudo o que impede a gravação (original ausente, sem segredo, tag que não autentica, outra Conversa, forma sem texto, instante implausível, sem decodificador) deixa o evento descartado, contado **por causa** e guardado cru; a linha de saída do ouvinte só traz contagens e rótulos de causa, nunca o texto. Medido em 18/10/2026: ~20 edições cifradas por dia e 1 aberta em 11 dias, 99 de 100 guardadas decifram. **A forma numérica do enum de edição nunca foi vista** (só o nome, `MESSAGE_EDIT`; a serialização de enum já veio nas duas formas no mesmo arquivo em outro ponto): se vier, o evento cai no descarte de sempre, **sem causa**, o que o distingue na guarda dos que tentaram e falharam. **Os comandos de reprocessar gravam edição com o decodificador do portão (#1246).** `executar` é síncrono e o portão assíncrono, então o ponto de entrada carrega o decodificador **antes** de despachar `ouvinte reprocessar` e `ouvinte reprocessar-descartados` (falha em carregar vira aviso, e a edição cifrada fica onde estava). Uma linha de edição que vira Edição, ou que já estava no Acervo, tem `descartados` vazio: conta como **gravada** e sai da guarda (nunca como ruído), e `ResultadoDoReprocesso.edicoes` conta só as Edições novas; o filtro `jq` da Ação Documentada precisa tratar a linha de edição do mesmo jeito. **A leitura nunca repete o texto:** `textoAtual` só existe na Mensagem editada (repeti-lo em toda Mensagem custou +21% de bytes por página de 500, medido em 18/10/2026; a chave condicional custa +4,7%). O sinal de verificação depois da release é o contador diário: o rótulo `secretEncryptedMessage` deve cair de ~20 por dia para ~0, e o que sobrar tem causa na guarda.
- **A Citação decide lendo o contexto da citação e nunca cria quem não foi observado (#1334).** Uma só leitura (`citacao.ts` do adaptador, que abre os mesmos envelopes e olha só os tipos que viram Mensagem, via `conteudo-de-mensagem.ts`) serve a recepção ao vivo, a drenagem, os dois reprocessos e o comando do estoque; a conta própria é reconhecida pelo endereço canônico dela, que o ouvinte tira do Registro e renova a cada vínculo conferido (sem ele, a direção da citada que o Acervo não tem fica nula). No estoque a conta é a da Configuração dona da Conversa direta, e na coletiva só vale com **uma** conta de endereço conhecido no Inquilino: com duas, não há como saber qual recebeu, e a recepção ao vivo e o estoque não discordam porque o estoque prefere a direção nula. **O autor da citada vira Identificador e mais nada: sem Participação, nome nem Pessoa**, porque promoção de Pessoa a partir de Identificador novo é efeito colateral do núcleo, e quem foi citado pode nunca ter escrito na Conversa. Quando a citada está no Acervo, na mesma Conversa e Fonte, o autor e a direção **dela** valem sobre o que a plataforma declarou, e **nenhum Identificador é criado** para o `participant` (nem na Mensagem repetida); a citada que chega depois completa o vínculo, o autor e a direção de quem a citava, só na mesma Conversa e só onde o vínculo faltava. A edição, a reação, a revogação e o pai de álbum não gravam Citação mesmo trazendo o id de outra Mensagem. A gravação é idempotente: a Mensagem repetida não muda, e o estoque nunca sobrescreve Citação existente. **O estoque lê o Acervo fora da transação** (a passada pelo bruto de todo o Acervo leva minutos e não pode segurar o escritor do ouvinte), por posição física (`+fonte` na consulta: sem ele o SQLite andaria pelo índice da Fonte e cada página releria o Acervo todo; há teste do plano), e só a gravação é uma Operação, numa transação: em Acervo grande grave em fatias; o `desfazer` devolve as quatro colunas a nulo, inclusive o vínculo que o vínculo tardio completou depois, e **não remove os Identificadores que o comando criou**. O bruto de importação de backup não tem esse contexto e não entra.
- **O oráculo de classificação depende da NATUREZA que se testa, e confundi-los custou quase 8.323 eventos.** Para estabelecer que um código da Fonte é **saída**, a fração de membros que escreveu **antes** dele tem de ser alta e a que escreveu depois, baixa. Para **entrada**, o inverso — e a fração que escreveu antes tem de ser quase zero, porque ninguém escreve num grupo antes de ser adicionado. Em 30/08/2026 o mapa nasceu usando só os oráculos de saída e aplicando-os a todos os códigos; num código de entrada eles medem outra coisa (se a pessoa saiu depois) e devolvem um valor intermediário sem significado. O código 15 ficou de fora com "10,5%" e a spec chegou a afirmar que a Fonte não declarava entrada. **Ao acrescentar código ao mapa em `src/adaptadores/whatsapp/codigos-de-evento.ts`, escolher o oráculo pela natureza que se hipotetiza — e rodar os dois.**
- **`--em <AAAA-MM-DD>` é o FIM daquele dia, capado ao fim do Alcance.** Data sem hora é um **dia**, e comparar meia-noite com o instante de um evento fez, em 30/08/2026, uma data dentro do Alcance ser reportada como fora — nas duas bordas. A regra atual está em `src/cli/index.ts`, no ramo `conversa presenca`; ao mexer nela, testar contra Conversa cujo Alcance começa e termina **no mesmo dia**, que é onde as duas bordas colidem. Fixture sintética com alcance de vários dias passa verde e não protege.
