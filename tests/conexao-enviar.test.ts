import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conectar } from '../src/adaptadores/whatsapp/conexao.js';

function bibliotecaComEnvio(opcoes: {
  sendMessage: (jid: string, content: unknown) => Promise<{ key?: { id?: string } } | undefined>;
}) {
  const ouvintes = new Map<string, (dado: unknown) => void>();
  return {
    default: () => ({
      ev: { on: (fluxo: string, f: (dado: unknown) => void) => ouvintes.set(fluxo, f) },
      requestPairingCode: () => Promise.resolve('12345678'),
      updateMediaMessage: (m: unknown) => Promise.resolve(m),
      sendMessage: opcoes.sendMessage,
    }),
    useMultiFileAuthState: () => Promise.resolve({ state: {}, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401, connectionClosed: 428, connectionLost: 408 },
    downloadMediaMessage: () => Promise.reject(new Error('nao usado neste teste')),
  };
}

test('conexao.enviar chama sendMessage pelo socket corrente e devolve o keyId', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-conexao-enviar-'));
  try {
    const biblioteca = bibliotecaComEnvio({
      sendMessage: async () => ({ key: { id: 'ABC123' } }),
    });
    const conexao = await conectar({
      pastaDoVinculo: pasta,
      registrar: () => undefined,
      aoTerminar: () => undefined,
      carregarBiblioteca: () => Promise.resolve(biblioteca),
      aoReceber: () => undefined,
    });

    const resultado = await conexao.enviar('5511999990000@s.whatsapp.net', { text: 'oi' });
    assert.deepEqual(resultado, { keyId: 'ABC123' });
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('conexao.enviar devolve undefined quando sendMessage devolve undefined', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-conexao-enviar-'));
  try {
    const biblioteca = bibliotecaComEnvio({ sendMessage: async () => undefined });
    const conexao = await conectar({
      pastaDoVinculo: pasta,
      registrar: () => undefined,
      aoTerminar: () => undefined,
      carregarBiblioteca: () => Promise.resolve(biblioteca),
      aoReceber: () => undefined,
    });

    const resultado = await conexao.enviar('5511999990000@s.whatsapp.net', { text: 'oi' });
    assert.equal(resultado, undefined);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('conexao.enviar trata Boom 428 (connectionClosed) como indeterminado, nao propaga', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-conexao-enviar-'));
  try {
    const erroDeTransporte = Object.assign(new Error('Connection Closed'), {
      output: { statusCode: 428 },
    });
    const biblioteca = bibliotecaComEnvio({
      sendMessage: async () => {
        throw erroDeTransporte;
      },
    });
    const conexao = await conectar({
      pastaDoVinculo: pasta,
      registrar: () => undefined,
      aoTerminar: () => undefined,
      carregarBiblioteca: () => Promise.resolve(biblioteca),
      aoReceber: () => undefined,
    });

    const resultado = await conexao.enviar('5511999990000@s.whatsapp.net', { text: 'oi' });
    assert.equal(resultado, undefined, 'erro de transporte deveria virar indeterminado, nao excecao');
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('conexao.enviar trata Boom 408 (connectionLost) como indeterminado', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-conexao-enviar-'));
  try {
    const erroDeTransporte = Object.assign(new Error('Connection Lost'), {
      output: { statusCode: 408 },
    });
    const biblioteca = bibliotecaComEnvio({
      sendMessage: async () => {
        throw erroDeTransporte;
      },
    });
    const conexao = await conectar({
      pastaDoVinculo: pasta,
      registrar: () => undefined,
      aoTerminar: () => undefined,
      carregarBiblioteca: () => Promise.resolve(biblioteca),
      aoReceber: () => undefined,
    });

    const resultado = await conexao.enviar('5511999990000@s.whatsapp.net', { text: 'oi' });
    assert.equal(resultado, undefined);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('conexao.enviar PROPAGA excecao que nao e de transporte (destinatario invalido)', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-conexao-enviar-'));
  try {
    const biblioteca = bibliotecaComEnvio({
      sendMessage: async () => {
        throw new Error('invalid jid');
      },
    });
    const conexao = await conectar({
      pastaDoVinculo: pasta,
      registrar: () => undefined,
      aoTerminar: () => undefined,
      carregarBiblioteca: () => Promise.resolve(biblioteca),
      aoReceber: () => undefined,
    });

    await assert.rejects(
      () => conexao.enviar('5511999990000@s.whatsapp.net', { text: 'oi' }),
      /invalid jid/,
    );
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});
