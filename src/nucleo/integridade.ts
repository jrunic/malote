import type { Acervo } from './acervo.js';
import type { PessoaId } from './tipos.js';

/**
 * Pessoas cujo apontamento de mestre NAO leva a uma raiz.
 *
 * Existe APESAR das guardas de escrita, nao no lugar delas: guarda protege o
 * caminho que conhece, e o inventario de quem escreve pode estar incompleto —
 * remocao de Pessoa, recriacao de Acervo, caminho novo que ninguem lembrou.
 * Detector nasce junto da denormalizacao, nao depois dela.
 *
 * So leitura. Devolve vazio quando o invariante vale.
 */
export function conferirMesclagem(acervo: Acervo): PessoaId[] {
  return (
    acervo.preparar(
        `SELECT f.id FROM pessoas f
           JOIN pessoas m ON m.id = f.absorvida_por
          WHERE m.absorvida_por IS NOT NULL
          ORDER BY f.id`,
      )
      .all() as Array<{ id: string }>
  ).map((l) => l.id);
}

/**
 * Transicao com instante impossivel.
 *
 * O CHECK do schema ja fecha a natureza; o que ele nao cobre e a data. Zero e
 * o sinal de fabricacao — nenhuma Fonte declara epoch como instante de evento,
 * e um zero aqui significa que alguem DERIVOU o que devia ter lido. E a mesma
 * recusa que o Acervo faz em Mensagem, do lado da Transicao.
 */
export function conferirTransicoes(acervo: Acervo): string[] {
  const linhas = acervo.preparar('SELECT id FROM transicoes_de_participacao WHERE ocorrida_em <= 0')
    .all() as Array<{ id: string }>;
  return linhas.map((l) => l.id);
}

/**
 * Quantos eventos do mundo aparecem no Acervo sob MAIS DE UM identificador.
 *
 * Existe porque o identificador do evento administrativo NAO converge entre as
 * duas fontes. Medido em 02/09/2026: 10.569 de 10.569 identificadores de evento
 * no material exportado tem 20 caracteres maiusculos, e os 34 recebidos ao vivo
 * tem 9 ou 10 minusculos. A ponte que decidiria a questao nao e mensuravel — a
 * sobreposicao entre as duas fontes e de 3 eventos.
 *
 * A chave de unicidade da Transicao inclui o identificador, entao ela nao pode
 * ver esta duplicacao. Trocar a chave sem poder medir o efeito seria o oposto
 * do que este repositorio faz; entao o produto MEDE, e a decisao se toma no dia
 * em que houver numero. Hoje a resposta e zero.
 *
 * O agrupamento e por SEGUNDO, e nao pelo milissegundo: 1.105 dos 16.041
 * eventos administrativos do material — 6,9% — tem fracao de segundo, porque o
 * instante de la vem de um numero de ponto flutuante, e ao vivo ele e segundo
 * inteiro. Pelo milissegundo, o detector nasceria cego justamente neles.
 */
/**
 * Quantas Transicoes registram a MESMA pessoa duas vezes no mesmo evento, uma
 * em cada forma de endereco.
 *
 * E o segundo angulo da duplicacao, e ele existe porque o primeiro nao o
 * enxerga: la o identificador e igual e o evento difere; aqui o evento e igual
 * e o identificador difere, e a chave de unicidade inclui o identificador.
 *
 * A causa nao e reordenavel dentro do produto: um evento recebido as 10h com o
 * endereco ainda desconhecido grava a forma alternativa, e a correspondencia
 * que chega as 11h nao volta atras. Corrigir isso e resolucao RETROATIVA, que
 * e o ciclo 12; ate la, o numero e o tamanho do problema.
 *
 * Medido em 02/09/2026 sobre 1.018.130 Mensagens: 10 pares, todos criados por
 * um defeito de ordem DENTRO do lote, que foi corrigido no mesmo dia.
 */
export function conferirTransicoesEmDuasFormas(acervo: Acervo): number {
  const linha = acervo.preparar(
      `SELECT COUNT(*) AS n
         FROM transicoes_de_participacao t1
         JOIN identificadores i1 ON i1.id = t1.identificador_id
         JOIN correspondencias_de_endereco c
           ON c.fonte = t1.fonte AND c.alternativo = i1.valor
         JOIN identificadores i2
           ON i2.fonte = t1.fonte AND i2.valor = c.canonico
         JOIN transicoes_de_participacao t2
           ON t2.fonte = t1.fonte
          AND t2.id_externo = t1.id_externo
          AND t2.identificador_id = i2.id`,
    )
    .get() as { n: number };
  return linha.n;
}

export function conferirTransicoesRepetidas(acervo: Acervo): number {
  const linha = acervo.preparar(
      `SELECT COUNT(*) AS n FROM (
         SELECT conversa_id, identificador_id, natureza, ocorrida_em / 1000 AS segundo
           FROM transicoes_de_participacao
          GROUP BY conversa_id, identificador_id, natureza, segundo
         HAVING COUNT(DISTINCT id_externo) > 1
       )`,
    )
    .get() as { n: number };
  return linha.n;
}

/**
 * Quantas Conversas tem a Referencia Externa na forma ALTERNATIVA de um
 * endereco cuja forma canonica o Acervo ja conhece.
 *
 * Deveria ser sempre zero: desde o ciclo 10 o endereco e resolvido para a forma
 * canonica ANTES de virar Referencia Externa, na importacao e na recepcao. O
 * detector existe porque "deveria" nao e medicao — e porque a conversao pode
 * criar o caso se algum endereco ficar fora do mapa.
 *
 * Medido em 04/09/2026: 0 de 6.470 no material real de 1.018.130 Mensagens, e
 * 0 de 38 em producao. Enquanto for zero, fundir Conversa nao precisa existir —
 * e fundir Conversa cascatearia em quatro tabelas. Este numero e o que autoriza
 * nao construir aquilo.
 */
export function conferirConversasEmFormaAlternativa(acervo: Acervo): number {
  const linha = acervo.preparar(
      `SELECT COUNT(*) AS n
         FROM conversas c
         JOIN correspondencias_de_endereco k
           ON k.fonte = c.fonte AND k.alternativo = c.id_externo`,
    )
    .get() as { n: number };
  return linha.n;
}
