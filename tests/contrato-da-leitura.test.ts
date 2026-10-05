import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarReqDeLeitura, criarResDeLeitura, transferiveis, type PedidoDeLeitura } from '../src/rede/contrato-da-leitura.js';

const PEDIDO: PedidoDeLeitura = {
  metodo: 'GET',
  url: '/relatorio?x=1',
  chaveId: 'k1',
  inquilinoId: 'i1',
  dados: '/nao/usado',
};

test('o req da leitura oferece method e url, e lanca em qualquer outro membro (#1132)', () => {
  const req = criarReqDeLeitura(PEDIDO);
  assert.equal(req.method, 'GET');
  assert.equal(req.url, '/relatorio?x=1');
  assert.throws(() => (req as unknown as { headers: unknown }).headers, /req\.headers/);
  assert.throws(() => (req as unknown as { on: unknown }).on, /req\.on/);
});

test('o res da leitura captura writeHead e end, e lanca em qualquer outro membro (#1132)', () => {
  const { res, capturar } = criarResDeLeitura();
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"ok":true}');
  assert.deepEqual(capturar(), {
    status: 200,
    cabecalhos: { 'content-type': 'application/json' },
    corpo: '{"ok":true}',
  });
  const outro = criarResDeLeitura().res as unknown as Record<string, unknown>;
  for (const membro of ['write', 'setHeader', 'statusCode', 'on', 'once', 'destroy', 'flushHeaders']) {
    assert.throws(() => outro[membro], new RegExp(`res\\.${membro}`), membro);
  }
  assert.throws(() => {
    outro['statusCode'] = 500;
  }, /statusCode/);
});

test('headersSent so vira true depois do writeHead (#1132)', () => {
  const { res } = criarResDeLeitura();
  assert.equal(res.headersSent, false);
  res.writeHead(404, { 'content-type': 'application/json' });
  assert.equal(res.headersSent, true);
});

test('end COPIA o Buffer, aceita string e vazio, e so o primeiro end vale (#1132)', () => {
  const origem = Buffer.from([1, 2, 3]);
  const a = criarResDeLeitura();
  a.res.writeHead(200, {});
  a.res.end(origem);
  origem[0] = 9;
  const corpo = a.capturar()?.corpo as Uint8Array;
  assert.deepEqual([...corpo], [1, 2, 3], 'o corpo capturado nao muda quando o Buffer de origem muda');
  assert.ok(!Buffer.isBuffer(corpo) || corpo.buffer !== origem.buffer, 'nao e o mesmo ArrayBuffer (o pool do Node)');

  const b = criarResDeLeitura();
  b.res.writeHead(404, {});
  b.res.end('');
  assert.equal(b.capturar()?.corpo, '');

  const c = criarResDeLeitura();
  c.res.writeHead(200, {});
  c.res.end('primeiro');
  c.res.end('segundo');
  assert.equal(c.capturar()?.corpo, 'primeiro');
});

test('end NAO copia o Buffer que e dono do proprio ArrayBuffer (opcao A: o arquivo grande de /midia) (#1132)', () => {
  const grande = Buffer.alloc(100_000, 7); // nao vem do pool: ArrayBuffer proprio, byteOffset 0
  const a = criarResDeLeitura();
  a.res.writeHead(200, {});
  a.res.end(grande);
  const corpo = a.capturar()?.corpo as Uint8Array;
  assert.equal(corpo.buffer, grande.buffer, 'o mesmo ArrayBuffer: nenhuma copia do arquivo');
  assert.equal(corpo.byteLength, 100_000);

  // um Buffer que e FATIA de um ArrayBuffer maior nao pode ser transferido inteiro: copia
  const pai = Buffer.alloc(10_000, 1);
  const fatia = pai.subarray(100, 200);
  const b = criarResDeLeitura();
  b.res.writeHead(200, {});
  b.res.end(fatia);
  const copiado = b.capturar()?.corpo as Uint8Array;
  assert.notEqual(copiado.buffer, pai.buffer);
  assert.equal(copiado.byteLength, 100);
});

test('transferiveis lista o ArrayBuffer do corpo binario e nada para texto (#1132)', () => {
  const bin = new Uint8Array([1, 2, 3]);
  assert.deepEqual(transferiveis({ status: 200, cabecalhos: {}, corpo: bin }), [bin.buffer]);
  assert.deepEqual(transferiveis({ status: 200, cabecalhos: {}, corpo: 'texto' }), []);
});

test('sem end nao ha resposta: capturar devolve undefined (#1132)', () => {
  const { res, capturar } = criarResDeLeitura();
  res.writeHead(200, {});
  assert.equal(capturar(), undefined);
});
