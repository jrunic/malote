import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { responderDeResultado } from '../src/rede/servidor.js';

test('o corpo binario chega ao res.end SEM copia: o Buffer envolve o mesmo ArrayBuffer (#1132)', () => {
  const corpo = new Uint8Array(50_000).fill(3);
  let enviado: unknown;
  const res = {
    destroyed: false,
    headersSent: false,
    writeHead: () => undefined,
    end: (d: unknown) => {
      enviado = d;
    },
  } as unknown as ServerResponse;
  responderDeResultado(res, { tipo: 'resposta', resposta: { status: 200, cabecalhos: {}, corpo } });
  const b = enviado as Buffer;
  assert.ok(Buffer.isBuffer(b));
  assert.equal(b.buffer, corpo.buffer, 'o mesmo ArrayBuffer: Buffer.from(Uint8Array) copiaria');
  assert.equal(b.byteLength, 50_000);
});
