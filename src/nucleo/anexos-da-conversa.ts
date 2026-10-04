import type { Acervo } from './acervo.js';
import { COLUNAS_DO_ANEXO, CONDICAO_DE_AUTORES, anexoDeLinha, type AnexoLido } from './consulta.js';
import { codificarCursor, type CursorDePaginacao } from './cursor.js';
import type { ConversaId, Presenca } from './tipos.js';

export interface FiltroDeAnexos {
  conversaId: ConversaId;
  /** Exato, contra o vocabulario que a Fonte entrega e o Acervo guarda (`image`, `document`, ...). */
  tipo?: string;
  /** Ids de Identificador autores; a lista vazia nao casa nada. */
  autorIds?: string[];
  de?: number;
  ate?: number;
  presenca?: Presenca;
  limite?: number;
  /** Exclusivo: `(ocorridaEm da Mensagem, id do Anexo)` do ultimo item da pagina anterior. */
  cursor?: CursorDePaginacao;
}

export interface AnexoDaConversa extends AnexoLido {
  mensagemId: string;
  autorId: string | null;
  ocorridaEm: number;
}

/**
 * A consulta, separada da execucao para um teste afirmar o PLANO dela. `CROSS JOIN` fixa a ordem:
 * as Mensagens da Conversa pelo indice `(conversa_id, ocorrida_em)` primeiro, e os Anexos entram
 * pelo indice `(mensagem_id)`. Sem a ordem fixa o otimizador pode comecar pela tabela de Anexos,
 * que e a maior do Acervo. UMA consulta para a pagina inteira — nunca uma por Mensagem.
 *
 * Mutante que sobrevive POR EQUIVALENCIA: trocar `CROSS JOIN` por `JOIN` nao muda o plano na fixture
 * (medido em 04/10/2026: o mesmo `EXPLAIN QUERY PLAN`, com so tres Anexos por Mensagem e sem
 * estatistica), entao nenhum teste o separa. O `CROSS JOIN` e a protecao contra o otimizador, em
 * producao, comecar pela tabela de Anexos; o criterio de custo e medido na maior Conversa no aceite.
 */
export function montarConsultaDeAnexos(filtro: FiltroDeAnexos): { sql: string; valores: unknown[] } {
  const condicoes = ['m.conversa_id = ?'];
  const valores: unknown[] = [filtro.conversaId];
  if (filtro.tipo !== undefined) {
    condicoes.push('a.tipo = ?');
    valores.push(filtro.tipo);
  }
  if (filtro.autorIds !== undefined) {
    condicoes.push(CONDICAO_DE_AUTORES);
    valores.push(JSON.stringify(filtro.autorIds));
  }
  if (filtro.de !== undefined) {
    condicoes.push('m.ocorrida_em >= ?');
    valores.push(filtro.de);
  }
  if (filtro.ate !== undefined) {
    condicoes.push('m.ocorrida_em <= ?');
    valores.push(filtro.ate);
  }
  if (filtro.presenca !== undefined) {
    condicoes.push('a.presenca = ?');
    valores.push(filtro.presenca);
  }
  if (filtro.cursor !== undefined) {
    condicoes.push('(m.ocorrida_em > ? OR (m.ocorrida_em = ? AND a.id > ?))');
    valores.push(filtro.cursor.ocorridaEm, filtro.cursor.ocorridaEm, filtro.cursor.id);
  }
  let limite = '';
  if (filtro.limite !== undefined) {
    if (!Number.isInteger(filtro.limite) || filtro.limite < 1) {
      throw new Error(`limite invalido: ${String(filtro.limite)}`);
    }
    limite = ` LIMIT ${filtro.limite}`;
  }
  const sql = `
    SELECT ${COLUNAS_DO_ANEXO},
           m.id AS mensagem_id, m.autor_id AS autor_id, m.ocorrida_em AS ocorrida_em
      FROM mensagens m
      CROSS JOIN anexos a ON a.mensagem_id = m.id
      LEFT JOIN transcricoes t ON t.anexo_id = a.id
     WHERE ${condicoes.join(' AND ')}
     ORDER BY m.ocorrida_em ASC, a.id ASC${limite}`;
  return { sql, valores };
}

/** Os Anexos de UMA Conversa, em ordem cronologica. Nao ha `ordem`: a unica e a que o cursor pagina. */
export function listarAnexosDaConversa(acervo: Acervo, filtro: FiltroDeAnexos): AnexoDaConversa[] {
  const { sql, valores } = montarConsultaDeAnexos(filtro);
  const linhas = acervo.preparar(sql).all(...valores) as Array<Record<string, unknown>>;
  return linhas.map((l) => ({
    ...anexoDeLinha(l),
    mensagemId: l['mensagem_id'] as string,
    autorId: (l['autor_id'] as string | null) ?? null,
    ocorridaEm: l['ocorrida_em'] as number,
  }));
}

/**
 * O token `proximo`, quando a pagina veio cheia — o mesmo criterio de `mensagens`: sem `limite` nao
 * ha pagina, e pagina menor que o limite e a ultima. O consumidor devolve o token, nunca o monta.
 */
export function cursorDaProximaPagina(anexos: AnexoDaConversa[], limite: number | undefined): string | undefined {
  if (limite === undefined || anexos.length === 0 || anexos.length < limite) return undefined;
  const ultimo = anexos[anexos.length - 1]!;
  return codificarCursor({ ocorridaEm: ultimo.ocorridaEm, id: ultimo.id });
}
