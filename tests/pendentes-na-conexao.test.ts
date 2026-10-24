// tests/pendentes-na-conexao.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import {
  ligarPendentes,
  observarLogger,
  pedidoDePendentes,
  temASuperficie,
  type EventoDePendentes,
  type SocketDePendentes,
} from '../src/adaptadores/whatsapp/pendentes-na-conexao.js';
import type { NoDoTransporte } from '../src/adaptadores/whatsapp/pendentes.js';

const CONSTANTES = { silencioMs: 20, esperaDaParteInicialMs: 500, prazoMs: 2_000 };
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Falso {
  sock: SocketDePendentes;
  ws: EventEmitter;
  ev: (nome: string, dado: unknown) => void;
  frames: unknown[];
  flushes: () => number;
  fecharBuffer: () => void;
}

function socketFalso(
  opcoes: {
    buffering?: boolean;
    aoEnviar?: (n: number, ws: EventEmitter, ev: (nome: string, dado: unknown) => void) => void;
    falharEnvio?: boolean;
    sem?: 'ws' | 'ws-on' | 'sendNode' | 'isBuffering' | 'flush';
  } = {},
): Falso {
  const ws = new EventEmitter();
  const ouvintes = new Map<string, ((dado: unknown) => void)[]>();
  const frames: unknown[] = [];
  let buffering = opcoes.buffering ?? true;
  let flushes = 0;
  const ev = (nome: string, dado: unknown): void => {
    for (const f of ouvintes.get(nome) ?? []) f(dado);
  };
  const sock: SocketDePendentes = {
    ...(opcoes.sem === 'ws'
      ? {}
      : {
          ws:
            opcoes.sem === 'ws-on'
              ? {}
              : { on: (e: string, f: (no: NoDoTransporte) => void) => ws.on(e, f) },
        }),
    ...(opcoes.sem === 'sendNode'
      ? {}
      : {
          sendNode: (frame: unknown) => {
            frames.push(frame);
            if (opcoes.falharEnvio === true) return Promise.reject(new Error('socket fechado'));
            opcoes.aoEnviar?.(frames.length, ws, ev);
            return Promise.resolve();
          },
        }),
    ev: {
      on: (nome: string, f: (dado: never) => void) => {
        const lista = ouvintes.get(nome) ?? [];
        lista.push(f as (dado: unknown) => void);
        ouvintes.set(nome, lista);
      },
      ...(opcoes.sem === 'isBuffering' ? {} : { isBuffering: () => buffering }),
      ...(opcoes.sem === 'flush'
        ? {}
        : {
            flush: () => {
              flushes += 1;
              buffering = false;
              return true;
            },
          }),
    },
  };
  return {
    sock,
    ws,
    ev,
    frames,
    flushes: () => flushes,
    fecharBuffer: () => {
      buffering = false;
    },
  };
}

function previewDe(total: number): unknown {
  return {
    tag: 'ib',
    attrs: {},
    content: [
      { tag: 'offline_preview', attrs: { count: String(total), notification: String(total) } },
    ],
  };
}

function ligar(
  f: Falso,
  extra: { contaFalhasDeDecifra?: boolean } = {},
): { eventos: EventoDePendentes[]; ligado: ReturnType<typeof ligarPendentes> } {
  const eventos: EventoDePendentes[] = [];
  const ligado = ligarPendentes(f.sock, {
    agora: Date.now,
    aoPendentes: (e) => eventos.push(e),
    contaFalhasDeDecifra: extra.contaFalhasDeDecifra ?? false,
    constantes: CONSTANTES,
    passoMs: 5,
  });
  return { eventos, ligado };
}

test('sem a superficie completa o modulo fica inerte: nada e assinado e nada e emitido', () => {
  for (const sem of ['ws', 'ws-on', 'sendNode', 'isBuffering', 'flush'] as const) {
    const f = socketFalso({ sem });
    assert.equal(temASuperficie(f.sock), false, sem);
    const { eventos, ligado } = ligar(f);
    assert.equal(ligado, undefined, sem);
    assert.equal(eventos.length, 0, sem);
    assert.equal(f.ws.eventNames().length, 0, `${sem}: nenhum no do transporte assinado`);
  }
  assert.equal(temASuperficie(socketFalso().sock), true);
});

test('o pedido e o mesmo no que a biblioteca envia, com o numero de itens pedido', () => {
  assert.deepEqual(pedidoDePendentes(100), {
    tag: 'ib',
    attrs: {},
    content: [{ tag: 'offline_batch', attrs: { count: '100' } }],
  });
});

test('recolhe: a parte inicial assenta, o buffer e liberado UMA vez, os pedidos saem e o fim fecha como recolheu', async () => {
  const f = socketFalso({
    aoEnviar: (n, ws, ev) => {
      setTimeout(() => {
        for (let i = 0; i < 5; i += 1)
          ws.emit('CB:notification', { tag: 'notification', attrs: {} });
        if (n === 3) ev('connection.update', { receivedPendingNotifications: true });
      }, 2);
    },
  });
  const { eventos } = ligar(f);
  f.ev('connection.update', { connection: 'open' });
  f.ws.emit('CB:ib,,offline_preview', previewDe(300));
  for (let i = 0; i < 4; i += 1) f.ws.emit('CB:message', { tag: 'message', attrs: {} });
  await esperar(300);
  assert.equal(f.flushes(), 1);
  assert.equal(f.frames.length, 3, 'um pedido por pausa, e para quando o fim chega');
  assert.deepEqual(f.frames[0], pedidoDePendentes(100));
  const tipos = eventos.map((e) => e.tipo);
  assert.equal(tipos[0], 'abertura');
  assert.ok(tipos.includes('anuncio'));
  assert.equal(tipos.filter((t) => t === 'final').length, 1, 'um unico final');
  const final = eventos.at(-1)!;
  assert.equal(final.tipo, 'final');
  assert.equal(final.estado.desfecho, 'recolheu');
  assert.equal(final.estado.pedidos, 3);
  assert.equal(final.estado.anunciados?.total, 300);
  assert.equal(final.estado.recebidos.mensagens, 4);
  assert.equal(final.estado.recebidos.notificacoes, 15);
  assert.notEqual(final.estado.abertoEm, null);
});

test('fim declarado antes da pausa: nenhum flush, nenhum pedido, fim-natural', async () => {
  const f = socketFalso();
  const { eventos } = ligar(f);
  f.ws.emit('CB:ib,,offline_preview', previewDe(7));
  f.ws.emit('CB:message', { tag: 'message', attrs: {} });
  f.ev('connection.update', { connection: 'open' });
  f.ev('connection.update', { receivedPendingNotifications: true });
  await esperar(120);
  assert.equal(f.flushes(), 0);
  assert.equal(f.frames.length, 0);
  assert.equal(eventos.at(-1)?.estado.desfecho, 'fim-natural');
});

test('o `receivedPendingNotifications` falso do comeco nao e fim', async () => {
  const f = socketFalso();
  const { eventos } = ligar(f);
  f.ev('connection.update', { receivedPendingNotifications: false });
  await esperar(60);
  assert.equal(eventos.at(-1)?.estado.fimDeclaradoEm, null);
  assert.equal(eventos.at(-1)?.estado.desfecho, 'em-andamento');
});

test('buffer ja inativo: o recolhimento segue e nao ha flush', async () => {
  const f = socketFalso({
    buffering: false,
    aoEnviar: (n, _ws, ev) => {
      if (n === 1) ev('connection.update', { receivedPendingNotifications: true });
    },
  });
  ligar(f);
  f.ws.emit('CB:ib,,offline_preview', previewDe(500));
  f.ws.emit('CB:message', { tag: 'message', attrs: {} });
  await esperar(200);
  assert.equal(f.flushes(), 0);
  assert.equal(f.frames.length, 1);
});

/** A plataforma que responde a cada pedido com alguns nos, sem nunca declarar o fim. */
const respondeSempre = (_n: number, ws: EventEmitter): void => {
  setTimeout(() => ws.emit('CB:notification', { tag: 'notification', attrs: {} }), 2);
};

test('o socket fechando no meio: encerrou-antes, e nenhum pedido depois', async () => {
  const f = socketFalso({ aoEnviar: respondeSempre });
  const { eventos } = ligar(f);
  f.ev('connection.update', { connection: 'open' });
  f.ws.emit('CB:ib,,offline_preview', previewDe(5_000));
  f.ws.emit('CB:message', { tag: 'message', attrs: {} });
  await esperar(120);
  const antes = f.frames.length;
  assert.ok(antes >= 1);
  f.ev('connection.update', { connection: 'close' });
  await esperar(150);
  assert.equal(f.frames.length, antes, 'nenhum pedido depois do close');
  assert.equal(eventos.at(-1)?.estado.desfecho, 'encerrou-antes');
  assert.equal(eventos.filter((e) => e.tipo === 'final').length, 1);
});

test('fim que chega DEPOIS do teto: dois finais, e o segundo corrige o desfecho para recolheu', async () => {
  const f = socketFalso();
  const { eventos } = ligar(f);
  f.ev('connection.update', { connection: 'open' });
  f.ws.emit('CB:ib,,offline_preview', previewDe(5_000));
  f.ws.emit('CB:message', { tag: 'message', attrs: {} });
  await esperar(250);
  assert.equal(
    eventos.at(-1)?.estado.desfecho,
    'sem-resposta',
    'tres pedidos sem nenhum no de volta',
  );
  f.ev('connection.update', { receivedPendingNotifications: true });
  const finais = eventos.filter((e) => e.tipo === 'final').map((e) => e.estado.desfecho);
  assert.deepEqual(
    finais,
    ['sem-resposta', 'recolheu'],
    'a plataforma declarou o fim, so que depois do esforco',
  );
  assert.notEqual(eventos.at(-1)?.estado.fimDeclaradoEm, null);
});

test('encerrar() (parar a Conexao) cancela o relogio e fecha como encerrou-antes, uma vez', async () => {
  const f = socketFalso({ aoEnviar: respondeSempre });
  const { eventos, ligado } = ligar(f);
  f.ws.emit('CB:ib,,offline_preview', previewDe(5_000));
  f.ws.emit('CB:message', { tag: 'message', attrs: {} });
  await esperar(80);
  ligado!.encerrar();
  ligado!.encerrar();
  const antes = f.frames.length;
  await esperar(120);
  assert.equal(f.frames.length, antes);
  assert.equal(eventos.at(-1)?.estado.desfecho, 'encerrou-antes');
  assert.equal(eventos.filter((e) => e.tipo === 'final').length, 1);
  f.ws.emit('CB:message', { tag: 'message', attrs: {} });
  assert.equal(
    eventos.at(-1)?.estado.recebidos.mensagens,
    1,
    'depois de encerrar nada mais e contado',
  );
});

test('falha de envio: falha-de-envio, sem insistir', async () => {
  const f = socketFalso({ falharEnvio: true });
  const { eventos } = ligar(f);
  f.ws.emit('CB:ib,,offline_preview', previewDe(5_000));
  f.ws.emit('CB:message', { tag: 'message', attrs: {} });
  await esperar(250);
  assert.equal(f.frames.length, 1);
  assert.equal(eventos.at(-1)?.estado.desfecho, 'falha-de-envio');
});

test('envio que lanca de forma sincrona tambem e falha-de-envio', async () => {
  const f = socketFalso();
  (f.sock as unknown as { sendNode: () => never }).sendNode = (): never => {
    throw new Error('socket fechado');
  };
  const { eventos } = ligar(f);
  f.ws.emit('CB:ib,,offline_preview', previewDe(5_000));
  f.ws.emit('CB:message', { tag: 'message', attrs: {} });
  await esperar(250);
  assert.equal(eventos.at(-1)?.estado.desfecho, 'falha-de-envio');
});

test('gancho que lanca nao derruba nada: o recolhimento termina assim mesmo', async () => {
  const f = socketFalso({
    aoEnviar: (n, _ws, ev) => {
      if (n === 1) ev('connection.update', { receivedPendingNotifications: true });
    },
  });
  let chamadas = 0;
  ligarPendentes(f.sock, {
    agora: Date.now,
    aoPendentes: () => {
      chamadas += 1;
      throw new Error('disco cheio');
    },
    contaFalhasDeDecifra: false,
    constantes: CONSTANTES,
    passoMs: 5,
  });
  f.ws.emit('CB:ib,,offline_preview', previewDe(500));
  f.ws.emit('CB:message', { tag: 'message', attrs: {} });
  await esperar(200);
  assert.ok(chamadas >= 3);
  assert.equal(f.frames.length, 1);
});

test('no de anuncio sem contagem legivel e ignorado: sem anuncio nao ha pedido', async () => {
  const f = socketFalso();
  const { eventos } = ligar(f);
  f.ws.emit('CB:ib,,offline_preview', {
    tag: 'ib',
    attrs: {},
    content: [{ tag: 'offline_preview', attrs: {} }],
  });
  f.ws.emit('CB:message', { tag: 'message', attrs: {} });
  await esperar(120);
  assert.equal(f.frames.length, 0);
  assert.ok(!eventos.some((e) => e.tipo === 'anuncio'));
});

test('a assinatura e na CRIACAO do socket: o anuncio que chega antes do open conta', async () => {
  const f = socketFalso();
  const { eventos } = ligar(f);
  f.ws.emit('CB:ib,,offline_preview', previewDe(42));
  f.ev('connection.update', { connection: 'open' });
  await esperar(20);
  const e = eventos.at(-1)!.estado;
  assert.equal(e.anunciados?.total, 42);
  assert.notEqual(e.abertoEm, null);
  assert.ok(e.socketCriadoEm <= e.abertoEm!);
});

test('o relogio nao segura o processo vivo', () => {
  const codigo = `
    import { EventEmitter } from 'node:events';
    import { ligarPendentes } from './src/adaptadores/whatsapp/pendentes-na-conexao.ts';
    const ws = new EventEmitter();
    ligarPendentes({
      ws: { on: (e, f) => ws.on(e, f) },
      sendNode: () => Promise.resolve(),
      ev: { on: () => undefined, isBuffering: () => true, flush: () => true },
    }, { agora: Date.now, aoPendentes: () => undefined, contaFalhasDeDecifra: false });
  `;
  const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', codigo], {
    timeout: 8_000,
    cwd: process.cwd(),
  });
  assert.equal(r.error, undefined, 'o processo saiu sozinho, sem estourar o prazo');
  assert.equal(r.status, 0);
});

test('o estado emitido nunca carrega JID nem id de Mensagem', async () => {
  const f = socketFalso({
    aoEnviar: (n, _ws, ev) => {
      if (n === 2) ev('connection.update', { receivedPendingNotifications: true });
    },
  });
  const { eventos } = ligar(f);
  f.ws.emit('CB:ib,,offline_preview', previewDe(500));
  f.ws.emit('CB:message', {
    tag: 'message',
    attrs: { id: 'ID-SINTETICO-123', from: '5599900000000@s.whatsapp.net' },
  });
  await esperar(200);
  const texto = JSON.stringify(eventos);
  assert.ok(!texto.includes('ID-SINTETICO-123'));
  assert.ok(!texto.includes('5599900000000'));
});

// ---- observarLogger ----

function loggerFalso(): {
  logger: Record<string, unknown>;
  chamadas: { metodo: string; args: unknown[]; eu: unknown }[];
  filho: Record<string, unknown>;
} {
  const chamadas: { metodo: string; args: unknown[]; eu: unknown }[] = [];
  const registrar = function (this: unknown, metodo: string) {
    return (...args: unknown[]): string => {
      chamadas.push({ metodo, args, eu: this });
      return `${metodo}-ok`;
    };
  };
  const filho: Record<string, unknown> = {};
  filho['error'] = (...args: unknown[]): string => {
    chamadas.push({ metodo: 'filho.error', args, eu: filho });
    return 'filho-error-ok';
  };
  const logger: Record<string, unknown> = { level: 'info' };
  logger['info'] = function (this: unknown, ...args: unknown[]): string {
    chamadas.push({ metodo: 'info', args, eu: this });
    return 'info-ok';
  };
  logger['error'] = function (this: unknown, ...args: unknown[]): string {
    chamadas.push({ metodo: 'error', args, eu: this });
    return 'error-ok';
  };
  logger['child'] = (): Record<string, unknown> => filho;
  void registrar;
  return { logger, chamadas, filho };
}

test('observarLogger conta SO a falha de decifra, repassa tudo e devolve o retorno', () => {
  const { logger, chamadas } = loggerFalso();
  let falhas = 0;
  const envolvido = observarLogger(logger, () => (falhas += 1)) as Record<
    string,
    (...a: unknown[]) => unknown
  >;
  assert.equal(envolvido['error']!({ key: 'x' }, 'failed to decrypt message'), 'error-ok');
  assert.equal(envolvido['error']!({ key: 'x' }, 'outro erro'), 'error-ok');
  assert.equal(
    envolvido['info']!({}, 'failed to decrypt message'),
    'info-ok',
    'so o nivel error conta',
  );
  assert.equal(falhas, 1);
  assert.equal(chamadas.length, 3, 'tudo foi repassado');
  assert.equal(chamadas[0]!.eu, logger, 'o `this` do original e preservado');
  assert.equal((envolvido as unknown as { level: string }).level, 'info');
});

test('observarLogger embrulha o logger filho tambem (child)', () => {
  const { logger, chamadas, filho } = loggerFalso();
  let falhas = 0;
  const envolvido = observarLogger(logger, () => (falhas += 1)) as {
    child: (b: object) => Record<string, (...a: unknown[]) => unknown>;
  };
  const f = envolvido.child({ class: 'baileys' });
  assert.equal(f['error']!({}, 'failed to decrypt message'), 'filho-error-ok');
  assert.equal(falhas, 1);
  assert.equal(chamadas.at(-1)!.eu, filho);
});

test('observarLogger: sem logger devolve undefined; contador que lanca nunca custa o log', () => {
  assert.equal(
    observarLogger(undefined, () => undefined),
    undefined,
  );
  assert.equal(
    observarLogger(null, () => undefined),
    undefined,
  );
  assert.equal(
    observarLogger('texto', () => undefined),
    undefined,
  );
  const { logger } = loggerFalso();
  const envolvido = observarLogger(logger, () => {
    throw new Error('contador quebrou');
  }) as Record<string, (...a: unknown[]) => unknown>;
  assert.equal(envolvido['error']!({}, 'failed to decrypt message'), 'error-ok');
});
