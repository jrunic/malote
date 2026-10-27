import { opcao, todasAsOpcoes, validarBandeiras } from './bandeiras.js';
import {
  LIMITE_DE_CHEGADAS,
  ORIGENS_DA_CHEGADA,
  TIPOS_DE_CHEGADA,
  type DirecaoDaChegada,
  type OrigemDaChegada,
  type TipoDeChegada,
} from '../nucleo/chegada.js';
import type { ChegadaComConteudo } from '../nucleo/chegadas-com-conteudo.js';

export interface PedidoDeChegadas {
  depois?: string;
  pontoDePartida: boolean;
  conversa?: string;
  configuracao?: string;
  direcao?: DirecaoDaChegada;
  remetente?: string;
  semRemetente: string[];
  tipos: TipoDeChegada[];
  origens: OrigemDaChegada[];
  limite?: number;
  comConteudo: boolean;
}

export type LeituraDoPedidoDeChegadas = { ok: true; pedido: PedidoDeChegadas } | { ok: false; erro: string };

const COM_VALOR = ['depois', 'conversa', 'configuracao', 'direcao', 'remetente', 'tipo', 'origem', 'limite'] as const;

function lista<T extends string>(texto: string | undefined, validos: readonly T[], flag: string): T[] | string {
  if (texto === undefined) return [];
  const itens = texto.split(',');
  for (const item of itens) {
    if (!(validos as readonly string[]).includes(item)) {
      return `--${flag} aceita ${validos.join(', ')} (separados por virgula); recebi "${item}".`;
    }
  }
  return itens as T[];
}

/**
 * Le os argumentos do comando `chegadas` e RECUSA o que esta errado, com a mensagem que diz o que corrigir: flag que pede
 * valor e vem sem ele (#1136), `--depois` e `--ponto-de-partida` juntos ou nenhum, filtro junto do ponto de partida,
 * valor fora do conjunto fechado.
 */
export function lerPedidoDeChegadas(argumentos: string[]): LeituraDoPedidoDeChegadas {
  const erroDeBandeira = validarBandeiras(argumentos);
  if (erroDeBandeira !== undefined) return { ok: false, erro: erroDeBandeira };
  const valores: Partial<Record<(typeof COM_VALOR)[number], string>> = {};
  for (const nome of COM_VALOR) {
    const valor = opcao(argumentos, nome);
    if (valor !== undefined) valores[nome] = valor;
  }
  const pontoDePartida = argumentos.includes('--ponto-de-partida');
  const comConteudo = argumentos.includes('--com-conteudo');
  const semRemetente = todasAsOpcoes(argumentos, 'sem-remetente');

  if (pontoDePartida === (valores.depois !== undefined)) {
    return {
      ok: false,
      erro: pontoDePartida
        ? '--depois e --ponto-de-partida se contradizem: use um so.'
        : 'Informe --depois <marcador> (a leitura seguinte) ou --ponto-de-partida (o Marcador de agora).',
    };
  }
  const filtros =
    comConteudo ||
    semRemetente.length > 0 ||
    COM_VALOR.some((n) => n !== 'depois' && valores[n] !== undefined);
  if (pontoDePartida && filtros) {
    return { ok: false, erro: '--ponto-de-partida nao aceita filtros nem --com-conteudo: ele so devolve o Marcador de agora.' };
  }
  if (valores.direcao !== undefined && valores.direcao !== 'enviada' && valores.direcao !== 'recebida') {
    return { ok: false, erro: '--direcao aceita enviada ou recebida.' };
  }
  const tipos = lista(valores.tipo, TIPOS_DE_CHEGADA, 'tipo');
  if (typeof tipos === 'string') return { ok: false, erro: tipos };
  const origens = lista(valores.origem, ORIGENS_DA_CHEGADA, 'origem');
  if (typeof origens === 'string') return { ok: false, erro: origens };

  const pedido: PedidoDeChegadas = { pontoDePartida, semRemetente, tipos, origens, comConteudo };
  if (valores.depois !== undefined) pedido.depois = valores.depois;
  if (valores.conversa !== undefined) pedido.conversa = valores.conversa;
  if (valores.configuracao !== undefined) pedido.configuracao = valores.configuracao;
  if (valores.direcao !== undefined) pedido.direcao = valores.direcao;
  if (valores.remetente !== undefined) pedido.remetente = valores.remetente;
  if (valores.limite !== undefined) {
    const n = Number(valores.limite);
    if (!Number.isInteger(n) || n < 1 || n > LIMITE_DE_CHEGADAS) {
      return { ok: false, erro: `--limite precisa ser um inteiro de 1 a ${LIMITE_DE_CHEGADAS}.` };
    }
    pedido.limite = n;
  }
  return { ok: true, pedido };
}

function umaLinha(texto: string, max = 80): string {
  const plano = texto.replace(/\s+/g, ' ').trim();
  return plano.length > max ? `${plano.slice(0, max - 1)}…` : plano;
}

/**
 * Uma linha por Chegada (numero, instante de gravacao, tipo, origem, Conversa, autor, direcao e, com conteudo, o inicio do
 * texto) e a ultima linha com o Marcador da proxima leitura. A saida para maquina e o `--json`.
 */
export function formatarChegadas(pagina: {
  chegadas: readonly ChegadaComConteudo[];
  proximo: string;
}): string[] {
  const linhas = pagina.chegadas.map((c) => {
    const base = `${String(c.seq)}  ${new Date(c.criadoEm).toISOString()}  ${c.tipo}  ${c.origem ?? '-'}  ${c.conversaId ?? '-'}  ${c.autorId ?? '-'}  ${c.direcao ?? '-'}`;
    if (c.conteudo === undefined) return base;
    if (c.conteudo === null) return `${base}  (mensagem ausente)`;
    const texto = c.conteudo.textoAtual ?? c.conteudo.conteudo;
    return `${base}  ${texto === null ? '(sem texto)' : umaLinha(texto)}`;
  });
  linhas.push(`# proximo ${pagina.proximo}`);
  return linhas;
}
