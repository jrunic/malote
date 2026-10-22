/**
 * A Citacao da Mensagem (#1334), do lado do WhatsApp: quando a Mensagem responde a outra pelo recurso de citacao, o
 * registro da plataforma traz o id da citada e quem a escreveu no `contextInfo` do conteudo. Funcao PURA, usada pela
 * recepcao ao vivo e pelo comando do estoque, para as duas lerem a mesma coisa.
 *
 * Medido em 21/10/2026 em dois Acervos reais: o `participant` vem em todas as citacoes, em grupo e em conversa direta,
 * quase sempre na forma opaca; texto, figurinha, audio, imagem, video e documento carregam o contexto no mesmo lugar.
 */

import { desembrulhar, VIRAM_MENSAGEM } from './conteudo-de-mensagem.js';

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
