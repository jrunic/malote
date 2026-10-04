import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { pedirPost, type CodigoDeFalha } from '../src/cli/cliente.js';

type Recebido = { metodo: string; auth: string | undefined; tipo: string | undefined; corpo: string };

/** Servidor de verdade que responde sempre o mesmo status/corpo, e guarda o que recebeu. */
async function servidor(
  status: number,
  corpo: string,
): Promise<{ url: string; recebido: Recebido[]; fechar: () => void }> {
  const recebido: Recebido[] = [];
  const srv: Server = createServer((req, res) => {
    const pedacos: Buffer[] = [];
    req.on('data', (p: Buffer) => pedacos.push(p));
    req.on('end', () => {
      recebido.push({
        metodo: req.method ?? '',
        auth: req.headers['authorization'],
        tipo: req.headers['content-type'],
        corpo: Buffer.concat(pedacos).toString('utf8'),
      });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(corpo);
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const porta = (srv.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${porta}`, recebido, fechar: () => srv.close() };
}

test('pedirPost manda POST JSON com a chave no cabecalho e devolve o corpo do 202', async () => {
  const s = await servidor(202, '{"aceita":true,"envioId":"e1"}');
  try {
    const r = await pedirPost(s.url, 'chave-x', '/envios/solicitar', '{"a":1}');
    assert.equal(r.status, 202);
    assert.equal(r.corpo, '{"aceita":true,"envioId":"e1"}');
    assert.equal(s.recebido[0]!.metodo, 'POST');
    assert.equal(s.recebido[0]!.auth, 'Bearer chave-x');
    assert.equal(s.recebido[0]!.tipo, 'application/json');
    assert.equal(s.recebido[0]!.corpo, '{"a":1}');
  } finally {
    s.fechar();
  }
});

async function falhaDe(status: number, corpo: string): Promise<CodigoDeFalha> {
  const s = await servidor(status, corpo);
  try {
    await pedirPost(s.url, 'k', '/envios/solicitar', '{}');
  } catch (e) {
    return e as CodigoDeFalha;
  } finally {
    s.fechar();
  }
  throw new Error('deveria ter lancado');
}

test('401 vira credencial, codigo 3', async () => {
  const e = await falhaDe(401, '');
  assert.equal(e.classe, 'credencial');
  assert.equal(e.codigoDeSaida, 3);
});

test('5xx vira servidor, codigo 5', async () => {
  const e = await falhaDe(500, '');
  assert.equal(e.classe, 'servidor');
  assert.equal(e.codigoDeSaida, 5);
});

test('4xx vira uso, codigo 6, com o status e o corpo na falha', async () => {
  const e = await falhaDe(400, '{"erro":"informe texto"}');
  assert.equal(e.classe, 'uso');
  assert.equal(e.codigoDeSaida, 6);
  assert.equal(e.status, 400);
  assert.match(e.message, /informe texto/);
});

test('404 de corpo vazio vira uso, codigo 6, com status 404', async () => {
  const e = await falhaDe(404, '');
  assert.equal(e.codigoDeSaida, 6);
  assert.equal(e.status, 404);
});

test('conexao recusada vira codigo 4', async () => {
  // porta aberta e fechada: ninguem escuta
  const s = await servidor(200, '');
  const url = s.url;
  s.fechar();
  await new Promise((r) => setTimeout(r, 50));
  await assert.rejects(pedirPost(url, 'k', '/x', '{}'), (e: CodigoDeFalha) => {
    assert.equal(e.classe, 'conexao');
    assert.equal(e.codigoDeSaida, 4);
    return true;
  });
});

test('timeout vira codigo 7 e a mensagem diz que repetir pode DUPLICAR', async () => {
  // servidor que aceita e nunca responde
  const srv = createServer(() => undefined);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const porta = (srv.address() as { port: number }).port;
  try {
    await assert.rejects(
      pedirPost(`http://127.0.0.1:${porta}`, 'k', '/x', '{}', { timeoutMs: 150 }),
      (e: CodigoDeFalha) => {
        assert.equal(e.classe, 'indeterminado');
        assert.equal(e.codigoDeSaida, 7);
        assert.match(e.message, /DUPLICAR/);
        assert.match(e.message, /mensagens --direcao enviada/);
        return true;
      },
    );
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});
