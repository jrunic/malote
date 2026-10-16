import type { Acervo } from './acervo.js';
import { consultarConversas, type ConversaListada, type ConversaListadaComChave, type FiltroDeConversa } from './consulta.js';
import {
  codificarCursorDeConversas,
  decodificarCursorDeConversas,
  type CursorDeConversas,
  type OrdemDaListagem,
} from './cursor-de-conversas.js';

/** O tamanho da pagina quando ninguem pede outro; o mesmo da paginacao de Mensagens (#1202). */
export const LIMITE_PADRAO_DE_CONVERSAS = 500;

/** O cursor nao decodifica, ou e de outra ordem. Quem chama responde 400 / codigo 2, e nunca devolve a primeira pagina. */
export class CursorDeConversasInvalidoError extends Error {
  constructor() {
    super('cursor invalido');
    this.name = 'CursorDeConversasInvalidoError';
  }
}

export interface PaginaDeConversas {
  conversas: ConversaListada[];
  /** O cursor da pagina seguinte. AUSENTE na ultima pagina. */
  proximo?: string;
}

function chaveDe(c: ConversaListadaComChave, ordem: OrdemDaListagem): CursorDeConversas {
  return ordem === 'criacao'
    ? { ordem, valor: c.chaveDeCriacao, id: c.id }
    : { ordem, valor: c.chaveDeAtividade as number, id: c.id };
}

/** A Conversa vem DEPOIS do cursor na ordem da consulta? Espelha o filtro do SQL, para o caminho em memoria. */
function vemDepois(c: ConversaListadaComChave, cursor: CursorDeConversas): boolean {
  if (cursor.ordem === 'criacao') {
    return c.chaveDeCriacao > cursor.valor || (c.chaveDeCriacao === cursor.valor && c.id > cursor.id);
  }
  const ultima = c.chaveDeAtividade as number;
  return ultima < cursor.valor || (ultima === cursor.valor && c.id > cursor.id);
}

/**
 * Uma pagina da listagem de Conversas (#1202). A ordem e a de `consultarConversas`: por criacao, ou por atividade
 * quando o filtro traz `desde`. Busca UMA a mais que o limite para saber se ha pagina seguinte, sem contar tudo.
 *
 * `marcadas` (a Marca "fixada") filtra em memoria, como a rota e a CLI ja faziam: a pagina vem DEPOIS desse filtro,
 * sobre a lista ordenada, e nao do corte feito no SQL.
 */
export function paginarConversas(
  acervo: Acervo,
  filtro: Omit<FiltroDeConversa, 'cursor' | 'limite'>,
  pagina: { limite: number; antes?: string; marcadas?: ReadonlySet<string> },
): PaginaDeConversas {
  const ordem: OrdemDaListagem = filtro.desde !== undefined ? 'atividade' : 'criacao';
  let cursor: CursorDeConversas | undefined;
  if (pagina.antes !== undefined) {
    cursor = decodificarCursorDeConversas(pagina.antes);
    if (cursor === undefined || cursor.ordem !== ordem) throw new CursorDeConversasInvalidoError();
  }

  let linhas: ConversaListadaComChave[];
  if (pagina.marcadas === undefined) {
    linhas = consultarConversas(acervo, { ...filtro, ...(cursor !== undefined ? { cursor } : {}), limite: pagina.limite + 1 });
  } else {
    const marcadas = pagina.marcadas;
    linhas = consultarConversas(acervo, filtro)
      .filter((c) => marcadas.has(c.id))
      .filter((c) => cursor === undefined || vemDepois(c, cursor))
      .slice(0, pagina.limite + 1);
  }

  const mostradas = linhas.slice(0, pagina.limite);
  const resposta: PaginaDeConversas = {
    conversas: mostradas.map(({ chaveDeCriacao: _c, chaveDeAtividade: _a, ...conversa }) => conversa),
  };
  if (linhas.length > pagina.limite) {
    resposta.proximo = codificarCursorDeConversas(chaveDe(mostradas[mostradas.length - 1] as ConversaListadaComChave, ordem));
  }
  return resposta;
}
