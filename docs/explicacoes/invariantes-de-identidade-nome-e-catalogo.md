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
