import type { Acervo } from './acervo.js';
import type { Direcao, Fonte } from './tipos.js';

/**
 * A Citacao (#1334): a Mensagem responde a outra pelo recurso de citacao da Fonte. Objeto de valor da Mensagem.
 *
 * O que a Fonte declara e so isto: o id externo da citada e, quando sabe, quem a escreveu e se foi enviada pela
 * propria conta. Quem sabe em que ponto do registro da Fonte isso vem e o Adaptador; o nucleo nao conhece formato.
 */
export interface CitacaoDeEntrada {
  /** O id externo da Mensagem citada. Gravado mesmo quando ela nao esta no Acervo. */
  idExterno: string;
  /** O Identificador do autor da citada. Ausente quando a citada e da propria conta (a Mensagem enviada nao tem autor). */
  autorId?: string;
  /** Enviada pela propria conta ou recebida. Ausente quando a Fonte nao permite saber. */
  direcao?: Direcao;
}

export interface ColunasDaCitacao {
  citadaId: string | null;
  idExterno: string;
  autorId: string | null;
  direcao: Direcao | null;
}

interface CitadaNoAcervo {
  id: string;
  autor_id: string | null;
  direcao: Direcao | null;
}

/**
 * As colunas da Citacao. A citada se procura pela Fonte e pelo id externo DENTRO da mesma Conversa: citada em outra
 * Conversa nao e vinculada (o id externo fica gravado). Quando a citada esta no Acervo, o autor e a direcao DELA
 * valem sobre o que a Fonte declarou na citacao.
 */
export function colunasDaCitacao(
  acervo: Acervo,
  alvo: { fonte: Fonte; conversaId: string },
  citacao: CitacaoDeEntrada,
): ColunasDaCitacao {
  const citada = acervo
    .preparar('SELECT id, autor_id, direcao FROM mensagens WHERE fonte = ? AND id_externo = ? AND conversa_id = ?')
    .get(alvo.fonte, citacao.idExterno, alvo.conversaId) as CitadaNoAcervo | undefined;
  if (citada === undefined) {
    return {
      citadaId: null,
      idExterno: citacao.idExterno,
      autorId: citacao.autorId ?? null,
      direcao: citacao.direcao ?? null,
    };
  }
  return {
    citadaId: citada.id,
    idExterno: citacao.idExterno,
    autorId: citada.autor_id,
    direcao: citada.direcao,
  };
}

/**
 * O vinculo tardio: a Mensagem `citada` acabou de ser gravada, e outras na MESMA Conversa e Fonte ja a citavam pelo id
 * externo sem achar o Acervo. Completa o vinculo, o autor e a direcao, so nas que ainda nao tinham vinculo.
 */
export function vincularCitantes(
  acervo: Acervo,
  citada: { id: string; fonte: Fonte; conversaId: string; idExterno: string; autorId: string | null; direcao: Direcao },
): number {
  return acervo
    .preparar(
      `UPDATE mensagens
          SET citada_id = ?, citada_autor_id = ?, citada_direcao = ?
        WHERE fonte = ? AND citada_id_externo = ? AND conversa_id = ? AND citada_id IS NULL`,
    )
    .run(citada.id, citada.autorId, citada.direcao, citada.fonte, citada.idExterno, citada.conversaId).changes;
}
