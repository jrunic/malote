// tests/conexao-presenca.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conectar, type GanchoDoReenvio } from '../src/adaptadores/whatsapp/conexao.js';

/**
 * O ouvinte nao se anuncia online (#1422). A biblioteca anuncia "disponivel" a cada Conexao quando a opcao esta ligada (o
 * padrao dela), e o ouvinte conecta dezenas de vezes por dia: o contato via a conta sempre online. A opcao entra na criacao
 * do socket em TODOS os cenarios, tambem no que nasce sem logger e sem fonte de reenvio, que e montado por partes condicionais.
 */

interface ConfigDoSocket {
  auth: unknown;
  logger?: unknown;
  getMessage?: unknown;
  markOnlineOnConnect?: unknown;
}

function biblioteca() {
  const configs: ConfigDoSocket[] = [];
  const logger = { error: (): void => undefined, info: (): void => undefined, child: (): object => logger };
  const lib = {
    default: (config: ConfigDoSocket) => {
      configs.push(config);
      return {
        ev: { on: (): void => undefined },
        requestPairingCode: () => Promise.resolve('12345678'),
        sendMessage: () => Promise.resolve({ key: { id: 'X' } }),
      };
    },
    DEFAULT_CONNECTION_CONFIG: { logger },
    proto: { Message: { fromObject: (o: unknown) => o } },
    useMultiFileAuthState: () => Promise.resolve({ state: { creds: 'sintetico' }, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401, connectionClosed: 428, connectionLost: 408 },
  };
  return { configs, lib };
}

async function comPasta<T>(f: (pasta: string) => Promise<T>): Promise<T> {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-conexao-presenca-'));
  try {
    return await f(pasta);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

const opcoesBase = (pasta: string, lib: unknown) => ({
  pastaDoVinculo: pasta,
  registrar: (): void => undefined,
  aoTerminar: (): void => undefined,
  carregarBiblioteca: () => Promise.resolve(lib),
  aoReceber: (): void => undefined,
});

const ganchoDeReenvio = (): GanchoDoReenvio => ({ lerDoAcervo: () => undefined, aoEvento: (): void => undefined });

test('o socket nasce sem anunciar presenca, no cenario SEM logger e SEM fonte de reenvio', () =>
  comPasta(async (pasta) => {
    const { configs, lib } = biblioteca();
    const conexao = await conectar(opcoesBase(pasta, lib));
    assert.equal(configs.length, 1);
    assert.equal(configs[0]!.markOnlineOnConnect, false);
    assert.equal(configs[0]!.logger, undefined, 'sem gancho, o socket continua sem logger proprio');
    assert.equal(configs[0]!.getMessage, undefined, 'e sem fonte de reenvio');
    conexao.parar();
  }));

test('o socket nasce sem anunciar presenca, no cenario COM logger e COM fonte de reenvio', () =>
  comPasta(async (pasta) => {
    const { configs, lib } = biblioteca();
    const conexao = await conectar({ ...opcoesBase(pasta, lib), aoPedidoDeReenvio: ganchoDeReenvio() });
    assert.equal(configs.length, 1);
    assert.equal(configs[0]!.markOnlineOnConnect, false);
    assert.notEqual(configs[0]!.logger, undefined, 'com gancho, o logger e o da biblioteca embrulhado');
    assert.equal(typeof configs[0]!.getMessage, 'function');
    conexao.parar();
  }));
