import type { Acervo } from './acervo.js';
import type { Fonte } from './tipos.js';

/**
 * A familia de formas de um Identificador gravado: as formas do MESMO endereco que a Correspondencia de endereco
 * conhece (a canonica e as alternativas). Nao confundir com a familia de Pessoas da mesclagem (`familia.ts`): esta e
 * de enderecos, aquela de Pessoas.
 *
 * `canonico` e nulo quando nenhuma Correspondencia liga o endereco a outra forma: nunca se inventa (o que nao tem par
 * resolve para ele mesmo, mas aqui a ausencia de par e a informacao). Quando o proprio endereco e o canonico de algum
 * par, `canonico` e ele mesmo. `outrasFormas` traz os VALORES das outras formas, gravadas como Identificador ou so
 * como correspondencia, ordenados por valor; `identificadorIds` traz os ids GRAVADOS da familia, o proprio primeiro e
 * os demais na ordem das formas.
 */
export interface FamiliaDeIdentificador {
  valor: string;
  canonico: string | null;
  outrasFormas: string[];
  identificadorIds: string[];
}

interface Linha {
  id: string;
  fonte: Fonte;
  valor: string;
}

/**
 * As tres consultas do lote, exportadas para o teste de plano de consulta fixar que pagam o indice (a PK da
 * correspondencia, o indice por canonico e a unicidade `(fonte, valor)` dos Identificadores), com `json_each` por fora.
 */
export const SQL_CANONICO_DAS_FORMAS = `SELECT c.fonte, c.alternativo, c.canonico FROM json_each(?) j
  JOIN correspondencias_de_endereco c ON c.fonte = json_extract(j.value, '$.f') AND c.alternativo = json_extract(j.value, '$.v')`;
export const SQL_ALTERNATIVAS_DOS_CANONICOS = `SELECT c.fonte, c.canonico, c.alternativo FROM json_each(?) j
  JOIN correspondencias_de_endereco c ON c.fonte = json_extract(j.value, '$.f') AND c.canonico = json_extract(j.value, '$.v')`;
export const SQL_GRAVADOS_DAS_FORMAS = `SELECT i.id, i.fonte, i.valor FROM json_each(?) j
  JOIN identificadores i ON i.fonte = json_extract(j.value, '$.f') AND i.valor = json_extract(j.value, '$.v')`;

const chave = (fonte: string, valor: string): string => `${fonte}\u0000${valor}`;

/**
 * A familia de cada Identificador do conjunto, com uma consulta por tabela, nunca uma por Identificador (a pagina de
 * leitura do Acervo grande tem centenas de autores). Id que nao existe nao entra no resultado. So le.
 */
export function familiasDeIdentificadores(
  acervo: Acervo,
  ids: readonly string[],
): Map<string, FamiliaDeIdentificador> {
  const saida = new Map<string, FamiliaDeIdentificador>();
  if (ids.length === 0) return saida;
  const base = acervo
    .preparar(
      'SELECT id, fonte, valor FROM identificadores WHERE id IN (SELECT value FROM json_each(?))',
    )
    .all(JSON.stringify([...new Set(ids)])) as Linha[];
  if (base.length === 0) return saida;

  const comoAlternativo = acervo
    .preparar(SQL_CANONICO_DAS_FORMAS)
    .all(JSON.stringify(base.map((b) => ({ f: b.fonte, v: b.valor })))) as Array<{
    fonte: string;
    alternativo: string;
    canonico: string;
  }>;
  const canonicoDe = new Map(
    comoAlternativo.map((l) => [chave(l.fonte, l.alternativo), l.canonico]),
  );

  const raizes = new Map<string, { f: string; v: string }>();
  for (const b of base) {
    const v = canonicoDe.get(chave(b.fonte, b.valor)) ?? b.valor;
    raizes.set(chave(b.fonte, v), { f: b.fonte, v });
  }
  const alternativas = acervo
    .preparar(SQL_ALTERNATIVAS_DOS_CANONICOS)
    .all(JSON.stringify([...raizes.values()])) as Array<{
    fonte: string;
    canonico: string;
    alternativo: string;
  }>;
  const alternativasDe = new Map<string, string[]>();
  for (const l of alternativas) {
    const k = chave(l.fonte, l.canonico);
    const lista = alternativasDe.get(k);
    if (lista === undefined) alternativasDe.set(k, [l.alternativo]);
    else lista.push(l.alternativo);
  }

  const formasPorId = new Map<
    string,
    { fonte: Fonte; outras: string[]; canonico: string | null }
  >();
  const todasAsFormas = new Map<string, { f: string; v: string }>();
  for (const b of base) {
    const raiz = canonicoDe.get(chave(b.fonte, b.valor)) ?? b.valor;
    const alts = alternativasDe.get(chave(b.fonte, raiz)) ?? [];
    const outras = [...new Set([raiz, ...alts])].filter((v) => v !== b.valor).sort();
    const temPar = canonicoDe.has(chave(b.fonte, b.valor)) || alts.length > 0;
    formasPorId.set(b.id, { fonte: b.fonte, outras, canonico: temPar ? raiz : null });
    for (const v of outras) todasAsFormas.set(chave(b.fonte, v), { f: b.fonte, v });
  }

  const gravados =
    todasAsFormas.size === 0
      ? []
      : (acervo
          .preparar(SQL_GRAVADOS_DAS_FORMAS)
          .all(JSON.stringify([...todasAsFormas.values()])) as Linha[]);
  const idPorForma = new Map(gravados.map((g) => [chave(g.fonte, g.valor), g.id]));

  for (const b of base) {
    const f = formasPorId.get(b.id)!;
    const idsDaFamilia = [b.id];
    for (const v of f.outras) {
      const id = idPorForma.get(chave(f.fonte, v));
      if (id !== undefined && !idsDaFamilia.includes(id)) idsDaFamilia.push(id);
    }
    saida.set(b.id, {
      valor: b.valor,
      canonico: f.canonico,
      outrasFormas: f.outras,
      identificadorIds: idsDaFamilia,
    });
  }
  return saida;
}
