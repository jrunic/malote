---
id: 202610067218
projeto: malote
tipo: explicacao
escopo: repo:malote
plataforma: "*"
status: ativo
dominios: [tecnologia]
descricao: Regras de migração versionada, trilha, Ator e verificação de cópia, com motivo e medição — carga sob demanda.
tags: [explicacao, invariantes, Node]
---

# Invariantes do Acervo, da migração e da trilha

Regras e decisões do repo **com o motivo e a medição que as sustentam**, movidas do `CONTEXTO.md` para que a carga default da sessão fique pequena. Leia antes de mexer no assunto; o `CONTEXTO.md` aponta para cá e nomeia as regras mais perigosas.

- **A migração relê a forma gravada DENTRO da transação, e a transação é `IMMEDIATE`.** O servidor e cada ouvinte abrem o
  Registro para escrita no boot e reiniciam juntos: lendo a forma fora da transação deferida, dois abridores aplicavam o mesmo
  passo e o segundo morria com `table ... already exists` (código de saída 1, que o unit não reinicia). Reproduzido em
  `tests/migracao-concorrente.test.ts` (a leitura de forma velha por um segundo abridor) e em `tests/registro-abertura-concorrente.test.ts`
  (três processos; reprova em 5 de 5 rodadas sem o `.immediate()`). `migrarComTrilha` não abre Operação `migrar-base` vazia para quem chega atrasado.
- **Passo de migração que precisa de dado fora do Acervo declara `exigeContexto` e RECUSA sem
  ele.** As Configurações vivem no Registro, que é outro arquivo, e migrar acontece ao **abrir**
  o Acervo — quem abre nem sempre tem o Registro. Escolher um valor por conveniência é o que a
  máquina não faz; a recusa nomeia `malote acervo migrar`, que é o único caminho com as duas
  bases. Corolário: `abrirAcervo` passa `inquilinoId` **undefined** para a trilha do Acervo, que
  não tem essa coluna — só a do Registro tem.
- **Verificação contra alvo que se MOVE usa contenção, nunca igualdade.** O
  ouvinte escreve durante um backup: `VACUUM INTO` tira instantâneo consistente
  no instante T e o original é lido em T+minutos. Exigir contagem igual reprova
  toda cópia boa — medido em 13/09/2026, a primeira versão da verificação
  acusou duas tabelas divergentes numa cópia perfeita, porque 53 Mensagens
  chegaram enquanto ela era escrita. O invariante é **a cópia estar contida no
  original**: linha a mais no original é o mundo tendo andado; linha a mais na
  cópia seria corrupção.
- **A trilha de uma migração se escreve DEPOIS dela.** A migração abre uma Operação, e uma migração pode estar alterando `operacoes` — foi o que aconteceu ao entrar o Ator. Escrever antes referencia coluna que o passo ainda não criou, e a migração inteira falha. Vale para toda migração futura que toque a trilha. E **abrir a base acontece dentro de um escopo de Ator**, senão a Operação da migração é a única sem autor.
- **O Ator é da SESSÃO, e o vocabulário é fechado por mecanismo.** `operador:<id>` e `acesso:<id>` são provados por credencial; `servico:<nome>` é declarado pelo deploy; `local` é o fato de nenhuma credencial ter sido apresentada. `indeterminado` é **defeito**, nunca declaração — e `NULL` é reservado a linha anterior ao ciclo 11. Escopado por `AsyncLocalStorage`: variável de módulo atribuiria a Operação de uma requisição ao Ator de outra.
- **`emOperacao` é reentrante por banco.** Envelopar uma chamada que já abre Operação não acrescenta uma: junta o trabalho à que está aberta. Quem quer distinguir execução automática de ato do Titular declara **Ator**, com `comAtor`, e nunca natureza nova — natureza nova aqui apagaria a Operação `importar-material` da trilha.
- **O Diário de Chegadas é só de acréscimo e o número de sequência nunca se reaproveita (`AUTOINCREMENT`).** Não é coluna em `mensagens` nem o `rowid`: medido que apagar a última linha e inserir outra reaproveita o número, e o consumidor perderia a Chegada seguinte. No Acervo real (1,73 milhão de Mensagens) a numeração ia de 1 ao máximo sem nenhum buraco, então o `rowid` funcionaria hoje; mas a garantia seria por convenção do código, e a primeira operação que apagasse Mensagem a quebraria.
- **O Piso é o maior número removido e o Marcador é válido sse é da época atual, maior ou igual ao Piso e menor ou igual à última Chegada.** O "acima da última" cobre o Acervo restaurado de uma cópia anterior, em que a época se mantém e a sequência volta ao ponto da cópia; "época diferente" sozinha não pegaria esse caso. O zero nunca é válido porque o Piso nasce no número da `inicio-do-diario`. A fronteira `>` contra `>=` do Piso e da última é a que os mutantes de `tests/chegada-marcador.test.ts` guardam.
- **O Acervo novo nasce semeado numa transação só (schema, versão e a Chegada `inicio-do-diario`), e o passo v30 faz a mesma semente, idempotente.** O teste de equivalência de forma compara estrutura, não linhas; um teste à parte (`tests/chegada-migracao.test.ts`) confere que o Acervo novo e o migrado do piso nascem com a mesma semente. Sem a semente não há Marcador atual: a leitura recusa com a causa em vez de inventar um.
- **A aparagem remove um PREFIXO da ordem de gravação, nunca a Chegada de maior número, e só grava Operação quando removeu.** Para na primeira Chegada ainda dentro da retenção, mesmo que depois haja outra mais velha pelo relógio (relógio que andou para trás), porque o Piso diz "tudo até aqui saiu". A fronteira é `seq >= Piso`: a `inicio-do-diario` nasce com o número igual ao Piso e é a primeira a sair. O tique que não remove nada não deixa Operação, porque a frota lê a ausência de Operação como sinal e uma por hora por Inquilino seria ruído. O `UPDATE` do Piso usa `MAX(piso, ?)` para que uma passada concorrente não o desça; esse mutante sobrevive por equivalência num teste sequencial.

## Limitação conhecida

- **Entre migrar e registrar a migração na trilha há uma janela, e ela é aceita.** A migração roda primeiro e a Operação `migrar-base` é gravada depois, na forma **nova** das tabelas (`migrarComTrilha`), que é o que permite a um passo alterar as tabelas da trilha. Se o processo morrer entre as duas coisas, a base fica migrada sem a linha na trilha. A contabilidade de verdade é `migracoes_aplicadas`, escrita **dentro** da transação da migração; a trilha é o segundo registro, para quem audita. A Operação também não existe durante a conferência, então um passo não declara `+1` para `operacoes`.
