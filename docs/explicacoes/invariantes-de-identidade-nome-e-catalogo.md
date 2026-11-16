---
id: 202610066084
projeto: malote
tipo: explicacao
escopo: repo:malote
plataforma: "*"
status: ativo
dominios: [tecnologia]
descricao: Regras de endereço, Conversa por Configuração, nome, Atribuição e catálogo, com motivo e medição — carga sob demanda.
tags: [explicacao, invariantes, Node]
---

# Invariantes de identidade, nome e catálogo

Regras e decisões do repo **com o motivo e a medição que as sustentam**, movidas do `CONTEXTO.md` para que a carga default da sessão fique pequena. Leia antes de mexer no assunto; o `CONTEXTO.md` aponta para cá e nomeia as regras mais perigosas.

- **O telefone, o JID e o LID da própria conta são dado pessoal: nenhuma saída de recusa nem linha de log os imprime.** O `ouvir` recusa com **2** e
  diz só que o vínculo é de outra conta; há teste que procura os dígitos na saída. O telefone **declarado** nunca é sobrescrito pelo do vínculo, o
  endereço ausente nunca apaga o gravado, e a comparação aceita o celular brasileiro com e sem o nono dígito (predicado no Adaptador de WhatsApp,
  não no núcleo). Identidade que o produto não sabe ler **segue sem conferir** e avisa: só a divergência confirmada recusa.
- **O Identificador do endereço da própria conta é registrado SEM Configuração.** A coluna de Configuração de `identificadores` é a do **catálogo que
  sustenta o vínculo com a Pessoa**; a relação "este endereço é o da Configuração X" vive no Registro (`enderecos_da_conta`). Misturar os dois
  significados foi um achado errado de revisão, retificado ao medir o schema.
- **Conversa direta pertence a UMA Configuração de Adaptador; coletiva pertence ao Inquilino.**
  A chave de unicidade de `conversas` são **dois índices parciais**, um por natureza — e não
  uma chave de três colunas com valor anulável. O SQLite trata `NULL` como distinto de
  `NULL`, então `UNIQUE (fonte, id_externo, configuracao_id)` deixaria passar **duas coletivas
  idênticas em silêncio**, que é exatamente o defeito que a restrição existe para impedir. O
  mutante está escrito em `tests/conversa-por-configuracao.test.ts`: trocar os dois índices
  pela chave anulável tem de derrubar o teste da coletiva duplicada.
- **A porta `registrarConversa` recusa quatro coisas, e nenhuma delas é disciplina do
  chamador:** direta sem Configuração, coletiva com Configuração, Configuração de outra Fonte,
  e endereço que já existe com a **outra natureza**. A última nasceu do lookup ramificado — o
  `SELECT` antigo por `(fonte, id_externo)` absorvia desencontro de natureza, e o novo não
  absorve: sem a guarda, o mesmo endereço viraria duas Conversas, uma em cada índice parcial,
  sem nada reclamar. Medido: importação classifica coletiva por `ZSESSIONTYPE != 0` e recepção
  ao vivo por `endsWith('@g.us')`, e para `<número>@status` os dois discordam (tarefa #826).
- **`importar` e `ouvir` exigem `--configuracao <apelido>`, sem default.**
  `resolverConfiguracao` **cria** quando não acha; enquanto o default era `padrao` e a
  Configuração de produção também, adivinhar acertava por coincidência. Desde o rename de
  08/09/2026 não acerta mais: adivinhar criaria Configuração paralela em silêncio, e as
  Conversas diretas dela nasceriam num fio à parte. O `ouvir` usa `configuracaoPorApelido`, que
  busca e **nunca cria** — no caminho ao vivo, criar significa gravar na conta errada sem
  alarme.
- **Vazio conta como AUSENTE em campo da Fonte, e `??` não serve.** A coalescência
  nula só cai para o segundo operando quando o primeiro é `null`; a Fonte grava `''`
  para dizer *não tem*. Medido em 13/09/2026: `ZCONTACTNAME ?? ZFIRSTNAME` devolvia
  `''` na maioria das linhas, e o membro ficava sem nome — dos 9.286 membros com
  nome no material, só **1.071** o receberam. A correção é uma função que trata `''`
  como `null`. **E a fixture tem de gravar vazio**, não só ausente: `material-falso.ts`
  escrevia `?? null`, e por isso nenhum teste via o caso. O teste novo falha com o
  código anterior — era o que faltava.
- **A Autoridade da Atribuição de Nome fica FORA da chave de unicidade, e sobe de
  forma monótona.** Com ela na chave, reimportar o material criaria uma linha
  declarada ao lado da indeterminada que já existe, e o histórico mostraria o mesmo
  nome duas vezes em milhares de endereços. Fora da chave, registrar de novo
  **atualiza**: `titular` sempre grava, `terceiro` só grava sobre indeterminado.
  Resolver indeterminado para `terceiro` **baixa** o rank de desempate (1 → 0) e
  mesmo assim é correto — o que sobe é o conhecimento, não a confiança. Tem teste
  próprio para ninguém "consertar" isso como defeito depois.
- **Duas regras de nome, duas casas, e confundi-las trava a execução.** A recusa de
  **nome que repete o próprio endereço** (comparação mecânica de dígitos) fica no
  **núcleo** (`nome-do-endereco.ts`) — nasceu no Adaptador de WhatsApp e subiu quando
  a porta de remoção passou a precisar dela também. A **normalização de marca
  invisível** fica na **porta do núcleo** — reconhecer que a segunda escrita é o
  mesmo nome exige consultar o que já está gravado, e a unicidade do banco é por
  texto exato: marcado e desmarcado são strings diferentes, então a linha gêmea
  nasce sem nada reclamar.
- **Normalizar é para COMPARAR, nunca para reescrever.** O texto gravado continua
  sendo o que a Fonte entregou. O par de testes é o desenho: um prova que a segunda
  escrita não cria linha, o outro **lê de volta** e prova que as marcas ficaram. Sem
  o segundo, normalizar na escrita passaria no primeiro.
- **As duas formas do celular brasileiro são um par na correspondência de endereço, aprendido pelo Adaptador de
  WhatsApp (#1376).** A regra (55, DDD, assinante de 8 dígitos começando em 6 a 9, com ou sem o 9) é uma só
  (`celular-br.ts`), e `resolverEnderecoDeWhatsapp` é o único ponto que resolve e aprende: todo ponto do Adaptador de
  WhatsApp que grava Identificador, Conversa ou participante passa por ele, e a guarda
  (`tests/celular-pontos-de-entrada.test.ts`) fixa a lista por chamada, com o motivo de cada arquivo que grava sem
  passar (a resolução retroativa, que só grava o canônico de um par já existente, e a identidade da conta, que recebe
  o JID já resolvido). Fixo nunca ganha 9. O endereço que o OPERADOR digitou (o destino de um Envio) e toda Mensagem
  `fromMe` (o produto não separa o eco de um Envio da Mensagem escrita no aparelho) só aprendem com evidência da
  plataforma: o resolvedor não inventa a forma canônica quando nenhuma das duas está gravada.
- **O endereço opaco que já resolve para um celular também aprende o par do nono dígito do canônico (#1531).** O resolvedor
  não sai cedo quando o endereço já é alternativa de um par: decide pelo canônico, que resolve para si mesmo (um passo, sem
  cadeia). Sem isso, o par do opaco aprendido antes da #1376 deixava o celular sem par quando o Identificador dele nascia depois
  (medido em 16/11/2026: 51 celulares sem par num Acervo de produção e 2 em outro). O reaponto dos Identificadores serializados
  segue a mesma regra no ramo em que o endereço do objeto já resolve. A união das Conversas NÃO aprende par (a guarda dela
  proíbe o resolvedor e `aprenderCorrespondencia`): o número que ela promove aprende o par na próxima Mensagem do contato, e o
  estoque o cobre antes disso.
- **O estoque aprende o par pelo MESMO resolvedor da recepção (#1376).** `identidade aprender-formas-do-celular` chama
  `resolverEnderecoDeWhatsapp` com `op`, e o ensaio usa `situacaoNoEstoque`, a mesma decisão vista sem escrever: nenhum
  critério próprio. Os números com as duas formas gravadas ficam sem par e o ensaio os lista com as Mensagens de cada forma; a
  Conversa direta que o aprendizado não une (uma por forma, da mesma Configuração) também é listada. O caso legado (o
  canônico do par LID é a forma não gravada) é o único em que a retroativa acha o que reapontar logo depois do estoque.
- **O par da forma opaca na Conversa direta vem do campo que a plataforma manda com a Mensagem RECEBIDA (#1439).** Na
  Conversa coletiva o par se aprende do autor (o campo irmão, desde a primeira passada da recepção); na direta, do campo do
  companheiro, que a biblioteca em uso preenche em toda mensagem decodificada. Por isso a regra exige que a Mensagem não seja
  da conta (`fromMe` falso) e não se apoia na ausência do campo: o número da própria conta apontaria o outro lado para o
  Titular. Medido em 08/11/2026 nos quatro Acervos de produção: nenhuma das Mensagens enviadas em Conversa direta por
  endereço opaco trazia o campo, os pares já conhecidos concordaram com ele em todos os casos e nenhuma Conversa trouxe mais
  de um número depois da regra do celular. Quem o Titular procura primeiro e que ainda não respondeu fica sem número: não há
  outra fonte do par na versão da biblioteca em uso.
- **Ao vivo, o par só abre Operação quando é novo.** A primeira passada filtra os opacos que **ainda não resolvem**, o mesmo
  pré-filtro do aprendizado da agenda; com o par gravado, só compara. Sem o filtro, cada Mensagem recebida de um outro lado por
  endereço opaco abriria uma Operação vazia (medido: o aprendizado da coletiva abriu ~21,6 mil Operações em 7 dias numa conta
  para ~126 pares novos). Conflito é linha do registro do ouvinte (`correspondencia em conflito (direta): <n>`), sem
  endereço, nome nem texto, e nunca Operação.
- **O par congela a Conversa por endereço opaco, e isso é declarado, não defeito.** A Conversa da Mensagem se resolve
  **depois** da primeira passada, então o próprio evento que traz o campo já vai para a Conversa do número; a opaca deixa de
  receber e de ter o `bruto` reescrito. A reentrega de evento antigo depois do par cria, se faltar, a Conversa do número
  **vazia** (Identificador e Participação), porque a Mensagem já existe pelo id. O par vale para o Inquilino inteiro (a chave
  é `fonte, alternativo`), então congela também a Conversa opaca de outra Configuração. A recepção nunca une as duas: a
  Conversa partida se une por uma Operação à parte (`identidade unir-conversas-do-contato`, #1440).
- **O estoque cria duas espécies de par e o `desfazer` remove as duas, mas não é volta.** `identidade
  aprender-pares-da-conversa-direta` resolve o número pelo resolvedor com `op`, que aprende também o par do celular quando
  falta (o número que só está no Conteúdo Bruto não é Identificador, e por isso o estoque do celular não o alcançou); o
  relatório conta as duas espécies à parte. O `desfazer` remove as linhas da Operação, mas com o ouvinte novo no ar a Mensagem
  recebida seguinte reaprende o par (o envelope ao vivo é irreversível), e as Mensagens gravadas entretanto ficam na Conversa
  do número.
- **A Edição compara o endereço da Conversa resolvido dos dois lados (#1439).** A original pode ter ficado na Conversa opaca
  e o envelope da edição chega pelo opaco, que agora resolve para o número: comparar o resolvido com o gravado recusaria
  como `outra-conversa` a edição de toda Mensagem antiga de um outro lado com par.
- **A união da Conversa partida move ou promove, e nunca apaga nem reescreve a história (#1440).** Com a Conversa do número
  na mesma Configuração, as Mensagens passam a ela e só a coluna da Conversa muda (identidade externa, conteúdo, Conteúdo
  Bruto, instante, direção, autor, Citação, Anexo e Edição ficam); sem ela, a Conversa partida troca o endereço pelo do
  número e fica com o id. A opaca vazia fica com as Participações (a Conversa direta tem duas; levar a do endereço opaco poria
  um segundo Identificador do mesmo outro lado no alvo). As Chegadas não mudam: o Diário só acrescenta, e mover não é chegada,
  então quem filtra o Diário pelo id da Conversa do número não vê as Chegadas das Mensagens movidas. O alvo é procurado pelas
  duas formas do número e só na mesma Configuração: mover entre Configurações misturaria contas. Medido em 09/11/2026 numa
  instalação real: 28 Conversas partidas com alvo (943 Mensagens) e 30 sem alvo (315) no Acervo maior, e 1 ambígua no outro.
- **A Conversa promovida mostra o nome do Identificador exato do endereço novo, não o da Correspondência.** A listagem, o
  detalhe e a busca por nome acham o Identificador pelo endereço da Conversa, e o nome não segue a Correspondência. Por isso a
  promoção registra o Identificador do endereço do número (sem Pessoa e sem nome inventado) e o ensaio conta quantas perdem o
  nome que mostram hoje (9 de 30 no Acervo maior, em 09/11/2026); o nome volta quando a Fonte entrega nome para o número.
- **A união roda com o ouvinte no ar, uma Conversa por transação, e reclassifica sob o lock.** O ouvinte espera 5 s por
  escrita e, acima disso, derrama o lote (o lote derramado perde a mídia). Cada Conversa é uma transação imediata que relê o
  alvo antes de escrever: se o ouvinte criou a Conversa do número entre o plano e a escrita, a promoção vira movimento, e
  nunca um erro do índice único das Conversas diretas. Mensagem que chega durante a união cai na Conversa que a recepção
  resolve; repetir o comando a leva junto.
- **O `desfazer` da união é item a item e confere o valor atual, antes do ramo genérico da resolução retroativa.** A tabela de
  Mensagens está no inventário da retroativa, cujo ramo devolve o valor sem conferir; o caso da união vem antes e recusa, com a
  causa, a Mensagem que já não está na Conversa que a Operação gravou, a Conversa que já não tem o endereço promovido e o
  Identificador que ganhou uso. Ele não é volta total: o que chegou depois fica, e desfazer uma promoção devolve o endereço
  opaco a uma Conversa que pode ter Mensagens das duas formas (com um par errado, a Mensagem seguinte do número cria uma
  terceira Conversa).
- **A leitura resolve as formas do endereço pela Correspondência e nunca infere Presença de ter escrito (#1517, #1518, #1465).**
  O autor da Mensagem, `participantes` e `identificar` usam a mesma família de formas (`familia-de-endereco.ts`: o
  endereço gravado, a forma canônica e as alternativas dela, as que existem como Identificador e as que só existem como
  Correspondência), resolvida **em lote** (uma consulta por tabela para a página inteira, nunca uma por Mensagem), e o
  filtro `--endereco` de `participantes` resolve pelo mesmo caminho de `--remetente` (`identificadoresDoRemetente`). A
  forma canônica do autor é **nula** quando nenhum par liga o endereço: nunca se monta um número. Em `participantes`, o
  autor que só existe sob a forma opaca entra na lista quando há Participação ou Transição sob **alguma** forma da família,
  e a situação de cada linha é decidida pelos eventos de todas as formas; quem escreveu sem nenhuma das duas, em forma
  nenhuma, fica de fora (Transição só nasce do que a Fonte declara). Em `identificar`, os totais da família (o bloco
  `totais`) contam as Mensagens de que alguma forma é autora e as
  Conversas por `UNION` (a Participação sob uma forma e a Mensagem sob outra na mesma Conversa contam uma). Medido em
  15/11/2026 num Acervo grande (somente leitura): de 31.691 pares autor-Conversa coletiva com Mensagem recebida, 6.462
  não têm Participação nem Transição sob o próprio id; com a família, 5.611 passam a aparecer na lista e 851 (nenhum de
  endereço opaco) ficam sem Participação em forma nenhuma. Dos 6.754 autores de endereço opaco, 5.464 têm par (o
  `canonico` vem preenchido) e 1.290 não. 130 Mensagens com autor em coletiva têm direção nula e não entram no universo
  de `participantes`. A palavra **família** aqui
  é de endereço; a família da mesclagem (`familia.ts`) é de Pessoas, e as duas não se misturam.
- **O Identificador de WhatsApp só nasce pela porta do Adaptador, que confere a forma do endereço (#1519).**
  `registrarIdentificadorDeWhatsapp` (`endereco-de-whatsapp.ts`) é a única chamada de `registrarIdentificador` em
  `src/adaptadores/whatsapp`, e grava só `<texto sem espaço, chave nem aspas>@<sufixo>`; o resto devolve nulo e **nunca
  lança** (a exceção que escapa da recepção derruba o ouvinte por 70). A guarda `tests/porta-de-identificador-whatsapp.test.ts`
  reprova a chamada direta nesse diretório. A checagem mora na porta de **gravação** do Adaptador, que o resolvedor alimenta,
  e não no resolvedor, que nunca recusa; o núcleo continua sem conhecer as formas de endereço de uma Fonte. **Três caminhos do
  núcleo criam Identificador de WhatsApp sem ela**: a declaração da conta (`endereco-da-conta.ts`), a resolução retroativa
  (`resolucao-retroativa.ts`) e a união das Conversas (`registrarIdentificadorComEfeito`); os valores deles vêm de
  Configuração e de par já gravado, nunca de evento. Instagram e o catálogo de agenda não têm a checagem (nome de exibição e e-mail são
  Identificadores legítimos neles). O parâmetro do evento de entrada e saída às vezes é o **objeto do participante
  serializado** (`{"id": ..., "phoneNumber": ..., "admin": ...}`): a Transição grava sob o `id` do objeto, resolvido pela
  Correspondência, sem aprender o par do telefone na recepção; o que não se lê conta `parametro-sem-endereco` e, quando é
  objeto, também `parametro-serializado-ilegivel`; o autor ou a Etiqueta recusados contam `endereco-invalido` (as três
  chaves vão à série de descartes do `ouvinte estado --json`), e a importação conta `enderecosInvalidos`. O autor recusado
  grava a Mensagem **sem autor**, nunca a perde. O estado ao vivo (a agenda sincronizada) recusa em silêncio, sem
  contador: o nome daquele endereço fica de fora. Medido em 15/11/2026 no Acervo do Titular: 3.706 valores serializados com
  5.595 Transições, todos de 07 a 10/09/2026, vindos do conversor do acervo antigo pela porta da recepção ao vivo. O
  **Identificador de valor vazio** (537 Mensagens e 211 Participações no mesmo Acervo) é o único legítimo que a regra recusa:
  a reentrega ou a reimportação dessas Mensagens grava sem autor e conta, em vez de ligá-las ao vazio (a origem do vazio,
  provavelmente `participant` vazio que o `??` não pega, não foi medida). A checagem custa de 0,0002 a 0,0013 ms por
  chamada (medido), e roda também na Mensagem comum de grupo, porque o autor passa pela porta a cada Mensagem.
- **`identidade reapontar-identificadores-serializados` limpa o estoque (#1519).** Para cada Identificador de WhatsApp de
  valor serializado, o destino é o canônico do par que o `id` do objeto já tem (o par existente vence e nunca é
  sobrescrito); sem par e com telefone, o telefone resolvido pela decisão do resolvedor (`decidirEnderecoDeWhatsapp`, que só
  lê), com o par do `id` para ele e o do nono dígito, se houver; sem telefone, o próprio `id`. O `id` que é canônico de outro
  par é conflito (cadeia de dois passos), e o Identificador que algo além de Transição referencia é achado: nada é tocado. Os
  valores **com telefone vão primeiro**: o mesmo participante aparece serializado em mais de um valor (o `admin` muda, o
  telefone falta em alguns; 4 casos no Acervo do Titular), e o valor sem telefone só chega ao número se o par do `id` já foi
  aprendido; na ordem de id ele iria ao endereço opaco e quem fala ficaria partido entre dois Identificadores. O ensaio carrega em memória os pares que
  já previu, para contar cada par uma vez e mandar ao número o que o efeito manda; o `--limite` corta depois dessa ordem.
- **"Comparar dígitos serve a qualquer Fonte" tem limite, e o nono dígito brasileiro
  mora do lado de fora dele.** `nome-do-endereco.ts` (núcleo) já dizia, desde que
  nasceu: "traduzir a forma escrita do número na forma do endereço é vocabulário de
  Fonte" e não deveria subir. Medido em 30/09/2026 (#1101): 1.110 de 1.110 nomes
  `+55...` que a comparação de sufixo/prefixo do núcleo deixava passar tinham o nono
  dígito móvel (2012) inserido no MEIO do número — nem sufixo nem prefixo alcançam
  isso. A correção fica no ADAPTADOR (`nome-repete-numero-br.ts`, WhatsApp), que
  ENVOLVE a função do núcleo sem alterá-la. Duplica em parte o que
  `contatos/telefone.ts` já resolve para o catálogo — deliberado: adaptador não
  importa adaptador (só `src/cli` compõe mais de uma Fonte), e o caso aqui (comparar
  dois valores já conhecidos) não precisa da máquina de gerar variante para busca,
  que existe lá só para não casar com o número de OUTRA pessoa.
- **Nome vindo de biblioteca de terceiro não é nome só por não ser vazio.** O
  WhatsApp dispara `contactAction` de app-state também para contato nunca nomeado, e
  `fullName` vem com um valor-placeholder em vez de ausente — medido em 30/09/2026
  (#1101): 58% de TODAS as Atribuições `titular`/`whatsapp` do Acervo real são essa
  forma (`+EAA=` sozinho é 81% do lixo em identificadores sem Pessoa), com assinatura
  de sentinela fixo (mesmo texto repetido em massa, comprimento sempre ≡1 mod 4 —
  prefixo `+` mais um bloco base64 válido), não corrupção de parsing. `estado-ao-vivo.ts`
  recusa pela FORMA (`pareceValorSentinela`) antes de gravar — 14 Pessoas já exibiam
  esse lixo como nome corrente antes da correção, e a limpeza do que já está gravado
  ainda não existe (ver Pendências).
- **A leitura do nome corrente descarta o bloco codificado quando existe outro nome; o
  dado fica (#1137).** O predicado é o mesmo da gravação (`pareceValorSentinela`), é do
  Adaptador e entra pela precedência (`comDescarteDeNome` põe `descartarNome` nela), na
  camada que compõe: a rede (o módulo é puro, sem import, e está na lista de exceções
  da fronteira) e a CLI. O núcleo (`nomeEscolhido`) só filtra quando sobra nome real; o
  bloco como única Atribuição segue sendo o escolhido. `pessoa precedencia` imprime a
  precedência sem o predicado, porque não resolve nome. `descartarNome` é função: não
  atravessa `postMessage`, e a precedência nasce dentro do worker de leitura. Medido em
  15/11/2026 nos quatro Acervos de produção, com a precedência padrão (a que rodava): o
  nome escolhido muda em **279 Pessoas, 1.624 Identificadores sem Pessoa e 1.106
  Identificadores com Pessoa** na leitura por Identificador (`identificar`); seguem no
  bloco, por não terem outro nome, 13.720 Identificadores sem Pessoa e nenhuma Pessoa.
  Dos ~4.100 valores distintos com a forma, 266 não são só metadado (varint e cadeia
  vazia): todos são protobuf válido e 250 levam DENTRO uma cadeia de texto (a maioria
  com espaço, cara do nome do contato serializado na mesma mutação). O valor gravado
  segue ilegível; o que o descarte esconde é o bloco, não um nome legível.
- **A remoção de Atribuição inválida classifica endereço-repetido PRIMEIRO.** Só
  depois marca-duplicata, e essa só remove se sobrar uma irmã que não vá ser
  removida também. Invertido, as linhas que são **as duas coisas** seguram uma à
  outra como irmã e nenhuma sai — eram 595 no acervo real.
- **`origem` é a FONTE; a Configuração de catálogo é coluna separada.** `melhorNome` faz lookup **exato** por origem contra a tabela de precedência: gravar `contatos:um-catalogo` ali faria o peso cair para zero e o nome de catálogo ficar **abaixo** do nome de plataforma — inclusive para as 11.948 atribuições de origem `whatsapp` já gravadas. A preferência entre catálogos é **segundo nível**, e só desempata quando os pesos empatam: ela nunca atravessa Fontes.
- **Quatro índices parciais em `atribuicoes_de_nome`, não dois.** O SQLite trata `NULL` como distinto de `NULL` em índice único, então o ramo `configuracao_id IS NULL` é o que mantém a idempotência de reimportação das linhas sem Configuração. Mesmo precedente dos dois índices parciais de `conversas`, do #825.
- **E-mail em mais de um cartão da MESMA Configuração é compartilhado**, e sai de **toda** produção de Proposta — inclusive do laço de cartão. A regra é por Configuração e não global, porque o caso legítimo — o que liga duas bases — é justamente um e-mail em dois cartões, um por base. Excluir de um lado só deixa a fusão entrar pela porta dos fundos: `[T,E]` e `[E,U]` fundem gente distinta **por transitividade** na aplicação, sem que nenhuma Proposta pareça errada sozinha.
- **Um produtor que pareia dois Identificadores de e-mail é impossível por construção.** `UNIQUE (fonte, valor)` faz o mesmo e-mail em duas bases ser **uma** linha. O que se liga são os **Cartões**, e é por isso que o inventário devolve **todos** eles, com a Configuração de cada.
- **O laço de telefone discrimina e-mail por `@`.** `variantesDeEndereco` extrai dígitos de qualquer cadeia, e um e-mail com número no nome casaria com uma variante brasileira — produzindo Proposta plausível e errada, que é o pior tipo.
- **`identificadores.visto_em` é a PRIMEIRA vez, e fica assim.** Quem registra reavistamento é `ultimo_avistamento`, em Cartão e Atribuição. Mover o primeiro faria re-avistar um nome antigo trazê-lo de volta ao topo do desempate por recência.
- **`registrarNome` devolve `changes > 0` como "nome novo", e por isso o reavistamento é UPDATE separado.** Convertê-lo em upsert faria `nomesCriados` contar reavistamento como criação, e o relatório mentiria sem nada acusar. Upsert sobre índice **parcial** ainda exigiria repetir o `WHERE` no alvo do conflito, e são quatro índices.
- **A identidade do Cartão deriva de telefones E e-mails, e mudá-la de novo é caro.** Com e-mail no conjunto, 1.839 dos 6.693 cartões reais mudam de identidade; alterar a regra depois de um import produz ausência e renascimento em massa.

## Limitações e decisões conhecidas

- **Duas capacidades rendem zero enquanto houver uma base de catálogo só.** O produtor de
  Proposta por `email` e a preferência entre catálogos exigem **duas** Configurações de
  `contatos`. Estão provados por teste com fixture construída; em produção dão zero, e isso é
  o resultado certo. Não tratar como defeito.
- **Desfazer não cobre o Registro, de propósito.** Decisão de configuração recusa desfazer e manda **redefinir**, dizendo onde ver o valor anterior — o comando de definir já é a porta. Remontar o objeto de opções de cada upsert seria uma segunda implementação de cada comando. Se isso mudar, é decisão nova, não conserto.
- **Desfazer um lote não remove as Pessoas que ele criou.** Os vínculos voltam; as Pessoas ficam, porque o produto nunca remove Pessoa. Num lote real isso são centenas de recusas com a mesma causa, e o relatório as agrupa — não é falha.
- **A preferência de mestre por catálogo quase nunca decide na prática, e isso é esperado.** Medido em 29/08/2026 sobre 458 mesclagens de material real: **zero** com `regra = 'preferencia-de-catalogo'`, todas por `ordem-de-chamada`. Razão: as propostas por telefone entram primeiro e sempre carregam um Identificador de `contatos`, então quando a mesclagem acontece as duas Pessoas já têm catálogo e o discriminante empata. A regra está correta e testada em unidade nas duas ordens de argumento; ver zero no banco **não** é defeito.
- **`aplicarConjunto` recusa mesclar quando alguma das Pessoas tem vínculo `humano` em qualquer lugar da família — e a checagem é da FAMÍLIA, não dos membros da Proposta.** A forma por membro deixaria passar a Pessoa construída à mão por um Identificador e ampliada por um lote anterior, cujos outros membros têm procedência `catalogo`. Ao mexer nessa guarda, a mutação que a devolve à forma por membro derruba **um** teste só; é ele que protege o flanco.
