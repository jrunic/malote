import type { NaturezaDeTransicao } from '../../nucleo/tipos.js';

/**
 * O vocabulario de evento administrativo que chega AO VIVO.
 *
 * E um mapa SEPARADO de `NATUREZA_POR_CODIGO`, que le o material exportado, e
 * a separacao e deliberada: os dois espacos de valores nao se encontram.
 * Medido em 02/09/2026 na captura contra conta real —
 *
 *   material exportado:  ZGROUPEVENTTYPE  ->  15, 3, 7, 9   (numeros opacos)
 *   ao vivo:             messageStubType  ->  GROUP_PARTICIPANT_ADD, ...
 *
 * Fundir os dois num mapa so faria 15 e 27 dividirem a mesma tabela sem que
 * nada garanta que nao colidam com significados diferentes.
 *
 * DUAS FORMAS NA MESMA CHAVE. A captura entregou nome (`GROUP_PARTICIPANT_ADD`)
 * e numero (2, para cifrada) no mesmo arquivo — a serializacao do enum nao e
 * estavel. Normalizar para texto antes de consultar cobre as duas.
 *
 * REGUA DE ADMISSAO, e ela e diferente da do material. La, os codigos eram
 * opacos e a natureza precisou de oraculo estatistico sobre quem escreveu antes
 * e depois do evento. Aqui o nome do enum DECLARA a semantica, e por isso
 * `GROUP_PARTICIPANT_REMOVE` entra mesmo sem ter ocorrido nas 11 horas de
 * captura: ausencia de amostra nao e ambiguidade de significado.
 *
 * `GROUP_CHANGE_ANNOUNCE` fica de fora — 3 ocorrencias, e e ajuste de
 * configuracao do grupo. Nao move ninguem, e o modelo so admite Transicao de
 * entrada e de saida.
 */
const POR_STUB: Readonly<Record<string, NaturezaDeTransicao>> = Object.freeze({
  GROUP_PARTICIPANT_ADD: 'entrou',
  '27': 'entrou',
  GROUP_PARTICIPANT_REMOVE: 'saiu',
  '28': 'saiu',
  GROUP_PARTICIPANT_LEAVE: 'saiu',
  '32': 'saiu',
});

/**
 * Tipos que a Fonte entrega SEM conteudo decifravel.
 *
 * 90 dos 4.167 eventos medidos. Ver `ao-vivo.ts` para por que sao pulados em
 * vez de gravados como Mensagem vazia.
 */
const CIFRADA: ReadonlySet<string> = new Set(['CIPHERTEXT', '2']);

/** Normaliza o valor do stub para texto. `null` quando nao ha stub. */
export function textoDoStub(valor: string | number | undefined): string | null {
  if (valor === undefined || valor === null) return null;
  return String(valor);
}

export function naturezaDoStub(valor: string | number | undefined): NaturezaDeTransicao | null {
  const t = textoDoStub(valor);
  if (t === null) return null;
  return POR_STUB[t] ?? null;
}

export function ehCifrada(valor: string | number | undefined): boolean {
  const t = textoDoStub(valor);
  return t !== null && CIFRADA.has(t);
}
