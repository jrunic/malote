import type { MensagemRecebida } from '../../src/adaptadores/whatsapp/ao-vivo.js';

export const GRUPO_DE_TESTE = '120363000000000002@g.us';
export const LID_DA_CONTA = '100000000000002@lid';
export const LID_DE_OUTRO_MEMBRO = '100000000000003@lid';

export interface OpcoesDeEventoDeGrupo {
  id: string;
  /** O tipo do evento: NOME (como chega depois do round-trip de JSON) ou numero. */
  tipo: string | number;
  /** `null` e a forma MEDIDA da remocao da descricao; `undefined` omite o campo. */
  parametros?: string[] | null;
  grupo?: string;
  autor?: string;
  /** Epoch em SEGUNDOS; a Fonte entrega numero ou texto. */
  ts?: number | string;
}

/** O evento de grupo, na forma medida pela espiga de 13 e 14/10/2026: sem `message`, com tipo e parametros. */
export function eventoDeGrupo(o: OpcoesDeEventoDeGrupo): MensagemRecebida {
  return {
    key: {
      remoteJid: o.grupo ?? GRUPO_DE_TESTE,
      id: o.id,
      // A espiga mediu: mesmo quando a propria conta altera, o evento chega com fromMe falso.
      fromMe: false,
      participant: o.autor ?? LID_DE_OUTRO_MEMBRO,
    },
    messageTimestamp: (o.ts ?? 1_791_922_317) as number,
    messageStubType: o.tipo,
    ...(o.parametros === undefined ? {} : { messageStubParameters: o.parametros as string[] }),
  };
}

/** O aviso de metadados de grupo quando o grupo e criado (`groups.upsert`): traz o instante do assunto. */
export function avisoDeCriacao(o: { grupo?: string; assunto: string; descricao?: string; subjectTime?: number; autor?: string }): unknown {
  return [
    {
      id: o.grupo ?? GRUPO_DE_TESTE,
      subject: o.assunto,
      ...(o.descricao === undefined ? {} : { desc: o.descricao }),
      subjectTime: o.subjectTime ?? 1_791_922_202,
      creation: 1_791_922_202,
      owner: o.autor ?? LID_DE_OUTRO_MEMBRO,
      participants: [
        { id: o.autor ?? LID_DE_OUTRO_MEMBRO, lid: o.autor ?? LID_DE_OUTRO_MEMBRO, admin: 'superadmin' },
        { id: LID_DA_CONTA, lid: LID_DA_CONTA, admin: null },
      ],
      author: o.autor ?? LID_DE_OUTRO_MEMBRO,
    },
  ];
}

/** O aviso de troca (`groups.update`): so o campo que mudou e o autor, SEM instante. */
export function avisoDeTroca(o: { grupo?: string; assunto?: string; descricao?: string; autor?: string }): unknown {
  return [
    {
      id: o.grupo ?? GRUPO_DE_TESTE,
      ...(o.assunto === undefined ? {} : { subject: o.assunto }),
      ...(o.descricao === undefined ? {} : { desc: o.descricao }),
      author: o.autor ?? LID_DE_OUTRO_MEMBRO,
    },
  ];
}
