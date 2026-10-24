// tests/conexao-pendentes.test.ts
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conectar } from '../src/adaptadores/whatsapp/conexao.js';
import type { EventoDePendentes } from '../src/adaptadores/whatsapp/pendentes-na-conexao.js';

interface SocketFalso {
  ev: (nome: string, dado: unknown) => void;
  ws: EventEmitter;
  frames: unknown[];
  flushes: () => number;
  config: { auth: unknown; logger?: unknown };
}

type Variante = 'completa' | 'sem-sendNode' | 'sem-config';

/**
 * Biblioteca falsa com a superficie dos Pendentes (enviar no, perguntar e liberar o buffer), um logger
 * padrao e socket NOVO a cada `default`. `ev.on` aceita varios ouvintes, como o emissor real.
 */
function biblioteca(
  variante: Variante = 'completa',
  aoLiberar?: (ev: (n: string, d: unknown) => void) => void,
) {
  const sockets: SocketFalso[] = [];
  const chamadasDoLogger: unknown[][] = [];
  const loggerOriginal = {
    error: (...args: unknown[]): void => {
      chamadasDoLogger.push(args);
    },
    child: (): object => loggerOriginal,
  };
  const lib = {
    default: (config: { auth: unknown; logger?: unknown }) => {
      const ouvintes = new Map<string, ((d: unknown) => void)[]>();
      const ws = new EventEmitter();
      const frames: unknown[] = [];
      let buffering = true;
      let flushes = 0;
      const ev = (nome: string, dado: unknown): void => {
        for (const f of ouvintes.get(nome) ?? []) f(dado);
      };
      sockets.push({ ev, ws, frames, flushes: () => flushes, config });
      return {
        ev: {
          on: (nome: string, f: (d: unknown) => void) => {
            ouvintes.set(nome, [...(ouvintes.get(nome) ?? []), f]);
          },
          isBuffering: () => buffering,
          flush: () => {
            flushes += 1;
            buffering = false;
            aoLiberar?.(ev);
            return true;
          },
        },
        ws,
        ...(variante === 'sem-sendNode'
          ? {}
          : {
              sendNode: (frame: unknown) => {
                frames.push(frame);
                return Promise.resolve();
              },
            }),
        requestPairingCode: () => Promise.resolve('12345678'),
      };
    },
    ...(variante === 'sem-config' ? {} : { DEFAULT_CONNECTION_CONFIG: { logger: loggerOriginal } }),
    useMultiFileAuthState: () =>
      Promise.resolve({ state: { creds: 'sintetico' }, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401, connectionClosed: 428, connectionLost: 408 },
  };
  return { sockets, lib, chamadasDoLogger };
}

async function comPasta<T>(f: (pasta: string) => Promise<T>): Promise<T> {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-conexao-pendentes-'));
  try {
    return await f(pasta);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const PREVIEW = {
  tag: 'ib',
  attrs: {},
  content: [{ tag: 'offline_preview', attrs: { count: '300', notification: '300' } }],
};

test('SEM o gancho o socket nasce como sempre: so `auth`, e nenhum no do transporte e assinado', () =>
  comPasta(async (pasta) => {
    const { sockets, lib } = biblioteca();
    const conexao = await conectar({
      pastaDoVinculo: pasta,
      registrar: () => undefined,
      aoTerminar: () => undefined,
      carregarBiblioteca: () => Promise.resolve(lib),
      aoReceber: () => undefined,
    });
    assert.deepEqual(Object.keys(sockets[0]!.config), ['auth'], 'a configuracao nao ganhou nada');
    assert.equal(sockets[0]!.ws.eventNames().length, 0);
    conexao.parar();
  }));

test('COM o gancho o logger da biblioteca e embrulhado, e as falhas de decifra entram no estado', () =>
  comPasta(async (pasta) => {
    const { sockets, lib, chamadasDoLogger } = biblioteca();
    const eventos: EventoDePendentes[] = [];
    const conexao = await conectar({
      pastaDoVinculo: pasta,
      registrar: () => undefined,
      aoTerminar: () => undefined,
      carregarBiblioteca: () => Promise.resolve(lib),
      aoReceber: () => undefined,
      aoPendentes: (e) => eventos.push(e),
    });
    const logger = sockets[0]!.config.logger as { error: (...a: unknown[]) => void };
    assert.notEqual(logger, undefined, 'o logger embrulhado foi passado ao socket');
    logger.error({ key: 'sintetica' }, 'failed to decrypt message');
    logger.error({ key: 'sintetica' }, 'failed to decrypt message');
    logger.error({}, 'outro erro');
    assert.equal(chamadasDoLogger.length, 3, 'o logger original continua recebendo tudo');
    conexao.parar();
    assert.equal(eventos.at(-1)?.estado.falhasDeDecifra, 2);
  }));

test('sem logger para embrulhar o socket nasce so com `auth` e as falhas ficam indisponiveis (null)', () =>
  comPasta(async (pasta) => {
    const { sockets, lib } = biblioteca('sem-config');
    const eventos: EventoDePendentes[] = [];
    const conexao = await conectar({
      pastaDoVinculo: pasta,
      registrar: () => undefined,
      aoTerminar: () => undefined,
      carregarBiblioteca: () => Promise.resolve(lib),
      aoReceber: () => undefined,
      aoPendentes: (e) => eventos.push(e),
    });
    assert.deepEqual(Object.keys(sockets[0]!.config), ['auth']);
    conexao.parar();
    assert.equal(eventos.at(-1)?.estado.falhasDeDecifra, null);
  }));

test('biblioteca SEM a superficie dos Pendentes: a Conexao sobe e funciona, e o gancho nunca e chamado', () =>
  comPasta(async (pasta) => {
    const { sockets, lib } = biblioteca('sem-sendNode');
    const eventos: EventoDePendentes[] = [];
    let abriu = 0;
    const conexao = await conectar({
      pastaDoVinculo: pasta,
      registrar: (l) => {
        if (l === 'conectado.') abriu += 1;
      },
      aoTerminar: () => undefined,
      carregarBiblioteca: () => Promise.resolve(lib),
      aoReceber: () => undefined,
      aoPendentes: (e) => eventos.push(e),
    });
    sockets[0]!.ev('connection.update', { connection: 'open' });
    sockets[0]!.ws.emit('CB:ib,,offline_preview', PREVIEW);
    await esperar(30);
    assert.equal(abriu, 1, 'a Conexao abriu normalmente');
    assert.equal(eventos.length, 0, 'sem superficie o estado dos Pendentes e indisponivel');
    conexao.parar();
  }));

test('a Mensagem liberada pelo flush chega ao aoReceber pelo caminho de sempre', () =>
  comPasta(async (pasta) => {
    // O relogio do recolhedor anda de 1 s em 1 s e a pausa e de 4 s: os timers simulados as atravessam sem esperar.
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    try {
      const recebidas: unknown[][] = [];
      const mensagem = {
        key: { remoteJid: '5511000000000@s.whatsapp.net', id: 'M-SINTETICA', fromMe: false },
        messageTimestamp: 1_700_000_000,
        message: { conversation: 'oi' },
      };
      const { sockets, lib } = biblioteca('completa', (ev) =>
        ev('messages.upsert', { type: 'append', messages: [mensagem] }),
      );
      const eventos: EventoDePendentes[] = [];
      const conexao = await conectar({
        pastaDoVinculo: pasta,
        registrar: () => undefined,
        aoTerminar: () => undefined,
        carregarBiblioteca: () => Promise.resolve(lib),
        aoReceber: (m) => recebidas.push(m),
        aoPendentes: (e) => eventos.push(e),
      });
      sockets[0]!.ev('connection.update', { connection: 'open' });
      sockets[0]!.ws.emit('CB:ib,,offline_preview', PREVIEW);
      sockets[0]!.ws.emit('CB:message', { tag: 'message', attrs: {} });
      mock.timers.tick(3_000);
      assert.equal(sockets[0]!.flushes(), 0, 'antes da pausa de 4 s nada e liberado');
      mock.timers.tick(1_000);
      assert.equal(sockets[0]!.flushes(), 1);
      assert.equal(recebidas.length, 1, 'a Mensagem liberada foi entregue a gravacao');
      mock.timers.tick(1_000);
      assert.equal(sockets[0]!.frames.length, 1, 'e o primeiro pedido sai logo depois');
      sockets[0]!.ev('connection.update', { receivedPendingNotifications: true });
      mock.timers.tick(1_000);
      assert.equal(eventos.at(-1)?.estado.desfecho, 'recolheu');
      conexao.parar();
    } finally {
      mock.timers.reset();
    }
  }));

test('a religacao liga os Pendentes do socket NOVO, e o do socket que caiu termina como encerrou-antes', () =>
  comPasta(async (pasta) => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { sockets, lib } = biblioteca();
      const eventos: EventoDePendentes[] = [];
      const conexao = await conectar({
        pastaDoVinculo: pasta,
        registrar: () => undefined,
        aoTerminar: () => undefined,
        carregarBiblioteca: () => Promise.resolve(lib),
        aoReceber: () => undefined,
        aoPendentes: (e) => eventos.push(e),
      });
      sockets[0]!.ev('connection.update', { connection: 'open' });
      sockets[0]!.ws.emit('CB:ib,,offline_preview', PREVIEW);
      sockets[0]!.ev('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 500 } } },
      });
      assert.equal(eventos.at(-1)?.estado.desfecho, 'encerrou-antes');
      assert.equal(eventos.at(-1)?.estado.anunciados?.total, 300);
      mock.timers.tick(5_000);
      assert.equal(sockets.length, 2, 'religou');
      const antes = eventos.length;
      sockets[1]!.ws.emit('CB:ib,,offline_preview', {
        tag: 'ib',
        attrs: {},
        content: [{ tag: 'offline_preview', attrs: { count: '9' } }],
      });
      assert.ok(eventos.length > antes, 'o socket novo tem os proprios Pendentes');
      assert.equal(eventos.at(-1)?.estado.anunciados?.total, 9, 'e nao herda o estado do anterior');
      assert.equal(eventos.at(-1)?.estado.desfecho, 'em-andamento');
      conexao.parar();
    } finally {
      mock.timers.reset();
    }
  }));

test('parar() encerra os Pendentes: nenhum pedido depois, e o desfecho e encerrou-antes', () =>
  comPasta(async (pasta) => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    try {
      const { sockets, lib } = biblioteca();
      const eventos: EventoDePendentes[] = [];
      const conexao = await conectar({
        pastaDoVinculo: pasta,
        registrar: () => undefined,
        aoTerminar: () => undefined,
        carregarBiblioteca: () => Promise.resolve(lib),
        aoReceber: () => undefined,
        aoPendentes: (e) => eventos.push(e),
      });
      sockets[0]!.ws.emit('CB:ib,,offline_preview', PREVIEW);
      conexao.parar();
      mock.timers.tick(20_000);
      assert.equal(sockets[0]!.frames.length, 0);
      assert.equal(sockets[0]!.flushes(), 0);
      assert.equal(eventos.at(-1)?.estado.desfecho, 'encerrou-antes');
    } finally {
      mock.timers.reset();
    }
  }));

test('excecao do gancho dos Pendentes nunca derruba a Conexao', () =>
  comPasta(async (pasta) => {
    const { sockets, lib } = biblioteca();
    const conexao = await conectar({
      pastaDoVinculo: pasta,
      registrar: () => undefined,
      aoTerminar: () => undefined,
      carregarBiblioteca: () => Promise.resolve(lib),
      aoReceber: () => undefined,
      aoPendentes: () => {
        throw new Error('disco cheio');
      },
    });
    sockets[0]!.ws.emit('CB:ib,,offline_preview', PREVIEW);
    sockets[0]!.ev('connection.update', { connection: 'open' });
    conexao.parar();
  }));

test('a falha de decifra que o socket ANTIGO ainda loga depois da religacao nao entra na conta do socket novo', () =>
  comPasta(async (pasta) => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { sockets, lib } = biblioteca();
      const eventos: EventoDePendentes[] = [];
      const conexao = await conectar({
        pastaDoVinculo: pasta,
        registrar: () => undefined,
        aoTerminar: () => undefined,
        carregarBiblioteca: () => Promise.resolve(lib),
        aoReceber: () => undefined,
        aoPendentes: (e) => eventos.push(e),
      });
      const loggerAntigo = sockets[0]!.config.logger as { error: (...a: unknown[]) => void };
      sockets[0]!.ev('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 500 } } },
      });
      mock.timers.tick(5_000);
      assert.equal(sockets.length, 2, 'religou');
      loggerAntigo.error({ key: 'sintetica' }, 'failed to decrypt message');
      sockets[1]!.ws.emit('CB:ib,,offline_preview', PREVIEW);
      assert.equal(
        eventos.at(-1)?.estado.falhasDeDecifra,
        0,
        'a falha do socket antigo nao e do novo',
      );
      const loggerNovo = sockets[1]!.config.logger as { error: (...a: unknown[]) => void };
      loggerNovo.error({ key: 'sintetica' }, 'failed to decrypt message');
      sockets[1]!.ws.emit('CB:ib,,offline_preview', PREVIEW);
      assert.equal(eventos.at(-1)?.estado.falhasDeDecifra, 1, 'a do socket novo e');
      conexao.parar();
    } finally {
      mock.timers.reset();
    }
  }));

test('o relogio dos Pendentes e o da Conexao, quando ela o recebe', () =>
  comPasta(async (pasta) => {
    const { lib } = biblioteca();
    const eventos: EventoDePendentes[] = [];
    const conexao = await conectar({
      pastaDoVinculo: pasta,
      registrar: () => undefined,
      aoTerminar: () => undefined,
      carregarBiblioteca: () => Promise.resolve(lib),
      aoReceber: () => undefined,
      aoPendentes: (e) => eventos.push(e),
      agora: () => 1_234_567,
    });
    assert.equal(eventos[0]?.tipo, 'abertura');
    assert.equal(eventos[0]?.estado.socketCriadoEm, 1_234_567);
    conexao.parar();
  }));
