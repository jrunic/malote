import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { criarServidor } from '../src/rede/servidor.js';
import { pedirGet, CodigoDeFalha } from '../src/cli/cliente.js';

const SERVIDOR = 'http://127.0.0.1';

async function portaLivre(): Promise<number> {
  // Pede ao sistema operacional uma porta efêmera e devolve: criar o servidor
  // de teste na porta 0 e ler address() é o mecanismo — nunca chute.
  const srv = createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const porta = (srv.address() as { port: number }).port;
  await new Promise<void>((r) => srv.close(() => r()));
  return porta;
}

test('GET com Bearer chega e devolve corpo', async () => {
  const porta = await portaLivre();
  const srv = createServer((req, res) => {
    if (req.headers.authorization === 'Bearer a-chave') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    } else {
      res.writeHead(401);
      res.end();
    }
  });
  await new Promise<void>((r) => srv.listen(porta, '127.0.0.1', r));
  try {
    const r = await pedirGet(`${SERVIDOR}:${porta}`, 'a-chave', '/conversas');
    assert.equal(r.status, 200);
    assert.equal(r.corpo, '{"ok":true}');
  } finally {
    srv.close();
  }
});

test('401 sai com classe CREDENCIAL (3) e mensagem que não adivinha qual', async () => {
  const porta = await portaLivre();
  const srv = criarServidor({ dados: process.cwd() + '/tests/ajuda', porta });
  await new Promise<void>((r) => srv.listen(porta, '127.0.0.1', r));
  try {
    try {
      await pedirGet(`${SERVIDOR}:${porta}`, 'chave-errada', '/conversas');
      assert.fail('deveria falhar');
    } catch (e) {
      assert.equal((e as CodigoDeFalha).classe, 'credencial');
      assert.equal((e as CodigoDeFalha).codigoDeSaida, 3);
      assert.match((e as Error).message, /credencial/i);
    }
  } finally {
    srv.close();
  }
});

test('conexão recusada sai com classe CONEXAO (4)', async () => {
  try {
    await pedirGet(`${SERVIDOR}:1`, 'k', '/x');
    assert.fail('deveria falhar');
  } catch (e) {
    assert.equal((e as CodigoDeFalha).classe, 'conexao');
    assert.equal((e as CodigoDeFalha).codigoDeSaida, 4);
  }
});

test('5xx sai com classe SERVIDOR (5); 404 sai com classe USO (6)', async () => {
  const porta = await portaLivre();
  const srv = createServer((_req, res) => {
    res.writeHead(503);
    res.end();
  });
  await new Promise<void>((r) => srv.listen(porta, '127.0.0.1', r));
  try {
    try {
      await pedirGet(`${SERVIDOR}:${porta}`, 'k', '/x');
      assert.fail('deveria falhar');
    } catch (e) {
      assert.equal((e as CodigoDeFalha).classe, 'servidor');
      assert.equal((e as CodigoDeFalha).codigoDeSaida, 5);
    }
  } finally {
    srv.close();
  }
});

test('timeout sai com classe INDETERMINADO (7) e mensagem declara resultado desconhecido', async () => {
  const porta = await portaLivre();
  const srv = createServer(() => {
    // NÃO responde: deixa o cliente estourar o tempo.
  });
  await new Promise<void>((r) => srv.listen(porta, '127.0.0.1', r));
  try {
    try {
      await pedirGet(`${SERVIDOR}:${porta}`, 'k', '/x', { timeoutMs: 200 });
      assert.fail('deveria falhar');
    } catch (e) {
      assert.equal((e as CodigoDeFalha).classe, 'indeterminado');
      assert.equal((e as CodigoDeFalha).codigoDeSaida, 7);
      assert.match((e as Error).message, /desconhecido/i);
    }
  } finally {
    srv.close();
  }
});
