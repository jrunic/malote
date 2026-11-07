// tests/conexao-reenvio.test.ts
import { test, mock } from 'node:test';
import v8 from 'node:v8';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conectar, type EventoDeReenvio, type GanchoDoReenvio } from '../src/adaptadores/whatsapp/conexao.js';

/**
 * O pedido de reenvio pela CONEXAO (#1420), com biblioteca falsa: o `enviar` do ouvinte guarda a mensagem montada, a
 * pergunta da biblioteca (`getMessage` da configuracao do socket) a acha na memoria, a memoria sobrevive a religacao,
 * e uma Conexao nova (o reinicio) so tem o Acervo. A propriedade de ida e volta com a biblioteca real fica em
 * `conexao-reenvio-biblioteca-real.test.ts`.
 */

const CONTATO = '5511900000001@s.whatsapp.net';
const OPACO = '100000000000001@lid';

type Responder = (chave: { remoteJid?: string; id?: string } | undefined) => Promise<unknown>;

interface SocketFalso {
  ev: (nome: string, dado: unknown) => void;
  config: { auth: unknown; logger?: unknown; getMessage?: Responder };
  enviados: { jid: string; conteudo: unknown }[];
}

/** Biblioteca falsa: `sendMessage` devolve a chave e a "mensagem montada" (objeto novo por envio). */
function biblioteca(montar: (conteudo: unknown, id: string) => unknown = (c) => ({ montada: c })) {
  const sockets: SocketFalso[] = [];
  const linhasDoLogger: unknown[][] = [];
  const logger = {
    error: (...a: unknown[]): void => void linhasDoLogger.push(a),
    info: (...a: unknown[]): void => void linhasDoLogger.push(a),
    child: (): object => logger,
  };
  let sequencia = 0;
  const lib = {
    default: (config: SocketFalso['config']) => {
      const ouvintes = new Map<string, ((d: unknown) => void)[]>();
      const enviados: SocketFalso['enviados'] = [];
      sockets.push({
        ev: (nome, dado) => {
          for (const f of ouvintes.get(nome) ?? []) f(dado);
        },
        config,
        enviados,
      });
      return {
        ev: {
          on: (nome: string, f: (d: unknown) => void) => {
            ouvintes.set(nome, [...(ouvintes.get(nome) ?? []), f]);
          },
        },
        requestPairingCode: () => Promise.resolve('12345678'),
        sendMessage: (jid: string, conteudo: unknown) => {
          enviados.push({ jid, conteudo });
          const id = `3EB0SINTETICO${(sequencia += 1)}`;
          return Promise.resolve({ key: { id, remoteJid: jid, fromMe: true }, message: montar(conteudo, id) });
        },
      };
    },
    DEFAULT_CONNECTION_CONFIG: { logger },
    proto: { Message: { fromObject: (o: unknown) => ({ reconstituida: o }) } },
    useMultiFileAuthState: () => Promise.resolve({ state: { creds: 'sintetico' }, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401, connectionClosed: 428, connectionLost: 408 },
  };
  return { sockets, lib, linhasDoLogger };
}

async function comPasta<T>(f: (pasta: string) => Promise<T>): Promise<T> {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-conexao-reenvio-'));
  try {
    return await f(pasta);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

function gancho(acervo: (ref: string) => string | undefined = () => undefined): {
  gancho: GanchoDoReenvio;
  eventos: EventoDeReenvio[];
  lidos: string[];
} {
  const eventos: EventoDeReenvio[] = [];
  const lidos: string[] = [];
  return {
    eventos,
    lidos,
    gancho: {
      lerDoAcervo: (ref) => {
        lidos.push(ref);
        return acervo(ref);
      },
      aoEvento: (e) => eventos.push(e),
    },
  };
}

const ecoLocal = (id: string): string =>
  JSON.stringify({
    key: { remoteJid: CONTATO, fromMe: true, id },
    message: { extendedTextMessage: { text: 'sintetico' } },
    messageTimestamp: '1800000000',
  });

const opcoesBase = (pasta: string, lib: unknown) => ({
  pastaDoVinculo: pasta,
  registrar: (): void => undefined,
  aoTerminar: (): void => undefined,
  carregarBiblioteca: () => Promise.resolve(lib),
  aoReceber: (): void => undefined,
});

test('enviar guarda a mensagem montada, e o pedido a devolve pela memoria SEM tocar o Acervo', () =>
  comPasta(async (pasta) => {
    const { sockets, lib } = biblioteca();
    const g = gancho(() => ecoLocal('X'));
    const conexao = await conectar({ ...opcoesBase(pasta, lib), aoPedidoDeReenvio: g.gancho });
    const r = await conexao.enviar(CONTATO, { text: 'ola' });
    assert.deepEqual(r, { keyId: '3EB0SINTETICO1' }, 'enviar continua devolvendo so o keyId');
    assert.deepEqual(g.lidos, [], 'a Conexao sem pedido nao consulta o Acervo');
    assert.equal(g.eventos.length, 0, 'nem conta nada');
    const devolvida = await sockets[0]!.config.getMessage!({ remoteJid: CONTATO, id: '3EB0SINTETICO1' });
    assert.deepEqual(devolvida, { montada: { text: 'ola' } });
    assert.deepEqual(g.lidos, []);
    assert.deepEqual(
      g.eventos.map((e) => (e.tipo === 'pedido' ? [e.resultado, e.enderecoDoRecibo] : e.tipo)),
      [['achada-na-memoria', 'igual']],
    );
    conexao.parar();
  }));

test('o objeto devolvido e o MESMO que a biblioteca montou (nada de copia ou normalizacao)', () =>
  comPasta(async (pasta) => {
    const montadas: unknown[] = [];
    const { sockets, lib } = biblioteca((c) => {
      const m = { montada: c };
      montadas.push(m);
      return m;
    });
    const conexao = await conectar({ ...opcoesBase(pasta, lib), aoPedidoDeReenvio: gancho().gancho });
    await conexao.enviar(OPACO, { text: 'x' });
    assert.equal(await sockets[0]!.config.getMessage!({ remoteJid: OPACO, id: '3EB0SINTETICO1' }), montadas[0]);
    conexao.parar();
  }));

test('a memoria sobrevive a religacao: o pedido no socket NOVO acha a mensagem enviada pelo antigo', () =>
  comPasta(async (pasta) => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { sockets, lib } = biblioteca();
      const g = gancho();
      const conexao = await conectar({ ...opcoesBase(pasta, lib), aoPedidoDeReenvio: g.gancho });
      await conexao.enviar(CONTATO, { text: 'antes da queda' });
      sockets[0]!.ev('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 500 } } },
      });
      mock.timers.tick(5_000);
      assert.equal(sockets.length, 2, 'religou');
      assert.equal(typeof sockets[1]!.config.getMessage, 'function', 'o socket novo tambem responde');
      const r = await sockets[1]!.config.getMessage!({ remoteJid: CONTATO, id: '3EB0SINTETICO1' });
      assert.deepEqual(r, { montada: { text: 'antes da queda' } });
      assert.deepEqual(g.lidos, []);
      conexao.parar();
    } finally {
      mock.timers.reset();
    }
  }));

test('reinicio (Conexao nova): a memoria comeca vazia e o Acervo atende', () =>
  comPasta(async (pasta) => {
    const primeira = biblioteca();
    const c1 = await conectar({ ...opcoesBase(pasta, primeira.lib), aoPedidoDeReenvio: gancho().gancho });
    await c1.enviar(CONTATO, { text: 'antes do reinicio' });
    c1.parar();
    const segunda = biblioteca();
    const g = gancho((ref) => (ref === '3EB0SINTETICO1' ? ecoLocal(ref) : undefined));
    const c2 = await conectar({ ...opcoesBase(pasta, segunda.lib), aoPedidoDeReenvio: g.gancho });
    const r = await segunda.sockets[0]!.config.getMessage!({ remoteJid: CONTATO, id: '3EB0SINTETICO1' });
    assert.deepEqual(r, { reconstituida: { extendedTextMessage: { text: 'sintetico' } } });
    assert.deepEqual(g.lidos, ['3EB0SINTETICO1']);
    assert.equal((g.eventos[0] as { resultado: string }).resultado, 'achada-no-acervo');
    c2.parar();
  }));

test('a mensagem que a biblioteca nao devolveu nao e guardada: o pedido cai para o Acervo', () =>
  comPasta(async (pasta) => {
    const { sockets, lib } = biblioteca(() => undefined);
    const g = gancho();
    const conexao = await conectar({ ...opcoesBase(pasta, lib), aoPedidoDeReenvio: g.gancho });
    assert.deepEqual(await conexao.enviar(CONTATO, { text: 'x' }), { keyId: '3EB0SINTETICO1' });
    assert.equal(await sockets[0]!.config.getMessage!({ remoteJid: CONTATO, id: '3EB0SINTETICO1' }), undefined);
    assert.deepEqual(g.lidos, ['3EB0SINTETICO1']);
    conexao.parar();
  }));

test('SEM o gancho: enviar devolve o keyId de sempre, e o socket nao ganha resposta nem logger', () =>
  comPasta(async (pasta) => {
    const { sockets, lib } = biblioteca();
    const conexao = await conectar(opcoesBase(pasta, lib));
    assert.deepEqual(await conexao.enviar(CONTATO, { text: 'x' }), { keyId: '3EB0SINTETICO1' });
    assert.deepEqual(Object.keys(sockets[0]!.config), ['auth']);
    conexao.parar();
  }));

test('depois de parar, a pergunta de um socket antigo fica sem resposta, sem ler e sem contar', () =>
  comPasta(async (pasta) => {
    const { sockets, lib } = biblioteca();
    const g = gancho(() => ecoLocal('X'));
    const conexao = await conectar({ ...opcoesBase(pasta, lib), aoPedidoDeReenvio: g.gancho });
    await conexao.enviar(CONTATO, { text: 'x' });
    conexao.parar();
    assert.equal(await sockets[0]!.config.getMessage!({ remoteJid: CONTATO, id: '3EB0SINTETICO1' }), undefined);
    assert.equal(await sockets[0]!.config.getMessage!({ remoteJid: CONTATO, id: 'OUTRA' }), undefined);
    // O logger do socket antigo ainda escreve: depois de parar, nada chega ao gancho.
    const logger = sockets[0]!.config.logger as Record<string, (...a: unknown[]) => void>;
    logger['error']!({ key: {}, ids: ['A'] }, 'error in sending message again');
    logger['info']!({ key: {} }, 'will not send message again, as sent too many times');
    logger['info']!({ key: {} }, 'recv retry for not fromMe message');
    assert.deepEqual(g.lidos, []);
    assert.deepEqual(g.eventos, []);
  }));

test('parar esvazia a memoria do envio: a mensagem guardada deixa de ser alcancavel', () =>
  comPasta(async (pasta) => {
    v8.setFlagsFromString('--expose-gc');
    const coletar = vm.runInNewContext('gc') as () => void;
    let referencia: WeakRef<object> | undefined;
    const { lib } = biblioteca((c) => {
      const m = { montada: c };
      referencia = new WeakRef(m);
      return m;
    });
    const conexao = await conectar({ ...opcoesBase(pasta, lib), aoPedidoDeReenvio: gancho().gancho });
    await conexao.enviar(CONTATO, { text: 'x' });
    await new Promise((r) => setImmediate(r));
    coletar();
    assert.notEqual(referencia?.deref(), undefined, 'antes de parar, a memoria a segura');
    conexao.parar();
    await new Promise((r) => setImmediate(r));
    coletar();
    assert.equal(referencia?.deref(), undefined, 'depois de parar, ninguem a segura');
  }));

test('falhar ao guardar nunca faz o envio rejeitar, nem quando o registro da falha tambem lanca', () =>
  comPasta(async (pasta) => {
    // O relogio que lanca so durante o envio e o que faz `guardar` falhar; o registro tambem lanca.
    let quebrar = false;
    const agora = (): number => {
      if (quebrar) throw new RangeError('relogio');
      return 1_800_000_000_000;
    };
    const linhas: string[] = [];
    const um = biblioteca();
    const c1 = await conectar({
      ...opcoesBase(pasta, um.lib),
      registrar: (l) => void linhas.push(l),
      aoPedidoDeReenvio: gancho().gancho,
      agora,
    });
    quebrar = true;
    assert.deepEqual(await c1.enviar(CONTATO, { text: 'x' }), { keyId: '3EB0SINTETICO1' });
    quebrar = false;
    assert.deepEqual(linhas, ['[reenvio] falhou ao guardar na memoria do envio (RangeError)']);
    c1.parar();
    const dois = biblioteca();
    const c2 = await conectar({
      ...opcoesBase(pasta, dois.lib),
      registrar: () => {
        if (quebrar) throw new Error('log fechado');
      },
      aoPedidoDeReenvio: gancho().gancho,
      agora,
    });
    quebrar = true;
    assert.deepEqual(await c2.enviar(CONTATO, { text: 'x' }), { keyId: '3EB0SINTETICO1' });
    quebrar = false;
    c2.parar();
  }));

test('o logger do socket conta a falha de reenvio por recibo e as duas recusas no gancho', () =>
  comPasta(async (pasta) => {
    const { sockets, lib, linhasDoLogger } = biblioteca();
    const g = gancho();
    const conexao = await conectar({ ...opcoesBase(pasta, lib), aoPedidoDeReenvio: g.gancho });
    const logger = sockets[0]!.config.logger as Record<string, (...a: unknown[]) => void>;
    logger['error']!({ key: {}, ids: ['A', 'B'] }, 'error in sending message again');
    logger['info']!({ key: {} }, 'will not send message again, as sent too many times');
    logger['info']!({ key: {} }, 'recv retry for not fromMe message');
    logger['info']!({ key: {} }, 'outra linha');
    assert.deepEqual(g.eventos, [
      { tipo: 'recibo-falhou' },
      { tipo: 'recusa', motivo: 'limite' },
      { tipo: 'recusa', motivo: 'nao-propria' },
    ]);
    assert.equal(linhasDoLogger.length, 4, 'o logger original recebe tudo');
    conexao.parar();
  }));

test('o gancho que lanca nunca custa o log, o envio nem a resposta', () =>
  comPasta(async (pasta) => {
    const { sockets, lib } = biblioteca();
    const conexao = await conectar({
      ...opcoesBase(pasta, lib),
      aoPedidoDeReenvio: {
        lerDoAcervo: () => undefined,
        aoEvento: () => {
          throw new Error('disco cheio');
        },
      },
    });
    const logger = sockets[0]!.config.logger as Record<string, (...a: unknown[]) => void>;
    logger['error']!({}, 'error in sending message again');
    assert.deepEqual(await conexao.enviar(CONTATO, { text: 'x' }), { keyId: '3EB0SINTETICO1' });
    assert.deepEqual(await sockets[0]!.config.getMessage!({ remoteJid: CONTATO, id: '3EB0SINTETICO1' }), {
      montada: { text: 'x' },
    });
    conexao.parar();
  }));

test('a memoria da Conexao respeita o relogio que ela recebe: passada 1 h, o pedido cai para o Acervo', () =>
  comPasta(async (pasta) => {
    let t = 1_800_000_000_000;
    const { sockets, lib } = biblioteca();
    const g = gancho();
    const conexao = await conectar({ ...opcoesBase(pasta, lib), aoPedidoDeReenvio: g.gancho, agora: () => t });
    await conexao.enviar(CONTATO, { text: 'x' });
    t += 3_600_001;
    assert.equal(await sockets[0]!.config.getMessage!({ remoteJid: CONTATO, id: '3EB0SINTETICO1' }), undefined);
    assert.deepEqual(g.lidos, ['3EB0SINTETICO1']);
    conexao.parar();
  }));
