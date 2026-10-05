import { join } from 'node:path';
import { abrirAcervoSomenteLeitura } from '../nucleo/acervo.js';
import { atorDeAcesso, comAtor } from '../nucleo/ator.js';
import type { InquilinoId } from '../nucleo/tipos.js';
import {
  criarReqDeLeitura,
  criarResDeLeitura,
  type InstrucaoDeTeste,
  type PedidoDeLeitura,
  type RespostaDeLeitura,
} from './contrato-da-leitura.js';
import { responder } from './rotas.js';
import type { ServerResponse } from 'node:http';

/** Bloqueia a thread de verdade (nao cede o laco), como uma consulta sincrona longa. */
function bloquear(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function aplicarInstrucao(instrucao: InstrucaoDeTeste | undefined, res: ServerResponse): void {
  if (instrucao === undefined) return;
  if (instrucao.dormirMs !== undefined) bloquear(instrucao.dormirMs);
  if (instrucao.lancarDepoisDoCabecalho !== undefined) {
    res.writeHead(200, { 'content-type': 'application/json' });
    throw new Error(instrucao.lancarDepoisDoCabecalho);
  }
  if (instrucao.lancar !== undefined) throw new Error(instrucao.lancar);
}

/**
 * A leitura INTEIRA, de ponta a ponta: abre o Acervo somente-leitura (a abertura pode lancar — Acervo inexistente
 * ou em forma divergente — e vira 503 de corpo vazio, a #1115), abre o Ator da requisicao e roda `responder`, que
 * e a MESMA funcao de antes das rotas, agora com um `req` e um `res` que lancam fora do contrato.
 *
 * Sincrona de proposito: roda dentro do worker, e fora dele nos testes. Excecao da rota PROPAGA — quem chama (a
 * casca do worker) a transforma em `500`.
 */
export function executarLeitura(pedido: PedidoDeLeitura): RespostaDeLeitura {
  const req = criarReqDeLeitura(pedido);
  const { res, capturar } = criarResDeLeitura();

  let acervo;
  try {
    acervo = abrirAcervoSomenteLeitura(join(pedido.dados, 'acervos'), pedido.inquilinoId as InquilinoId);
  } catch (e) {
    process.stderr.write(
      `acervo indisponivel para a Chave ${pedido.chaveId}: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return { status: 503, cabecalhos: { 'content-type': 'application/json' }, corpo: '' };
  }

  try {
    comAtor(atorDeAcesso(pedido.chaveId), () => {
      aplicarInstrucao(pedido.instrucao, res);
      responder(req, res, {
        acervo,
        identidade: { chaveId: pedido.chaveId, inquilinoId: pedido.inquilinoId },
        dados: pedido.dados,
      });
    });
  } finally {
    acervo.fechar();
  }

  const resposta = capturar();
  if (resposta === undefined) throw new Error('a rota nao respondeu');
  return resposta;
}
