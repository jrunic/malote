import type { Acervo } from './acervo.js';
import type { PrecedenciaDeNome } from '../registro/precedencia-de-nome.js';
import { nomesEmLote } from './nomes-em-lote.js';

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

export interface EtiquetaDeIdentificador {
  conversaId: string;
  texto: string | null;
  em: number;
}

/** Vigentes de um CONJUNTO de Identificadores, por Conversa, numa consulta so. */
export function etiquetasDosIdentificadores(
  acervo: Acervo,
  identificadorIds: readonly string[],
): Map<string, EtiquetaDeIdentificador[]> {
  const mapa = new Map<string, EtiquetaDeIdentificador[]>();
  if (identificadorIds.length === 0) return mapa;
  const linhas = acervo
    .preparar(
      `SELECT identificador_id AS identificadorId, conversa_id AS conversaId, texto, ocorrida_em AS em
         FROM (
           SELECT identificador_id, conversa_id, texto, ocorrida_em,
                  ROW_NUMBER() OVER (
                    PARTITION BY identificador_id, conversa_id
                    ORDER BY ocorrida_em DESC, id_externo DESC
                  ) AS posicao
             FROM etiquetas_de_participacao
            WHERE identificador_id IN (SELECT value FROM json_each(?))
         )
        WHERE posicao = 1
        ORDER BY em DESC, conversaId`,
    )
    .all(JSON.stringify(identificadorIds)) as Array<{
    identificadorId: string;
    conversaId: string;
    texto: string;
    em: number;
  }>;
  for (const l of linhas) {
    const lista = mapa.get(l.identificadorId) ?? [];
    lista.push({ conversaId: l.conversaId, texto: l.texto === '' ? null : l.texto, em: l.em });
    mapa.set(l.identificadorId, lista);
  }
  return mapa;
}

/** O que `participantes` acrescenta a cada membro. */
export interface EtiquetaDoMembro {
  /** O texto vigente, ou `null` quando ausente OU removida. */
  etiqueta: string | null;
  /** O instante do ultimo evento ate a data; `null` quando NUNCA observada. */
  etiquetaEm: number | null;
}

type ComEtiquetas<R> = {
  [K in keyof R]: K extends 'presentes' | 'sairamAntes' | 'aindaNaoEntraram' | 'semInformacao'
    ? Array<(R[K] extends Array<infer U> ? U : never) & EtiquetaDoMembro>
    : R[K];
};

/**
 * Acrescenta `etiqueta` e `etiquetaEm` a CADA membro que a resposta de presenca
 * ja lista, com UMA consulta por Conversa. NAO muda o conjunto de membros nem a
 * regra de Alcance: quem so tem etiqueta nao entra na lista, e fora do Alcance
 * a lista segue como estava. A data e a MESMA que a resposta usou (`em`), entao
 * a etiqueta herda o comportamento do resto do comando.
 */
export function acrescentarEtiquetas<
  R extends {
    conversaId: string;
    em: number;
    presentes: Array<{ identificadorId: string }>;
    sairamAntes: Array<{ identificadorId: string }>;
    aindaNaoEntraram: Array<{ identificadorId: string }>;
    semInformacao: Array<{ identificadorId: string }>;
  },
>(acervo: Acervo, resposta: R): ComEtiquetas<R> {
  const vigentes = etiquetasVigentesDaConversa(acervo, resposta.conversaId, resposta.em);
  const acrescentar = <T extends { identificadorId: string }>(p: T): T & EtiquetaDoMembro => {
    const v = vigentes.get(p.identificadorId);
    return { ...p, etiqueta: v?.texto ?? null, etiquetaEm: v?.em ?? null };
  };
  return {
    ...resposta,
    presentes: resposta.presentes.map(acrescentar),
    sairamAntes: resposta.sairamAntes.map(acrescentar),
    aindaNaoEntraram: resposta.aindaNaoEntraram.map(acrescentar),
    semInformacao: resposta.semInformacao.map(acrescentar),
  } as ComEtiquetas<R>;
}

export const LIMITE_DE_ETIQUETAS = { padrao: 100, maximo: 1000 } as const;

export interface FiltroDeEtiquetas {
  conversaId?: string;
  /** Identificadores GRAVADOS que o remetente alcanca (`identificadoresDoRemetente`); vazio devolve NADA. */
  autorIds?: readonly string[];
  /** Texto LITERAL. */
  busca?: string;
  /** Todos os eventos do membro na Conversa; exige `conversaId` e `autorIds`. */
  historico?: boolean;
  limite?: number;
}

export interface EtiquetaListada {
  conversaId: string;
  identificadorId: string;
  /** O valor do Identificador (com a Fonte implicita na Conversa). */
  valor: string;
  nome: string | null;
  origemDoNome: string | null;
  /** `null` e a remocao (so aparece no historico). */
  texto: string | null;
  em: number;
}

/**
 * Lista e busca etiquetas. NAO depende de Alcance: e a superficie de quem
 * procura um texto (o numero de um registro profissional, por exemplo).
 * Ordem: do mais novo ao mais antigo, e o limite padrao (100) corta o resto;
 * quem precisa de mais refina por Conversa ou remetente.
 */
export function listarEtiquetas(
  acervo: Acervo,
  filtro: FiltroDeEtiquetas,
  precedencia: PrecedenciaDeNome,
): EtiquetaListada[] {
  const limite = filtro.limite ?? LIMITE_DE_ETIQUETAS.padrao;
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_DE_ETIQUETAS.maximo) {
    throw new Error(`limite precisa ser um inteiro de 1 a ${LIMITE_DE_ETIQUETAS.maximo}`);
  }
  if (filtro.historico === true && (filtro.conversaId === undefined || filtro.autorIds === undefined)) {
    throw new Error('--historico exige conversa e remetente');
  }
  // Remetente sem nenhum Identificador devolve NADA, nunca tudo. Mutante que sobrevive por
  // EQUIVALENCIA (medido em 06/10/2026): sem esta linha, `IN (SELECT value FROM json_each('[]'))` ja
  // devolve zero linhas; a guarda so poupa a consulta, e nenhum teste a separa.
  if (filtro.autorIds !== undefined && filtro.autorIds.length === 0) return [];

  const condicoes: string[] = [];
  const valores: Array<string | number> = [];
  if (filtro.conversaId !== undefined) {
    condicoes.push('conversa_id = ?');
    valores.push(filtro.conversaId);
  }
  if (filtro.autorIds !== undefined) {
    condicoes.push('identificador_id IN (SELECT value FROM json_each(?))');
    valores.push(JSON.stringify(filtro.autorIds));
  }
  const onde = condicoes.length === 0 ? '' : `WHERE ${condicoes.join(' AND ')}`;

  let busca = '';
  const valoresDaBusca: string[] = [];
  if (filtro.busca !== undefined) {
    // Termo do usuario e LITERAL: % e _ escapados, como em `conversas --busca`.
    const termo = filtro.busca.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
    busca = `LOWER(texto) LIKE LOWER(?) ESCAPE '\\'`;
    valoresDaBusca.push(`%${termo}%`);
  }

  const sql =
    filtro.historico === true
      ? `SELECT conversa_id AS conversaId, identificador_id AS identificadorId, texto, ocorrida_em AS em
           FROM etiquetas_de_participacao ${onde}
          ${busca === '' ? '' : `${onde === '' ? 'WHERE' : 'AND'} ${busca}`}
          ORDER BY ocorrida_em DESC, id_externo DESC LIMIT ?`
      : `SELECT conversaId, identificadorId, texto, em FROM (
           SELECT conversa_id AS conversaId, identificador_id AS identificadorId, texto, ocorrida_em AS em,
                  ROW_NUMBER() OVER (
                    PARTITION BY conversa_id, identificador_id
                    ORDER BY ocorrida_em DESC, id_externo DESC
                  ) AS posicao
             FROM etiquetas_de_participacao ${onde}
         )
          WHERE posicao = 1 AND texto <> '' ${busca === '' ? '' : `AND ${busca}`}
          ORDER BY em DESC, conversaId, identificadorId LIMIT ?`;

  const linhas = acervo.preparar(sql).all(...valores, ...valoresDaBusca, limite) as Array<{
    conversaId: string;
    identificadorId: string;
    texto: string;
    em: number;
  }>;

  const ids = [...new Set(linhas.map((l) => l.identificadorId))];
  const nomes = nomesEmLote(acervo, ids, precedencia);
  const valoresDoId = new Map<string, string>();
  if (ids.length > 0) {
    for (const l of acervo
      .preparar('SELECT id, valor FROM identificadores WHERE id IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(ids)) as Array<{ id: string; valor: string }>) {
      valoresDoId.set(l.id, l.valor);
    }
  }
  return linhas.map((l) => ({
    conversaId: l.conversaId,
    identificadorId: l.identificadorId,
    valor: valoresDoId.get(l.identificadorId) ?? '',
    nome: nomes.get(l.identificadorId)?.nome ?? null,
    origemDoNome: nomes.get(l.identificadorId)?.origem ?? null,
    texto: l.texto === '' ? null : l.texto,
    em: l.em,
  }));
}
