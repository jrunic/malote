import type { Acervo } from './acervo.js';
import type { MensagemId } from './tipos.js';

/**
 * As portas do Anexo da imagem do cabecalho da mensagem de modelo (#1242). O nucleo nao interpreta a forma do modelo (isso
 * e vocabulario da Fonte e mora no adaptador): so lista as candidatas e remove o Anexo que o comando criou.
 */

export interface MensagemDeModeloCandidata {
  mensagemId: MensagemId;
  /** O Conteudo Bruto da Mensagem, de onde o adaptador le a imagem do cabecalho. */
  bruto: string;
}

/**
 * As Mensagens de WhatsApp com mensagem de modelo no bruto que NAO tem nenhum Anexo. O filtro de texto e so um pre-corte barato
 * (a mesma ideia da lista do Contato Compartilhado): quem decide se ha imagem no cabecalho e o adaptador, lendo o JSON. Quem ja
 * tem Anexo, `nunca-obtido` ou `presente`, nao entra: a regra de um Anexo por Mensagem vale, e o comando e idempotente.
 */
export function listarMensagensDeModeloSemAnexo(acervo: Acervo): MensagemDeModeloCandidata[] {
  return acervo
    .preparar(
      `SELECT m.id AS mensagemId, m.bruto AS bruto
         FROM mensagens m
        WHERE m.fonte = 'whatsapp' AND m.bruto IS NOT NULL AND instr(m.bruto, '"templateMessage"') > 0
          AND NOT EXISTS (SELECT 1 FROM anexos a WHERE a.mensagem_id = m.id)
        ORDER BY m.ocorrida_em, m.id`,
    )
    .all() as MensagemDeModeloCandidata[];
}

/**
 * Remove UM Anexo, mas so enquanto `nunca-obtido`. Usado por `desfazer`: desfazer a CRIACAO do Anexo nao pode apagar midia que
 * ja foi baixada (isso e Retencao), entao o `presente` e recusado com a causa.
 */
export function removerAnexoNuncaObtido(acervo: Acervo, anexoId: string): 'removido' | 'ja-baixado' | 'inexistente' {
  const linha = acervo.preparar('SELECT presenca FROM anexos WHERE id = ?').get(anexoId) as { presenca: string } | undefined;
  if (linha === undefined) return 'inexistente';
  if (linha.presenca !== 'nunca-obtido') return 'ja-baixado';
  acervo.preparar('DELETE FROM anexos WHERE id = ? AND presenca = ?').run(anexoId, 'nunca-obtido');
  return 'removido';
}

/** Quantas Mensagens de WhatsApp tem mensagem de modelo no bruto, e quantas delas ja tem Anexo. Para o relato do ensaio. */
export function contarMensagensDeModelo(acervo: Acervo): { total: number; comAnexo: number } {
  return acervo
    .preparar(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM anexos a WHERE a.mensagem_id = m.id) THEN 1 ELSE 0 END), 0) AS comAnexo
         FROM mensagens m
        WHERE m.fonte = 'whatsapp' AND m.bruto IS NOT NULL AND instr(m.bruto, '"templateMessage"') > 0`,
    )
    .get() as { total: number; comAnexo: number };
}
