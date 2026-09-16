---
id: 202608260627
projeto: malote
tipo: decisao
status: aprovado
data: 2026-08-26
escopo: repo:malote
plataforma: "*"
dominios: [tecnologia]
descricao: "ADR — Participação não guarda data que a Fonte não forneceu; revisada em 28/08/2026, quando a medição desmentiu a premissa de que material exportado não traz entrada nem saída"
tags: [adr, decisao, participacao, conversa, adaptador, fidelidade-de-fonte]
---

# ADR — Participação não guarda data que a Fonte não forneceu

## Status

Aprovado — 2026-08-26. **Revisado em 2026-08-28 e em 2026-08-30**: a decisão permanece
em ambas; o que caiu foram premissas factuais, desmentidas por medição.

A revisão de 30/08 é a mais ampla: o material exportado declara **entrada**, e não só
saída — 8.310 eventos de entrada nos dois backups. A afirmação contrária orientou a
abertura do ciclo 9 e caiu no meio dele. O erro de método vale registrar: os oráculos
que estabeleceram a classificação dos códigos eram testes de **saída** ("ainda ativo
depois", "escreveu depois") e foram aplicados a todos os códigos; num código de entrada
eles medem outra coisa. O oráculo certo para entrada é *escreveu **antes***, e por ele
o código 15 dá 0,3% contra ~40% dos códigos de saída.

O que **não** muda: Participação continua sem guardar data que a Fonte não forneceu.
Quem guarda o evento datado é a Transição de Participação, agregado próprio.

## Contexto

O modelo de domínio nasceu declarando que **Participação registra quando começou**, e o argumento que sustentou a escolha do agregado único para Conversa direta e coletiva foi poder responder *"quem estava nesta Conversa em tal data"*.

Ao implementar o leitor de material exportado do WhatsApp, a premissa não se sustentou. O backup de dispositivo entrega, em `ZWAGROUPMEMBER`, quem está na Conversa coletiva **no momento do export** — endereço e papel de administrador. Não há data de entrada, não há data de saída, não há registro de quem já saiu.

> **Corrigido em 28/08/2026.** A frase acima vale para `ZWAGROUPMEMBER` e **não** vale para o material como um todo: a medição olhou a tabela de roster e generalizou para o formato. As mensagens administrativas de grupo carregam entrada e saída datadas. Ver *Revisão*.

Medições que sustentam a decisão, feitas em 26/08/2026 contra o acervo real:

- Conversas coletivas com algum participante conhecido: **343 de 1.365**. Grupo do qual o Titular saiu não traz membro algum.
- Conversas diretas: **5.953**, e para todas os dois participantes são deriváveis sem ambiguidade — o Titular e o outro lado.
- ~~Nenhuma estrutura do formato carrega instante de entrada ou de saída.~~ **Falso, medido em 30/08/2026.** As mensagens administrativas de grupo carregam os dois: 16.402 eventos datados nos dois backups, sendo 8.310 de **entrada** e 8.092 de saída. A afirmação valia para as tabelas que a medição de 26/08 olhou, e foi generalizada para o formato — o mesmo erro que a revisão de 28/08 já apontara num outro parágrafo, e que sobreviveu aqui porque ninguém audita a linha que não está sendo editada.

A saída aparentemente óbvia — usar a data da primeira Mensagem como início da Participação — **fabrica dado**. É o mesmo defeito que o Acervo recusa em Mensagem, com outro nome: o produto rejeita instante implausível na entrada justamente para não guardar data que ninguém observou.

Há ainda uma armadilha técnica que fecha a porta da alternativa. Tornar `comecou_em` anulável mantendo-a na chave primária não funciona: o SQLite admite nulo em coluna de chave primária e trata nulo como distinto de nulo, então reimportar o mesmo material **duplicaria** cada Participação. Verificado por execução.

## Decisão

**Participação não guarda data que a Fonte não forneceu.**

1. `comecou_em` e `terminou_em` são anuláveis e ficam nulos quando a Fonte não os informa. Nunca recebem aproximação.
2. Participação passa a registrar **`observada_em`** — quando o malote soube dela. É o dado que o malote realmente possui, e o que distingue "está na Conversa" de "estava quando olhamos pela última vez".
3. A chave da Participação passa a ser `(conversa_id, identificador_id)`. Uma Pessoa tem no máximo uma Participação por Conversa, e reimportar atualiza em vez de duplicar.
4. **Conversa direta tem exatamente duas Participações**, sempre — é derivável de qualquer Fonte e vira invariante testável.
5. **Conversa coletiva tem as Participações que a Fonte informar, podendo ser nenhuma.**
6. O histórico temporal sai do corpo do modelo para "Modelado, não construído". ~~Nomeando a recepção contínua como a capacidade que pode observá-lo.~~ **Revisto em 28/08/2026:** a recepção contínua não é o único produtor — o próprio material exportado traz transições datadas em mensagem administrativa. O histórico continua não construído; a razão deixa de ser impossibilidade e passa a ser fatiamento.

## Consequências

### Positivas

- O Acervo deixa de poder conter data de Participação que ninguém observou.
- O invariante de Conversa direta é forte e testável: duas Participações, sempre. Antes, o modelo declarava "ao menos uma" e a importação produzia zero, sem nada perceber.
- Reimportar atualiza o quadro de participantes em vez de duplicá-lo — o roster acompanha o export mais recente.
- `observada_em` responde honestamente à pergunta que o produto pode responder, em vez de responder mal a que não pode.

### Negativas

- A pergunta *"quem estava neste grupo em 2019?"* fica sem resposta para material exportado. Era um dos argumentos do desenho escolhido, e não se cumpre por esse caminho. **Ressalva de 28/08/2026:** continua verdadeira para 2019, mas por retenção, não por formato — as transições existem no material a partir de 2025.
- ~~Entrada e saída repetidas da mesma Pessoa na mesma Conversa não são representáveis.~~ **Superado pelo ciclo 9 (30/08/2026).** A **Transição de Participação** as representa, e a consulta de presença as resolve pelo último evento até a data, sem caso especial. A Participação continua uma por Conversa — ela é o retrato, e não o histórico.
- 1.022 das 1.365 Conversas coletivas do acervo de origem ficarão sem Participação alguma. Não é perda: é o dado que nunca existiu, agora visível como ausência em vez de disfarçado.

### Implementação

- Schema do Acervo: `participacoes` com chave `(conversa_id, identificador_id)`, `comecou_em` e `terminou_em` anuláveis, `observada_em` obrigatória.
- A porta de escrita atualiza `observada_em` a cada registro, e não duplica.
- O adaptador registra as duas Participações de toda Conversa direta e o roster que a Fonte trouxer nas coletivas.
- Teste de guarda: toda Conversa direta importada tem exatamente duas Participações. Sem ele, o defeito que gerou esta ADR volta em silêncio — a versão anterior do invariante não tinha teste nenhum.

## Escopo

Vale para este repositório. Não vincula decisão futura: quando a recepção contínua existir, ela observa entrada e saída com data real, e o histórico temporal graduará de "Modelado, não construído" para o corpo do modelo — acrescentando capacidade, sem revogar esta ADR.

## Alternativas Consideradas

| Alternativa | Por que não |
|---|---|
| **Manter o invariante e usar a data da primeira Mensagem como início** | fabrica dado. O produto recusa instante implausível em Mensagem exatamente para não fazer isso; abrir exceção em Participação seria incoerente e invisível |
| **Adiar Participação inteira para quando houver recepção contínua** | deixaria o invariante aprovado violado no intervalo, que é o estado em que o defeito foi encontrado. E descartaria dado que a Fonte fornece: as duas Participações de 5.953 Conversas diretas e o roster de 343 coletivas |
| **`comecou_em` anulável mantendo a chave primária atual** | não funciona. O SQLite trata nulo como distinto de nulo em chave primária, e reimportar duplicaria cada Participação. Verificado por execução em 26/08/2026 |

## Revisão — 2026-08-28

**O que estava errado:** esta ADR afirmou que material exportado não fornece entrada
nem saída de Participação, e concluiu que só a recepção contínua poderia observar a
transição. A medição de 26/08 olhou `ZWAGROUPMEMBER` — a tabela de roster — e
generalizou da tabela para o formato. É o erro de tomar ausência no recorte de busca
por ausência de capacidade.

**O que a medição de 28/08/2026 encontrou.** Duas fontes distintas, e a segunda é a
que vale — a primeira medição foi feita contra o banco **vivo** do aplicativo de
escritório, que não é material exportado. Refeita contra um **backup de dispositivo**,
que é o que o Adaptador lê:

| Artefato medido | Mensagens | Conversas coletivas | Transições datadas nomeando o membro |
|---|---|---|---|
| Backup de dispositivo (**material exportado**) | 94.346 | 89 | **7.404** |
| Banco vivo do aplicativo de escritório (não é material) | 377.890 | 269 | 1.356 |

No banco vivo, os eventos vão de 2025 em diante e cobrem 60 das 269 Conversas coletivas
(22%); nenhum é anterior a 2025. No backup a densidade é muito maior — 7.404 transições
para 7.454 registros de roster —, mas a conta medida é de uso comercial, e a rotatividade
de membro ali não representa a de uma conta pessoal. **A ordem de grandeza confirma o
achado; a taxa não se generaliza de uma conta para a outra.**

Todos os eventos sobrevivem ao filtro atual do Adaptador.

As transições vivem em mensagem de sistema, com instante próprio e com o membro
nomeado em coluna estruturada. O adaptador **já as importa hoje** como Mensagem de
tipo genérico, e já lê a coluna que nomeia o membro; a única coluna que ele não lê é
a que diz **o que aconteceu**.

**O que permanece:**

1. A decisão inteira. Participação continua sem guardar data que a Fonte não forneceu,
   a chave continua sendo `(conversa, identificador)`, e o roster continua sendo
   retrato do momento do export.
2. **Ausência no roster novo continua não significando saída.** Um export mais recente
   com menos participantes não remove Participação — a transição só é afirmável quando
   houver o evento que a declara, nunca por diferença entre dois retratos.
3. O histórico temporal continua não construído.

**O que muda:**

1. A razão de não estar construído passa de *impossível a partir de material exportado*
   para *não fatiado*. Duas coisas distintas: a primeira fecha a porta, a segunda a deixa
   aberta com fila.
2. O produtor deixa de ser exclusivamente a recepção contínua. São dois, e o do material
   exportado existe hoje.
3. **A cobertura é parcial e recente, e qualquer promessa precisa dizer isso:** 22% das
   Conversas coletivas, e nada antes de 2025 enquanto o acervo vai a 2013. É reconstrução
   a partir de um ponto, nunca desde o começo.

**O que ainda não foi medido:** o significado de cada código de evento. A medição separou
os que nomeiam um membro; distinguir *entrou* de *saiu* de *foi removido* é trabalho da
implementação, e a ADR não o presume.

**Consequência de roadmap:** o histórico de Participação virou ciclo próprio, antes do
ouvinte, para que o modelo de transição nasça uma vez e sirva aos dois produtores.

## Referências

- `docs/dominio/malote.md` — agregado Conversa, e a seção "Modelado, não construído"
- `GLOSSARIO.md` — **Participação**
