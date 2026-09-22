---
id: 202608240940
projeto: malote
tipo: dominio
descricao: "Modelo do arquivo pessoal de conversas — núcleo genérico multi-inquilino (Inquilino, Conversa, Mensagem, Pessoa, Identificador, Anexo) desacoplado das fontes por Adaptador"
status: aprovado
aprovado-em: 2026-09-22
escopo: repo:malote
plataforma: "*"
dominios: [tecnologia]
tags: [dominio, malote, arquivo-de-conversas, adaptadores, midia, multi-inquilino]
---

# Domínio: Malote

## Propósito

Guardar o arquivo das conversas de uma pessoa, vindas de fontes diferentes, num formato que humano e agente consultam — e mantê-lo consultável ao longo dos anos, mesmo quando o acervo cresce além do disco disponível.

Uma instalação serve vários Inquilinos ao mesmo tempo, sem que nada atravesse de um para outro.

## Linguagem

Termos deste contexto estão no `GLOSSARIO.md`: **Inquilino**, **Chave de Acesso**, **Conversa**, **Mensagem**, **Pessoa**, **Identificador**, **Anexo**, **Adaptador**, **Fonte**, **Participação**, **Acervo**, **Política de Retenção**.

Duas regras atravessam o modelo inteiro:

1. **Nenhum nome do núcleo nomeia ferramenta.** Não existe `jid`, `lid`, `handle`, `resource_name` ou `etag` em agregado do núcleo. Esses termos são vocabulário de Adaptador.
2. **Tudo é escopado a Inquilino.** Não existe entidade do núcleo sem Inquilino, e nenhuma operação alcança dado de mais de um Inquilino.

## Agregados

### Inquilino

**Entidades / Objetos de Valor**

- **Inquilino** (raiz) — um mundo isolado dentro da instalação. Normalmente uma pessoa; possivelmente uma organização.
- **Titular** (referência) — a Pessoa a quem o Acervo pertence. **Do Inquilino, sempre.** O nome pelo qual uma Fonte chama essa pessoa dentro do material é outra coisa, e mora na Configuração — ver *Nome do Titular na Fonte*.
- **Configuração de Adaptador** (entidade) — uma conta de plataforma que este Inquilino alimenta. N por Inquilino, inclusive várias da mesma Fonte. Identificada por `(Inquilino, Fonte, apelido)`, com o **apelido informado por quem instala** — é ele que distingue `contatos/google` de `contatos/icloud`.
- **Nome do Titular na Fonte** (objeto de valor, na Configuração) — como aquela Fonte chama o Titular dentro do material. Só existe onde a Fonte exige: o Instagram precisa dele para achar quem é "eu" na conversa direta.
- **Pasta de Entrada** (objeto de valor, na Configuração) — o diretório local onde material novo daquela Configuração aparece.
- **Natureza do Material** (objeto de valor, na Configuração) — **completo** ou **parcial**.
- **Destino de Mídia** (entidade) — onde os arquivos de Anexo deste Inquilino ficam. Um caminho de sistema de arquivos, configurável por Inquilino; caminho montado por rede é atendido como qualquer outro. Transporte remoto próprio (objeto tipo S3) saiu do recorte v1 em 28/08/2026. O layout **sob** a raiz é decidido pelo núcleo e começa por um segmento do Inquilino.

**Invariantes**

- Todo Inquilino tem exatamente um Acervo, e todo Acervo pertence a exatamente um Inquilino.
- **Nenhuma entidade do núcleo existe sem Inquilino.** Conversa, Mensagem, Pessoa, Identificador e Anexo pertencem sempre a um, e só a um.
- **Nenhuma operação alcança dado de mais de um Inquilino.** Não existe consulta, exportação, relatório ou varredura de retenção que atravesse a fronteira — nem como opção, nem sob flag.
- Duas contas de plataforma da mesma pessoa pertencem ao mesmo Inquilino. Múltiplas contas não são múltiplos mundos.
- Identificador igual em Inquilinos diferentes são entidades distintas: a mesma pessoa do mundo real vista por dois Inquilinos não é a mesma Pessoa no Acervo.
- **O apelido da Configuração é informado, nunca derivado do material.** Duas contas da mesma Fonte se distinguem por ele e por nada mais — não pelo conteúdo, não pelo caminho da pasta, não pelo nome do arquivo.
- **`Titular` nomeia o dono do Inquilino e nada mais.** O nome que a Fonte dá a ele dentro do material é *Nome do Titular na Fonte*, vive na Configuração e pode diferir entre contas do mesmo Titular.
- Todo Inquilino tem um Destino de Mídia declarado. Dois Inquilinos podem ter destinos diferentes, inclusive de naturezas diferentes.
- **O Destino diz onde a raiz fica; o núcleo continua decidindo o layout dentro dela.** Trocar o Destino não muda a estrutura de caminhos nem reintroduz dado pessoal neles.
- **O caminho derivado pelo núcleo começa por um segmento do Inquilino, e isso é estrutural.** Dois Inquilinos podem apontar para a **mesma** raiz de Destino — nada no modelo o proíbe, e nada no schema o impede. Sem o segmento eles compartilhariam árvore, e apagar os arquivos de um alcançaria os do outro. O identificador do Inquilino é gerado pelo produto, não vem da Fonte: entra no caminho sem violar o invariante de que caminho de arquivo não carrega dado pessoal.
- **Apagar os arquivos de um Inquilino apaga a subárvore dele, nunca a raiz do Destino.** É o corolário do anterior, e é o que impede que recriar um Acervo destrua o acervo de um vizinho.
- **Presença e Descritor vivem sempre no Acervo, nunca no Destino.** O malote sabe o que tem e em que estado, mesmo com o Destino inacessível.
- Destino fora do ar é **condição de execução, não estado de Presença**: o Anexo continua *presente* e a leitura falha como "arquivo inacessível". Distinto de *descartado* (saiu por política) e de *nunca obtido* (jamais chegou).
- Remover um Inquilino remove o Acervo dele por inteiro e não afeta nenhum outro.

**Ciclo de vida** — criado explicitamente antes de qualquer importação; permanece enquanto o Acervo existir.

### Chave de Operador

**Entidades / Objetos de Valor**

- **Chave de Operador** (raiz) — credencial de quem administra a instalação.

**Invariantes**

- **Chave de Operador não pertence a Inquilino nenhum.** Não é caso particular de Chave de Acesso, e o modelo não admite Chave com Inquilino ausente — são duas coisas distintas, para que um defeito que apague o Inquilino de uma Chave de Acesso não produza silenciosamente uma credencial de administração.
- **A primeira Chave de Operador é criada na instalação, antes de existir qualquer Inquilino.** Sem ela, a instalação não aceita nada por rede.
- Não existe Chave de Operador padrão, embutida ou derivada de valor conhecido. Toda Chave de Operador é gerada na criação e exibida uma única vez.
- **Chave de Operador não lê conteúdo diretamente.** Cria Inquilino, emite e revoga Chave de Acesso, configura Destino de Mídia, lê o consolidado de espaço. Nenhuma operação de leitura de Conversa, Mensagem, Pessoa ou Anexo aceita Chave de Operador.
- **Mas o Operador pode emitir Chave de Acesso para qualquer Inquilino e ler por ela.** A separação acima é de superfície, não de confidencialidade; o que a sustenta é o registro de toda emissão, visível ao Titular. Ver `## Postura de confidencialidade`.
- Sempre existe ao menos uma Chave de Operador ativa; revogar a última é recusado.
- Revogação tem efeito imediato. Toda tentativa de uso — aceita ou recusada — é registrada.

**Ciclo de vida** — a primeira nasce no ato da instalação; as demais são criadas por uma já existente. Nunca editada, só revogada.

### Chave de Acesso

**Entidades / Objetos de Valor**

- **Chave de Acesso** (raiz) — credencial que identifica e autoriza acesso por rede.
- **Escopo** (objeto de valor) — o que a Chave pode fazer.

**Invariantes**

- Toda Chave de Acesso pertence a exatamente um Inquilino, declarado na emissão e imutável. Não existe Chave de Acesso sem Inquilino.
- **Chave de Acesso de um Inquilino nunca alcança dado de outro.** É a mesma fronteira do agregado Inquilino, aplicada na borda de rede.
- Acesso por rede sem Chave válida não lê nada — não existe leitura anônima, nem de metadado, nem de contagem.
- Chave de Acesso é revogável a qualquer momento, e a revogação tem efeito imediato. Chave de Acesso é emitida por Chave de Operador, nunca por outra Chave de Acesso.
- O valor da Chave nunca é recuperável depois da emissão: perdida, emite-se outra.
- Toda tentativa de uso de Chave — aceita ou recusada — é registrada com o Inquilino alvo.
- Um Inquilino pode ter N Chaves; revogar uma não afeta as outras.

**Ciclo de vida** — emitida sob um Inquilino, usada, revogada. Nunca editada.

### Conversa

**Entidades / Objetos de Valor**

- **Conversa** (raiz) — o fio de mensagens.
- **Referência Externa** (objeto de valor) — o que amarra a Conversa ao que ela é lá fora. Em Conversa **coletiva** é o par `(Fonte, identificador na origem)`; em Conversa **direta** é a tripla `(Fonte, Configuração de Adaptador, identificador na origem)`.
- **Participação** (entidade) — a presença de uma Pessoa na Conversa, com início e fim **quando a Fonte os informa**, e com o instante em que o malote a observou.
- **Metadados de Coletiva** (objeto de valor, opcional) — assunto, descrição, imagem, quem alterou e quando. Só existe quando a Conversa é coletiva.
- **Marca do Titular** (objeto de valor, opcional) — uma afirmação do **dono da conta** sobre um objeto do Acervo, com tipo, procedência e data. Pendura em **Mensagem ou em Conversa**, exatamente um dos dois, pelo mesmo critério da Atribuição de Nome. Tipos: `favorito` em Mensagem; `fixada` e `arquivada` em Conversa.

**Invariantes**

- Toda Conversa tem identidade própria, atribuída pelo malote, independente de qualquer Fonte.
- Toda Conversa pertence a exatamente um Inquilino; a unicidade da Referência Externa vale dentro do Inquilino, não entre Inquilinos.
- Toda Conversa tem exatamente uma Referência Externa, e ela é única no Acervo — **com forma diferente por natureza, e a assimetria é o modelo.**
- **Conversa direta pertence a UMA Configuração de Adaptador; coletiva pertence ao Inquilino.** Duas contas do Titular que falam com o mesmo endereço têm **dois** fios: o que se conversou pelo número pessoal e pelo número de trabalho não é a mesma conversa. Já um grupo do qual as duas contas participam é **um** grupo, não dois — e a Mensagem que chega às duas por ele continua sendo uma só.
- **A Configuração é obrigatória em Conversa direta e proibida em coletiva**, pelo mesmo critério que já vale para Metadados de Coletiva: Conversa não carrega campo nulo de uma natureza que não é a dela.
- **Conversa direta aponta para Configuração da mesma Fonte.** A Configuração vive no Registro, que é outro arquivo — não há chave estrangeira possível, e a porta de escrita é o único lugar onde as duas Fontes se encontram.
- **Um endereço não existe nas duas naturezas ao mesmo tempo.** Encontrá-lo já gravado como coletiva ao registrá-lo como direta, ou o contrário, é conflito relatado — nunca uma segunda Conversa.

  Medido em 08/09/2026, ao importar a segunda conta de WhatsApp do Titular sobre um Acervo que já tinha a primeira: **95 Conversas pré-existentes receberam Mensagem da conta nova — 89 diretas e ZERO coletivas.** Uma delas foi de 9.557 para 12.466 Mensagens num fio só. É esse número que sustenta a assimetria: o dado mostra que a colisão que acontece é a da direta, e a que não acontece é a da coletiva.
- A identidade da Conversa nunca é o identificador da Fonte.
- **Conversa direta tem exatamente duas Participações** — o Titular e o outro lado. São sempre deriváveis, de qualquer Fonte.
- **Conversa coletiva tem as Participações que a Fonte informar, podendo ser nenhuma.** Material exportado traz o quadro do momento do export, e grupo do qual o Titular saiu costuma não trazer membro algum.
- **Nenhuma data de Participação é inferida.** `comecou_em` e `terminou_em` são nulos quando a Fonte não os fornece — nunca a data da primeira mensagem, nunca uma aproximação. Fabricar data é o mesmo defeito que o Acervo recusa em Mensagem.
- **Toda Participação registra quando foi observada.** É o que distingue "está na Conversa" de "estava quando o malote olhou pela última vez", sem inventar a diferença.
- **Retrato e transição são coisas diferentes, e só a transição afirma saída.** O roster que a Fonte entrega é o quadro de um instante; a diferença entre dois retratos **nunca** é lida como entrada ou saída. Participação ausente de um material mais recente permanece, com a data da última observação. Saída só é afirmável quando a Fonte declara o evento — e aí ela tem instante próprio.
- Uma Pessoa tem no máximo uma Participação por Conversa — o retrato é um só. **Entradas e saídas repetidas são representáveis**, e não pela Participação: cada uma é uma Transição, com instante próprio e unicidade por evento. Vale também para material exportado, e não só para a recepção contínua — a correção é de 01/09/2026, e a redação anterior nasceu antes de o ciclo 9 medir que a Fonte declara esses eventos no export.
- Reimportar material atualiza a Participação observada, sem duplicá-la.
- **Marca do Titular vale por Configuração de Adaptador, como a Conversa direta.** O que o Titular fixou na conta pessoal não diz nada sobre a conta de trabalho.
- **A Marca só é afirmável a partir de material ou evento de Natureza completa.** Estado que chega num retrato completo autoriza dizer *não está marcada*; estado que chega numa atualização parcial só autoriza dizer *esta mudou*. É o mesmo invariante que já separa retrato de transição na Participação, e a mesma Natureza que o Adaptador declara — ler uma atualização de um item como se fosse o retrato desmarcaria tudo o que não veio nela, em silêncio.

  Medido em 12/09/2026 no ouvinte em produção: dos **8.409** eventos de atualização de Conversa em nove dias, **8.394 trouxeram um item só** e **um** trouxe **2.674 com o estado de fixação de cada uma** — e só este último autoriza concluir ausência.

### Transição de Participação

**Entidades / Objetos de Valor**

- Transição de Participação (raiz) — o evento datado que a Fonte declarou
- Natureza — par fechado: entrou, saiu
- Código da Fonte — o valor bruto, preservado depois de classificado

**Invariantes**

- **Toda Transição tem o instante que a Fonte declarou.** Nenhum é derivado — nem da primeira Mensagem, nem da importação, nem de aproximação.
- **A diferença entre dois retratos nunca produz Transição.** Só o evento declarado a produz. É a guarda central do agregado.
- **Código que o produto não classifica nunca vira Transição** — é contado por código no relatório de importação, nunca descartado em silêncio.
- **Transição e Participação coexistem, e nenhuma deriva da outra.** O retrato continua sendo retrato.
- Reimportar o mesmo material não duplica Transição: a unicidade é `(Fonte, identificador do evento, Identificador)`.
- **Conversa sem Transição não tem Alcance**, e aí o produto recusa responder por data passada em vez de devolver o quadro de hoje.

**Ciclo de vida** — nasce da importação de material ou, quando existir, da recepção contínua. Nunca é editada nem removida.
- Metadados de Coletiva só existem em Conversa coletiva; Conversa direta não carrega campo de coletiva nulo.
- Conversa nunca é apagada por política de espaço.

**Ciclo de vida** — nasce na primeira importação ou no primeiro evento recebido pelo Adaptador; permanece para sempre. Pode ficar inativa (sem Mensagem nova), nunca removida.

### Mensagem

**Entidades / Objetos de Valor**

- **Mensagem** (raiz).
- **Referência Externa** (objeto de valor) — mesmo conceito da Conversa.
- **Citação** (objeto de valor, opcional) — ponteiro para a Mensagem citada.
- **Marca do Titular** (objeto de valor, opcional) — ver o agregado Conversa, onde o conceito está descrito. Em Mensagem o tipo é `favorito`.
- **Conteúdo Bruto** (objeto de valor) — o registro original entregue pela Fonte, preservado para o que o núcleo não modela. **Não é exclusivo da Mensagem:** Conversa, Participação e Anexo o carregam pela mesma razão, e quem os produz é o Adaptador. Onde a Fonte entrega uma linha, ela é preservada inteira; onde o participante é **derivado** — conversa direta, que não tem roster — não há registro a preservar e o campo fica ausente.

**Invariantes**

- Toda Mensagem pertence a exatamente uma Conversa.
- O Adaptador **não escolhe** o que do registro original vale a pena guardar: guarda a linha inteira. Enumerar colunas é decidir hoje o que será útil depois, e é justamente o erro que o Conteúdo Bruto existe para não cometer.
- Toda Mensagem pertence ao mesmo Inquilino da sua Conversa.
- O par `(Fonte, identificador na origem)` é único no Acervo — reimportar a mesma origem não duplica Mensagem.
- Toda Mensagem tem instante de ocorrência conhecido e plausível; instante ausente ou fora da faixa de existência da Fonte é rejeitado na entrada, não gravado. Não existe estado intermediário de data suspeita: o Acervo não comporta instante implausível.
- O autor de uma Mensagem é um Identificador, nunca um texto livre de endereço.
- Mensagem sem autor conhecido é válida — o autor pode ser resolvido depois.
- Mensagem nunca é apagada por política de espaço.
- **Favorito é afirmação do Titular, não propriedade da Mensagem.** É a única curadoria humana que o acervo recebe da Fonte — o sinal que diz *isto aqui importa*, na voz do dono. Entra como Marca do Titular e segue as regras dela.

  Medido em 07/09/2026 no backup real: **90 Mensagens favoritadas, em 7 Conversas**, de 1.018.587. Ao vivo, zero em 571 eventos de atualização de Mensagem — ausência de evento, não de capacidade.

**Ciclo de vida** — criada na importação ou na recepção; imutável quanto ao conteúdo. Pode ganhar vínculos depois (autor resolvido, Anexo baixado).

### Pessoa

**Entidades / Objetos de Valor**

- **Pessoa** (raiz) — quem conversa.
- **Identificador** (entidade) — um endereço numa Fonte: número de telefone, apelido de perfil, endereço de e-mail, código interno da plataforma.
- **Atribuição de Nome** (objeto de valor) — um nome vindo de uma origem, com data e **Autoridade**. Pendura em **Identificador ou em Pessoa**, exatamente um dos dois: o material afirma que um *endereço* se chama X, e o humano afirma que uma *pessoa* se chama X. São afirmações diferentes, e o modelo guarda as duas como elas foram feitas.
- **Autoridade da Atribuição** (objeto de valor) — **quem afirmou o nome**: `titular`, quando quem é dono da conta o cadastrou, e `terceiro`, quando o dono do endereço o escolheu para si. É declarada pelo Adaptador, que é quem sabe de qual campo do material o nome veio.

**Invariantes**

- Pessoa existe independentemente de qualquer catálogo externo. O produto funciona sem adaptador de identidade.
- Toda Pessoa pertence a exatamente um Inquilino. Não há Pessoa compartilhada entre Inquilinos, ainda que o mesmo Identificador apareça nos dois.
- Todo Identificador pertence a no máximo uma Pessoa.
- O par `(Fonte, valor do identificador)` é único no Acervo.
- Uma Pessoa pode ter N Identificadores, de Fontes diferentes — é isso que permite cruzar conversas entre plataformas.
- Identificador sem Pessoa é válido: representa alguém visto mas ainda não identificado. Resolver identidade é operação posterior, nunca pré-requisito de importação.
- Nome de Pessoa é derivado das Atribuições de Nome por precedência declarada, não gravado como verdade única — trocar de adaptador de identidade muda o nome exibido sem reescrever o Acervo.
- **Importar nunca cria Pessoa.** O Adaptador registra Identificador, Participação, Mensagem e Atribuição de Nome **do endereço**; criar Pessoa e vincular são operações posteriores e explícitas. É o que mantém *resolver identidade nunca é pré-requisito de importação* verdadeiro sem custar a informação de nome que a Fonte oferece.
- **O nome corrente de uma Pessoa deriva do que está nela e do que está nos Identificadores dela**, pela mesma precedência. Desvincular um Identificador leva o nome dele junto — ele nunca foi da Pessoa.
- **Nome que repete o próprio endereço não é Atribuição de Nome.** Plataforma que preenche o campo de nome com o número de telefone não está nomeando ninguém, e gravar isso como afirmação faz o endereço competir com o nome de verdade. O Adaptador é quem compara, porque só ele sabe traduzir a forma escrita do nome na forma do endereço.

  Medido em 12/09/2026 no Acervo do Titular: **1.271 de 11.967 Atribuições de origem `whatsapp` (10,6%) repetem o endereço do próprio Identificador**.
- **Toda Atribuição de Nome declara a Autoridade, e ela desempata DENTRO da mesma Fonte.** `titular` prevalece sobre `terceiro` — o nome que o dono da conta cadastrou vale mais que o nome que o outro escolheu para si. É o terceiro nível da precedência, irmão do catálogo preferido: como ele, **nunca atravessa Fontes**, porque atravessar faria nome de plataforma ganhar de nome de catálogo.

  Medido em 12/09/2026: **2.885 Identificadores têm mais de um nome na mesma origem `whatsapp`**; nos 208 em que um deles é o endereço e o outro é nome humano, a Autoridade acerta **86** e erra **1** — o único contra-caso é um endereço cujo material trouxe o telefone e cujo nome humano veio do outro lado.
- **A recência não é critério de confiança, e era o que decidia.** Sem a Autoridade, duas afirmações de mesmo peso eram desempatadas pela ordem de registro: o nome que a plataforma reenvia todo dia vencia o que o Titular cadastrou uma vez. Isso vale também **entre Fontes de peso igual** — `whatsapp` e `instagram` empatam por padrão, e ali o desempate continua sendo a recência enquanto ninguém declarar peso diferente. A recência é o último critério, nunca o primeiro.
- **Para uma Pessoa mestre, "dela" é a família inteira.** Ler a mestre alcança os Identificadores e as Atribuições de Nome de todas as absorvidas, deduplicados, pela mesma precedência. **É este invariante que torna desnecessário copiar qualquer coisa na mesclagem** — o que a absorvida tem já é alcançável pela mestre, sem ter sido movido. Sem ele, mesclar por apontamento perderia o que mesclar por movimento entregava.
- **Procedência `catalogo` diz QUAL catálogo.** Com mais de uma Configuração de catálogo, `catalogo` sozinho não permite auditar nem desfazer a contribuição de uma delas, e dois catálogos que discordam ficam indistinguíveis. O mesmo vale para a Atribuição de Nome cuja origem é catálogo.
- **Cartão de Contato que deixa de aparecer é MARCADO, nunca removido**, e o registro continua disponível. Reconciliar é ato humano — mesmo padrão de mesclar, pela mesma razão: o produto não desfaz sozinho o que pode ser trabalho humano.
- **A marca só existe para material de Natureza completa.** É o invariante que impede a ingestão parcial do Instagram de marcar como ausente tudo o que ela simplesmente não trouxe.
- **O produto não sabe que um contato é o mesmo quando o endereço dele muda, e isso é limite da Fonte, não do desenho.** Medido em 11/09/2026: o vCard não traz identificador estável — **0 em 6.693 cartões** —, então a identidade do Cartão é derivada dos endereços e trocar um telefone produz outro Cartão. O desfecho é o que o modelo já prevê: um Cartão marcado como ausente e outro nascendo, com a ligação entre os dois feita por quem sabe. Resolver isso exigiria o identificador da plataforma viva, recusado em 29/08/2026.
- **Todo vínculo entre Identificador e Pessoa carrega a Procedência do Vínculo** — material, catálogo ou humano — e execução automática nunca desfaz o que o humano afirmou.
- **Mesclar não move nem copia nada: mesclar é apontar.** A Pessoa absorvida mantém os Identificadores e as Atribuições de Nome que sempre teve, e passa a apontar para a **Pessoa mestre**. Revisado em 29/08/2026 — até então mesclar movia os Identificadores e copiava os nomes de nível Pessoa, e a operação de maior alcance do modelo era a única irreversível, porque o conjunto movido deixava de existir no instante do movimento.
- **A família de uma Pessoa mestre é uma estrela de um salto, nunca uma cadeia.** Toda Pessoa absorvida aponta **direto** para a mestre; não existe absorvida apontando para outra absorvida. Ao mesclar duas famílias, as absorvidas da que perde o posto são reapontadas para a mestre que prevalece. É o que permite resolver Pessoa em um salto, sem percurso recursivo.
- **A mestre é sempre uma raiz.** O apontamento de mestre de qualquer Pessoa absorvida leva a uma Pessoa que não está absorvida em ninguém. É o que sustenta o salto único: mestre que pudesse estar absorvida transformaria a estrela em árvore.
- **O invariante é guardado na fronteira de escrita, e a ordem errada é recusada em vez de consertada.** Duas guardas o sustentam: a mestre indicada precisa ser raiz, e **Pessoa que ainda é mestre de outras não pode ser absorvida** — suas absorvidas são reapontadas primeiro, explicitamente. A segunda existe porque a primeira olha o lado errado do problema: ao absorver uma mestre, a escrita é na linha dela, e validar a nova mestre não diz nada sobre quem a seguia. Sem a segunda guarda, absorver uma mestre deixa os seguidores apontando para quem deixou de ser raiz — e em silêncio.
- **A cascata é da aplicação, não do banco.** O banco conseguiria reapontar sozinho, mas escrita que a aplicação não vê é escrita que a trilha não registra — e num produto operado por agentes a trilha é como um agente descobre o que outro fez. O banco recusa; quem reaponta é quem opera, e o reapontamento fica registrado.
- **Quem absorveu quem, naquele ato, é imutável.** Além da mestre — que é conclusão corrente e pode ser reescrita —, a Pessoa absorvida guarda **quem a absorveu diretamente**, no momento em que foi absorvida, e esse registro nunca muda. É ele que torna desfazer uma reconstrução exata em vez de um palpite: a mestre diz onde a Pessoa está hoje, o absorvedor direto diz de onde ela veio.
- **A preferência de mestre é declarada, não é "a que sobrou".** Entre duas Pessoas, prevalece a que tem Identificador da **Fonte de catálogo** — é a Fonte que existe justamente para dizer quem é quem, e a única que conhece uma pessoa por vários endereços. Sem catálogo dos dois lados, ou com catálogo nos dois, a escolha é de quem chama, e a regra usada fica registrada. Um agente mesclando em lote precisa de critério determinístico, e *a que ficou* não é um.
- **Pessoa sem Identificador é estado válido.** Desvincular o último endereço não apaga a Pessoa: é ela que guarda o histórico de nomes e o registro do que foi desfeito. Pessoa absorvida por mesclagem também permanece, como registro da mesclagem.
- O núcleo nunca constrói o endereço de uma Fonte a partir do dado de outra. Traduzir telefone em endereço de plataforma é responsabilidade do Adaptador daquela plataforma.
- **Quando a Fonte não fornece endereço algum, o Adaptador usa o sinal mais durável que o material tiver, e declara qual é.** Registrado em 26/08/2026, ao entrar o segundo Adaptador: há material que dá o nome de exibição de um participante e nenhum endereço. O valor do Identificador passa a ser esse nome, e a consequência é dita em vez de escondida — homônimos colidem e troca de nome cria Identificador novo. O núcleo não muda: ele guarda o par (Fonte, valor) e a unicidade dele, e não interpreta o valor. Unir o que se descobrir depois ser a mesma Pessoa é operação explícita e reversível, nunca inferência do Adaptador.

**Ciclo de vida** — nasce da importação (Identificador solto) ou da vinculação feita por um adaptador de identidade; permanece. Fusão de duas Pessoas é operação explícita e **reversível por construção**: mesclar escreve um apontamento, e desfazer o remove. Nenhuma Pessoa é apagada em nenhum momento — a absorvida continua existindo, com tudo que tinha.

### Anexo

**Entidades / Objetos de Valor**

- **Anexo** (raiz) — o arquivo que acompanha a Mensagem.
- **Descritor** (objeto de valor) — tipo, tamanho, nome original, duração, impressão de conteúdo. É o que se sabe sobre o arquivo.
- **Presença** (objeto de valor) — o estado do arquivo em disco: presente, nunca obtido ou descartado.

**Invariantes**

- Todo Anexo pertence a exatamente uma Mensagem.
- Todo Anexo pertence ao mesmo Inquilino da sua Mensagem, e o arquivo fica sob o Destino de Mídia daquele Inquilino.
- **Descartar o arquivo nunca apaga a Mensagem nem o Anexo.** O Descritor sobrevive: continua sendo possível saber que houve um vídeo naquela conversa, de quem, quando e de que tamanho, mesmo sem o arquivo.
- Presença é sempre explícita. "Arquivo não está lá" nunca é indistinguível de "arquivo nunca existiu".
- Anexo descartado registra quando e por qual política — descarte é auditável.
- O layout do arquivo sob o Destino é decidido pelo núcleo, não pelo Adaptador — uniforme entre Fontes e entre Destinos.
- Nenhum caminho de arquivo do Acervo contém dado pessoal (nome, apelido de perfil, número).

**Ciclo de vida** — nasce junto com a Mensagem, mesmo antes de o arquivo existir em disco. Transita entre estados de Presença por operação explícita. Nunca é removido do Acervo.

### Adaptador

**Entidades / Objetos de Valor**

- **Adaptador** (raiz conceitual) — o código que traduz uma Fonte para o núcleo.
- **Estado de Sincronização** (entidade) — o que aquele Adaptador precisa lembrar entre execuções: quais **Materiais** já entraram.
- **Material** (entidade) — um lote exportado por uma Fonte, identificado por uma **impressão** derivada do seu conteúdo.

**Invariantes**

- Adaptador escreve no núcleo apenas pelas operações públicas do núcleo — nunca em tabela do núcleo diretamente.
- Adaptador roda sempre sob um Inquilino declarado e não enxerga nenhum outro.
- Adaptador é dono das suas próprias estruturas de apoio, e elas não pertencem ao núcleo — **com uma exceção nomeada: estrutura cujo significado morre junto com o Acervo mora no Acervo.** É o caso do Estado de Sincronização, decidido em 28/08/2026: registro de Material que sobrevivesse ao Acervo faria o produto afirmar "esse Material já entrou" contra um banco vazio. A justificativa mudou em 01/09/2026 e o critério permanece — a redação original dizia "enquanto o versionamento for por fase, recriar Acervo é rotina", e recriar deixou de ser rotina quando a migração versionada entrou; mas recriar continua existindo como escolha, e basta ele acontecer uma vez para o dado órfão mentir. O critério da exceção é esse, e não conveniência: se apagar o Acervo torna o dado mentiroso, ele é do Acervo.
- Estado de Sincronização é sempre por Inquilino e por Configuração de Adaptador. Nenhum Adaptador lê ou sobrescreve o estado de outro, nem da mesma Fonte em outro Inquilino.
- **Material só é registrado quando a importação termina.** Interrompida no meio, o Acervo fica com o que entrou e sem registro, e a execução seguinte processa tudo de novo — a idempotência é a rede embaixo, e o registro é a economia, nunca a garantia.
- **A impressão do Material é derivada de nome e tamanho dos arquivos, nunca do conteúdo.** É o que mantém o custo proporcional ao número de arquivos e não ao volume. Ignorar a estrutura não é opção: medido em 28/08/2026 sobre sete materiais reais da mesma conta, quatro pares têm árvore idêntica e diferem só no tamanho.
- **A Configuração de Adaptador carrega qual conta da Fonte ela representa**, em vocabulário do Adaptador. O Registro guarda o valor opaco — quem sabe o que ele significa é o Adaptador.
- **Um Material pode estar espalhado por mais de uma pasta.** Medido no Instagram: a plataforma fatia o export por tipo de conteúdo, e das pastas emitidas na mesma data só uma traz os arquivos de mensagem.
- **O produto consulta uma Pasta de Entrada; não busca material.** Baixar de onde quer que o material venha — serviço de arquivos, e-mail, cópia à mão — está **fora do produto**, porque varia por quem instala. O que o produto garante é: dada uma pasta, ele reconhece o que ainda não entrou e processa.
- **A Natureza do Material é declarada por Configuração, e é ela que dá sentido à ausência.** Em material **completo**, o que não veio sumiu na origem. Em material **parcial**, o que não veio apenas não mudou. Ler ausência como remoção num material parcial marcaria dado bom como sumido, em silêncio — e por isso **a ausência não é medida em material parcial**.
- **A Natureza vale para o que chega ao vivo, e ali ela muda por evento.** Material tem Natureza estável por Configuração; recepção contínua entrega as duas — o **retrato** de um estado inteiro, que a plataforma reenvia de tempos em tempos, e a **atualização** de um objeto só. O Adaptador declara qual dos dois recebeu, e essa declaração é o que dá sentido à ausência, exatamente como no material.

  Medido em 12/09/2026: o retrato chega quando a plataforma consegue entregar o instantâneo do estado, e **isso falhou em 2 de 3 tentativas** em nove dias. Reinício do processo não o provoca — houve mais de dez reinícios e um retrato. Logo o produto **conta e expõe** se o retrato chegou ou falhou, e não conclui nada de um período sem ele: *nenhuma marcada* e *o retrato não veio* são coisas diferentes, e confundi-las apaga curadoria humana em silêncio.
- **Uma mesma instalação vigia os dois tipos ao mesmo tempo.** Medido: o export do Instagram é parcial (26/08/2026) e o vCard de catálogo é completo. A natureza não é propriedade do produto nem do arquivo: é da Fonte, declarada na Configuração.
- **Varrer nunca decide identidade.** A varredura reconhece material não registrado e chama a importação; criar Pessoa e vincular continuam sendo operações separadas e humanas.
- **Teste de aceite do desenho:** acrescentar uma Fonte não altera nenhum agregado do núcleo.
- Dois Adaptadores podem servir à mesma Fonte com mecanismos diferentes (importação de arquivo exportado e recepção contínua) e convergem para a mesma Referência Externa — a mesma Mensagem obtida pelos dois caminhos não vira duas.
- Adaptador de identidade é um Adaptador como outro qualquer: contribui Identificadores e Atribuições de Nome, e é opcional.
- **Todo Cartão de Contato pertence a exatamente uma Configuração de Adaptador.** Sem isso, "o catálogo A não tem mais este número" é indistinguível de "o catálogo B nunca teve" — e um Inquilino com mais de um catálogo é o caso normal, não a borda.
- **O Adaptador de catálogo grava o laço de Cartão de Contato**, que diz de qual entrada do catálogo veio cada Identificador. É a exceção nomeada acima em ação: sem ele o produtor de Proposta por múltiplos endereços teria de usar o **nome** para agrupar, e nome agrupa homônimos — medido em 29/08/2026, 24 nomes em 51 cartões, 57 telefones que seriam unidos indevidamente. A identidade do Cartão é derivada do conjunto de endereços dele, porque o material não traz identificador estável.
- **Proposta é calculada, nunca armazenada.** O Adaptador a deriva do Acervo a cada listagem; não há tabela de Propostas e, portanto, não há Proposta obsoleta. Um conjunto já resolvido deixa de aparecer sozinho.
- **A origem de uma Atribuição de Nome é a FONTE, e a Configuração fica em campo separado.**
  A resolução do nome corrente busca a origem **exatamente** na tabela de precedência; colar a
  Configuração na origem faria o peso cair para zero e o nome de catálogo ficar **abaixo** do
  nome de plataforma. Quem distingue catálogos é o campo próprio, que é também o que permite
  declarar um deles como preferido.
- **A unicidade de nome que sustenta a Proposta por nome é medida por Fonte**, não somando o Acervo. Somar torna ambíguo justamente o nome que aparece uma vez em cada Fonte — que é o caso de mais valor, a ponte entre plataformas sem endereço em comum.

### Operação

**Entidades / Objetos de Valor**

- **Operação** (raiz) — identificador próprio, natureza, instante, classe de reversibilidade
- **Linha de Efeito** — tabela, chave, e ou o par anterior/posterior de um campo, ou a referência a uma trilha existente

**Invariantes**

- Um comando de decisão grava exatamente uma Operação, ainda que escreva várias linhas.
- Ingestão grava uma Operação por Material, nunca uma por Mensagem.
- Uma Linha de Efeito tem exatamente uma natureza: diferença de valor **ou** referência.
- Onde já existe trilha semântica — mesclagem, Material —, a Operação a referencia e não copia o conteúdo dela.
- Desfazer nunca apaga: acrescenta uma Operação que aponta para a desfeita.
- Uma Operação é desfeita no máximo uma vez.
- A Operação é gravada na mesma base do efeito que registra, na mesma transação.
- Nenhuma consulta à trilha atravessa Inquilino.

**Ciclo de vida** — nasce com o ato; nunca é alterada nem removida; pode ser apontada por uma Operação de desfazer.

## Operações

Toda operação nomeia o Inquilino sobre o qual age. Não existe operação sem Inquilino.

### criar-chave-de-operador

- **Ator:** quem instala, na própria máquina — a primeira; o Operador autenticado, as demais
- **Entrada:** nenhuma, além da intenção
- **Saída:** o valor da Chave de Operador, exibido uma única vez
- **Regras:** a primeira execução é o ato de bootstrap da instalação e precede a criação de qualquer Inquilino. A raiz de confiança da primeira é o acesso à máquina; não há credencial anterior a apresentar. Valor gerado, nunca escolhido, nunca recuperável depois.
- **Não-funcionais:** o valor nunca é gravado em log, em histórico de comando ou em mensagem de erro.

### revogar-chave-de-operador

- **Ator:** Operador
- **Entrada:** Chave de Operador
- **Saída:** Chave revogada
- **Regras:** recusa quando é a última ativa — a instalação nunca fica sem administração possível. Revogar já revogada não é erro.
- **Não-funcionais:** idempotente.

### criar-inquilino

- **Ator:** Operador, autenticado por Chave de Operador
- **Entrada:** identificação do Inquilino, Pessoa titular
- **Saída:** Inquilino criado, com Acervo vazio e área de arquivos própria
- **Regras:** precede qualquer importação, e é precedido pela criação da primeira Chave de Operador. Criar Inquilino não emite Chave de Acesso — são operações separadas.
- **Não-funcionais:** Padrão.

### emitir-chave

- **Ator:** Operador, autenticado por Chave de Operador
- **Entrada:** Inquilino, escopo
- **Saída:** o valor da Chave, exibido uma única vez
- **Regras:** o valor não é recuperável depois. O Inquilino da Chave é imutável. A emissão é registrada de forma imutável e fica visível ao Titular do Inquilino.
- **Não-funcionais:** o valor da Chave nunca é gravado em log, em histórico de comando ou em mensagem de erro.

### revogar-chave

- **Ator:** Operador, autenticado por Chave de Operador
- **Entrada:** Chave
- **Saída:** Chave revogada
- **Regras:** efeito imediato. Revogar não afeta as demais Chaves do Inquilino. Revogar Chave já revogada não é erro.
- **Não-funcionais:** idempotente.

### listar-chaves-de-acesso

- **Ator:** Titular, autenticado por Chave de Acesso do próprio Inquilino; ou Operador
- **Entrada:** Inquilino
- **Saída:** as Chaves de Acesso do Inquilino, com data de emissão, estado e data de revogação — nunca o valor
- **Regras:** é o que torna a auditoria de emissão útil a quem não é o Operador. O Titular vê chave emitida para o seu Inquilino ainda que não tenha sido ele a pedir.
- **Não-funcionais:** só leitura.

### configurar-destino-de-midia

- **Ator:** Operador, autenticado por Chave de Operador
- **Entrada:** Inquilino, natureza e endereço do Destino
- **Saída:** Destino configurado, mais a verificação de que é alcançável e gravável
- **Regras:** configurar não move arquivo. Trocar o Destino de um Inquilino com Acervo existente exige migração explícita dos arquivos, que é operação à parte.
- **Não-funcionais:** a verificação de alcance falha alto — Destino inalcançável nunca é aceito em silêncio.

### importar-acervo

- **Ator:** humano
- **Entrada:** Inquilino, Configuração de Adaptador, caminho do material exportado. **O Nome do Titular na Fonte vem da Configuração**, não da invocação — quem varre pastas sozinho não tem como sabê-lo por pasta.
- **Saída:** contagem de Conversas, Mensagens, Pessoas e Anexos criados e ignorados por já existirem; Transições de Participação criadas; participantes que a Fonte declara ativos e inativos; e os eventos de grupo **não classificados, contados por código**
- **Regras:** o Adaptador traduz o material e chama as operações do núcleo. Reexecução sobre o mesmo material não duplica nada — a unicidade de `(Fonte, identificador na origem)` é o mecanismo. Mensagem com instante implausível é rejeitada e contabilizada, não gravada. Anexo é criado com Presença explícita mesmo quando o arquivo não veio no material.
- **Não-funcionais:** idempotência é requisito de aceite, não padrão implícito — é a operação que roda sobre acervo de milhões de registros e será reexecutada. Deve ser retomável: interrupção no meio não exige recomeçar do zero.

### importar-catalogo-de-identidade

- **Ator:** humano, ou a varredura
- **Entrada:** Inquilino, Configuração de Adaptador de catálogo, material do catálogo
- **Saída:** Cartões de Contato registrados, Identificadores vistos, Atribuições de Nome com Procedência de catálogo, e — quando a Natureza for completa — o que deixou de aparecer
- **Regras:** o catálogo **só acrescenta e marca**; nunca remove Identificador, nunca desfaz vínculo, nunca cria Pessoa. Cada Cartão nasce preso à Configuração que o trouxe.
- **Não-funcionais:** Padrão

### propor-vinculo-por-catalogo

- **Ator:** humano ou agente
- **Entrada:** Inquilino
- **Saída:** Propostas de identidade sustentadas pelo laço de Cartão de Contato
- **Regras:** Proposta é calculada, nunca armazenada. Aplicar continua sendo ato separado.
- **Não-funcionais:** Padrão

### receber-ao-vivo

- **Ator:** o próprio produto, num processo dedicado que o humano inicia
- **Entrada:** o Inquilino, e **uma** conta da Fonte — um processo escuta uma conta, e uma segunda conta é um segundo processo, com o próprio vínculo de dispositivo
- **Saída:** um efeito contínuo — o instante do último evento recebido, gravado onde quem está **de fora** o lê sem abrir o Acervo; e, por evento, o que foi gravado, o que foi recusado com a causa, e o que foi ignorado contado por tipo
- **Regras:** o que chega é gravado pelas **mesmas** portas que a importação usa, sem forma nova no núcleo — é isso que faz os dois caminhos convergirem sem código de convergência. Endereço é resolvido para a forma canônica **antes** de virar Referência Externa. Cada evento é gravado por inteiro ou não é gravado. O que a Fonte entrega sem conteúdo decifrável **não** vira Mensagem: gravar o envelope vazio travaria o identificador contra quem souber preenchê-lo depois. Reprocessar não duplica: quem responde *isto já existe* é o Acervo, e o receptor não guarda memória própria. Transição de Participação segue a mesma regra de sempre — só existe quando a Fonte declara o evento
- **Não-funcionais:** o produto continua completo **sem** esta operação; importar e consultar não dependem dela. A recepção é **ingestão, não decisão**: grava uma Operação por evento, com o efeito desligado. Queda de conexão é rotina e não é sinal de parada — a religação é espaçada, com teto, e o sinal de que o receptor morreu é o instante do último evento parar de avançar. Cobertura não é promessa: o que a plataforma não reentrega é **lacuna declarada**, preenchível por importação de material posterior
- **Quando o Acervo está ocupado, o evento vai para o Derrame e volta depois.** Disputa de escrita **não** é recusa: recusa é sobre dado que o modelo não aceita, e banco ocupado é infraestrutura. O evento é escrito cru, por lote, num arquivo fora do Acervo, e o receptor **continua vivo** — matá-lo perderia tudo o que viesse depois. Na primeira escrita bem-sucedida seguinte, o receptor **drena** parte do Derrame; o sinal de que a disputa passou é o sucesso, e não o relógio. Grava-se no Acervo **antes** de tirar do Derrame: invertido, morrer no meio apaga o que nunca entrou, e nesta ordem o pior caso é repetição, que a unicidade da Referência Externa descarta. Lote que falha por algo que **não** é disputa sai para um arquivo à parte, com a causa junto — sem isso ele derrubaria o receptor a cada drenagem, para sempre
- **O Derrame é visível sem abrir o Acervo**, pela mesma operação que reporta o instante do último evento. E derramar **não** é ficar em silêncio: o instante continua avançando, porque o receptor está vivo e recebendo
- **O que a plataforma entrega além da Mensagem entra pelas mesmas portas, com a Natureza declarada.** Nome que o Titular cadastrou e Marca do Titular chegam por eventos de estado, não na Mensagem; o receptor os grava com a Autoridade e a Natureza que o Adaptador determinar, e **a chegada do retrato é reportada junto do instante do último evento** — quem vigia precisa distinguir *não há marcação* de *o retrato não veio*

### consultar-participacao-em-data

- **Ator:** humano ou agente
- **Entrada:** Inquilino, Conversa, data
- **Saída:** quatro grupos — *presente*, *saiu antes desta data* (com o instante), *ainda não entrou* e *sem informação* —, o Alcance da Conversa, e a ressalva nas duas direções
- **Regras:** a rota é o **último evento até a data**, e é ela que trata reentrada sem caso especial. Não havendo evento até a data, decide o primeiro depois dela: saída posterior prova presença — ninguém sai de onde não está —, e entrada posterior prova que a Pessoa ainda não tinha entrado. Fora do Alcance, todos caem em *sem informação*, nas duas direções. Conversa sem Alcance responde que não tem, e não devolve o roster. A ressalva é parte da estrutura da resposta, e não do texto de apresentação — posta na apresentação, sumiria no `--json`.
- **Não-funcionais:** grava zero Operações. Não se diz "estritamente de leitura": autenticar grava a tentativa, comportamento do ciclo 1.

### consultar-conversas

- **Ator:** humano ou agente
- **Entrada:** Inquilino, mais filtros por Pessoa, Fonte, período, texto, tipo de Mensagem, presença de Anexo e Marca do Titular
- **Saída:** Conversas ou Mensagens, em formato legível por humano ou estruturado para agente
- **Regras:** consulta atravessa Fontes e Configurações de Adaptador por padrão — duas contas de WhatsApp do mesmo Inquilino aparecem juntas, sem flag. **Nunca atravessa Inquilino.** Restringir a uma Fonte é filtro, não modo. Filtro por Pessoa resolve todos os Identificadores daquela Pessoa, em todas as Fontes. Resultado indica a Presença do Anexo, nunca omite a Mensagem por o arquivo não estar em disco.
- **Não-funcionais:** só leitura. Nenhum caminho de consulta escreve no Acervo. Quando invocada por rede, o Inquilino vem da Chave de Acesso, nunca de parâmetro do chamador.

### resolver-identidade

- **Ator:** humano ou sistema
- **Entrada:** Inquilino, mais Identificador solto ou vínculos vindos de um adaptador de identidade
- **Saída:** Identificadores vinculados a Pessoas
- **Regras:** vincular Identificador a Pessoa nunca reescreve Mensagem. Vínculo é reversível. Todo vínculo declara a **Procedência do Vínculo**, e execução automática nunca desfaz o que o humano afirmou. Conflito — dois adaptadores propondo Pessoas diferentes para o mesmo Identificador — é registrado e apresentado, nunca resolvido em silêncio.
- **Não-funcionais:** Padrão.

### vincular-identificador

- **Ator:** humano, ou Adaptador de identidade
- **Entrada:** Inquilino, Identificador, Pessoa (ou o pedido de criar uma), Procedência do Vínculo
- **Saída:** vínculo gravado, com quem o afirmou e quando
- **Regras:** recusa quando o Identificador já pertence a outra Pessoa — mover entre Pessoas é operação própria, e o conflito é apresentado com as duas Pessoas nomeadas. Recusa quando a Procedência pedida é menor que a vigente. Nunca escreve em Mensagem.
- **Não-funcionais:** revincular à mesma Pessoa é sem efeito e não move a data da afirmação que vale.

### desvincular-identificador

- **Ator:** humano
- **Entrada:** Inquilino, Identificador
- **Saída:** vínculo desfeito, e o registro do que saiu — endereço, Fonte e Procedência que vigorava
- **Regras:** a Pessoa **permanece**, ainda que fique sem Identificador nenhum. O nome de nível Identificador vai junto com o endereço; o de nível Pessoa fica.
- **Não-funcionais:** idempotente — desvincular duas vezes registra uma vez só.

### mesclar-pessoas

- **Ator:** humano ou agente
- **Entrada:** Inquilino, as duas Pessoas a unir, e opcionalmente qual delas deve ser a mestre
- **Saída:** a Pessoa mestre da família resultante, a regra que a escolheu, e quantas Pessoas foram reapontadas
- **Regras:** mesclar é **apontar**, não mover. A absorvida mantém Identificadores e Atribuições de Nome e passa a apontar para a mestre; nada é copiado e nada é movido. **Receber uma Pessoa absorvida resolve para a mestre dela** — a família é a Pessoa. A escolha da mestre segue três regras, nesta ordem: indicação explícita, preferência de catálogo, e ordem de chamada; a regra que valeu é registrada no ato. Se a Pessoa que perde o posto já era mestre de outras, todas são **reapontadas** para a mestre que prevalece, e o registro de quem as absorveu diretamente **não muda**. Recusa mesclar consigo mesma. Nunca escreve em Mensagem, Conversa ou Anexo.
- **Não-funcionais:** Padrão.

### desfazer-mesclagem

- **Ator:** humano ou agente
- **Entrada:** Inquilino, Pessoa absorvida
- **Saída:** a Pessoa deixa de pertencer à família
- **Regras:** remove o apontamento de mestre, devolvendo a Pessoa ao estado de raiz com tudo que ela sempre teve — nada precisa ser reconstruído, porque nada foi movido. As Pessoas que ela absorvia diretamente voltam a apontar para ela, pelo registro imutável de absorvedor direto. Desfazer **não apaga** o histórico de que a mesclagem aconteceu.
- **Não-funcionais:** Padrão.

### listar-propostas-de-identidade

- **Ator:** humano ou agente
- **Entrada:** Inquilino, opcionalmente o produtor
- **Saída:** conjuntos de Identificadores que parecem ser a mesma Pessoa, cada um com o produtor que o gerou e a evidência concreta
- **Regras:** **não escreve nada**, e a garantia é estrutural — o Acervo é aberto em modo que recusa gravação, não por disciplina de quem escreveu o código. As Propostas são recalculadas a cada chamada contra o estado atual, então conjunto já resolvido não aparece. Onde dois produtores apontam para o mesmo conjunto, sai **uma** Proposta, declarando a evidência mais forte.
- **Não-funcionais:** Padrão.

### aplicar-proposta

- **Ator:** humano ou agente
- **Entrada:** Inquilino, o conjunto de Identificadores
- **Saída:** o que foi feito — o vínculo de cada Identificador e o ato de cada mesclagem —, ou a recusa com a causa
- **Regras:** vincula com Procedência de catálogo os Identificadores sem Pessoa, e **mescla** as Pessoas distintas pela operação de mesclar, sem indicar mestre — é a preferência de catálogo que decide. **Recusa quando há mais de uma Pessoa e alguma delas tem vínculo humano em qualquer lugar da própria família:** fundir o que uma pessoa construiu é decisão de gente, e a verificação é da família, não dos membros da Proposta. Com uma Pessoa só em jogo não há conflito. É atômica: ou faz tudo, ou não faz nada e diz por quê.
- **Não-funcionais:** Padrão.

### aplicar-propostas-em-lote

- **Ator:** humano ou agente
- **Entrada:** Inquilino, opcionalmente o produtor
- **Saída:** quantas entraram, quantos vínculos, quantas mesclagens, quantas foram preservadas ou recusadas e por quê — e a **lista do que foi feito**
- **Regras:** **o ensaio sem efeito é o padrão**; escrever exige pedido explícito. É **atômico por Proposta, nunca por lote**: uma recusa não aborta as demais. As duas naturezas — vínculo e mesclagem — são contadas separadamente, porque desfazer cada uma tem caminho próprio. **A lista devolvida é o que torna o lote reversível**, e não existe operação que desfaça um lote sem ela: não há registro de lote, e o identificador de operação que permitiria isso é de outro ciclo.
- **Não-funcionais:** Padrão.

### conferir-integridade-de-mesclagem

- **Ator:** humano ou agente
- **Entrada:** Inquilino
- **Saída:** as Pessoas cujo apontamento de mestre não leva a uma raiz
- **Regras:** só leitura. Existe **apesar** das guardas de escrita, não no lugar delas: guarda protege o caminho que conhece, e o inventário de quem escreve pode estar incompleto — remoção de Pessoa, recriação de Acervo, caminho novo que ninguém lembrou. Detector nasce junto da denormalização, não depois dela, e é o alarme que revela o que o inventário não previu. Devolve vazio quando o invariante vale.
- **Não-funcionais:** Padrão.

### listar-conversas-sem-endereco

- **Ator:** humano
- **Entrada:** Inquilino, limite opcional
- **Saída:** os endereços ainda sem Pessoa, do que mais cobre para o que menos, com quantas Conversas e quantas Mensagens o vínculo passa a cobrir, e o nome que o material deu ao endereço
- **Regras:** a linha é o **endereço**, não a Conversa: é o endereço que se liga, e o mesmo endereço em várias Conversas cobre todas de uma vez. O endereço do próprio Titular aparece, em geral primeiro; ligá-lo uma vez o remove.
- **Não-funcionais:** só leitura.

### definir-politica-de-retencao

- **Ator:** humano
- **Entrada:** Inquilino, mais critérios de retenção (idade, tipo de Anexo, natureza da Conversa, teto de espaço)
- **Saída:** política gravada, mais a projeção do que ela faria se aplicada agora
- **Regras:** definir política nunca aplica política. A projeção é obrigatória e mostra quantos Anexos e quantos bytes seriam afetados, por critério.
- **Não-funcionais:** Padrão.

### aplicar-politica-de-retencao

- **Ator:** humano ou sistema agendado
- **Entrada:** Inquilino, política definida, modo de execução
- **Saída:** Anexos transitados de estado, bytes liberados, relatório do que foi feito
- **Regras:** só transita Presença de Anexo. Nunca toca Mensagem, Conversa ou Pessoa. Ensaio sem efeito é o modo padrão; execução com efeito é explícita. Cada transição registra a política e a data.
- **Não-funcionais:** idempotente — reexecutar não muda mais nada. Reversível apenas no registro, não no arquivo: o descarte do blob é definitivo e a operação diz isso antes de executar.

### relatar-acervo

- **Ator:** humano ou agente
- **Entrada:** Inquilino, recorte opcional
- **Saída:** tamanho do Acervo por Fonte, por tipo de Anexo, por natureza de Conversa e por faixa de idade; espaço livre no destino; projeção de crescimento. O operador da instalação obtém o consolidado por Inquilino — contagens e bytes, nunca conteúdo
- **Regras:** é a operação que torna o problema de espaço visível antes de virar incidente. Reporta o que está no disco e o que o Acervo diz que deveria estar — divergência entre os dois é achado, não erro de arredondamento.
- **Não-funcionais:** só leitura.

### migrar-acervo

- **Ator:** humano ou agente, por comando explícito; ou o próprio produto, ao abrir o Acervo para escrita
- **Entrada:** o Inquilino cujo Acervo se migra
- **Saída:** a forma de origem, a de destino, e cada passo aplicado com o resultado da conferência
- **Regras:** os passos são declarados, ordenados e idempotentes, e a máquina recusa arrancar se houver buraco na sequência. A execução é atômica: falha em qualquer passo deixa o Acervo íntegro na forma de **origem**, nunca numa forma intermediária. A conferência compara a contagem de cada tabela antes e depois e **reprova** divergência que o passo não declarou; a verificação de integridade referencial compara contra a linha de base tomada antes, para que dano herdado não aborte migração que não o causou. Passo que exija ação sobre os arquivos grava a pendência na mesma transação do banco, e Acervo com pendência em aberto não abre. Abaixo do piso de migração a operação recusa, e a saída é recriar. **Consulta nunca migra:** a abertura somente-leitura recusa forma divergente e manda migrar
- **Não-funcionais:** grava Operação na trilha, uma por execução, com um efeito por passo. Declarada irreversível: desfazer uma migração seria outro passo, escrito de propósito


### declarar-pasta-de-entrada

- **Ator:** humano
- **Entrada:** Configuração de Adaptador, caminho de diretório local, Natureza do Material (completo ou parcial), e o Nome do Titular na Fonte quando a Fonte exigir. A subpasta `processados/` é derivada do caminho declarado, não configurável — um caminho a menos para errar.
- **Saída:** a declaração gravada na Configuração
- **Regras:** o produto não valida se o caminho existe no momento da declaração — pasta ausente é condição de execução da varredura, não erro de configuração, pela mesma razão que Destino de Mídia fora do ar não muda a Presença de um Anexo. Declarar de novo substitui.
- **Não-funcionais:** Padrão

### varrer-pastas-de-entrada

- **Ator:** agente ou sistema — é a operação feita para rodar sozinha
- **Entrada:** Inquilino; opcionalmente uma Configuração, para varrer só ela
- **Saída:** por Configuração — o que foi reconhecido como novo, o que foi processado, o que já estava registrado, e o que foi recusado com o motivo
- **Regras:** para cada Configuração com Pasta de Entrada declarada, reconhece o material ainda não registrado pela Impressão de Material e chama a importação daquela Fonte. **Não busca material, não autentica em serviço nenhum, não decide identidade.** Pasta inexistente ou ilegível é relatada por Configuração e não interrompe as demais — uma Fonte indisponível não pode impedir as outras de entrarem.
- **Regras (complemento):** material processado **sai da Pasta de Entrada para `processados/`**, na mesma passada. É a mudança de lugar que responde *"já processei este arquivo?"* — o que está na Pasta de Entrada é, por definição, o que falta. **O produto nunca apaga o que moveu:** limpar `processados/` é de quem instala, fora do produto. Decisão do Titular em 11/09/2026.
- **Por que não por assinatura:** a Impressão de Material responde *"é o mesmo lote?"* para material **grande e multi-arquivo**, e o invariante a mantém longe do conteúdo por custo. Para um catálogo de arquivo único ela erra nos dois sentidos — **medido em 11/09/2026: trocar um dígito de telefone preserva o tamanho em bytes** (2.163.448 nos dois lados), e o arquivo seria pulado em silêncio; e um transporte que datar o nome reimportaria sempre. Mover o arquivo dissolve a pergunta em vez de responder melhor, e **o invariante da Impressão fica intacto, sem exceção**.
- **Não-funcionais:** idempotência é requisito de aceite, não padrão implícito — é a operação que roda sem ninguém olhando, e reprocessar não pode duplicar. Arquivo que volte à Pasta de Entrada é reprocessado: para catálogo isso é a reconciliação rodando de novo, e para os demais a idempotência absorve.

### marcar-ausentes-do-catalogo

- **Ator:** sistema — decorre da importação de um catálogo, não é invocada à parte
- **Entrada:** a Configuração de catálogo e o Material completo recém-processado
- **Saída:** quantos Cartões de Contato daquela Configuração deixaram de aparecer, e quais
- **Regras:** **só roda quando a Natureza do Material daquela Configuração é completa.** Marca; não remove Cartão, não desfaz vínculo, não apaga Atribuição de Nome, não mexe em Pessoa. O que foi marcado continua legível e volta a ficar presente se reaparecer num material seguinte.
- **Não-funcionais:** Padrão

## Relações com outros contextos

Nenhuma. Contexto único.

## Fora do domínio

- **Enviar mensagem.** O malote lê, guarda e cruza. Não é cliente de mensageria.
- **Alterar ou apagar conteúdo na Fonte de origem.**
- **Interpretar conteúdo** — resumo, classificação, análise de sentimento. O malote entrega o material; quem interpreta é o agente que consulta.
- **Autenticação e sessão das plataformas de origem** — é responsabilidade do Adaptador, não do núcleo.
- **Backup do Acervo.** É operação de infraestrutura de quem instala.
- **Gestão de usuários humanos** — cadastro, senha, sessão de navegador. O acesso por rede é por Chave, não por login.
- **Cobrança e planos.** Multi-inquilino aqui é isolamento de dado, não modelo comercial.

## Modelado, não construído

- **Separação de uma Pessoa em duas** como operação de usuário. Mesclar existe desde o ciclo 3; desfazer uma mesclagem não está fatiado. A Pessoa absorvida permanece com o próprio histórico justamente para que isso seja possível depois.
- **Rebaixamento de Anexo** (transcodificar vídeo em vez de descartar). Depende da política de retenção escolhida. Enquanto nenhuma operação o produzir, *rebaixado* **não** é estado de Presença.
- **Deduplicação de Anexo por impressão de conteúdo.** O Descritor já prevê o campo. A economia real não foi medida.
- **Camadas de armazenamento** (Acervo frio em disco externo ou remoto). O invariante de que o núcleo decide a localização é o que torna isso possível sem tocar Adaptador.
- **Fontes além das três do v1** — LinkedIn, e-mail. Nenhuma exige mudança de agregado; cada uma é um Adaptador.
- **Escopo de Chave de Acesso além de leitura.** O v1 emite Chave só-leitura; escrita por rede não está fatiada.
- **Migração de arquivos entre Destinos de Mídia.** Configurar Destino não move arquivo; mover é operação à parte.
- **Marca do Titular do tipo `arquivada`.** Chega no mesmo retrato que a fixação — foi medida na chave, não no valor —, e nenhuma consulta a pede hoje. O tipo já está no modelo para que aceitá-la depois não mexa em agregado.
- **Silenciar Conversa.** Chave `muteEndTime` observada pela primeira vez em 13/09/2026, num
  evento de sete itens. É conceito que o modelo não tem, e nenhuma consulta o pede. Fica
  registrado para não ser descoberto como surpresa por quem for processar o Retrato.
- **Fixação de Conversa pelo Retrato do receptor** — o caminho que o modelo dava como
  disponível, e que a medição de 13/09/2026 mostrou **bloqueado neste vínculo**. Os atos do
  Titular produziram mutação, e o dispositivo tentou ressincronizar quatro vezes em onze
  segundos; as quatro falharam por **falta da chave que decodifica a mutação** — 3 chaves de
  app-state no vínculo, contra 246 de um vínculo maduro.

  **DESBLOQUEADO no mesmo dia, e o caminho está medido.** As chaves foram copiadas de vínculos
  preservados e do coletor anterior — o material da chave é **da conta**, não do dispositivo
  (`keyData` idêntico em 246 de 246 entre dois pareamentos). Depois disso o Retrato decodificou:
  `restored state ... from snapshot to v282`, com **2.676 Conversas**, e o mecanismo das duas
  portas apareceu no dado real — o Retrato substitui o conjunto, a atualização de um item o
  ajusta. **Não houve repareamento.**
- **Fixação de Conversa a partir de material exportado.** O backup do WhatsApp a guarda num campo de bits não decifrado. Decifrar exige um material tirado **depois** de alguém fixar alguma coisa: no acervo do Titular, no instante do backup de 05/09/2026, havia **zero** Conversas fixadas — não há o que comparar. Enquanto isso, o único caminho é o retrato do receptor, que é o caminho que **não** serve para quem não mantém receptor no ar.

## Premissas

- **Nota de 11/09/2026:** `importar-catalogo-de-identidade` e `propor-vinculo-por-catalogo` existiam no produto desde o ciclo 7 e **nunca tinham entrado neste modelo**. Foram acrescentadas agora, ao modelar o ciclo 16 — a lacuna apareceu porque o ciclo 16 as toca, não porque alguém auditou o modelo.
- **Assumido, a confirmar no gate:** que uma Configuração tem **uma** Pasta de Entrada. O modelo já admite Material espalhado por mais de uma pasta dentro do mesmo lote (medido no Instagram), mas não duas pastas de entrada distintas para a mesma conta.
- **Assumido:** que a Natureza do Material é estável por Configuração. Se um dia a mesma conta emitir ora completo, ora parcial, a declaração passa a ser por Material e este invariante muda. **Revisto em 12/09/2026:** vale para material; na recepção contínua a Natureza é do **evento**, porque a mesma Configuração entrega retrato e atualização.
- **Assumido, a confirmar no gate:** que a Autoridade tem **dois** valores e não três. Plataforma que preenche o nome com o próprio endereço seria um terceiro caso, e ele é resolvido antes, pelo invariante que recusa nome que repete o endereço — sem precisar de valor novo.
- **Assumido, a confirmar no gate:** que Marca do Titular é objeto de valor pendurado, e não entidade própria com histórico. O modelo guarda o estado corrente com data e procedência; *quando foi desfavoritada* não é pergunta que alguém tenha feito.

  **A segunda metade desta premissa CAIU em 13/09/2026.** Ela dizia que nenhuma Fonte medida
  entrega o evento de desmarcação. O caminho ao vivo entrega: medidos **210 eventos** de
  favorito numa única janela, e **145 deles desmarcam**. O material continua não entregando —
  ele dá o estado, não a transição. A decisão de guardar só o estado corrente **permanece**,
  porque continua sendo o que alguém pergunta; o que mudou é que agora ela é escolha, e não
  limitação da Fonte.

Nenhuma em aberto. Todas foram resolvidas no gate de 24/08/2026.

Decidido em 24/08/2026: o núcleo, não o Adaptador, decide o layout de arquivo sob o Destino de Mídia — é o que remove dado pessoal do caminho de arquivo; o produto não protege o conteúdo contra o Operador da instalação, e quem precisa disso roda a própria; Inquilino é o termo canônico do mundo isolado, e é normalmente uma pessoa — as duas contas de WhatsApp do acervo privado são um Inquilino com dois Adaptadores; Destino de Mídia é configurável por Inquilino, local ou remoto; Chave de Acesso é por Inquilino, revogável e só-leitura no v1; Presença de Anexo tem três estados, sem rebaixamento no v1; a instalação tem Chave de Operador, criada antes do primeiro Inquilino; a precedência entre as fontes de nome é declarada pelo usuário; Conversa direta e coletiva são o mesmo agregado, com Participação registrada sem data inferida (revisto em 26/08/2026 — ver ADR `20260826-participacao-sem-historico-em-material-exportado`); instante implausível é rejeitado na entrada; o Acervo pertence à Pessoa e contas de plataforma são Configurações de Adaptador dentro dele.

## Postura de confidencialidade

Decidido em 24/08/2026: **o malote não protege o conteúdo contra o Operador da instalação.** O Operador não lê diretamente, mas pode emitir Chave de Acesso para qualquer Inquilino e ler por ela; o que existe é rastro, não impossibilidade.

A resposta do produto a quem não aceita isso não é criptografia — é **rodar a própria instalação**. Quem é o Operador é quem é o dono do dado.

Consequências que o modelo assume por causa disso:

- Toda emissão e toda revogação de Chave de Acesso é registrada de forma imutável.
- **O Titular lista as Chaves de Acesso do seu Inquilino e o histórico de emissão delas.** Sem isso a auditoria só serve a quem já tem o poder, e a garantia vira nominal.
- O produto não promete confidencialidade contra o Operador em nenhuma superfície — documentação, README e mensagem de erro incluídos. Prometer o que não se cumpre é pior que não oferecer.

### reprocessar-derrame

- **Ator:** humano ou agente, por comando explícito
- **Entrada:** Inquilino, conta, e a Configuração de Adaptador sob a qual gravar
- **Saída:** quantos lotes entraram e quantas Mensagens foram gravadas; e o Derrame esvaziado, ou intacto
- **Regras:** só descarta o arquivo depois de reprocessar **tudo** — descartar parcial perderia exatamente o que o Derrame existe para não perder. A Configuração é **exigida e nunca criada**: o evento derramado pertence à conta que o recebeu. **Recusa enquanto houver receptor no ar**, porque os dois escrevem no mesmo arquivo e o que for derramado entre a leitura e o descarte some sem ter sido gravado — recurso com estado exclusivo tem um dono por vez
- **Não-funcionais:** existe apesar da drenagem automática, e não em vez dela: Derrame antigo, drenagem desligada ou dúvida do operador continuam pedindo o ato explícito

### listar-operacoes
- **Ator:** humano ou agente
- **Entrada:** Inquilino
- **Saída:** as Operações do Inquilino, da mais recente à mais antiga, com quantas linhas cada uma tem e se já foi desfeita
- **Regras:** lê as duas Trilhas em modo somente-leitura e apresenta uma linha do tempo só; Operação de instalação, que não é de Inquilino nenhum, não aparece aqui
- **Não-funcionais:** Padrão

### ver-operacao
- **Ator:** humano ou agente
- **Entrada:** identificador da Operação
- **Saída:** o efeito linha a linha, com valor anterior e posterior legíveis
- **Regras:** somente leitura
- **Não-funcionais:** Padrão

### desfazer-operacao
- **Ator:** humano ou agente
- **Entrada:** identificador da Operação
- **Saída:** a Operação nova que a desfez, quantas linhas reverteram e quais recusaram, com a causa de cada uma
- **Regras:** ensaio sem efeito é o padrão; reverte pelas portas do núcleo, nunca por escrita direta; recusa com a causa nomeada quando a Operação já foi desfeita, é irreversível, ou é decisão de configuração — que se desfaz redefinindo; item a item, e uma recusa não aborta as demais
- **Não-funcionais:** Padrão

### definir-precedencia-de-nome
- **Ator:** humano
- **Entrada:** Inquilino, origem, peso
- **Saída:** a precedência gravada
- **Regras:** vale por Inquilino e muda o nome exibido sem escrever no Acervo
- **Não-funcionais:** Padrão

### declarar-catalogo-preferido
- **Ator:** humano
- **Entrada:** Inquilino, a Configuração de catálogo preferida
- **Saída:** a preferência gravada
- **Regras:** é o **segundo nível** da precedência, e só desempata **dentro da mesma
  origem** — nunca atravessa Fontes. Declarar um catálogo preferido não pode fazer nome de
  catálogo perder para nome de plataforma. Sem declaração, catálogos empatados desempatam por
  recência, que é o comportamento de sempre. Vale por Inquilino e muda o nome exibido sem
  escrever no Acervo, como a precedência por origem.
- **Não-funcionais:** Padrão

### definir-intervalo-esperado
- **Ator:** humano
- **Entrada:** Configuração de Adaptador, dias
- **Saída:** o intervalo gravado
- **Regras:** é o que torna possível dizer que um Material está atrasado
- **Não-funcionais:** Padrão

### resolver-configuracao
- **Ator:** humano, via `importar`, `entrada declarar` ou `configuracao criar`
- **Entrada:** Inquilino, Fonte, apelido
- **Saída:** a Configuração de Adaptador correspondente — criada se não existia, devolvida se já existia
- **Regras:** idempotente por `(Inquilino, Fonte, apelido)`. Não cria conta nem grava nada além da própria Configuração; declarar a conta é operação separada (`definir-conta`).
- **Não-funcionais:** Padrão

### definir-conta
- **Ator:** humano, via `importar` ou `configuracao criar`, quando `--conta` é informado
- **Entrada:** a Configuração de Adaptador (por id), o nome da conta na Fonte
- **Saída:** a Configuração atualizada com a conta declarada
- **Regras:** opcional — uma Configuração pode existir sem conta declarada (`configuracao listar` mostra `(nao declarada)`). Sobrescreve o valor anterior, sem histórico.
- **Não-funcionais:** Padrão
