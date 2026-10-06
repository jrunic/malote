import { mesmoTelefone } from '../adaptadores/whatsapp/identidade-da-conta.js';
import {
  listarConfiguracoes,
  type ConfiguracaoDeAdaptador,
} from '../registro/configuracao-adaptador.js';
import type { Registro } from '../registro/registro.js';

/**
 * A OUTRA Configuracao de WhatsApp do Inquilino que ja tem este telefone,
 * contando o mesmo celular com e sem o nono digito. O Registro e opaco para o
 * valor: a equivalencia e do Adaptador, e quem os junta e a CLI.
 */
export function configuracaoComTelefoneEquivalente(
  registro: Registro,
  inquilinoId: string,
  telefone: string,
  ignorarConfiguracaoId?: string,
): ConfiguracaoDeAdaptador | undefined {
  return listarConfiguracoes(registro, inquilinoId).find(
    (c) =>
      c.fonte === 'whatsapp' &&
      c.id !== ignorarConfiguracaoId &&
      c.telefone !== null &&
      mesmoTelefone(c.telefone, telefone),
  );
}
