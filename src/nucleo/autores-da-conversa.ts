import type { Acervo } from './acervo.js';
import { nomesEmLote } from './nomes-em-lote.js';
import type { ConversaId } from './tipos.js';
import type { PrecedenciaDeNome } from '../registro/precedencia-de-nome.js';

export interface AutorDaConversa {
  identificadorId: string;
  valor: string;
  nome: string | null;
  origemDoNome: string | null;
  pessoaId: string | null;
}

/**
 * Exportada para um teste afirmar o PLANO: parte do indice da Conversa, e o `DISTINCT` aparece nele.
 *
 * `DISTINCT` e custo, nao resultado: sem ele os ids repetidos entram no JSON (uma linha por Mensagem) e
 * `IN (json_each)` os colapsa, entao a resposta e a mesma — o teste do plano e o que o guarda.
 * Mutante que sobrevive por EQUIVALENCIA: tirar `autor_id IS NOT NULL` leva um `null` ao JSON, que
 * `IN (json_each)` nunca casa com linha nenhuma, entao nenhuma resposta muda (medido em 04/10/2026).
 */
export const SQL_DOS_AUTORES_DA_CONVERSA =
  'SELECT DISTINCT autor_id FROM mensagens WHERE conversa_id = ? AND autor_id IS NOT NULL';

/**
 * Os Identificadores que ESCREVERAM na Conversa — nao os participantes: medido numa Conversa de
 * 101.527 Mensagens, 850 dos 2.200 autores (39%) nao constam de `participantes`, porque escrever
 * nao exige Participacao gravada. Cada um com valor, nome corrente (em LOTE, nunca por linha), a
 * origem do nome e a Pessoa. So le: nao abre Operacao.
 */
export function autoresDaConversa(
  acervo: Acervo,
  conversaId: ConversaId,
  precedencia: PrecedenciaDeNome,
): AutorDaConversa[] {
  const ids = (acervo.preparar(SQL_DOS_AUTORES_DA_CONVERSA).all(conversaId) as Array<{ autor_id: string }>).map(
    (l) => l.autor_id,
  );
  if (ids.length === 0) return [];
  const nomes = nomesEmLote(acervo, ids, precedencia);
  const linhas = acervo
    .preparar('SELECT id, valor, pessoa_id FROM identificadores WHERE id IN (SELECT value FROM json_each(?)) ORDER BY valor')
    .all(JSON.stringify(ids)) as Array<{ id: string; valor: string; pessoa_id: string | null }>;
  return linhas.map((l) => ({
    identificadorId: l.id,
    valor: l.valor,
    nome: nomes.get(l.id)?.nome ?? null,
    origemDoNome: nomes.get(l.id)?.origem ?? null,
    pessoaId: l.pessoa_id,
  }));
}
