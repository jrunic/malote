import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conectar } from '../src/adaptadores/whatsapp/conexao.js';

// #1160 fatia C: a conexao ENTREGA o aviso de metadados de grupo; quem recebe grava.

function biblioteca(): { handlers: Map<string, Array<(d: unknown) => void>>; lib: unknown } {
  const handlers = new Map<string, Array<(d: unknown) => void>>();
  const lib = {
    default: () => ({
      // A biblioteca real aceita VARIOS ouvintes por fluxo.
      ev: { on: (f: string, h: (d: unknown) => void) => handlers.set(f, [...(handlers.get(f) ?? []), h]) },
      requestPairingCode: () => Promise.resolve('12345678'),
    }),
    useMultiFileAuthState: () => Promise.resolve({ state: {}, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401, connectionClosed: 428, connectionLost: 408 },
  };
  return { handlers, lib };
}

async function comConexao(
  corpo: (ctx: { emitir: (fluxo: string, dado: unknown) => void; recebidos: Array<[string, unknown]>; linhas: string[]; parar: () => void }) => void,
  aoAvisoDeGrupo?: (fluxo: string, dado: unknown) => void,
): Promise<void> {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-aviso-'));
  try {
    const { handlers, lib } = biblioteca();
    const recebidos: Array<[string, unknown]> = [];
    const linhas: string[] = [];
    const conexao = await conectar({
      pastaDoVinculo: pasta,
      registrar: (l) => linhas.push(l),
      aoTerminar: () => undefined,
      carregarBiblioteca: () => Promise.resolve(lib),
      aoReceber: () => undefined,
      aoAvisoDeGrupo: aoAvisoDeGrupo ?? ((f, d) => recebidos.push([f, d])),
    });
    corpo({
      emitir: (fluxo, dado) => (handlers.get(fluxo) ?? []).forEach((h) => h(dado)),
      recebidos,
      linhas,
      parar: () => conexao.parar(),
    });
    conexao.parar();
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

test('groups.upsert e groups.update chegam ao gancho, com o fluxo e o dado como vieram', () =>
  comConexao(({ emitir, recebidos }) => {
    emitir('groups.upsert', [{ id: '1@g.us', subject: 'A' }]);
    emitir('groups.update', [{ id: '1@g.us', desc: 'D' }]);
    assert.deepEqual(recebidos, [
      ['groups.upsert', [{ id: '1@g.us', subject: 'A' }]],
      ['groups.update', [{ id: '1@g.us', desc: 'D' }]],
    ]);
  }));

test('excecao do gancho NAO sobe para a biblioteca: vira linha de registro sem o dado', () =>
  comConexao(
    ({ emitir, linhas }) => {
      assert.doesNotThrow(() => emitir('groups.update', [{ id: '1@g.us', subject: 'TEXTO-QUE-NAO-PODE-VAZAR' }]));
      assert.ok(linhas.some((l) => l.includes('groups.update') && l.includes('falhou')));
      assert.equal(linhas.join('\n').includes('TEXTO-QUE-NAO-PODE-VAZAR'), false);
    },
    () => {
      throw new Error('banco ocupado');
    },
  ));

test('depois de parar, o aviso nao e entregue (o Acervo ja pode estar fechado)', () =>
  comConexao(({ emitir, recebidos, parar }) => {
    parar();
    emitir('groups.update', [{ id: '1@g.us', subject: 'A' }]);
    assert.deepEqual(recebidos, []);
  }));
