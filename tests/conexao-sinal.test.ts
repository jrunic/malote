// tests/conexao-sinal.test.ts
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conectar } from '../src/adaptadores/whatsapp/conexao.js';

interface SocketFalso {
  ev: Map<string, (dado: unknown) => void>;
  ws: EventEmitter | undefined;
}

/**
 * Biblioteca falsa que devolve um socket NOVO a cada `default`, como a real a cada
 * religacao, com um emissor de transporte (`ws`) proprio. `variante` tira o `ws`
 * ou o `on` dele, para provar a compatibilidade com quem nao oferece o gancho.
 */
function biblioteca(variante: 'com-ws' | 'sem-ws' | 'ws-sem-on' = 'com-ws'): {
  sockets: SocketFalso[];
  lib: unknown;
} {
  const sockets: SocketFalso[] = [];
  const lib = {
    default: () => {
      const ev = new Map<string, (dado: unknown) => void>();
      const ws = variante === 'com-ws' ? new EventEmitter() : undefined;
      sockets.push({ ev, ws });
      return {
        ev: { on: (fluxo: string, f: (dado: unknown) => void) => ev.set(fluxo, f) },
        ...(variante === 'com-ws' ? { ws } : {}),
        ...(variante === 'ws-sem-on' ? { ws: {} } : {}),
        requestPairingCode: () => Promise.resolve('12345678'),
      };
    },
    useMultiFileAuthState: () => Promise.resolve({ state: {}, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401, connectionClosed: 428, connectionLost: 408 },
  };
  return { sockets, lib };
}

async function comPasta<T>(f: (pasta: string) => Promise<T>): Promise<T> {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-conexao-sinal-'));
  try {
    return await f(pasta);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

test('cada frame do transporte chama o gancho', () =>
  comPasta(async (pasta) => {
    const { sockets, lib } = biblioteca();
    let frames = 0;
    const conexao = await conectar({
      pastaDoVinculo: pasta,
      registrar: () => undefined,
      aoTerminar: () => undefined,
      carregarBiblioteca: () => Promise.resolve(lib),
      aoReceber: () => undefined,
      aoFrame: () => (frames += 1),
    });
    sockets[0]!.ws!.emit('frame', { tag: 'iq' });
    sockets[0]!.ws!.emit('frame', new Uint8Array(4));
    sockets[0]!.ws!.emit('frame', { tag: 'ib' });
    assert.equal(frames, 3);
    conexao.parar();
  }));

test('o sinal e do TRANSPORTE: o evento de dominio com o mesmo nome nao conta', () =>
  comPasta(async (pasta) => {
    const { sockets, lib } = biblioteca();
    let frames = 0;
    const conexao = await conectar({
      pastaDoVinculo: pasta,
      registrar: () => undefined,
      aoTerminar: () => undefined,
      carregarBiblioteca: () => Promise.resolve(lib),
      aoReceber: () => undefined,
      aoFrame: () => (frames += 1),
    });
    sockets[0]!.ev.get('frame')?.({});
    assert.equal(frames, 0);
    assert.equal(sockets[0]!.ws!.listenerCount('frame'), 1, 'a assinatura e no ws');
    conexao.parar();
  }));

test('a religacao reassina o gancho no socket NOVO', () =>
  comPasta(async (pasta) => {
    // A religacao so acontece por `setTimeout(abrir, 5 s)` interno, sem relogio injetavel: os timers
    // simulados do executor de testes a provocam sem esperar (prototipo de 12/10/2026).
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { sockets, lib } = biblioteca();
      let frames = 0;
      const conexao = await conectar({
        pastaDoVinculo: pasta,
        registrar: () => undefined,
        aoTerminar: () => undefined,
        carregarBiblioteca: () => Promise.resolve(lib),
        aoReceber: () => undefined,
        aoFrame: () => (frames += 1),
      });
      sockets[0]!.ev.get('connection.update')?.({
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 428 } } },
      });
      assert.equal(sockets.length, 1, 'antes do tempo nao religou');
      mock.timers.tick(5_000);
      assert.equal(sockets.length, 2, 'religou com um socket novo');

      sockets[1]!.ws!.emit('frame', { tag: 'iq' });
      assert.equal(frames, 1, 'o frame do socket NOVO chega ao gancho');
      conexao.parar();
    } finally {
      mock.timers.reset();
    }
  }));

test('excecao do gancho NAO escapa para a biblioteca nem impede o frame seguinte', () =>
  comPasta(async (pasta) => {
    const { sockets, lib } = biblioteca();
    let chamadas = 0;
    const conexao = await conectar({
      pastaDoVinculo: pasta,
      registrar: () => undefined,
      aoTerminar: () => undefined,
      carregarBiblioteca: () => Promise.resolve(lib),
      aoReceber: () => undefined,
      aoFrame: () => {
        chamadas += 1;
        throw new Error('falha sintetica do gancho');
      },
    });
    // `emit` roda o gancho DENTRO do processamento de frame da biblioteca: se a excecao escapasse,
    // custaria o frame (e, com ele, Mensagem).
    assert.doesNotThrow(() => sockets[0]!.ws!.emit('frame', { tag: 'iq' }));
    assert.doesNotThrow(() => sockets[0]!.ws!.emit('frame', { tag: 'iq' }));
    assert.equal(chamadas, 2);
    conexao.parar();
  }));

test('biblioteca SEM ws: a conexao sobe e funciona, e o gancho nunca e chamado', () =>
  comPasta(async (pasta) => {
    const { sockets, lib } = biblioteca('sem-ws');
    let frames = 0;
    const conexao = await conectar({
      pastaDoVinculo: pasta,
      registrar: () => undefined,
      aoTerminar: () => undefined,
      carregarBiblioteca: () => Promise.resolve(lib),
      aoReceber: () => undefined,
      aoFrame: () => (frames += 1),
    });
    assert.equal(sockets.length, 1);
    assert.equal(frames, 0);
    conexao.parar();
  }));

test('ws SEM on: a conexao sobe, sem erro', () =>
  comPasta(async (pasta) => {
    const { sockets, lib } = biblioteca('ws-sem-on');
    const conexao = await conectar({
      pastaDoVinculo: pasta,
      registrar: () => undefined,
      aoTerminar: () => undefined,
      carregarBiblioteca: () => Promise.resolve(lib),
      aoReceber: () => undefined,
      aoFrame: () => undefined,
    });
    assert.equal(sockets.length, 1);
    conexao.parar();
  }));

test('sem gancho, nada e assinado no transporte', () =>
  comPasta(async (pasta) => {
    const { sockets, lib } = biblioteca();
    const conexao = await conectar({
      pastaDoVinculo: pasta,
      registrar: () => undefined,
      aoTerminar: () => undefined,
      carregarBiblioteca: () => Promise.resolve(lib),
      aoReceber: () => undefined,
    });
    assert.equal(sockets[0]!.ws!.listenerCount('frame'), 0);
    conexao.parar();
  }));
