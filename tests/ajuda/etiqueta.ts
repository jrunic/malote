import type { Acervo } from '../../src/nucleo/acervo.js';
import { registrarConversa, registrarIdentificador } from '../../src/nucleo/escrita.js';

/** Conversa COLETIVA sintetica; nenhum id real. */
export function umaColetiva(acervo: Acervo, idExterno = '120363000000000001@g.us'): string {
  return registrarConversa(acervo, { fonte: 'whatsapp', idExterno, coletiva: true });
}

/** Um membro sintetico, na forma canonica de telefone. */
export function umMembro(acervo: Acervo, telefone = '5565911110001'): string {
  return registrarIdentificador(acervo, { fonte: 'whatsapp', valor: `${telefone}@s.whatsapp.net` }).id;
}
