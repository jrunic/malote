---
id: 202609011820
projeto: malote
tipo: decisao
status: aprovado
data: 2026-09-01
escopo: repo:malote
dominios: [tecnologia]
plataforma: "*"
descricao: "ADR — política de forma das duas bases do malote: entre o piso e a versão corrente a forma anterior é migrada por passos declarados; posterior recusa; abaixo do piso recusa; e as três assimetrias entre Acervo e Registro ficam declaradas aqui, não espalhadas em comentário"
tags: [adr, migracao, schema, acervo, registro]
---

# ADR — Política de forma das duas bases

## Status

Aceito (2026-09-01).

## Contexto

O malote guarda dados em duas bases de natureza diferente. O **Acervo** é um banco por
Inquilino, com as Conversas, Mensagens, Pessoas e Anexos; ele é construído a partir de
material exportado pelas Fontes, que continua existindo. O **Registro** é um banco por
instalação, com os Inquilinos, as Chaves de Operador, os Destinos de Mídia e as
configurações; nada o reconstrói.

Até esta decisão, as duas tratavam forma divergente de maneiras diferentes, por razões
que nunca tinham sido escritas juntas — cada uma vivia num comentário do próprio módulo,
e quem lia um não via o outro.

- O **Acervo** recusava abrir em qualquer forma divergente, nas duas direções, e mandava
  recriar. Funcionava porque recriar reconstrói: apagar o banco e reimportar o material
  devolve o mesmo conteúdo.
- O **Registro** subia sozinho ao abrir. A subida consistia em reexecutar o schema, que
  usa `CREATE TABLE IF NOT EXISTS`, e carimbar o número novo.

A subida do Registro tinha um defeito que só não apareceu por sorte de escopo: ela
alcança **tabela** que falta, porque a criação condicional a cria, e **nunca alcança
coluna** que falta, porque nada ali altera tabela existente. Um Registro de forma
anterior seria marcado como corrente sem receber a coluna, e o produto passaria a ler uma
forma que a base não tem.

O custo disso já tinha sido pago duas vezes, e está visível no próprio schema: dois dados
que seriam naturalmente colunas de uma tabela existente foram criados como **tabelas
separadas**, com o comentário explicando que coluna nova não alcançaria instalação
existente. Era desenho de schema distorcido pela ausência de uma máquina de migração.

O gatilho para resolver agora é outro, e é de produto: a partir do momento em que o
malote passa a receber mensagem ao vivo, recriar o Acervo deixa de ser reconstrução e
passa a ser perda — o que chega ao vivo não existe em export nenhum.

## Decisão

As duas bases usam a **mesma máquina de migração**: passos declarados, ordenados,
idempotentes, aplicados numa transação por execução, com conferência de contagens que
reprova divergência não declarada.

A política de abertura passa a ser:

| | forma entre piso e corrente | forma posterior | forma abaixo do piso | recriar existe? |
|---|---|---|---|---|
| **Acervo**, abertura de escrita | migra por passos | recusa | recusa, e manda recriar | sim |
| **Acervo**, abertura de leitura | recusa, e manda migrar | recusa | recusa | — |
| **Registro**, abertura de escrita | migra por passos | recusa | recusa, e manda usar outra versão | não |
| **Registro**, abertura de leitura | recusa | recusa | recusa | — |

### As três assimetrias, e a razão de cada uma

1. **Só o Acervo tem recriar.** O Acervo é construído de material exportado, que continua
   existindo e é a fonte. O Registro guarda a identidade dos Inquilinos e as Chaves, que
   nada reconstrói — recriá-lo seria destruir sem volta. É por isso que a mensagem de
   recusa abaixo do piso difere: uma manda recriar, a outra manda usar uma versão do
   produto que alcance aquela forma.

2. **Os pisos são números diferentes.** O do Acervo é a forma corrente na data desta
   decisão, porque toda forma anterior é pré-lançamento e recriar é mais barato que
   manter passos que ninguém consome. O do Registro é **2**, e não 1, por um motivo
   factual: antes da forma 2 a constante de versão não era movida a cada mudança, então
   uma base marcada com 1 pode ter qualquer subconjunto das tabelas acrescentadas depois.
   O número 1 não identifica uma forma, e não há passo possível para um alvo
   indeterminado.

3. **Só o Acervo tem comando explícito de migrar.** O Registro é aberto para escrita antes
   de qualquer subcomando ser despachado; um comando para ele relataria trabalho que a
   própria abertura já fez. Não é lacuna — é consequência do desenho de entrada.

### Duas regras que sustentam a máquina

**O DDL de um passo é fotografia congelada.** Um passo nunca compartilha código com o
schema fresco. Parece duplicação e não é: quando um passo futuro alterar a tabela que
outro criou, o antigo tem de continuar criando a forma de **então**, senão a cadeia deixa
de reconstruir a história. O que mantém a duplicação honesta é um teste que compara a base
migrada por passos com a base criada do zero, por estrutura — colunas, índices, chaves
estrangeiras e gatilhos —, nunca pelo texto do `CREATE`, que difere por cosmética.

**A base de comparação do teste também é fotografia congelada.** Foi medido: uma fixture
que fabrica a base "antiga" derivando-a do schema corrente contamina os dois lados da
comparação em igual medida, e o teste passa com o defeito presente. A base do piso vem do
DDL de então, e só dele.

## Consequências

### Positivas

- Forma anterior deixa de exigir recriar, o que é pré-requisito para o produto receber
  dado que nada reconstrói.
- Acrescentar coluna a tabela povoada deixa de ser impedimento e passa a ser um passo
  escrito. As duas tabelas que existem hoje *como tabelas* por causa dessa limitação
  podem virar colunas quando alguém quiser pagar o passo — nada obriga, e nada nelas está
  errado.
- A subida do Registro deixa de afirmar uma forma que a base pode não ter.

### Negativas

- Cada mudança de forma passa a custar um passo escrito e conferido. É troca deliberada:
  paga-se disciplina para comprar dado que sobrevive.
- Duas fotografias congeladas do schema passam a existir e a precisar de manutenção — a do
  passo e a da fixture de teste.

### Implementação

- A máquina é agnóstica de base: recebe piso, forma corrente e lista de passos.
- A conferência compara contagem por tabela contra a linha de base, e a verificação de
  integridade referencial compara contra o estado **anterior** — dano herdado no arquivo
  não aborta migração que não o causou.
- Passo que exija ação sobre arquivos grava a pendência na mesma transação do banco; a
  ação ocorre depois do commit, e a base com pendência em aberto não abre.

## Alternativas consideradas

- **Manter o Acervo recusando e continuar recriando.** Recusada: encerra a possibilidade
  de o produto receber dado ao vivo, que é o próximo passo do roadmap.
- **Migrar só o Acervo e deixar o Registro com a subida atual.** Recusada: a subida atual
  não alcança coluna, e o defeito é latente — o schema já foi distorcido duas vezes para
  contorná-lo.
- **Escrever os passos de todas as formas históricas.** Recusada: nenhuma base de forma
  anterior ao piso sobrevive fora de desenvolvimento, e passos que ninguém consome são
  trabalho morto que ainda assim precisa de manutenção.
- **Migração reversível, com passo de volta para cada passo de ida.** Recusada por
  ausência de necessidade: nenhum critério a pede, e a proteção contra migração ruim é a
  atomicidade mais a cópia de segurança de quem opera.

## Referências

- Precedente de migration SQLite com chave estrangeira: statement a statement em vez de
  execução em lote, `PRAGMA foreign_keys` alterado fora da transação, e verificação de
  integridade comparada contra linha de base tomada antes.
