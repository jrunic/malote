import { randomUUID } from 'node:crypto';
import type { Acervo } from './acervo.js';
import { motivoDaRejeicao } from './instante.js';
import type { Fonte, MensagemId } from './tipos.js';

/**
 * Edicao (#1246): o texto novo que alguem deu a uma Mensagem que ja tinha enviado. Evento datado e imutavel,
 * pendurado na Mensagem: o texto e o Conteudo Bruto dela nunca mudam. O texto da Edicao e DERIVADO do bruto da
 * propria Edicao (o evento como chegou) e, na forma cifrada, do segredo da Mensagem original, entao e refazivel. O
 * nucleo nao sabe o que e segredo nem cifra (isso e vocabulario de Fonte e mora no adaptador): so recebe o texto ja lido.
 */

export type OrigemDaEdicao = 'cifrada' | 'aberta';

export interface EntradaDeEdicao {
  mensagemId: MensagemId;
  fonte: Fonte;
  /** O identificador do EVENTO de edicao, nao o da Mensagem editada. Com a Fonte, e o que torna a reentrega idempotente. */
  idExterno: string;
  /** Pode ser vazio: a legenda apagada e uma edicao valida. */
  texto: string;
  /** O instante da edicao, em milissegundos. */
  editadaEm: number;
  origem: OrigemDaEdicao;
  /** O evento como chegou. */
  bruto: string;
  agora: number;
  /** Folga PARA A FRENTE do relogio, so para a recepcao ao vivo (a mesma da Mensagem). */
  toleranciaDeRelogioMs?: number;
}

export interface EdicaoLida {
  id: string;
  texto: string;
  editadaEm: number;
  origem: OrigemDaEdicao;
}

export class EdicaoImplausivelError extends Error {
  constructor(readonly motivo: string) {
    super(`Edicao recusada: ${motivo}`);
    this.name = 'EdicaoImplausivelError';
  }
}

export interface ResultadoDoRegistroDeEdicao {
  /** `false` quando o evento ja estava gravado. */
  gravou: boolean;
}

/**
 * Grava a Edicao de uma Mensagem. O instante passa pela mesma guarda de plausibilidade da Mensagem; o evento ja gravado
 * (mesma Fonte e mesmo identificador) nao escreve nada.
 */
export function registrarEdicao(acervo: Acervo, e: EntradaDeEdicao): ResultadoDoRegistroDeEdicao {
  const motivo = motivoDaRejeicao(e.fonte, e.editadaEm, e.agora, e.toleranciaDeRelogioMs);
  if (motivo !== null) throw new EdicaoImplausivelError(motivo);

  const ja = acervo
    .preparar('SELECT 1 AS um FROM edicoes WHERE fonte = ? AND id_externo = ?')
    .get(e.fonte, e.idExterno);
  if (ja !== undefined) return { gravou: false };

  acervo
    .preparar(
      `INSERT INTO edicoes (id, mensagem_id, fonte, id_externo, texto, editada_em, origem, bruto)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), e.mensagemId, e.fonte, e.idExterno, e.texto, e.editadaEm, e.origem, e.bruto);
  return { gravou: true };
}

interface LinhaDeEdicao {
  id: string;
  mensagem_id: string;
  texto: string;
  editada_em: number;
  origem: OrigemDaEdicao;
}

/**
 * As Edicoes de VARIAS Mensagens em uma consulta so, nunca uma por Mensagem. Mensagem sem Edicao nao entra no mapa.
 * Ordem: o instante da edicao, e o empate desfaz pela gravacao.
 */
export function lerEdicoes(acervo: Acervo, mensagemIds: readonly MensagemId[]): Map<MensagemId, EdicaoLida[]> {
  const mapa = new Map<MensagemId, EdicaoLida[]>();
  if (mensagemIds.length === 0) return mapa;
  const linhas = acervo
    .preparar(
      `SELECT id, mensagem_id, texto, editada_em, origem
         FROM edicoes
        WHERE mensagem_id IN (SELECT value FROM json_each(?))
        ORDER BY mensagem_id, editada_em, rowid`,
    )
    .all(JSON.stringify(mensagemIds)) as LinhaDeEdicao[];
  for (const l of linhas) {
    const lista = mapa.get(l.mensagem_id) ?? [];
    lista.push({ id: l.id, texto: l.texto, editadaEm: l.editada_em, origem: l.origem });
    mapa.set(l.mensagem_id, lista);
  }
  return mapa;
}

export interface MensagemParaEdicao {
  id: MensagemId;
  /** O Conteudo Bruto da Mensagem: e dele que o adaptador tira o segredo da forma cifrada. */
  bruto: string | null;
  /** O endereco, na forma canonica gravada, da Conversa em que a Mensagem esta. */
  enderecoDaConversa: string;
}

/** A Mensagem editada, pelo par (Fonte, identificador na origem), ou `undefined` se o Acervo nao a tem. */
export function mensagemParaEdicao(
  acervo: Acervo,
  e: { fonte: Fonte; idExterno: string },
): MensagemParaEdicao | undefined {
  const l = acervo
    .preparar(
      `SELECT m.id AS id, m.bruto AS bruto, c.id_externo AS enderecoDaConversa
         FROM mensagens m
         JOIN conversas c ON c.id = m.conversa_id
        WHERE m.fonte = ? AND m.id_externo = ?`,
    )
    .get(e.fonte, e.idExterno) as MensagemParaEdicao | undefined;
  return l;
}
