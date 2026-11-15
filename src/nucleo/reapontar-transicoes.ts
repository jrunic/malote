import type { Acervo } from './acervo.js';
import type { Fonte } from './tipos.js';
import type { Operacao } from './trilha.js';

/**
 * As portas de reapontar as Transicoes de um Identificador para outro e de remover o Identificador vazio (#1519). So o nucleo
 * toca em tabela; quem decide que valor e "serializado" e qual e o destino e o Adaptador. Toda escrita relata UMA linha de
 * efeito por mudanca (o `desfazer` devolve item a item, so enquanto o valor e o que a Operacao gravou).
 *
 * | Mudanca | tabela / campo | antes | depois |
 * |---|---|---|---|
 * | Transicao reapontada | `transicoes_de_participacao` / `identificador_id` | id de origem | id do destino |
 * | Transicao fundida (removida) | `transicoes_de_participacao` / `removida-por-fusao` | a linha, em JSON | `null` |
 * | Identificador removido | `identificadores` / `removido` | `{fonte,valor,vistoEm}` em JSON | `null` |
 *
 * A Chegada nao e referencia que recusa (decisao do ciclo 50): o Diario so acrescenta e nao se reescreve. A Chegada fica com o
 * id do Identificador removido, e o `desfazer` o recria com o MESMO id, o que a restaura.
 */

export interface IdentificadorPorPrefixo {
  id: string;
  valor: string;
  vistoEm: string;
}

/** Uma pagina dos Identificadores da Fonte cujo valor comeca por `prefixo` (o Adaptador o passa), em ordem de id, DEPOIS do cursor. */
export function listarIdentificadoresPorPrefixo(
  acervo: Acervo,
  fonte: Fonte,
  prefixo: string,
  depoisDoId: string,
  limite: number,
): IdentificadorPorPrefixo[] {
  if (!Number.isInteger(limite) || limite <= 0)
    throw new RangeError('o limite precisa ser um inteiro maior que zero');
  if (prefixo.length === 0) throw new RangeError('o prefixo nao pode ser vazio');
  return (
    acervo
      .preparar(
        'SELECT id, valor, visto_em FROM identificadores WHERE fonte = ? AND id > ? AND substr(valor, 1, ?) = ? ORDER BY id LIMIT ?',
      )
      .all(fonte, depoisDoId, prefixo.length, prefixo, limite) as Array<{
      id: string;
      valor: string;
      visto_em: string;
    }>
  ).map((l) => ({ id: l.id, valor: l.valor, vistoEm: l.visto_em }));
}

export interface InventarioDoIdentificador {
  /** Transicoes que pendem do Identificador: a Operacao as move. */
  transicoes: number;
  /** O que referencia o Identificador e a Operacao NAO sabe mover: recusa o item. Nome da tabela (ou tabela.campo) e a contagem. */
  outras: Record<string, number>;
  /** Chegadas que o citam como autor: INFORMACAO, nunca recusa (o Diario so acrescenta; decisao do ciclo 50). */
  chegadas: number;
}

const EM = '(SELECT value FROM json_each(?))';

/**
 * O inventario de um CONJUNTO de Identificadores, em lote, FORA de transacao: uma varredura por tabela para o conjunto todo.
 * `mensagens.citada_autor_id` e `chegadas.autor_id` nao tem indice (varrem a tabela: 1 a 7 s no Acervo grande), e e por isso
 * que este e o unico lugar que os le; sob o lock de cada item so ficam as releituras de `referenciasBaratas`.
 */
export function inventarioEmLote(
  acervo: Acervo,
  ids: readonly string[],
): Map<string, InventarioDoIdentificador> {
  const saida = new Map<string, InventarioDoIdentificador>();
  for (const id of new Set(ids)) saida.set(id, { transicoes: 0, outras: {}, chegadas: 0 });
  if (saida.size === 0) return saida;
  const conjunto = JSON.stringify([...saida.keys()]);
  const somar = (
    sql: string,
    aplicar: (inv: InventarioDoIdentificador, n: number) => void,
  ): void => {
    for (const l of acervo.preparar(sql).all(conjunto) as Array<{ id: string; n: number }>) {
      const inv = saida.get(l.id);
      if (inv !== undefined) aplicar(inv, l.n);
    }
  };
  const outra =
    (nome: string) =>
    (inv: InventarioDoIdentificador, n: number): void => {
      inv.outras[nome] = n;
    };
  somar(
    `SELECT identificador_id AS id, COUNT(*) AS n FROM transicoes_de_participacao WHERE identificador_id IN ${EM} GROUP BY 1`,
    (inv, n) => {
      inv.transicoes = n;
    },
  );
  somar(
    `SELECT autor_id AS id, COUNT(*) AS n FROM chegadas WHERE autor_id IN ${EM} GROUP BY 1`,
    (inv, n) => {
      inv.chegadas = n;
    },
  );
  for (const tabela of [
    'atribuicoes_de_nome',
    'cartoes_de_catalogo',
    'etiquetas_de_participacao',
    'participacoes',
    'desvinculos',
  ]) {
    somar(
      `SELECT identificador_id AS id, COUNT(*) AS n FROM ${tabela} WHERE identificador_id IN ${EM} GROUP BY 1`,
      outra(tabela),
    );
  }
  somar(
    `SELECT autor_id AS id, COUNT(*) AS n FROM mensagens WHERE autor_id IN ${EM} GROUP BY 1`,
    outra('mensagens.autor'),
  );
  somar(
    `SELECT citada_autor_id AS id, COUNT(*) AS n FROM mensagens WHERE citada_autor_id IN ${EM} GROUP BY 1`,
    outra('mensagens.citada_autor'),
  );
  somar(
    `SELECT id, 1 AS n FROM identificadores WHERE id IN ${EM} AND pessoa_id IS NOT NULL`,
    outra('pessoa'),
  );
  return saida;
}

/**
 * As releituras que cabem sob o lock de cada item: o que pode ter aparecido depois do inventario em lote. NAO le
 * `mensagens.citada_autor_id` nem `chegadas` (sem indice). `participacoes`, `etiquetas_de_participacao` e `desvinculos` nao
 * tem indice que comece por `identificador_id` e varrem a tabela; sao as menores das que referenciam Identificador, e o custo
 * vai medido no lote (critério 7).
 */
export function referenciasBaratas(
  acervo: Acervo,
  identificadorId: string,
): Record<string, number> {
  const saida: Record<string, number> = {};
  const candidatas: Array<[string, string]> = [
    [
      'atribuicoes_de_nome',
      'SELECT COUNT(*) AS n FROM atribuicoes_de_nome WHERE identificador_id = ?',
    ],
    [
      'cartoes_de_catalogo',
      'SELECT COUNT(*) AS n FROM cartoes_de_catalogo WHERE identificador_id = ?',
    ],
    [
      'etiquetas_de_participacao',
      'SELECT COUNT(*) AS n FROM etiquetas_de_participacao WHERE identificador_id = ?',
    ],
    ['participacoes', 'SELECT COUNT(*) AS n FROM participacoes WHERE identificador_id = ?'],
    ['desvinculos', 'SELECT COUNT(*) AS n FROM desvinculos WHERE identificador_id = ?'],
    ['mensagens.autor', 'SELECT COUNT(*) AS n FROM mensagens WHERE autor_id = ?'],
    ['pessoa', 'SELECT COUNT(*) AS n FROM identificadores WHERE id = ? AND pessoa_id IS NOT NULL'],
  ];
  for (const [nome, sql] of candidatas) {
    const n = (acervo.preparar(sql).get(identificadorId) as { n: number }).n;
    if (n > 0) saida[nome] = n;
  }
  return saida;
}

type LinhaDeTransicao = Record<string, unknown> & { id: string; fonte: string; id_externo: string };

/**
 * Reaponta as Transicoes de `de` para `para`; a que repete o evento ja gravado sob `para` (mesmo identificador de evento da
 * Fonte) e FUNDIDA: sai, com a linha inteira no efeito, porque a regra de unicidade do evento recusaria o reapontar. Uma
 * transacao, uma linha de efeito por Transicao. Devolve as contagens.
 */
export function reapontarTransicoes(
  acervo: Acervo,
  e: { de: string; para: string },
  op: Operacao,
): { reapontadas: number; fundidas: number } {
  return acervo.db.transaction(() => {
    const linhas = acervo
      .preparar('SELECT * FROM transicoes_de_participacao WHERE identificador_id = ? ORDER BY id')
      .all(e.de) as LinhaDeTransicao[];
    const colide = acervo.preparar(
      'SELECT 1 FROM transicoes_de_participacao WHERE fonte = ? AND id_externo = ? AND identificador_id = ?',
    );
    let reapontadas = 0;
    let fundidas = 0;
    for (const t of linhas) {
      if (colide.get(t.fonte, t.id_externo, e.para) !== undefined) {
        acervo.preparar('DELETE FROM transicoes_de_participacao WHERE id = ?').run(t.id);
        op.valor({
          tabela: 'transicoes_de_participacao',
          chave: t.id,
          campo: 'removida-por-fusao',
          antes: JSON.stringify(t),
          depois: null,
        });
        fundidas += 1;
      } else {
        acervo
          .preparar('UPDATE transicoes_de_participacao SET identificador_id = ? WHERE id = ?')
          .run(e.para, t.id);
        op.valor({
          tabela: 'transicoes_de_participacao',
          chave: t.id,
          campo: 'identificador_id',
          antes: e.de,
          depois: e.para,
        });
        reapontadas += 1;
      }
    }
    return { reapontadas, fundidas };
  })();
}

/**
 * Remove o Identificador SO se as referencias que a releitura sob o lock alcanca acabaram. NAO varre
 * `mensagens.citada_autor_id` (sem indice: 1 a 7 s) nem `chegadas` (a Chegada nao e reescrita; decisao do ciclo 50): o
 * inventario em lote, fora do lock, ja recusou o item que tinha citacao, e a porta fechada impede referencia nova a valor
 * serializado. Conferido por EXISTS e nunca deixado a chave estrangeira: as de `identificadores` sao em cascata ou anulam.
 */
export const SQL_REMOVER_SERIALIZADO = `DELETE FROM identificadores
  WHERE id = ?
    AND pessoa_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM atribuicoes_de_nome        WHERE identificador_id = identificadores.id)
    AND NOT EXISTS (SELECT 1 FROM cartoes_de_catalogo        WHERE identificador_id = identificadores.id)
    AND NOT EXISTS (SELECT 1 FROM etiquetas_de_participacao  WHERE identificador_id = identificadores.id)
    AND NOT EXISTS (SELECT 1 FROM participacoes              WHERE identificador_id = identificadores.id)
    AND NOT EXISTS (SELECT 1 FROM transicoes_de_participacao WHERE identificador_id = identificadores.id)
    AND NOT EXISTS (SELECT 1 FROM desvinculos                WHERE identificador_id = identificadores.id)
    AND NOT EXISTS (SELECT 1 FROM mensagens                  WHERE autor_id = identificadores.id)`;

export function removerIdentificadorSerializado(
  acervo: Acervo,
  identificadorId: string,
  op: Operacao,
): 'removido' | 'em-uso' | 'ja-nao-existe' {
  return acervo.db.transaction(() => {
    const linha = acervo
      .preparar('SELECT fonte, valor, visto_em FROM identificadores WHERE id = ?')
      .get(identificadorId) as { fonte: string; valor: string; visto_em: string } | undefined;
    if (linha === undefined) return 'ja-nao-existe' as const;
    if (acervo.preparar(SQL_REMOVER_SERIALIZADO).run(identificadorId).changes !== 1)
      return 'em-uso' as const;
    op.valor({
      tabela: 'identificadores',
      chave: identificadorId,
      campo: 'removido',
      antes: JSON.stringify({ fonte: linha.fonte, valor: linha.valor, vistoEm: linha.visto_em }),
      depois: null,
    });
    return 'removido' as const;
  })();
}

// ---------------------------------------------------------------------------------------------------------------------------
// As guardas do `desfazer`: `null` (desfeito) ou a causa da recusa; nunca lancam por estado mudado.

/** Linha `identificador_id`: devolve a Transicao a `de`, SO se ela ainda pende de `para` e o evento esta livre em `de`. */
export function devolverTransicaoReapontada(
  acervo: Acervo,
  e: { transicaoId: string; de: string; para: string },
): string | null {
  const t = acervo
    .preparar(
      'SELECT fonte, id_externo, identificador_id FROM transicoes_de_participacao WHERE id = ?',
    )
    .get(e.transicaoId) as
    { fonte: string; id_externo: string; identificador_id: string } | undefined;
  if (t === undefined) return 'a Transicao ja nao existe';
  if (t.identificador_id !== e.para) {
    return 'a Transicao ja nao pende do Identificador que a Operacao gravou (mudou depois) e fica onde esta';
  }
  if (acervo.preparar('SELECT 1 FROM identificadores WHERE id = ?').get(e.de) === undefined) {
    return 'o Identificador de origem ja nao existe';
  }
  const ocupado = acervo
    .preparar(
      'SELECT 1 FROM transicoes_de_participacao WHERE fonte = ? AND id_externo = ? AND identificador_id = ?',
    )
    .get(t.fonte, t.id_externo, e.de);
  if (ocupado !== undefined)
    return 'o Identificador de origem ja tem a Transicao desse evento; a do destino fica';
  acervo
    .preparar(
      'UPDATE transicoes_de_participacao SET identificador_id = ? WHERE id = ? AND identificador_id = ?',
    )
    .run(e.de, e.transicaoId, e.para);
  return null;
}

/** Recria a Transicao fundida, com a linha inteira que a Operacao guardou, SO se o id e a chave de unicidade do evento estao livres. */
export function devolverTransicaoFundida(
  acervo: Acervo,
  e: { transicaoId: string; linha: string },
): string | null {
  const t = JSON.parse(e.linha) as LinhaDeTransicao & { identificador_id: string };
  if (
    acervo.preparar('SELECT 1 FROM transicoes_de_participacao WHERE id = ?').get(e.transicaoId) !==
    undefined
  ) {
    return 'a Transicao ja existe de novo';
  }
  if (
    acervo.preparar('SELECT 1 FROM identificadores WHERE id = ?').get(t.identificador_id) ===
    undefined
  ) {
    return 'o Identificador da Transicao ja nao existe; devolva o Identificador antes';
  }
  if (
    acervo
      .preparar(
        'SELECT 1 FROM transicoes_de_participacao WHERE fonte = ? AND id_externo = ? AND identificador_id = ?',
      )
      .get(t.fonte, t.id_externo, t.identificador_id) !== undefined
  ) {
    return 'o evento ja esta gravado sob esse Identificador';
  }
  const colunas = Object.keys(t);
  acervo
    .preparar(
      `INSERT INTO transicoes_de_participacao (${colunas.map((c) => `"${c}"`).join(', ')}) VALUES (${colunas.map(() => '?').join(', ')})`,
    )
    .run(...colunas.map((c) => t[c]));
  return null;
}

/** Recria o Identificador removido, com o MESMO id (as Transicoes devolvidas e as Chegadas pendem dele), SO se o id e o valor estao livres. */
export function devolverIdentificadorRemovido(
  acervo: Acervo,
  e: { identificadorId: string; dados: string },
): string | null {
  const d = JSON.parse(e.dados) as { fonte: string; valor: string; vistoEm: string };
  if (
    acervo.preparar('SELECT 1 FROM identificadores WHERE id = ?').get(e.identificadorId) !==
    undefined
  ) {
    return 'o Identificador ja existe de novo';
  }
  if (
    acervo
      .preparar('SELECT 1 FROM identificadores WHERE fonte = ? AND valor = ?')
      .get(d.fonte, d.valor) !== undefined
  ) {
    return 'o valor ja e de outro Identificador';
  }
  acervo
    .preparar('INSERT INTO identificadores (id, fonte, valor, visto_em) VALUES (?, ?, ?, ?)')
    .run(e.identificadorId, d.fonte, d.valor, d.vistoEm);
  return null;
}
