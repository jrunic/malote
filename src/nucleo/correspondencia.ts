import type { Acervo } from './acervo.js';
import type { Fonte } from './tipos.js';

/**
 * Correspondencia entre duas formas do mesmo endereco numa Fonte.
 *
 * A forma canonica e a que o material exportado grava — a que o catalogo e as
 * Pessoas ja usam. Traduzir para ela e o que faz a Conversa recebida ao vivo
 * encontrar a que a importacao criou, em vez de nascer duplicada, e o que
 * impede que o autor de uma Mensagem vire uma segunda identidade de alguem que
 * ja esta no acervo. Medido em 02/09/2026: 53,7% dos enderecos vistos ao vivo
 * ja existiam ali, na outra forma.
 *
 * O nucleo nao sabe o que sao essas formas: quem decide qual e canonica e o
 * Adaptador da Fonte. Aqui sao duas cadeias e uma direcao.
 */
export interface EntradaDeCorrespondencia {
  fonte: Fonte;
  alternativo: string;
  canonico: string;
}

export class CorrespondenciaEmConflitoError extends Error {
  constructor(
    readonly fonte: string,
    readonly alternativo: string,
    readonly gravado: string,
    readonly novo: string,
  ) {
    super(
      `Conflito de correspondencia em ${fonte}: ${alternativo} ja aponta para ` +
        `${gravado}, e agora chegou ${novo}. Um endereco alternativo designa um ` +
        `destinatario so; isto e achado, nao dado novo.`,
    );
    this.name = 'CorrespondenciaEmConflitoError';
  }
}

/**
 * Aprende uma correspondencia. Idempotente; conflito RECUSA.
 *
 * Recusar em vez de sobrescrever e desenho: sobrescrever apagaria a evidencia
 * de que houve conflito, e o produto passaria a afirmar a ultima coisa que
 * ouviu como se fosse a verdade. Quem chama decide o que fazer com a recusa —
 * o adaptador de recepcao, por exemplo, mantem a primeira e grava a Mensagem
 * assim mesmo, porque perder o que chegou seria pior que ter uma duvida.
 */
export function aprenderCorrespondencia(acervo: Acervo, entrada: EntradaDeCorrespondencia): void {
  const gravado = acervo.preparar(
      'SELECT canonico FROM correspondencias_de_endereco WHERE fonte = ? AND alternativo = ?',
    )
    .get(entrada.fonte, entrada.alternativo) as { canonico: string } | undefined;

  if (gravado !== undefined) {
    if (gravado.canonico === entrada.canonico) return;
    throw new CorrespondenciaEmConflitoError(
      entrada.fonte,
      entrada.alternativo,
      gravado.canonico,
      entrada.canonico,
    );
  }

  acervo.preparar(
      `INSERT INTO correspondencias_de_endereco (fonte, alternativo, canonico, aprendida_em)
       VALUES (?, ?, ?, ?)`,
    )
    .run(entrada.fonte, entrada.alternativo, entrada.canonico, new Date().toISOString());
}

/**
 * Traduz um endereco para a forma canonica.
 *
 * Endereco sem correspondencia resolve para ELE MESMO — nao ter correspondencia
 * e o caso comum, nao erro. Devolver o proprio valor deixa o chamador escrever
 * sem ramo condicional, e e o que mantem o adaptador simples.
 */
export function resolverEndereco(acervo: Acervo, fonte: Fonte, valor: string): string {
  const linha = acervo.preparar(
      'SELECT canonico FROM correspondencias_de_endereco WHERE fonte = ? AND alternativo = ?',
    )
    .get(fonte, valor) as { canonico: string } | undefined;
  return linha?.canonico ?? valor;
}
