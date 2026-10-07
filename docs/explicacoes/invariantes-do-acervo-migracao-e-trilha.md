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

## Limitação conhecida

- **A migração não tem caminho para passo que recrie as tabelas da própria trilha.** A Operação é gravada no início da transação, na forma **velha** dessas tabelas. Nenhum passo de hoje as toca; se um dia precisar, é caminho novo na máquina, não remendo. Consequência medida em 01/09/2026: a linha da Operação entra **antes** de a conferência tomar a linha de base, então ela não aparece como divergência — declarar `+1` para `operacoes` num passo REPROVA a migração.
