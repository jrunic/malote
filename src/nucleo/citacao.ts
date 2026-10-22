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

export interface CandidataDeCitacao {
  /** A posicao fisica da linha: o cursor da passada, que anda sempre para a frente. */
  rowid: number;
  mensagemId: string;
  conversaId: string;
  bruto: string;
}

export interface FiltroDeCandidatas {
  fonte: Fonte;
  contem: string;
  depoisDe: number;
  limite: number;
  de?: number;
  ate?: number;
}

/**
 * O SQL e os valores da consulta de candidatas, expostos para o teste conferir o PLANO. A Fonte entra como `+fonte`: com o
 * indice unico (fonte, id_externo) o SQLite andaria por ele e ordenaria num B-tree temporario, e cada pagina releria todas
 * as Mensagens da Fonte (O(N x paginas), medido em 100 mil Mensagens). Sem o indice, o plano anda pelo rowid, e o cursor
 * `rowid > ?` e uma faixa de verdade.
 */
export function consultaDeCandidatas(filtro: FiltroDeCandidatas): { sql: string; valores: Array<string | number> } {
  const condicoes = ['rowid > ?', '+fonte = ?', 'citada_id_externo IS NULL', 'bruto IS NOT NULL', 'instr(bruto, ?) > 0'];
  const valores: Array<string | number> = [filtro.depoisDe, filtro.fonte, filtro.contem];
  if (filtro.de !== undefined) {
    condicoes.push('ocorrida_em >= ?');
    valores.push(filtro.de);
  }
  if (filtro.ate !== undefined) {
    condicoes.push('ocorrida_em <= ?');
    valores.push(filtro.ate);
  }
  return {
    sql: `SELECT rowid AS rowid, id, conversa_id, bruto FROM mensagens WHERE ${condicoes.join(' AND ')} ORDER BY rowid LIMIT ?`,
    valores: [...valores, filtro.limite],
  };
}

/**
 * As Mensagens de uma Fonte que AINDA nao tem Citacao e cujo Conteudo Bruto contem o trecho dado, em ordem de posicao
 * fisica, a partir de um cursor. O trecho e do Adaptador (o nucleo nao conhece o formato da Fonte): serve so para a
 * consulta nao trazer o Acervo inteiro. Quem le o bruto decide se ha Citacao de verdade.
 */
export function listarCandidatasDeCitacao(acervo: Acervo, filtro: FiltroDeCandidatas): CandidataDeCitacao[] {
  const { sql, valores } = consultaDeCandidatas(filtro);
  const linhas = acervo.preparar(sql).all(...valores) as Array<{ rowid: number; id: string; conversa_id: string; bruto: string }>;
  return linhas.map((l) => ({ rowid: l.rowid, mensagemId: l.id, conversaId: l.conversa_id, bruto: l.bruto }));
}

/**
 * Quantas Mensagens da Fonte, no recorte, tem Conteudo Bruto e NAO contem o trecho: o que o estoque nao pode ler (o bruto
 * de importacao de backup tem outra forma) ou que simplesmente nao cita. O ensaio as conta a parte, para ninguem achar
 * que o comando olhou o Acervo inteiro.
 */
export function contarSemTrecho(
  acervo: Acervo,
  filtro: { fonte: Fonte; contem: string; de?: number; ate?: number },
): number {
  const condicoes = ['+fonte = ?', 'bruto IS NOT NULL', 'instr(bruto, ?) = 0'];
  const valores: Array<string | number> = [filtro.fonte, filtro.contem];
  if (filtro.de !== undefined) {
    condicoes.push('ocorrida_em >= ?');
    valores.push(filtro.de);
  }
  if (filtro.ate !== undefined) {
    condicoes.push('ocorrida_em <= ?');
    valores.push(filtro.ate);
  }
  return (acervo.preparar(`SELECT COUNT(*) AS n FROM mensagens WHERE ${condicoes.join(' AND ')}`).get(...valores) as { n: number }).n;
}

/** A Configuracao dona da Conversa (nula na coletiva). `undefined` se a Conversa nao existe. */
export function configuracaoDaConversa(acervo: Acervo, conversaId: string): string | null | undefined {
  const l = acervo.preparar('SELECT configuracao_id AS c FROM conversas WHERE id = ?').get(conversaId) as { c: string | null } | undefined;
  return l === undefined ? undefined : l.c;
}

/**
 * Grava a Citacao numa Mensagem que ja existe e ainda nao a tinha (o estoque). Devolve as colunas gravadas, ou `null`
 * quando a Mensagem ja tinha Citacao ou saiu do Acervo: a passada nunca sobrescreve.
 */
export function aplicarCitacao(
  acervo: Acervo,
  mensagemId: string,
  alvo: { fonte: Fonte; conversaId: string },
  citacao: CitacaoDeEntrada,
): ColunasDaCitacao | null {
  const colunas = colunasDaCitacao(acervo, alvo, citacao);
  const r = acervo
    .preparar(
      `UPDATE mensagens
          SET citada_id = ?, citada_id_externo = ?, citada_autor_id = ?, citada_direcao = ?
        WHERE id = ? AND citada_id_externo IS NULL`,
    )
    .run(colunas.citadaId, colunas.idExterno, colunas.autorId, colunas.direcao, mensagemId);
  return r.changes > 0 ? colunas : null;
}

/**
 * O inverso de `aplicarCitacao`, para o `desfazer`: devolve a nulo as quatro colunas, mas so se a Citacao ainda e a que o
 * comando gravou (mesmo id externo). Inclui o vinculo que o vinculo tardio tenha completado depois.
 */
export function removerCitacao(acervo: Acervo, mensagemId: string, idExterno: string): boolean {
  return (
    acervo
      .preparar(
        `UPDATE mensagens
            SET citada_id = NULL, citada_id_externo = NULL, citada_autor_id = NULL, citada_direcao = NULL
          WHERE id = ? AND citada_id_externo = ?`,
      )
      .run(mensagemId, idExterno).changes > 0
  );
}
