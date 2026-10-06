import { resolverEndereco } from '../../src/nucleo/correspondencia.js';
import type { Acervo } from '../../src/nucleo/acervo.js';

/** O endereco canonico de um valor de WhatsApp, como o Acervo o resolve. */
export function resolverEnderecoDeTeste(acervo: Acervo, valor: string): string {
  return resolverEndereco(acervo, 'whatsapp', valor);
}
