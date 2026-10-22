/**
 * A Citacao da Mensagem (#1334), do lado do WhatsApp: quando a Mensagem responde a outra pelo recurso de citacao, o
 * registro da plataforma traz o id da citada e quem a escreveu no `contextInfo` do conteudo. Funcao PURA, usada pela
 * recepcao ao vivo e pelo comando do estoque, para as duas lerem a mesma coisa.
 *
 * Medido em 21/10/2026 em dois Acervos reais: o `participant` vem em todas as citacoes, em grupo e em conversa direta,
 * quase sempre na forma opaca; texto, figurinha, audio, imagem, video e documento carregam o contexto no mesmo lugar.
 */

import type { Acervo } from '../../nucleo/acervo.js';
import { colunasDaCitacao, type CitacaoDeEntrada } from '../../nucleo/citacao.js';
import { resolverEndereco } from '../../nucleo/correspondencia.js';
import { registrarIdentificador } from '../../nucleo/escrita.js';
import { desembrulhar, VIRAM_MENSAGEM } from './conteudo-de-mensagem.js';

const FONTE = 'whatsapp' as const;

export interface CitacaoLida {
  /** O id da Mensagem citada na plataforma. */
  idExterno: string;
  /** O endereco de quem escreveu a citada, na forma que a plataforma entregou (pode ser opaca). Ausente se nao veio. */
  enderecoDoAutor: string | undefined;
}

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

/**
 * Procura a citacao so nos tipos de conteudo que VIRAM Mensagem (a mesma lista da recepcao), abrindo os mesmos dois
 * envelopes (o documento com legenda e a midia associada de album). A reacao vira Mensagem, mas nao e Citacao; a edicao,
 * a revogacao e o pai de album nem chegam a esta lista. Forma de conteudo que nao vira Mensagem (enquete, modelo) nao
 * grava Citacao mesmo trazendo o id de outra.
 */
export function citacaoDaMensagem(message: Record<string, unknown> | null | undefined): CitacaoLida | undefined {
  const conteudo = desembrulhar(message);
  if (conteudo == null) return undefined;
  for (const [chave, valor] of Object.entries(conteudo)) {
    if (!VIRAM_MENSAGEM.has(chave) || chave === 'reactionMessage') continue;
    const contexto = objeto(objeto(valor)?.['contextInfo']);
    const id = contexto?.['stanzaId'];
    if (typeof id !== 'string' || id === '') continue;
    const participante = contexto?.['participant'];
    return {
      idExterno: id,
      enderecoDoAutor: typeof participante === 'string' && participante !== '' ? participante : undefined,
    };
  }
  return undefined;
}

/** O autor da citada ja resolvido para a forma canonica, e se a citada e da propria conta. Le o Acervo, nunca escreve. */
export interface CitacaoResolvida {
  idExterno: string;
  /** O endereco canonico do autor. Ausente quando a plataforma nao o disse, quando e a propria conta ou e `@broadcast`. */
  enderecoDoAutor: string | undefined;
  /** A citada foi enviada pela propria conta. */
  propria: boolean;
}

export function resolverCitacao(
  acervo: Acervo,
  message: Record<string, unknown> | null | undefined,
  enderecosDaConta: readonly string[],
): CitacaoResolvida | undefined {
  const lida = citacaoDaMensagem(message);
  if (lida === undefined) return undefined;
  if (lida.enderecoDoAutor === undefined) return { idExterno: lida.idExterno, enderecoDoAutor: undefined, propria: false };
  const endereco = resolverEndereco(acervo, FONTE, lida.enderecoDoAutor);
  if (enderecosDaConta.some((e) => resolverEndereco(acervo, FONTE, e) === endereco)) {
    return { idExterno: lida.idExterno, enderecoDoAutor: undefined, propria: true };
  }
  if (endereco.endsWith('@broadcast')) return { idExterno: lida.idExterno, enderecoDoAutor: undefined, propria: false };
  return { idExterno: lida.idExterno, enderecoDoAutor: endereco, propria: false };
}

/**
 * A Citacao a gravar (#1334), ou nada. Quando a citada ja esta no Acervo (na mesma Conversa), o autor e a direcao DELA
 * valem e nada mais e consultado: nenhum Identificador e criado. Fora do Acervo, o autor da citada vira Identificador SE
 * faltar; NAO ganha Participacao, nome nem Pessoa, porque ninguem foi observado na Conversa so por ter sido citado. A
 * citada da propria conta nao tem autor (Mensagem enviada nao tem), e a direcao dela e `enviada`. Sem endereco de conta
 * conhecido, a direcao da citada que o Acervo nao tem fica nula.
 */
export function citacaoParaGravar(
  acervo: Acervo,
  message: Record<string, unknown> | null | undefined,
  enderecosDaConta: readonly string[],
  alvo: { conversaId: string },
): CitacaoDeEntrada | undefined {
  const r = resolverCitacao(acervo, message, enderecosDaConta);
  if (r === undefined) return undefined;
  if (colunasDaCitacao(acervo, { fonte: FONTE, conversaId: alvo.conversaId }, { idExterno: r.idExterno }).citadaId !== null) {
    return { idExterno: r.idExterno };
  }
  if (r.propria) return { idExterno: r.idExterno, direcao: 'enviada' };
  if (r.enderecoDoAutor === undefined) return { idExterno: r.idExterno };
  const { id } = registrarIdentificador(acervo, { fonte: FONTE, valor: r.enderecoDoAutor });
  return {
    idExterno: r.idExterno,
    autorId: id,
    ...(enderecosDaConta.length > 0 ? { direcao: 'recebida' as const } : {}),
  };
}
