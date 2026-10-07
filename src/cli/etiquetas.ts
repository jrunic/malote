import { opcao, validarBandeiras } from './bandeiras.js';
import type { EtiquetaListada } from '../nucleo/etiqueta-de-participacao.js';
import { LIMITE_DE_ETIQUETAS } from '../nucleo/etiqueta-de-participacao.js';

export interface PedidoDeEtiquetas {
  conversa?: string;
  remetente?: string;
  busca?: string;
  historico: boolean;
  limite?: number;
}

export type LeituraDoPedido = { ok: true; pedido: PedidoDeEtiquetas } | { ok: false; erro: string };

const COM_VALOR = ['conversa', 'remetente', 'busca', 'limite'] as const;

/**
 * Le os argumentos do comando `etiquetas` e RECUSA o que esta errado, com a
 * mensagem que diz o que corrigir. Nasce com a regra da #1136: flag que pede
 * valor e vem sem ele (fim da linha, ou seguida de outra flag) e erro de uso,
 * nunca ignorada em silencio — `conversas --coletiva` devolvia TUDO por isso.
 */
export function lerPedidoDeEtiquetas(argumentos: string[]): LeituraDoPedido {
  const erroDeBandeira = validarBandeiras(argumentos);
  if (erroDeBandeira !== undefined) return { ok: false, erro: erroDeBandeira };
  const valores: Partial<Record<(typeof COM_VALOR)[number], string>> = {};
  for (const nome of COM_VALOR) {
    const valor = opcao(argumentos, nome);
    if (valor !== undefined) valores[nome] = valor;
  }
  if (valores.busca === '') return { ok: false, erro: 'A flag --busca pede um valor.' };
  const pedido: PedidoDeEtiquetas = { historico: argumentos.includes('--historico') };
  if (valores.conversa !== undefined) pedido.conversa = valores.conversa;
  if (valores.remetente !== undefined) pedido.remetente = valores.remetente;
  if (valores.busca !== undefined) pedido.busca = valores.busca;
  if (valores.limite !== undefined) {
    const n = Number(valores.limite);
    if (!Number.isInteger(n) || n < 1 || n > LIMITE_DE_ETIQUETAS.maximo) {
      return { ok: false, erro: `--limite precisa ser um inteiro de 1 a ${LIMITE_DE_ETIQUETAS.maximo}.` };
    }
    pedido.limite = n;
  }
  if (pedido.historico && (pedido.conversa === undefined || pedido.remetente === undefined)) {
    return { ok: false, erro: '--historico exige --conversa e --remetente.' };
  }
  return { ok: true, pedido };
}

/** Uma linha por etiqueta: instante, valor, nome, Conversa e texto. A remocao aparece como `(removida)`. */
export function formatarEtiquetas(lista: readonly EtiquetaListada[]): string[] {
  return lista.map(
    (e) =>
      `${new Date(e.em).toISOString()}  ${e.valor}  ${e.nome ?? '-'}  ${e.conversaId}  ${e.texto ?? '(removida)'}`,
  );
}
