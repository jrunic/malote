import type { Acervo } from './acervo.js';
import { resolverEndereco } from './correspondencia.js';
import type { ConversaId, Fonte } from './tipos.js';

/**
 * O Envio por Conversa (#1323). O nucleo diz o que a Conversa e e para onde o Envio iria; QUEM e destinatario valido
 * (grupo, telefone, endereco opaco) e vocabulario de Fonte e mora no adaptador.
 */

/** A Conversa como o Envio por Conversa a enxerga. */
export interface ConversaDeEnvio {
  id: ConversaId;
  fonte: Fonte;
  coletiva: boolean;
  /** A Configuracao dona. Nula na coletiva, que pertence ao Inquilino. */
  configuracaoId: string | null;
  /** A Referencia Externa na Fonte: o endereco para onde o Envio vai. */
  endereco: string;
}

interface LinhaDeConversa {
  id: string;
  fonte: Fonte;
  coletiva: number;
  configuracao_id: string | null;
  id_externo: string;
}

function conversaDeEnvio(l: LinhaDeConversa): ConversaDeEnvio {
  return { id: l.id, fonte: l.fonte, coletiva: l.coletiva === 1, configuracaoId: l.configuracao_id, endereco: l.id_externo };
}

/** A Conversa pelo id, neste Acervo, ou `undefined`. O Acervo e de um Inquilino so: id de outro Inquilino nao existe aqui. */
export function lerConversaDeEnvio(acervo: Acervo, conversaId: ConversaId): ConversaDeEnvio | undefined {
  const l = acervo
    .preparar('SELECT id, fonte, coletiva, configuracao_id, id_externo FROM conversas WHERE id = ?')
    .get(conversaId) as LinhaDeConversa | undefined;
  return l === undefined ? undefined : conversaDeEnvio(l);
}

export type DestinoPorConversa =
  | { tipo: 'inexistente' }
  /** A Conversa em que o Envio fica gravado. `usada.id !== dada.id` quando houve redirecionamento (Decisao 4). */
  | { tipo: 'conversa'; dada: ConversaDeEnvio; usada: ConversaDeEnvio }
  /** A dada e a forma alternativa e a canonica ainda nao existe nesta Configuracao: grava-se o endereco canonico. */
  | { tipo: 'endereco'; dada: ConversaDeEnvio; endereco: string };

/**
 * Resolve o destino de um Envio dado o id de uma Conversa. A Conversa em forma ALTERNATIVA de endereco (o opaco de
 * uma pessoa que tem telefone conhecido) e REDIRECIONADA para a canonica da mesma Configuracao: e nela que o eco da
 * mensagem cai, e o Envio ficaria numa Conversa que nunca mostra o que foi enviado. Sem Conversa canonica ainda,
 * devolve o endereco canonico: o ouvinte a cria na hora em que a mensagem sai.
 */
export function resolverDestinoPorConversa(acervo: Acervo, conversaId: ConversaId): DestinoPorConversa {
  const dada = lerConversaDeEnvio(acervo, conversaId);
  if (dada === undefined) return { tipo: 'inexistente' };

  const canonico = resolverEndereco(acervo, dada.fonte, dada.endereco);
  if (canonico === dada.endereco) return { tipo: 'conversa', dada, usada: dada };

  // A canonica da MESMA natureza e, na direta, da MESMA Configuracao: o fio e da conta.
  const canonica = acervo
    .preparar(
      `SELECT id, fonte, coletiva, configuracao_id, id_externo FROM conversas
        WHERE fonte = ? AND id_externo = ? AND coletiva = ? AND configuracao_id IS ?`,
    )
    .get(dada.fonte, canonico, dada.coletiva ? 1 : 0, dada.configuracaoId) as LinhaDeConversa | undefined;
  if (canonica === undefined) return { tipo: 'endereco', dada, endereco: canonico };
  return { tipo: 'conversa', dada, usada: conversaDeEnvio(canonica) };
}
