import type { Acervo } from './acervo.js';
import type { Fonte } from './tipos.js';
import type { Operacao } from './trilha.js';

/** A consulta de `enderecoEhCanonico`, exportada para o teste de plano de consulta fixar que ela usa o indice por canonico (v31). */
export const SQL_ENDERECO_EH_CANONICO =
  'SELECT 1 FROM correspondencias_de_endereco WHERE fonte = ? AND canonico = ? LIMIT 1';

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
export function aprenderCorrespondencia(
  acervo: Acervo,
  entrada: EntradaDeCorrespondencia,
  op?: Operacao,
): void {
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

  // Com `op`, a linha de efeito e o que deixa o `desfazer` de uma Operacao `por-efeito` remover ESTE par e so ele. A
  // recepcao ao vivo nao passa `op`: o aprendizado dela e irreversivel e sem efeito, como o do resto da correspondencia.
  op?.valor({
    tabela: 'correspondencias_de_endereco',
    chave: JSON.stringify([entrada.fonte, entrada.alternativo]),
    campo: 'canonico',
    antes: null,
    depois: entrada.canonico,
  });
}

/**
 * Remove UM par, e so se ele ainda aponta para o canonico dado. Usado por `desfazer`: o par refeito depois, para outro
 * canonico, nao e tocado.
 */
export function removerCorrespondencia(acervo: Acervo, entrada: EntradaDeCorrespondencia): boolean {
  return (
    acervo
      .preparar(
        'DELETE FROM correspondencias_de_endereco WHERE fonte = ? AND alternativo = ? AND canonico = ?',
      )
      .run(entrada.fonte, entrada.alternativo, entrada.canonico).changes === 1
  );
}

/** O valor e canonico de algum par? (a forma que o resto do Acervo ja usa). Usa o indice por canonico (v31). */
export function enderecoEhCanonico(acervo: Acervo, fonte: Fonte, valor: string): boolean {
  return acervo.preparar(SQL_ENDERECO_EH_CANONICO).get(fonte, valor) !== undefined;
}

/** O valor esta gravado como Identificador da Fonte? */
export function enderecoTemIdentificador(acervo: Acervo, fonte: Fonte, valor: string): boolean {
  return (
    acervo
      .preparar('SELECT 1 FROM identificadores WHERE fonte = ? AND valor = ? LIMIT 1')
      .get(fonte, valor) !== undefined
  );
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
