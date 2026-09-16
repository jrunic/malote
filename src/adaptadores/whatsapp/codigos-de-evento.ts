import type { NaturezaDeTransicao } from '../../nucleo/tipos.js';

/**
 * O tipo de mensagem que a Fonte usa para evento administrativo de grupo.
 *
 * ESTE e o discriminante, e nao o codigo de evento. O campo de codigo tem um
 * valor de REPOUSO que aparece em mensagem comum: medido em 30/08/2026, ele
 * esta em 453.746 mensagens de texto da conta pessoal. Classificar pelo codigo
 * sem filtrar o tipo produziria falso positivo nessa escala.
 */
export const TIPO_ADMINISTRATIVO = 6;

/**
 * Codigo da Fonte -> o que ele afirma.
 *
 * REGUA DE ADMISSAO (criterio 7 da spec), corrigida em 30/08/2026.
 *
 * O oraculo depende da NATUREZA que se testa, e confundi-los foi o erro que
 * quase deixou 8.323 eventos de fora:
 *
 *   - Para SAIDA: a fracao que escreveu ANTES do evento tem de ser ALTA (a
 *     pessoa estava no grupo) e a que escreveu DEPOIS, BAIXA.
 *   - Para ENTRADA: o inverso. A fracao que escreveu ANTES tem de ser
 *     QUASE ZERO — ninguem escreve num grupo antes de ser adicionado a ele.
 *
 * A primeira versao deste mapa usou so os oraculos de saida ("ainda ativo
 * depois" e "escreveu depois") e os aplicou a TODOS os codigos. Num codigo de
 * entrada eles medem outra coisa — se a pessoa saiu depois —, e devolvem um
 * valor intermediario sem significado. Foi assim que o 15 ficou de fora com
 * "10,5%", e que a spec chegou a afirmar que nenhum codigo era de entrada.
 *
 * Medido em 30/08/2026 nos dois backups, com o oraculo certo para cada lado:
 *
 *   codigo | membros | escreveu ANTES | escreveu DEPOIS | leitura
 *   -------+---------+----------------+-----------------+------------------
 *      15  |  4.660  |     0,3%       |      473        | entrou
 *      3   |  2.179  |    41,9%       |      1,5%       | saiu
 *      7   |  1.634  |    44,2%       |      2,3%       | saiu
 *      9   |    396  |    37,9%       |      4,5%       | saiu
 *      2   |  4.246  |     4,7%       |     55,3%       | nao e transicao
 *
 * Os codigos de saida tem ~40% escrevendo antes e ~2% depois; o 15 tem o
 * padrao exatamente INVERTIDO. Na conta comercial o sinal e ainda mais limpo:
 * ZERO de 3.526 membros escreveram antes do primeiro 15, e o evento que
 * sucede um 15 e sempre 3 (2.293x) ou 7 (1.317x) — a sequencia natural de
 * adicionado, depois removido ou saiu.
 *
 * O codigo 2 tem texto em 86% dos casos e 55% escrevem depois: e mudanca de
 * assunto do grupo, feita por quem esta dentro. Nao move ninguem.
 *
 * O codigo 30 fica de fora porque os oraculos DIVERGEM nele (3,9% ainda
 * ativos contra 77,2% escrevendo depois), e divergencia nao e aprovacao.
 */
export const NATUREZA_POR_CODIGO: Readonly<Record<number, NaturezaDeTransicao>> = Object.freeze({
  15: 'entrou',
  3: 'saiu',
  7: 'saiu',
  9: 'saiu',
});

/**
 * Classifica um codigo. Devolve `null` para o que nao esta no mapa — e o
 * chamador CONTA o null por codigo, nunca o descarta em silencio.
 */
export function classificar(codigo: number | null): NaturezaDeTransicao | null {
  if (codigo === null) return null;
  return NATUREZA_POR_CODIGO[codigo] ?? null;
}
