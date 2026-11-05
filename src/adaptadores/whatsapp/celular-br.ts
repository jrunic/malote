/**
 * A regra UNICA de celular brasileiro de WhatsApp (#1376). Segue a regra da identidade da conta (`mesmoTelefone`), e um
 * teste fixa que as duas concordam. A do catalogo de contatos e outra: aceita qualquer digito depois do 9, e por isso
 * NAO vale aqui — um endereco de 13 digitos com 9 seguido de 0 a 5 NAO e celular (medido em 29/10/2026: 266 e 1.408
 * Identificadores), porque a forma de 12 digitos que ela geraria tem cara de fixo de outra pessoa.
 *
 * Endereco COMPLETO, no sufixo do usuario: `55`, DDD de 2 digitos, o 9 opcional e 8 digitos de assinante comecando em
 * 6 a 9. Nada de sufixo de dispositivo, de LID ou de grupo. O comprimento decide o 9: a mesma cadeia nao tem duas
 * leituras.
 */
const CELULAR = /^55(\d{2})(9?)([6-9]\d{7})@s\.whatsapp\.net$/;

/** A outra forma do mesmo celular (com ou sem o 9), ou `null` se o endereco nao e celular brasileiro. */
export function outraFormaDoCelular(endereco: string): string | null {
  const m = CELULAR.exec(endereco);
  if (m === null) return null;
  const [, ddd, nove, assinante] = m;
  return nove === '9'
    ? `55${ddd}${assinante}@s.whatsapp.net`
    : `55${ddd}9${assinante}@s.whatsapp.net`;
}
