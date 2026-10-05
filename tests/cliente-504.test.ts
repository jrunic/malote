import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { pedirGet } from '../src/cli/cliente.js';

async function servidorQueResponde(status: number): Promise<{ url: string; fechar: () => void }> {
  const srv = createServer((_req, res) => {
    res.writeHead(status, {});
    res.end('');
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, fechar: () => srv.close() };
}

test('504 diz que passou do prazo e manda restringir os filtros, e sai com o codigo de servidor (#1132)', async () => {
  const s = await servidorQueResponde(504);
  try {
    await assert.rejects(pedirGet(s.url, 'k', '/x'), (e: Error & { codigoDeSaida?: number }) => {
      assert.equal(e.codigoDeSaida, 5);
      assert.match(e.message, /Erro do servidor \(504\)/);
      assert.match(e.message, /prazo/);
      assert.match(e.message, /filtro/);
      return true;
    });
  } finally {
    s.fechar();
  }
});

test('503 diz para tentar de novo, e mantem o prefixo de erro do servidor (#1132)', async () => {
  const s = await servidorQueResponde(503);
  try {
    await assert.rejects(pedirGet(s.url, 'k', '/x'), (e: Error & { codigoDeSaida?: number }) => {
      assert.equal(e.codigoDeSaida, 5);
      assert.match(e.message, /Erro do servidor \(503\)/);
      assert.match(e.message, /tente de novo/i);
      return true;
    });
  } finally {
    s.fechar();
  }
});

test('outro 5xx segue com a mensagem de antes (#1132)', async () => {
  const s = await servidorQueResponde(500);
  try {
    await assert.rejects(pedirGet(s.url, 'k', '/x'), (e: Error) => /^Erro do servidor \(500\)\.$/.test(e.message));
  } finally {
    s.fechar();
  }
});
