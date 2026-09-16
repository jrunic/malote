/**
 * Normalizacao de endereco telefonico — do ADAPTADOR, nunca do nucleo.
 * O nucleo nao sabe o que e telefone, e nenhum termo daqui aparece em
 * agregado dele.
 */

/** Tudo que nao e digito sai. O JID do WhatsApp e digito puro. */
export function soDigitos(bruto: string): string {
  return bruto.replace(/\D/g, '');
}

const DDI_BR = '55';
/** Primeiro digito do assinante que indica movel no Brasil. */
const MOVEL = new Set(['6', '7', '8', '9']);

/**
 * As formas sob as quais este endereco pode aparecer no Acervo.
 *
 * O nono digito movel entrou em 2012: cadastro antigo guarda oito digitos de
 * assinante, e o WhatsApp guarda nove. Geramos as duas e o casamento aceita
 * qualquer uma — nos dois sentidos, porque o velho tanto pode estar no
 * catalogo quanto no Acervo.
 *
 * Fixo NAO ganha nono digito, e aqui esta a divergencia deliberada em relacao
 * ao script que mediu 3.696 em 28/08: ele acrescentava o nono a QUALQUER
 * assinante de oito digitos. Medido em 29/08 — 816 telefones brasileiros de
 * 12 digitos tem assinante nao-movel, e para eles aquele script gerava 815
 * variantes que esta funcao nao gera. Casamento nascido de nono digito
 * inventado num fixo e falso por construcao: o cartao e um fixo, e o JID que
 * ele alcancaria e de outra pessoa. Por isso 3.696 e TETO, nao meta.
 *
 * Numero sem DDI 55 nao ganha prefixo: sao 281 de 6.823 no material, dos
 * quais 191 poderiam ser brasileiros. Prefixar mudaria a base dos numeros
 * medidos, entao fica de fora de proposito.
 */
export function variantesDeEndereco(bruto: string): Set<string> {
  const d = soDigitos(bruto);
  if (d.length === 0) return new Set();

  const formas = new Set<string>([d]);
  if (!d.startsWith(DDI_BR)) return formas;

  const resto = d.slice(DDI_BR.length);
  if (resto.length < 10 || resto.length > 11) return formas;

  const ddd = resto.slice(0, 2);
  const assinante = resto.slice(2);

  if (assinante.length === 9 && assinante.startsWith('9')) {
    formas.add(`${DDI_BR}${ddd}${assinante.slice(1)}`);
  }
  if (assinante.length === 8 && MOVEL.has(assinante[0] ?? '')) {
    formas.add(`${DDI_BR}${ddd}9${assinante}`);
  }
  return formas;
}
