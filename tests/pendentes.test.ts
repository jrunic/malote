// tests/pendentes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSTANTES_PADRAO,
  criarRecolhedor,
  lerAnunciados,
  tetoDePedidos,
  type Anunciados,
  type Recolhedor,
} from '../src/adaptadores/whatsapp/pendentes.js';

function relogio(inicio = 1_700_000_000_000): {
  agora: () => number;
  avancar: (ms: number) => void;
} {
  let t = inicio;
  return {
    agora: () => t,
    avancar: (ms: number) => {
      t += ms;
    },
  };
}

const SILENCIO = CONSTANTES_PADRAO.silencioMs;

function anunciado(total: number): Anunciados {
  return {
    total,
    mensagens: 0,
    recibos: 0,
    notificacoes: total,
    status: 0,
    chamadas: 0,
    outros: 0,
  };
}

/** Cria o recolhedor, abre, anuncia e deixa a parte inicial assentar: o proximo passo libera. */
function comParteAssentada(
  total = 3_583,
  extra: Parameters<typeof criarRecolhedor>[0]['constantes'] = {},
): {
  r: Recolhedor;
  rel: ReturnType<typeof relogio>;
} {
  const rel = relogio();
  const r = criarRecolhedor({ agora: rel.agora, constantes: extra });
  r.abriu();
  r.anuncio(anunciado(total));
  for (let i = 0; i < 100; i += 1) r.no('mensagem');
  rel.avancar(SILENCIO);
  return { r, rel };
}

test('o teto de pedidos e 2 x (anunciados / 100, para cima) + 10, com piso de 20', () => {
  assert.equal(tetoDePedidos(3_583), 82);
  assert.equal(tetoDePedidos(100), 20);
  assert.equal(tetoDePedidos(0), 20);
  assert.equal(tetoDePedidos(700), 24);
  assert.equal(tetoDePedidos(701), 26);
});

test('lerAnunciados le a contagem total e por tipo do no de aviso', () => {
  const no = {
    tag: 'ib',
    attrs: {},
    content: [
      {
        tag: 'offline_preview',
        attrs: {
          count: '3583',
          message: '302',
          receipt: '197',
          notification: '3048',
          appdata: '0',
          call: '3',
          status: '32',
        },
      },
    ],
  };
  assert.deepEqual(lerAnunciados(no), {
    total: 3_583,
    mensagens: 302,
    recibos: 197,
    notificacoes: 3_048,
    status: 32,
    chamadas: 3,
    outros: 0,
  });
});

test('lerAnunciados devolve null sem contagem total legivel', () => {
  assert.equal(lerAnunciados({ tag: 'ib', attrs: {}, content: [] }), null);
  assert.equal(
    lerAnunciados({ tag: 'ib', attrs: {}, content: [{ tag: 'offline_preview', attrs: {} }] }),
    null,
  );
  assert.equal(
    lerAnunciados({
      tag: 'ib',
      attrs: {},
      content: [{ tag: 'offline_preview', attrs: { count: 'abc' } }],
    }),
    null,
  );
  assert.equal(lerAnunciados({ tag: 'ib', attrs: {}, content: 'texto' }), null);
  assert.equal(lerAnunciados({ tag: 'ib' }), null);
});

test('parte inicial assentada: libera UMA vez e so entao pede', () => {
  const { r, rel } = comParteAssentada();
  assert.equal(r.passo(true), 'liberar');
  assert.equal(
    r.passo(true),
    'pedir',
    'a parte inicial ja estava quieta: o primeiro pedido sai logo depois da liberacao',
  );
  rel.avancar(SILENCIO);
  assert.equal(r.passo(true), 'pedir');
  assert.equal(r.estado().liberadoEm !== null, true);
});

test('enquanto ainda chegam nos, nao libera nem pede', () => {
  const rel = relogio();
  const r = criarRecolhedor({ agora: rel.agora });
  r.abriu();
  r.anuncio(anunciado(3_000));
  // 14 x 3.999 ms = 56 s: dentro dos 60 s da espera da parte inicial (passado disso, liberar e a regra).
  for (let i = 0; i < 14; i += 1) {
    rel.avancar(SILENCIO - 1);
    r.no('notificacao');
    assert.equal(r.passo(true), undefined, `passo ${i}`);
  }
  assert.equal(r.estado().liberadoEm, null);
  assert.equal(r.estado().pedidos, 0);
});

test('passados 60 s do socket, libera mesmo com nos ainda chegando', () => {
  const rel = relogio();
  const r = criarRecolhedor({ agora: rel.agora });
  r.anuncio(anunciado(3_000));
  let acao: string | undefined;
  for (let i = 0; i < 20 && acao === undefined; i += 1) {
    rel.avancar(SILENCIO - 1);
    r.no('notificacao');
    acao = r.passo(true);
  }
  assert.equal(acao, 'liberar');
  assert.ok(rel.agora() - r.estado().socketCriadoEm >= CONSTANTES_PADRAO.esperaDaParteInicialMs);
});

test('sem anuncio e sem fim: passados 11 min segue em-andamento, porque sem anuncio nao ha recolhimento nem prazo dele', () => {
  const rel = relogio();
  const r = criarRecolhedor({ agora: rel.agora });
  r.abriu();
  rel.avancar(CONSTANTES_PADRAO.esperaDaParteInicialMs);
  assert.equal(r.passo(true), 'liberar');
  rel.avancar(11 * 60_000);
  assert.equal(r.passo(true), undefined);
  assert.equal(r.estado().desfecho, 'em-andamento');
  r.fechou();
  assert.equal(r.estado().desfecho, 'encerrou-antes');
});

test('no de chamada tambem conta como no (parte so de chamadas)', () => {
  const rel = relogio();
  const r = criarRecolhedor({ agora: rel.agora });
  r.anuncio(anunciado(3));
  rel.avancar(SILENCIO - 1);
  r.no('chamada');
  rel.avancar(SILENCIO - 1);
  assert.equal(r.passo(true), undefined, 'a chamada reiniciou a pausa');
  assert.equal(r.estado().recebidos.chamadas, 1);
  rel.avancar(1);
  assert.equal(r.passo(true), 'liberar');
});

test('sem anuncio: so a espera de 60 s libera, e nunca ha pedido', () => {
  const rel = relogio();
  const r = criarRecolhedor({ agora: rel.agora });
  r.abriu();
  rel.avancar(SILENCIO * 5);
  assert.equal(r.passo(true), undefined, 'sem anuncio a pausa nao basta');
  rel.avancar(CONSTANTES_PADRAO.esperaDaParteInicialMs);
  assert.equal(r.passo(true), 'liberar');
  rel.avancar(SILENCIO * 10);
  assert.equal(r.passo(true), undefined, 'sem anuncio nao ha pedido');
  assert.equal(r.estado().pedidos, 0);
});

test('buffer inativo: a liberacao e dispensada, o recolhimento segue', () => {
  const { r } = comParteAssentada();
  assert.equal(r.passo(false), undefined, 'nada a liberar');
  assert.equal(r.passo(false), 'pedir');
});

test('fim declarado antes da pausa: zero acoes e fim-natural', () => {
  const rel = relogio();
  const r = criarRecolhedor({ agora: rel.agora });
  r.abriu();
  r.anuncio(anunciado(7));
  r.no('mensagem');
  rel.avancar(200);
  r.fim();
  assert.equal(r.passo(true), undefined);
  const e = r.estado();
  assert.equal(e.desfecho, 'fim-natural');
  assert.equal(e.pedidos, 0);
  assert.equal(e.liberadoEm, null);
  assert.notEqual(e.fimDeclaradoEm, null);
});

test('fim sem anuncio tambem e fim-natural', () => {
  const rel = relogio();
  const r = criarRecolhedor({ agora: rel.agora });
  r.fim();
  assert.equal(r.passo(true), undefined);
  assert.equal(r.estado().desfecho, 'fim-natural');
  assert.equal(r.estado().anunciados, null);
});

test('recolhe: pede a cada pausa e termina como recolheu quando o fim chega', () => {
  const { r, rel } = comParteAssentada();
  assert.equal(r.passo(true), 'liberar');
  for (let i = 1; i <= 3; i += 1) {
    assert.equal(r.passo(true), 'pedir', `pedido ${i}`);
    for (let k = 0; k < 100; k += 1) r.no('notificacao');
    rel.avancar(SILENCIO);
  }
  r.fim();
  assert.equal(r.passo(true), undefined);
  const e = r.estado();
  assert.equal(e.desfecho, 'recolheu');
  assert.equal(e.pedidos, 3);
  assert.deepEqual(e.nosPorPedido, [100, 100, 100]);
  assert.equal(e.recebidos.notificacoes, 300);
});

test('nao pede de novo dentro da pausa do pedido anterior', () => {
  const { r, rel } = comParteAssentada();
  r.passo(true);
  assert.equal(r.passo(true), 'pedir');
  r.no('notificacao');
  rel.avancar(SILENCIO - 1);
  assert.equal(r.passo(true), undefined);
  rel.avancar(1);
  assert.equal(r.passo(true), 'pedir');
});

test('para no teto derivado do anuncio', () => {
  const { r, rel } = comParteAssentada(100);
  assert.equal(tetoDePedidos(100), 20);
  r.passo(true);
  let pedidos = 0;
  for (let i = 0; i < 40; i += 1) {
    const acao = r.passo(true);
    if (acao === 'pedir') {
      pedidos += 1;
      r.no('notificacao');
    }
    rel.avancar(SILENCIO);
  }
  assert.equal(pedidos, 20);
  assert.equal(r.estado().desfecho, 'teto');
});

test('tres pedidos seguidos sem nenhuma resposta: sem-resposta, e nao ha quarto pedido', () => {
  const { r, rel } = comParteAssentada();
  r.passo(true);
  let pedidos = 0;
  for (let i = 0; i < 10; i += 1) {
    if (r.passo(true) === 'pedir') pedidos += 1;
    rel.avancar(SILENCIO);
  }
  assert.equal(pedidos, 3);
  const e = r.estado();
  assert.equal(e.desfecho, 'sem-resposta');
  assert.deepEqual(e.nosPorPedido, [0, 0, 0]);
});

test('pedido que traz no zera a contagem: muitos pedidos com resposta nunca sao sem-resposta', () => {
  const { r, rel } = comParteAssentada();
  r.passo(true);
  let pedidos = 0;
  for (let i = 0; i < 12; i += 1) {
    if (r.passo(true) === 'pedir') {
      pedidos += 1;
      // dois pedidos sem resposta, um com: nunca tres seguidos
      if (pedidos % 3 === 0) r.no('mensagem');
    }
    rel.avancar(SILENCIO);
  }
  assert.ok(pedidos >= 9, `pedidos: ${pedidos}`);
  assert.equal(r.estado().desfecho, 'em-andamento');
});

test('falha de envio: para com falha-de-envio e nao insiste', () => {
  const { r, rel } = comParteAssentada();
  r.passo(true);
  assert.equal(r.passo(true), 'pedir');
  r.envioFalhou();
  rel.avancar(SILENCIO);
  assert.equal(r.passo(true), undefined);
  assert.equal(r.estado().desfecho, 'falha-de-envio');
  rel.avancar(SILENCIO);
  assert.equal(r.passo(true), undefined);
});

test('passou o prazo de recolhimento: prazo', () => {
  const { r, rel } = comParteAssentada(100_000, { prazoMs: 30_000 });
  r.passo(true);
  let pedidos = 0;
  for (let i = 0; i < 20; i += 1) {
    if (r.passo(true) === 'pedir') {
      pedidos += 1;
      r.no('notificacao');
    }
    rel.avancar(SILENCIO);
  }
  assert.equal(r.estado().desfecho, 'prazo');
  assert.ok(pedidos >= 5 && pedidos <= 8, `pedidos: ${pedidos}`);
});

test('o socket fechando no meio: encerrou-antes, e nenhum pedido depois', () => {
  const { r, rel } = comParteAssentada();
  r.passo(true);
  assert.equal(r.passo(true), 'pedir');
  r.fechou();
  rel.avancar(SILENCIO * 3);
  assert.equal(r.passo(true), undefined);
  assert.equal(r.estado().desfecho, 'encerrou-antes');
  assert.equal(r.estado().pedidos, 1);
});

test('o fim declarado e o socket fechando antes do proximo passo: o desfecho respeita o fim', () => {
  const rel = relogio();
  const r = criarRecolhedor({ agora: rel.agora });
  r.anuncio(anunciado(7));
  r.fim();
  r.fechou();
  assert.equal(r.estado().desfecho, 'fim-natural');
  const { r: r2, rel: rel2 } = comParteAssentada();
  r2.passo(true);
  r2.passo(true);
  rel2.avancar(SILENCIO);
  r2.fim();
  r2.fechou();
  assert.equal(r2.estado().desfecho, 'recolheu', 'houve pedidos: recolheu');
  assert.equal(r2.estado().nosPorPedido.length, 1, 'o pedido em voo e contado ao fechar');
});

test('fechar depois de um desfecho nao o altera', () => {
  const rel = relogio();
  const r = criarRecolhedor({ agora: rel.agora });
  r.fim();
  r.passo(true);
  r.fechou();
  assert.equal(r.estado().desfecho, 'fim-natural');
});

test('no ao vivo depois do desfecho nao dispara nada nem muda a conta', () => {
  const rel = relogio();
  const r = criarRecolhedor({ agora: rel.agora });
  r.anuncio(anunciado(5));
  r.fim();
  r.passo(true);
  const v = r.versao();
  r.no('mensagem');
  r.no('chamada');
  rel.avancar(SILENCIO * 4);
  assert.equal(r.passo(true), undefined);
  assert.equal(r.versao(), v, 'o estado final nao mexe');
  assert.equal(r.estado().recebidos.mensagens, 0);
});

test('segundo anuncio nao muda o teto; segundo fim e ignorado', () => {
  const { r, rel } = comParteAssentada(100);
  r.anuncio(anunciado(50_000));
  assert.equal(r.estado().anunciados?.total, 100, 'o primeiro anuncio vale');
  r.passo(true);
  rel.avancar(SILENCIO);
  let pedidos = 0;
  for (let i = 0; i < 60; i += 1) {
    if (r.passo(true) === 'pedir') {
      pedidos += 1;
      r.no('notificacao');
    }
    rel.avancar(SILENCIO);
  }
  assert.equal(pedidos, 20, 'o teto continua o do primeiro anuncio (piso 20)');
  r.fim();
  const fim1 = r.estado().fimDeclaradoEm;
  rel.avancar(1_000);
  r.fim();
  assert.equal(r.estado().fimDeclaradoEm, fim1, 'o segundo fim nao muda o instante');
});

test('fim que chega depois do teto, do prazo ou da falta de resposta corrige o desfecho para recolheu', () => {
  const { r, rel } = comParteAssentada();
  r.passo(true);
  for (let i = 0; i < 10; i += 1) {
    r.passo(true);
    rel.avancar(SILENCIO);
  }
  assert.equal(r.estado().desfecho, 'sem-resposta');
  r.fim();
  assert.equal(r.estado().desfecho, 'recolheu');
  assert.notEqual(r.estado().fimDeclaradoEm, null);
});

test('falhas de decifra: null sem observacao, contagem com ela', () => {
  const rel = relogio();
  const sem = criarRecolhedor({ agora: rel.agora });
  sem.falhaDeDecifra();
  assert.equal(sem.estado().falhasDeDecifra, 1, 'se algo as conta, o numero existe');
  const nunca = criarRecolhedor({ agora: rel.agora });
  assert.equal(nunca.estado().falhasDeDecifra, null, 'nao observado e INDISPONIVEL, nunca zero');
  const com = criarRecolhedor({ agora: rel.agora, contaFalhasDeDecifra: true });
  assert.equal(com.estado().falhasDeDecifra, 0);
  com.falhaDeDecifra();
  com.falhaDeDecifra();
  assert.equal(com.estado().falhasDeDecifra, 2);
});

test('o estado traz os instantes de criacao e de abertura, que costumam vir nessa ordem', () => {
  const rel = relogio(1_000);
  const r = criarRecolhedor({ agora: rel.agora });
  rel.avancar(500);
  r.abriu();
  const e = r.estado();
  assert.equal(e.socketCriadoEm, 1_000);
  assert.equal(e.abertoEm, 1_500);
  assert.equal(e.atualizadoEm, 1_500);
});

test('o estado nunca carrega JID, id de Mensagem nem conteudo: so tipos e numeros', () => {
  const { r } = comParteAssentada();
  r.passo(true);
  const texto = JSON.stringify(r.estado());
  assert.ok(!/@/.test(texto), 'sem JID');
  assert.deepEqual(
    Object.keys(r.estado()).sort(),
    [
      'abertoEm',
      'anunciados',
      'atualizadoEm',
      'desfecho',
      'falhasDeDecifra',
      'fimDeclaradoEm',
      'liberadoEm',
      'nosPorPedido',
      'pedidos',
      'recebidos',
      'socketCriadoEm',
    ].sort(),
  );
});

test('o numero de entradas de nosPorPedido e limitado', () => {
  const { r, rel } = comParteAssentada(1_000_000, { prazoMs: 10 ** 12 });
  r.passo(true);
  for (let i = 0; i < 300; i += 1) {
    if (r.passo(true) === 'pedir') r.no('notificacao');
    rel.avancar(SILENCIO);
  }
  assert.ok(r.estado().nosPorPedido.length <= 200);
});
