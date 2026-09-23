---
id: 202608240950
projeto: malote
tipo: referencia
descricao: "Linguagem universal do malote — termos do arquivo multi-inquilino de conversas, com sinônimos a evitar"
status: aprovado
aprovado-em: 2026-09-23
escopo: repo:malote
plataforma: "*"
tags: [glossario, malote, linguagem-universal, ddd]
---

# Malote

Arquivo das conversas de uma pessoa, reunidas de plataformas diferentes num formato que humano e agente consultam. Uma instalação serve vários Inquilinos isolados. Este glossário fixa os termos do núcleo — nenhum deles nomeia uma plataforma.

## Vocabulário

### Isolamento

**Inquilino**:
Um mundo isolado dentro da instalação — normalmente uma pessoa, possivelmente uma organização — dono de exatamente um Acervo.
*Evitar*: tenant, mundo, conta, workspace, organização, perfil.

**Titular**:
A Pessoa a quem o Acervo de um Inquilino pertence. **Sempre do Inquilino** — nunca de uma
Fonte, nunca de um material.
*Evitar*: dono, owner, usuário principal, e **usar "titular" sozinho para o nome que a Fonte
dá ao Titular dentro do material** — esse é o *Nome do Titular na Fonte*, abaixo.

**Nome do Titular na Fonte**:
O nome pelo qual uma Fonte chama o Titular **dentro do material exportado** — no Instagram, o
nome de exibição que aparece na lista de participantes de cada conversa. É o que permite ao
Adaptador saber qual dos participantes é "eu". Vive na Configuração de Adaptador, porque
varia por conta: a mesma pessoa tem *Nome Civil* numa conta e *Apelido Público* em
outra. **Não é o Titular, não é o apelido da Configuração e não é o handle da plataforma** —
medido em 11/09/2026, o apelido da conta passado onde se espera este valor recusa
todas as conversas.
*Evitar*: titular, self, eu, me, dono da conta, handle.

**Configuração de Adaptador**:
Uma conta de plataforma que alimenta o Acervo de um Inquilino. Identificada por
`(Inquilino, Fonte, apelido)`, e **o apelido é informado por quem instala, nunca capturado do
material** — é ele que distingue duas contas da mesma Fonte (`contatos/google` e
`contatos/icloud`). Carrega também, quando a Fonte exige, o *Nome do Titular na Fonte*, a
*Pasta de Entrada* e a *Natureza do Material*.
*Evitar*: conta, account, instância, credencial, e **handle** — que é exatamente o apelido, e
ter dois nomes para o mesmo campo foi o que gerou a dúvida de 11/09/2026.

**Destino de Mídia**:
Onde os arquivos de Anexo de um Inquilino ficam — um caminho de sistema de arquivos, configurado por Inquilino. Caminho montado por rede é atendido como qualquer outro; transporte remoto próprio ficou fora do v1 (28/08/2026).
*Evitar*: storage, bucket, pasta de mídia, backend, volume.

**Chave de Acesso**:
Credencial que identifica e autoriza acesso por rede a exatamente um Inquilino.
*Evitar*: token, API key, senha, credencial.

**Chave de Operador**:
Credencial de quem administra a instalação, sem vínculo com Inquilino nenhum e sem alcance ao conteúdo dos Acervos.
*Evitar*: chave mestra, chave root, superchave, admin key.

**Operador**:
Quem administra a instalação — cria Inquilino, emite e revoga Chave de Acesso — autenticado por Chave de Operador.
*Evitar*: admin, root, sysadmin.

### Núcleo

**Acervo**:
O conjunto completo do que um Inquilino guarda — Conversas, Mensagens, Pessoas e Anexos.
*Evitar*: banco, base, brain, arquivo (no sentido de coleção).

**Conversa**:
Fio de Mensagens entre um conjunto de Pessoas.
*Evitar*: chat, thread, sala, grupo (grupo é uma Conversa com mais de duas Participações).

**Mensagem**:
Unidade de conteúdo enviada por uma Pessoa dentro de uma Conversa, num instante conhecido.
*Evitar*: msg, registro, evento.

**Direção da Mensagem**:
Se a Mensagem foi enviada pelo Titular ou recebida de outra Pessoa —
independente do autor estar resolvido. Gravada por cada Adaptador no momento
da escrita, nunca inferida depois pela ausência de autor.
*Evitar*: fromMe, direction, sentido, isFromMe.

**Participação**:
A presença de uma Pessoa numa Conversa, com início e fim quando a Fonte os informa, e com o instante em que o malote a observou.
*Evitar*: membro, participante (é o papel, não o vínculo), roster.

**Transição de Participação**:
Um evento datado, declarado pela Fonte, que afirma que alguém entrou ou saiu de uma Conversa. Nunca nasce da comparação entre dois retratos de participantes.
*Evitar*: evento de grupo, entrada/saída, movimentação, log de membros.

**Alcance**:
A janela de tempo em que uma Conversa tem evento declarado. Fora dela o produto não sabe — e Conversa sem evento algum não tem Alcance.
*Evitar*: cobertura, janela, período, range, histórico disponível.

**Pessoa**:
Quem conversa — uma só entidade, ainda que apareça em várias plataformas.
*Evitar*: contato, usuário, perfil, autor.

**Identificador**:
O endereço de uma Pessoa numa Fonte — número, apelido de perfil, e-mail, código interno da plataforma.
*Evitar*: jid, lid, handle, telefone, número, endereço.

**Atribuição de Nome**:
Um nome vindo de uma origem, com data e Autoridade, pendurado num Identificador ou numa Pessoa.
Nome que apenas repete o próprio endereço não é Atribuição de Nome — a plataforma que preenche
o campo com o número de telefone não nomeou ninguém.
*Evitar*: apelido, label, display name, alias.

**Autoridade da Atribuição**:
Quem afirmou o nome: `titular`, quando quem é dono da conta o cadastrou, e `terceiro`, quando o
dono do endereço o escolheu para si. Desempata **dentro da mesma Fonte**, como o Catálogo
Preferido, e pela mesma razão nunca atravessa Fontes. Declarada pelo Adaptador.
*Evitar*: confiança, peso, prioridade, fonte do nome.

**Marca do Titular**:
Uma afirmação do dono da conta sobre um objeto do Acervo, com tipo, procedência e data,
pendurada numa Mensagem ou numa Conversa. Tipos: `favorito` em Mensagem; `fixada` e `arquivada`
em Conversa. É a única curadoria humana que as Fontes entregam.
*Evitar*: flag, estrela, star, pin, favorito do sistema.

**Retrato de Estado**:
O quadro completo de um estado que a plataforma reenvia de tempos em tempos na recepção
contínua — em oposição à **atualização**, que fala de um objeto só. Só o Retrato autoriza
concluir ausência; a atualização diz apenas que aquele objeto mudou. É a Natureza do Material
aplicada ao que chega ao vivo, e é o mesmo raciocínio que já separa o **retrato de
Participação** da **Transição**: quadro de um instante nunca é evento.
*Evitar*: sync, snapshot, carga inicial, full load.

**Mesclagem**:
O ato de declarar que duas Pessoas são a mesma. Não move nem copia nada: a absorvida passa a apontar para a mestre e mantém tudo que tinha.
*Evitar*: fusão, merge, unificação, deduplicação.

**Operação**:
Um ato de decisão registrado — o que se fez, quando, sobre qual Inquilino, e o efeito linha a linha. É a unidade da trilha: um comando grava uma Operação, ainda que escreva várias linhas.
*Evitar*: log, evento, transação, auditoria, ação.

**Linha de Efeito**:
O que uma Operação mudou, em uma de duas naturezas: a **diferença de valor** de um campo, ou a **referência** a uma trilha que já existe. Nunca as duas.
*Evitar*: diff, changeset, delta, patch.

**Trilha**:
O conjunto de Operações de uma base. São duas, uma por base: a do Acervo, com identidade e retenção, e a do Registro, com instalação e configuração. Nenhuma consulta atravessa Inquilino.
*Evitar*: log, histórico, auditoria, journal.

**Pessoa mestre**:
A Pessoa que representa uma família de Pessoas mescladas. Toda absorvida aponta direto para ela, em um salto; entre duas candidatas prevalece a que tem Identificador da Fonte de catálogo.
*Evitar*: sobrevivente, principal, canônica, primária.

**Absorvedor direto**:
Quem absorveu uma Pessoa **naquele ato**, gravado no momento da mesclagem e nunca reescrito — distinto da mestre, que é conclusão corrente e muda quando famílias se juntam.
*Evitar*: pai, origem, anterior.

**Procedência do Vínculo**:
Quem afirmou que um Identificador pertence a uma Pessoa — material, catálogo ou humano.
*Evitar*: origem, fonte, source (a **Fonte** é a plataforma), confiança, score.

**Anexo**:
Arquivo que acompanha uma Mensagem.
*Evitar*: mídia, attachment, blob, arquivo (isolado).

**Descritor**:
O que se sabe sobre um Anexo — tipo, tamanho, nome original, duração, impressão de conteúdo — independente de o arquivo estar em disco.
*Evitar*: metadados, header.

**Presença**:
O estado de um Anexo em disco: presente, nunca obtido ou descartado.
*Evitar*: status, disponibilidade, existe.

**Metadados de Coletiva**:
Assunto, descrição e imagem de uma Conversa coletiva, com quem alterou e quando.
*Evitar*: metadados de grupo, subject, tópico, nome do grupo.

### Fontes e integração

**Fonte**:
A plataforma de origem de uma Conversa ou de um Identificador.
*Evitar*: origem, provider, canal, source.

**Adaptador**:
O código que traduz uma Fonte para o núcleo e é dono das suas próprias estruturas de apoio.
*Evitar*: conector, importador, plugin, driver, integração.

**Referência Externa**:
O que amarra uma Conversa ou Mensagem ao que ela é lá fora. Na Mensagem e na Conversa coletiva, é o par Fonte mais identificador na origem. Na Conversa **direta**, entra também a Configuração de Adaptador: duas contas do Titular que falam com o mesmo endereço têm dois fios, e não um.
*Evitar*: id externo, chave natural, id original.

**Conteúdo Bruto**:
O registro original que a Fonte entregou, guardado inteiro ao lado do que o núcleo modelou — Mensagem, Conversa, Participação e Anexo o carregam.
*Evitar*: payload, raw, json cru, dump.

**Estado de Sincronização**:
O que um Adaptador precisa lembrar entre execuções para retomar de onde parou.
*Evitar*: cursor, checkpoint, sync token, sync_state.

**Material**:
Um lote exportado por uma Fonte, processado de uma vez. É a unidade que o Estado de Sincronização registra.
*Evitar*: export, dump, arquivo, backup, batch.

**Impressão de Material**:
A cadeia que identifica um Material pelo seu conteúdo, derivada de nome e tamanho dos arquivos — nunca do caminho, que muda de máquina, e sem abrir nenhum arquivo.
*Evitar*: hash, fingerprint, digest, checksum.

**Impressão de Anexo**:
A cadeia que identifica o conteúdo de **um arquivo**, calculada quando ele entra no Destino de Mídia.
*Evitar*: hash, fingerprint, digest, checksum.

As duas respondem *"é o mesmo?"* sobre coisas de tamanhos diferentes — um lote e um arquivo — e nenhuma substitui a outra. **Impressão** sozinha é ambígua a partir do ciclo 5: qualificar sempre.

**Pasta de Entrada**:
O diretório do disco local onde uma Configuração de Adaptador espera encontrar material novo.
O produto **consulta**; não busca, não baixa, não autentica. Como o material chega até ali
(Drive, e-mail, OneDrive, cópia à mão) varia por quem instala e **fica fora do produto** —
decisão do Titular em 11/09/2026. **O que já entrou sai da Pasta de Entrada para a subpasta
`processados/`**, e é essa mudança de lugar que responde *"já processei este arquivo?"* — não
uma assinatura, não um arquivo de controle. O que está na Pasta de Entrada é, por definição, o
que falta. **O produto nunca apaga** o que moveu; limpar `processados/` é decisão de quem
instala, fora do produto.
*Evitar*: watch folder, inbox, dropbox, fila.

**Natureza do Material**:
Se aquele material é **completo** — retrato inteiro da origem naquele instante — ou
**parcial**, trazendo só o que mudou. Declarada por Configuração de Adaptador, porque é
propriedade da Fonte e não do arquivo: o export do Instagram é parcial (medido em 26/08/2026)
e o vCard de um catálogo é completo. **É o que decide se ausência significa alguma coisa**:
em material completo, o que não veio sumiu na origem; em material parcial, o que não veio
apenas não mudou.
*Evitar*: full, incremental, delta, snapshot.

**Catálogo Preferido**:
A Configuração de catálogo de contatos que prevalece quando duas dão nomes diferentes ao mesmo
Identificador. É **desempate dentro da Fonte**, nunca passe livre: não faz nome de catálogo
vencer nome de origem mais alta. Declarado por Inquilino; sem declaração, o desempate é por
recência.
*Evitar*: catálogo mestre, catálogo principal, fonte da verdade.

**Marca de Ausência**:
O registro de que um Cartão de Contato deixou de aparecer no material completo daquela
Configuração. **Marca, nunca remove** — o registro continua disponível e a reconciliação é
ato humano, como mesclar. Só existe para material de Natureza completa.
*Evitar*: deleção, remoção, soft delete, tombstone, expiração.

**Cartão de Contato**:
Uma entrada do catálogo de contatos: um nome e os endereços que a pessoa guardou para alguém. **Pertence a exatamente uma Configuração de Adaptador** — sem isso, "o Google não tem mais esse número" é indistinguível de "o iCloud nunca teve". É o **laço** que diz que dois telefones são da mesma pessoa — a única Fonte que sabe isso.
*Evitar*: contato, vCard, card, registro.

**Proposta**:
A afirmação de que um conjunto de Identificadores é a mesma Pessoa, com a evidência que a sustenta. **É calculada a cada listagem, nunca armazenada** — por isso não existe Proposta obsoleta, e um par já resolvido simplesmente deixa de aparecer.
*Evitar*: sugestão, candidato, match, palpite, merge suggestion.

**Produtor de Proposta**:
A regra que gera Propostas de um tipo — por telefone, por nome ou por múltiplos endereços do mesmo Cartão de Contato. Cada Proposta declara qual a gerou, e a ordem entre eles é a força da evidência: telefone é endereço, nome é coincidência de texto.
*Evitar*: matcher, estratégia, heurística, regra.

**Aplicar**:
Transformar uma Proposta em Acervo: vincular os Identificadores soltos e mesclar as Pessoas distintas. É sempre ato explícito, e o ensaio sem efeito é o padrão.
*Evitar*: confirmar, aceitar, commitar, resolver.

**Derrame**:
Os eventos que a recepção ao vivo recebeu e **não conseguiu gravar** porque o Acervo estava ocupado, guardados crus fora dele até caberem. Não é perda nem recusa: é dívida visível, com prazo — a **Drenagem** a paga sozinha na primeira escrita bem-sucedida seguinte.
*Evitar*: fila, buffer, cache, dead letter (as três primeiras sugerem mecanismo permanente de vazão, e ele é excepcional; a última sugere que o dado não volta, e ele volta).

**Drenagem**:
O ato de gravar no Acervo o que está no Derrame, de volta pelas portas normais. Acontece sozinha depois de uma escrita que funcionou — o sucesso é o sinal de que a disputa passou —, e consome uma parte por vez, para não virar a própria disputa que causou o Derrame.
*Evitar*: flush, retry, replay, reprocessamento automático.

### Espaço e retenção

**Política de Retenção**:
O conjunto de critérios que decide quais Anexos deixam de ocupar disco.
*Evitar*: limpeza, purge, expurgo, TTL, garbage collection.

**Descarte**:
A remoção do arquivo de um Anexo do disco, preservando o Descritor.
*Evitar*: deletar, apagar, remover (sugerem que o registro some, e ele não some).

## Relações

- Uma instalação hospeda N **Inquilinos**, isolados entre si.
- Um **Inquilino** tem exatamente 1 **Acervo**, 1 **Titular**, 1 **Destino de Mídia**, N **Configurações de Adaptador** e N **Chaves de Acesso**.
- Uma **Chave de Acesso** autoriza exatamente 1 **Inquilino**; uma **Chave de Operador** não autoriza **Inquilino** nenhum.
- Uma instalação tem 1..N **Chaves de Operador**, e nunca zero.
- Um **Operador** administra N **Inquilinos** e nunca lê o conteúdo do Acervo deles.
- Um **Acervo** contém N **Conversas**, N **Pessoas** e N **Anexos**.
- Uma **Conversa** tem 1 **Referência Externa** e N **Mensagens**.
- Uma **Conversa** direta tem exatamente 2 **Participações**; uma **Conversa** coletiva tem 0..N — as que a **Fonte** informar.
- Uma **Conversa** coletiva tem exatamente 1 **Metadados de Coletiva**; conversa direta não tem.
- Uma **Participação** liga exatamente 1 **Pessoa** a exatamente 1 **Conversa**.
- Uma **Mensagem** pertence a exatamente 1 **Conversa** e tem 0..N **Anexos**.
- Uma **Mensagem** tem 0..1 **Identificador** como autor.
- Uma **Mensagem** tem 0..1 **Marca do Titular**, do tipo `favorito`.
- Uma **Conversa** tem 0..N **Marcas do Titular**, dos tipos `fixada` e `arquivada`, no máximo uma de cada tipo.
- Uma **Pessoa** tem 0..N **Identificadores**, possivelmente de **Fontes** diferentes.
- Um **Identificador** pertence a 0..1 **Pessoa** e a exatamente 1 **Fonte**.
- Um **Anexo** tem exatamente 1 **Descritor** e exatamente 1 **Presença**.
- Uma **Operação** tem 0..N **Linhas de Efeito** e aponta para 0..1 **Operação** que ela desfaz.
- Uma **Operação** é desfeita no máximo uma vez.
- Uma **Fonte** é servida por 1..N **Adaptadores**; cada **Adaptador** tem 1 **Estado de Sincronização** por conta.
- Uma **Política de Retenção** produz N **Descartes** sobre **Anexos**.

## Diálogo de exemplo

> **Dev:** "Quando o usuário apaga a mídia antiga para liberar espaço, a **Mensagem** some da busca?"
>
> **Especialista de domínio:** "Não. O que sai do disco é o arquivo do **Anexo**. O **Descritor** fica, e a **Presença** passa a dizer *descartado*. A busca continua achando a **Mensagem** e mostra que ali houve um vídeo de 40 MB que não está mais guardado."
>
> **Dev:** "E se a pessoa aparece no WhatsApp e no Instagram? São duas **Pessoas**?"
>
> **Especialista:** "É uma **Pessoa** com dois **Identificadores**, um por **Fonte**. Enquanto ninguém vincula, são dois **Identificadores** sem **Pessoa** — o que é um estado válido, não um erro de importação."
>
> **Dev:** "A Leia tem duas contas de WhatsApp, uma pessoal e uma de trabalho. São dois **Inquilinos**?"
>
> **Especialista:** "Não. É um **Inquilino** com duas **Configurações de Adaptador**. A consulta dela atravessa as duas sem flag nenhuma. Dois **Inquilinos** seriam duas pessoas diferentes, e aí nada atravessa — nem com flag, nem com opção."
>
> **Dev:** "A **Chave de Operador** é uma **Chave de Acesso** com poder maior?"
>
> **Especialista:** "São coisas diferentes de propósito. **Chave de Acesso** sempre tem um **Inquilino**; **Chave de Operador** nunca tem. Se fossem a mesma coisa com um campo opcional, um defeito que apagasse esse campo viraria credencial de administração sem ninguém perceber."
>
> **Dev:** "Para entrar com o LinkedIn eu mexo em quê?"
>
> **Especialista:** "Escreve um **Adaptador**. Se você precisar alterar **Conversa**, **Mensagem** ou **Pessoa** para o LinkedIn caber, o desenho está errado."

## Ambiguidades sinalizadas

- **"grupo"** era ao mesmo tempo um tipo de **Conversa** e a coleção de participantes. Resolvido: grupo não é termo do núcleo. Existe **Conversa** — coletiva quando tem mais de duas **Participações** — e existe **Participação**.
- **"contato"** significava tanto a **Pessoa** quanto o registro vindo do catálogo externo. Resolvido: **Pessoa** é a entidade; o que o catálogo entrega é um conjunto de **Identificadores** e nomes, contribuído por um **Adaptador**.
- **"mídia"** era usado para o arquivo, para o registro do arquivo e para a pasta em disco. Resolvido: **Anexo** é a entidade, **Descritor** é o que se sabe sobre ele, e o arquivo é só o arquivo.
- **"apagar"** era usado para descarte de arquivo e para remoção de registro. Resolvido: **Descarte** afeta apenas o arquivo. Nenhuma operação do produto remove **Mensagem** ou **Conversa**.
- **"fonte"** aparecia como coluna marcando procedência e como a plataforma em si. Resolvido: **Fonte** é a plataforma; a marcação de procedência é a **Referência Externa**.
- **"procedência"** passou a ter dois usos. Resolvido: a marcação de onde veio a Conversa ou a Mensagem é a **Referência Externa**; quem afirmou o vínculo entre Identificador e Pessoa é a **Procedência do Vínculo**, sempre com o nome inteiro.
- **"nome"** era ao mesmo tempo o nome de uma pessoa e o nome que a plataforma dá a um endereço. Resolvido: os dois são **Atribuição de Nome**, e a âncora diz de quem é a afirmação — o material nomeia o **Identificador**, o humano nomeia a **Pessoa**.
- **"favorito"** era usado tanto para a Mensagem que o Titular marcou quanto para a Conversa que ele fixou no topo. São atos diferentes, em objetos diferentes: resolvidos como **Marca do Titular**, com o tipo dizendo qual — `favorito` só existe em Mensagem, `fixada` só em Conversa.
- **"o nome não veio"** era indistinguível de **"a plataforma mandou o número no lugar do nome"**. Resolvido pelo invariante que recusa nome que repete o próprio endereço: o que não nomeia ninguém não vira Atribuição.
- **"conta"** significava tanto o mundo isolado quanto a conta de plataforma. Resolvido: o mundo é **Inquilino**; a conta de plataforma é **Configuração de Adaptador**. Um **Inquilino** tem várias.
- **"local do arquivo"** confundia duas decisões distintas. Resolvido: o **Destino de Mídia** é onde a raiz fica e é do Inquilino; o layout dentro dela é do núcleo. Trocar um não mexe no outro.
- **"chave"** sozinha era ambígua entre a credencial de inquilino e a de administração. Resolvido: **Chave de Acesso** e **Chave de Operador** são agregados distintos, nunca o mesmo com um campo a mais.
- **"mundo"** e **"tenant"** foram usados na discussão para o mesmo conceito. Resolvido: o termo é **Inquilino** — escolha marcada para o gate.
