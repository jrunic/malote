import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conectar } from '../src/adaptadores/whatsapp/conexao.js';
import type { IdentidadeBrutaDoVinculo } from '../src/adaptadores/whatsapp/identidade-da-conta.js';

const ME = { id: '5511900000001:14@s.whatsapp.net', lid: '100000000000001:14@lid', name: 'Conta Sintetica' };

function biblioteca(opcoes: { meSalvo?: IdentidadeBrutaDoVinculo; user?: IdentidadeBrutaDoVinculo }) {
  const ouvintes = new Map<string, (dado: unknown) => void>();
  let soquetes = 0;
  return {
    default: () => {
      soquetes += 1;
      return {
        ev: { on: (fluxo: string, f: (dado: unknown) => void) => ouvintes.set(fluxo, f) },
        requestPairingCode: () => Promise.resolve('12345678'),
        user: opcoes.user,
      };
    },
    useMultiFileAuthState: () =>
      Promise.resolve({
        state: opcoes.meSalvo === undefined ? {} : { creds: { me: opcoes.meSalvo } },
        saveCreds: () => undefined,
      }),
    DisconnectReason: { loggedOut: 401, connectionClosed: 428, connectionLost: 408 },
    soquetes: (): number => soquetes,
    emitir: (fluxo: string, dado: unknown): void => {
      ouvintes.get(fluxo)?.(dado);
    },
  };
}

async function conectarCom(
  b: ReturnType<typeof biblioteca>,
  aoIdentificar: ((i: IdentidadeBrutaDoVinculo) => 'seguir' | 'recusar') | undefined,
  extras: { aoTerminar?: (m: string) => void; aoReceber?: () => void; registrar?: (l: string) => void } = {},
): Promise<void> {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-conexao-id-'));
  try {
    await conectar({
      pastaDoVinculo: pasta,
      registrar: extras.registrar ?? (() => undefined),
      aoTerminar: extras.aoTerminar ?? (() => undefined),
      carregarBiblioteca: () => Promise.resolve(b),
      aoReceber: extras.aoReceber ?? (() => undefined),
      ...(aoIdentificar === undefined ? {} : { aoIdentificar }),
    });
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

test('vinculo ja pareado: o gancho roda ANTES de abrir o socket, com a identidade salva', async () => {
  const b = biblioteca({ meSalvo: ME });
  const vistas: IdentidadeBrutaDoVinculo[] = [];
  let soquetesNoGancho = -1;
  await conectarCom(b, (i) => {
    vistas.push(i);
    soquetesNoGancho = b.soquetes();
    return 'seguir';
  });
  assert.equal(vistas.length, 1);
  assert.deepEqual(vistas[0], ME);
  assert.equal(soquetesNoGancho, 0, 'o socket ainda nao tinha sido aberto');
  assert.equal(b.soquetes(), 1, 'e abriu depois, porque o gancho disse seguir');
});

test('recusar antes de abrir: o socket NUNCA abre e o ouvinte e avisado', async () => {
  const b = biblioteca({ meSalvo: ME });
  const fins: string[] = [];
  await conectarCom(b, () => 'recusar', { aoTerminar: (m) => fins.push(m) });
  assert.equal(b.soquetes(), 0, 'nenhum socket foi aberto');
  assert.equal(fins.length, 1);
  assert.match(fins[0] as string, /outra conta/);
});

test('primeiro pareamento: sem identidade salva, o gancho roda ao ABRIR, com o user do socket', async () => {
  const b = biblioteca({ user: ME });
  const vistas: IdentidadeBrutaDoVinculo[] = [];
  await conectarCom(b, (i) => {
    vistas.push(i);
    return 'seguir';
  });
  assert.equal(vistas.length, 0, 'antes de abrir nao ha identidade');
  b.emitir('connection.update', { connection: 'open' });
  assert.equal(vistas.length, 1);
  assert.deepEqual(vistas[0], ME);
});

test('recusar ao abrir: avisa, nao diz conectado e SILENCIA as mensagens que chegarem depois', async () => {
  const b = biblioteca({ user: ME });
  const linhas: string[] = [];
  const fins: string[] = [];
  let recebidas = 0;
  await conectarCom(b, () => 'recusar', {
    registrar: (l) => linhas.push(l),
    aoTerminar: (m) => fins.push(m),
    aoReceber: () => {
      recebidas += 1;
    },
  });
  b.emitir('connection.update', { connection: 'open' });
  assert.equal(fins.length, 1);
  assert.equal(linhas.includes('conectado.'), false, 'conta errada nao anuncia "conectado."');
  b.emitir('messages.upsert', {
    type: 'notify',
    messages: [{ key: { remoteJid: '5511900000009@s.whatsapp.net', id: 'X1', fromMe: false }, messageTimestamp: 1, message: { conversation: 'oi' } }],
  });
  assert.equal(recebidas, 0, 'depois da recusa o Acervo esta fechado: a mensagem nao pode chegar');
});

test('gancho que LANCA nao derruba a conexao: vira linha de log e o ouvinte segue', async () => {
  const b = biblioteca({ user: ME });
  const linhas: string[] = [];
  await conectarCom(
    b,
    () => {
      throw new Error('registro ocupado');
    },
    { registrar: (l) => linhas.push(l) },
  );
  b.emitir('connection.update', { connection: 'open' });
  assert.ok(linhas.some((l) => /falhou ao conferir a conta/.test(l)));
  assert.ok(linhas.includes('conectado.'));
});

test('sem gancho, nada muda (o caminho de quem nao pede identidade)', async () => {
  const b = biblioteca({ meSalvo: ME, user: ME });
  const linhas: string[] = [];
  await conectarCom(b, undefined, { registrar: (l) => linhas.push(l) });
  b.emitir('connection.update', { connection: 'open' });
  assert.equal(b.soquetes(), 1);
  assert.ok(linhas.includes('conectado.'));
});
