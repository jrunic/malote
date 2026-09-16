/**
 * A forma sob a qual dois nomes sao "o mesmo". Do ADAPTADOR, como a
 * normalizacao de telefone: casar gente por string e vocabulario de
 * casamento, nao de dominio.
 *
 * Recuperada da medicao de 28/08 que produziu o numero da spec e reconferida
 * em 29/08: 6.693 nomes reais dao 6.661 distintos, com 29 repetidos em 61
 * cartoes. E ESTA forma que a guarda de unicidade usa — medir unicidade na
 * forma escrita deixaria sete cartoes escaparem por acento ou espaco.
 *
 * O script original usava `.encode('ascii','ignore')`, que derruba todo
 * caractere nao-ASCII e nao so o acento. Medido: as duas formas dao
 * exatamente o mesmo resultado neste catalogo, divergindo em 5 nomes e
 * zerando nenhum — entao fica a conservadora.
 */
export function normalizarNome(bruto: string): string {
  return bruto
    .normalize('NFKD')
    .replace(/\p{Mn}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
