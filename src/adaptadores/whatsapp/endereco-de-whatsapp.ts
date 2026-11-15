/**
 * O que e endereco de WhatsApp, para quem GRAVA Identificador (#1519). Medido no Acervo do Titular em 15/11/2026: todo
 * Identificador legitimo e `<texto sem espaco, chave nem aspas>@<sufixo>` (sufixos s.whatsapp.net, lid, g.us, broadcast e o
 * endereco interno do sistema); 3.706 valores eram o objeto do participante serializado, que a plataforma entrega como
 * parametro do evento de entrada e saida e que a guarda de presenca de `@` deixava passar.
 */
const FORMA_DE_ENDERECO = /^[A-Za-z0-9._-]+@[a-z0-9.]+$/;

export function ehEnderecoDeWhatsapp(valor: string): boolean {
  return FORMA_DE_ENDERECO.test(valor);
}

/**
 * O endereco que um parametro de evento carrega: o proprio texto quando e endereco, ou o `id` do objeto serializado
 * (`{"id": ..., "phoneNumber": ..., "admin": ...}`). Nulo quando nao ha endereco legivel. Nao aprende o par do objeto: quem
 * grava resolve o `id` pela Correspondencia que ja existe.
 */
export function enderecoDoParametro(parametro: string): string | null {
  if (ehEnderecoDeWhatsapp(parametro)) return parametro;
  if (!parametro.startsWith('{')) return null;
  let objeto: unknown;
  try {
    objeto = JSON.parse(parametro);
  } catch {
    return null;
  }
  if (objeto === null || typeof objeto !== 'object') return null;
  const id = (objeto as Record<string, unknown>)['id'];
  return typeof id === 'string' && ehEnderecoDeWhatsapp(id) ? id : null;
}
