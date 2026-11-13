import type { Acervo } from './acervo.js';
import { detalharConversa } from './detalhe-da-conversa.js';
import type { ConversaId } from './tipos.js';
import type { PrecedenciaDeNome } from '../registro/precedencia-de-nome.js';

/** Um item do Indice: so o que identifica e descreve a midia. Sem texto da Mensagem, sem nome de arquivo, sem miniatura. */
export interface ItemDoIndiceDeMidia {
  anexoId: string;
  mensagemId: string;
  ocorridaEm: number;
  tipo: string;
  tamanho: number | null;
  presenca: string;
}

export interface CursorDoIndice {
  ocorridaEm: number;
  mensagemId: string;
  anexoId: string;
}

export interface FiltroDoIndice {
  conversaId: ConversaId;
  limite: number;
  /** Exclusivo: o ultimo item da pagina anterior. */
  cursor?: CursorDoIndice;
  /** Instantes (ms) inclusivos; o chamador os alinha ao inicio e ao fim de um dia no fuso. */
  de?: number;
  ate?: number;
}

export function codificarCursorDoIndice(c: CursorDoIndice): string {
  return Buffer.from(JSON.stringify([c.ocorridaEm, c.mensagemId, c.anexoId])).toString('base64url');
}

export function decodificarCursorDoIndice(token: string): CursorDoIndice | undefined {
  try {
    const v = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(v) || v.length !== 3) return undefined;
    const [ocorridaEm, mensagemId, anexoId] = v as unknown[];
    if (typeof ocorridaEm !== 'number' || !Number.isFinite(ocorridaEm) || typeof mensagemId !== 'string' || typeof anexoId !== 'string') {
      return undefined;
    }
    return { ocorridaEm, mensagemId, anexoId };
  } catch {
    return undefined;
  }
}

/**
 * Uma pagina do Indice de Midia de UMA Conversa, na ordem que o `NN` do rotulo usa: instante da Mensagem, id da Mensagem
 * (o desempate da spec) e id do Anexo. `CROSS JOIN` fixa a ordem (as Mensagens pelo indice `(conversa_id, ocorrida_em)` e
 * os Anexos por `(mensagem_id)`), como em `anexos-da-conversa.ts`: sem ela o otimizador pode comecar pela tabela de Anexos.
 */
export function paginaDoIndiceDeMidia(acervo: Acervo, f: FiltroDoIndice): ItemDoIndiceDeMidia[] {
  if (!Number.isInteger(f.limite) || f.limite < 1) throw new Error(`limite invalido: ${String(f.limite)}`);
  const condicoes = ['m.conversa_id = ?'];
  const valores: unknown[] = [f.conversaId];
  if (f.de !== undefined) {
    condicoes.push('m.ocorrida_em >= ?');
    valores.push(f.de);
  }
  if (f.ate !== undefined) {
    condicoes.push('m.ocorrida_em <= ?');
    valores.push(f.ate);
  }
  if (f.cursor !== undefined) {
    condicoes.push('(m.ocorrida_em > ? OR (m.ocorrida_em = ? AND (m.id > ? OR (m.id = ? AND a.id > ?))))');
    valores.push(f.cursor.ocorridaEm, f.cursor.ocorridaEm, f.cursor.mensagemId, f.cursor.mensagemId, f.cursor.anexoId);
  }
  const linhas = acervo
    .preparar(
      `SELECT a.id AS anexo_id, m.id AS mensagem_id, m.ocorrida_em AS ocorrida_em, a.tipo AS tipo, a.tamanho AS tamanho,
              a.presenca AS presenca
         FROM mensagens m
         CROSS JOIN anexos a ON a.mensagem_id = m.id
        WHERE ${condicoes.join(' AND ')}
        ORDER BY m.ocorrida_em ASC, m.id ASC, a.id ASC
        LIMIT ${f.limite}`,
    )
    .all(...valores) as Array<{
    anexo_id: string;
    mensagem_id: string;
    ocorrida_em: number;
    tipo: string;
    tamanho: number | null;
    presenca: string;
  }>;
  return linhas.map((l) => ({
    anexoId: l.anexo_id,
    mensagemId: l.mensagem_id,
    ocorridaEm: l.ocorrida_em,
    tipo: l.tipo,
    tamanho: l.tamanho,
    presenca: l.presenca,
  }));
}

/** O token `proximo`, quando a pagina veio cheia. */
export function cursorDaProximaPaginaDoIndice(itens: ItemDoIndiceDeMidia[], limite: number): string | undefined {
  if (itens.length < limite || itens.length === 0) return undefined;
  const u = itens[itens.length - 1] as ItemDoIndiceDeMidia;
  return codificarCursorDoIndice({ ocorridaEm: u.ocorridaEm, mensagemId: u.mensagemId, anexoId: u.anexoId });
}

/** O que o Acervo sabe do nome da Conversa para o rotulo: o telefone sai do endereco, no adaptador (o nucleo nao nomeia a Fonte). */
export interface FontesDoNomeDaConversa {
  nome: string | null;
  assunto: string | null;
  /** O endereco da Conversa DIRETA (nunca da coletiva). Quem o usa o transforma em telefone; nunca o devolve ao cliente. */
  enderecoDaDireta: string | null;
}

/** `undefined` quando a Conversa nao existe neste Acervo. */
export function fontesDoNomeDaConversa(
  acervo: Acervo,
  conversaId: ConversaId,
  precedencia: PrecedenciaDeNome,
): FontesDoNomeDaConversa | undefined {
  const detalhe = detalharConversa(acervo, conversaId, precedencia);
  if (detalhe === undefined) return undefined;
  let enderecoDaDireta: string | null = null;
  if (!detalhe.coletiva) {
    const l = acervo.preparar('SELECT id_externo FROM conversas WHERE id = ?').get(conversaId) as { id_externo: string } | undefined;
    enderecoDaDireta = l?.id_externo ?? null;
  }
  return { nome: detalhe.nome, assunto: detalhe.metadados?.assunto ?? null, enderecoDaDireta };
}
