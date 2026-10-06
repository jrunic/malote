import type { Acervo } from './acervo.js';

/**
 * A etiqueta VIGENTE de um membro numa Conversa: a do evento de maior instante.
 * `texto` e `null` quando a vigente e a remocao (texto vazio): "sem etiqueta"
 * e um estado, e se distingue de "nunca observada", que e a ausencia no mapa.
 *
 * Empate de instante desempata pela identidade do evento, de forma
 * deterministica e sem relacao com a ordem de insercao (a Fonte entrega fora de
 * ordem, e a ordem de chegada e dela, nao nossa). Duas mudancas no mesmo
 * segundo sao possiveis: a plataforma declara o instante em segundos.
 */
export interface EtiquetaVigente {
  identificadorId: string;
  texto: string | null;
  /** Instante do evento vigente, em milissegundos. */
  em: number;
}

const SEM_LIMITE = Number.MAX_SAFE_INTEGER;

/**
 * Todas as vigentes de UMA Conversa, numa consulta so, ate o instante `ate`
 * (inclusive). `ate` ausente e agora. Fora do Alcance nada muda aqui: quem
 * decide o que a data significa e o chamador.
 */
export function etiquetasVigentesDaConversa(
  acervo: Acervo,
  conversaId: string,
  ate: number = SEM_LIMITE,
): Map<string, EtiquetaVigente> {
  const linhas = acervo
    .preparar(
      `SELECT identificador_id AS identificadorId, texto, ocorrida_em AS em
         FROM (
           SELECT identificador_id, texto, ocorrida_em,
                  ROW_NUMBER() OVER (
                    PARTITION BY identificador_id
                    ORDER BY ocorrida_em DESC, id_externo DESC
                  ) AS posicao
             FROM etiquetas_de_participacao
            WHERE conversa_id = ? AND ocorrida_em <= ?
         )
        WHERE posicao = 1`,
    )
    .all(conversaId, ate) as Array<{ identificadorId: string; texto: string; em: number }>;
  const mapa = new Map<string, EtiquetaVigente>();
  for (const l of linhas) {
    mapa.set(l.identificadorId, {
      identificadorId: l.identificadorId,
      texto: l.texto === '' ? null : l.texto,
      em: l.em,
    });
  }
  return mapa;
}
