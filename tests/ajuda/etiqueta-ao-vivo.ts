import type { MensagemRecebida } from '../../src/adaptadores/whatsapp/ao-vivo.js';

export const GRUPO = '120363000000000001@g.us';
export const LID_DE_OUTRO = '109876543210987@lid';
export const TEL_DE_OUTRO = '5565911110001@s.whatsapp.net';
export const LID_DA_CONTA = '100000000000001@lid';
export const JID_DA_CONTA = '5565911110099@s.whatsapp.net';

export interface OpcoesDeEtiqueta {
  id: string;
  texto: string;
  grupo?: string;
  fromMe?: boolean;
  /** Quem muda a etiqueta, em LID. */
  autor?: string;
  /** O telefone do autor, quando a Fonte o entrega (outro membro). */
  autorPn?: string;
  /** Epoch em SEGUNDOS; a Fonte entrega string. `null` omite o campo. */
  labelTimestamp?: string | number | null;
  messageTimestamp?: number;
  /** O tipo do protocolo: nome (padrao), numero ou outro valor. */
  tipo?: string | number;
}

/** O evento de mudanca de etiqueta, na forma medida em campo (tipo por NOME, campos string). */
export function mudancaDeEtiqueta(o: OpcoesDeEtiqueta): MensagemRecebida {
  const messageTimestamp = o.messageTimestamp ?? 1_791_215_000;
  const memberLabel: Record<string, unknown> = { label: o.texto };
  if (o.labelTimestamp !== null) memberLabel['labelTimestamp'] = String(o.labelTimestamp ?? messageTimestamp);
  return {
    key: {
      remoteJid: o.grupo ?? GRUPO,
      id: o.id,
      fromMe: o.fromMe ?? false,
      participant: o.autor ?? LID_DE_OUTRO,
      ...(o.autorPn !== undefined ? { participantPn: o.autorPn } : {}),
    },
    messageTimestamp,
    message: {
      protocolMessage: { type: o.tipo ?? 'GROUP_MEMBER_LABEL_CHANGE', memberLabel },
      messageContextInfo: {},
    },
  };
}
