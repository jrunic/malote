import type { Acervo } from '../../nucleo/acervo.js';
import { declararEnderecosDaConta, type ResultadoDeEnderecoDaConta } from '../../nucleo/endereco-da-conta.js';
import type { IdentidadeDaConta } from './identidade-da-conta.js';
import { resolverEnderecoDeWhatsapp } from './resolver-celular.js';

/**
 * Declara os enderecos da conta do vinculo (#1376). A declaracao mora no nucleo, que nao sabe de telefone e nao importa
 * adaptador; entao a forma do celular e resolvida AQUI, antes, e o nucleo recebe o JID ja canonico. Sem isto o par LID
 * da conta apontaria para a forma crua e montaria cadeia com o par do celular.
 */
export function declararContaDeWhatsapp(
  acervo: Acervo,
  id: Pick<IdentidadeDaConta, 'jid' | 'lid'>,
): ResultadoDeEnderecoDaConta {
  const canonico = resolverEnderecoDeWhatsapp(acervo, id.jid);
  return declararEnderecosDaConta(acervo, {
    fonte: 'whatsapp',
    canonico,
    ...(id.lid !== null ? { alternativo: id.lid } : {}),
  });
}
