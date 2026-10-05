import { parentPort } from 'node:worker_threads';
import { transferiveis, type MensagemDoTrabalhador, type PedidoDeLeitura } from './contrato-da-leitura.js';
import { executarLeitura } from './leitura.js';

/**
 * A casca do worker: recebe um pedido, roda a leitura e devolve. Excecao NUNCA mata o worker: vira mensagem de erro
 * (o despachante responde `500`). O log leva a mensagem e o caminho SEM a query, que pode ter texto de conversa.
 */
// O corpo binario atravessa por TRANSFERENCIA (nao copia): e o que mantem o pico de um documento de 890 MB em ~1x. Nao
// ha teste de comportamento que distinga transferir de copiar; quem o mede e o Task 7 (RSS servindo o arquivo grande).
const responder = (r: MensagemDoTrabalhador): void =>
  parentPort!.postMessage(r, 'resposta' in r ? transferiveis(r.resposta) : []);

parentPort!.on('message', (m: { id: number; pedido: PedidoDeLeitura }) => {
  if (m.pedido.instrucao?.sair === true) {
    // SO PARA TESTE. Excecao nao capturada termina o worker (a mae recebe `error` e `exit`), sem resposta e sem abrir o
    // Acervo — o que a spec chama de "worker que morre no meio da leitura". `process.exit` em src/ e proibido (#1125).
    setImmediate(() => {
      throw new Error('saida de teste do worker');
    });
    return;
  }
  try {
    responder({ id: m.id, resposta: executarLeitura(m.pedido) });
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    const caminho = m.pedido.url.split('?')[0];
    process.stderr.write(`erro na rota ${m.pedido.metodo} ${caminho}: ${mensagem}\n`);
    responder({ id: m.id, erro: mensagem });
  }
});

// Depois de os imports resolverem: e o que separa "falhou ao CARREGAR" de "morreu RODANDO". O evento `online` do
// Node vem ANTES de carregar o modulo de entrada, entao nao serve.
responder({ pronto: true });
