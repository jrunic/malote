// tests/estado-dos-pendentes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EstadoDosPendentes } from '../src/adaptadores/whatsapp/pendentes.js';
import {
  criarGravadorDosPendentes,
  falhasDoEstadoDosPendentes,
  gravarEstadoDosPendentes,
  lerEstadoDosPendentes,
  linhaDeResumo,
  linhaDoAnuncio,
} from '../src/cli/estado-dos-pendentes.js';

const T0 = Date.parse('2026-10-23T20:00:00Z');

function estado(extra: Partial<EstadoDosPendentes> = {}): EstadoDosPendentes {
  return {
    socketCriadoEm: T0,
    abertoEm: T0 + 500,
    atualizadoEm: T0 + 180_000,
    anunciados: {
      total: 3_583,
      mensagens: 302,
      recibos: 197,
      notificacoes: 3_048,
      status: 32,
      chamadas: 3,
      outros: 0,
    },
    recebidos: { mensagens: 336, notificacoes: 3_057, recibos: 201, chamadas: 0 },
    falhasDeDecifra: 9,
    pedidos: 35,
    nosPorPedido: [100, 98, 100],
    liberadoEm: T0 + 7_000,
    fimDeclaradoEm: T0 + 170_000,
    desfecho: 'recolheu',
    ...extra,
  };
}

function comPasta<T>(f: (pasta: string) => T): T {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-pendentes-'));
  try {
    return f(pasta);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

test('grava e le de volta, igual', () =>
  comPasta((pasta) => {
    const caminho = join(pasta, 'pendentes.json');
    gravarEstadoDosPendentes(caminho, estado());
    assert.deepEqual(lerEstadoDosPendentes(caminho), estado());
  }));

test('aceita anunciados e falhas nulos (Conexao sem anuncio, biblioteca sem logger)', () =>
  comPasta((pasta) => {
    const caminho = join(pasta, 'pendentes.json');
    const e = estado({
      anunciados: null,
      falhasDeDecifra: null,
      abertoEm: null,
      liberadoEm: null,
      fimDeclaradoEm: null,
      desfecho: 'em-andamento',
    });
    gravarEstadoDosPendentes(caminho, e);
    assert.deepEqual(lerEstadoDosPendentes(caminho), e);
  }));

test('arquivo ausente ou ilegivel le como null (indisponivel), nunca como estado vazio', () =>
  comPasta((pasta) => {
    assert.equal(lerEstadoDosPendentes(join(pasta, 'nao-existe.json')), null);
    const ruim = join(pasta, 'ruim.json');
    writeFileSync(ruim, '{ isto nao e json');
    assert.equal(lerEstadoDosPendentes(ruim), null);
    writeFileSync(ruim, '[]');
    assert.equal(lerEstadoDosPendentes(ruim), null);
    writeFileSync(ruim, 'null');
    assert.equal(lerEstadoDosPendentes(ruim), null);
  }));

test('forma fora do contrato le como null: desfecho invalido, campo ausente ou de tipo errado', () =>
  comPasta((pasta) => {
    const caminho = join(pasta, 'p.json');
    const casos: Record<string, unknown>[] = [
      { ...estado(), desfecho: 'inventado' },
      { ...estado(), pedidos: '35' },
      { ...estado(), recebidos: null },
      { ...estado(), recebidos: { mensagens: 1 } },
      { ...estado(), anunciados: { total: 1 } },
      { ...estado(), anunciados: 'muito' },
      { ...estado(), nosPorPedido: [1, 'dois'] },
      { ...estado(), nosPorPedido: 7 },
      { ...estado(), socketCriadoEm: null },
      { ...estado(), falhasDeDecifra: 'nove' },
      { ...estado(), fimDeclaradoEm: 'ontem' },
    ];
    for (const [i, caso] of casos.entries()) {
      writeFileSync(caminho, JSON.stringify(caso));
      assert.equal(lerEstadoDosPendentes(caminho), null, `caso ${i}`);
    }
  }));

test('a escrita e atomica e nao deixa temporario para tras', () =>
  comPasta((pasta) => {
    gravarEstadoDosPendentes(join(pasta, 'pendentes.json'), estado());
    assert.deepEqual(readdirSync(pasta), ['pendentes.json']);
  }));

function gravador(pasta: string, relogio: { t: number }, avisos: string[], intervaloMs = 5_000) {
  return criarGravadorDosPendentes({
    caminho: join(pasta, 'pendentes.json'),
    agora: () => relogio.t,
    avisar: (t) => avisos.push(t),
    intervaloMs,
  });
}

test('o primeiro evento grava de imediato; os seguintes dentro da janela nao regravam', () =>
  comPasta((pasta) => {
    const relogio = { t: T0 };
    const gravar = gravador(pasta, relogio, []);
    gravar(estado({ pedidos: 1 }), false);
    assert.equal(lerEstadoDosPendentes(join(pasta, 'pendentes.json'))?.pedidos, 1);
    relogio.t += 4_999;
    gravar(estado({ pedidos: 2 }), false);
    assert.equal(
      lerEstadoDosPendentes(join(pasta, 'pendentes.json'))?.pedidos,
      1,
      'dentro da janela',
    );
    relogio.t += 1;
    gravar(estado({ pedidos: 3 }), false);
    assert.equal(
      lerEstadoDosPendentes(join(pasta, 'pendentes.json'))?.pedidos,
      3,
      'na janela seguinte grava',
    );
  }));

test('o evento final grava SEMPRE, mesmo dentro da janela: e o que fica depois da Conexao', () =>
  comPasta((pasta) => {
    const relogio = { t: T0 };
    const gravar = gravador(pasta, relogio, []);
    gravar(estado({ desfecho: 'em-andamento', pedidos: 1 }), false);
    relogio.t += 10;
    gravar(estado({ desfecho: 'recolheu', pedidos: 9 }), true);
    const lido = lerEstadoDosPendentes(join(pasta, 'pendentes.json'));
    assert.equal(lido?.desfecho, 'recolheu');
    assert.equal(lido?.pedidos, 9);
  }));

test('relogio que volta para tras nao congela o estado', () =>
  comPasta((pasta) => {
    const relogio = { t: T0 + 100_000 };
    const gravar = gravador(pasta, relogio, []);
    gravar(estado({ pedidos: 1 }), false);
    relogio.t = T0;
    gravar(estado({ pedidos: 2 }), false);
    assert.equal(lerEstadoDosPendentes(join(pasta, 'pendentes.json'))?.pedidos, 2);
  }));

test('pasta ausente: avisa UMA vez, nao lanca, nao cria a pasta e conta a falha', () =>
  comPasta((pasta) => {
    const relogio = { t: T0 };
    const avisos: string[] = [];
    const gravar = criarGravadorDosPendentes({
      caminho: join(pasta, 'nao-existe', 'pendentes.json'),
      agora: () => relogio.t,
      avisar: (t) => avisos.push(t),
    });
    const antes = falhasDoEstadoDosPendentes();
    gravar(estado(), true);
    relogio.t += 10_000;
    gravar(estado(), true);
    assert.equal(avisos.length, 1, 'um unico aviso');
    assert.match(avisos[0]!, /ENOENT/);
    assert.ok(!avisos[0]!.includes(pasta), 'o aviso nao carrega caminho');
    assert.equal(falhasDoEstadoDosPendentes() - antes, 2);
    assert.equal(existsSync(join(pasta, 'nao-existe')), false);
  }));

test('a linha do anuncio traz so tipos e numeros', () => {
  assert.equal(
    linhaDoAnuncio(estado()),
    '[ouvinte] pendentes anunciados: 3583 (mensagens 302, recibos 197, notificacoes 3048, status 32, chamadas 3, outros 0)',
  );
  assert.equal(
    linhaDoAnuncio(estado({ anunciados: null })),
    '[ouvinte] pendentes anunciados: sem anuncio',
  );
});

test('a linha de resumo traz desfecho, a Conexao, anunciados, recebidos, falhas, pedidos e nos por pedido', () => {
  assert.equal(
    linhaDeResumo(estado()),
    `[ouvinte] pendentes: desfecho=recolheu conexao=${T0} anunciados=3583 ` +
      'recebidos=mensagens 336/notificacoes 3057/recibos 201/chamadas 0 ' +
      'falhasDeDecifra=9 pedidos=35 nosPorPedido=100,98,100 duracao=180s',
  );
});

test('o resumo limita a lista de nos por pedido e diz indisponivel, nao zero', () => {
  const muitos = Array.from({ length: 35 }, (_, i) => 100 + i);
  const linha = linhaDeResumo(
    estado({ nosPorPedido: muitos, falhasDeDecifra: null, anunciados: null, pedidos: 0 }),
  );
  assert.match(linha, /nosPorPedido=100,101,102,103,104,105,106,107,108,109,\+25 /);
  assert.match(linha, /falhasDeDecifra=indisponivel/);
  assert.match(linha, /anunciados=sem-anuncio/);
  assert.match(linhaDeResumo(estado({ nosPorPedido: [] })), /nosPorPedido=- /);
});

test('nenhum JID nem id de Mensagem chega ao arquivo ou as linhas, mesmo que o estado recebido os tenha por engano', () =>
  comPasta((pasta) => {
    // O estado so tem campos numericos e tipados; este teste fixa que as linhas e o arquivo so serializam esses campos.
    const sujo = {
      ...estado(),
      jid: '5599900000000@s.whatsapp.net',
      idDeMensagem: 'ID-SINTETICO-123',
    } as unknown as EstadoDosPendentes;
    const linhas = `${linhaDoAnuncio(sujo)}\n${linhaDeResumo(sujo)}`;
    assert.ok(!linhas.includes('5599900000000'));
    assert.ok(!linhas.includes('ID-SINTETICO-123'));
    mkdirSync(pasta, { recursive: true });
    const caminho = join(pasta, 'p.json');
    gravarEstadoDosPendentes(caminho, estado());
    assert.ok(!readFileSync(caminho, 'utf8').includes('@'));
  }));

test('o leitor devolve SO os campos do contrato: chave extra no arquivo nao passa', () =>
  comPasta((pasta) => {
    const caminho = join(pasta, 'p.json');
    writeFileSync(
      caminho,
      JSON.stringify({
        ...estado(),
        jid: '5599900000000@s.whatsapp.net',
        texto: 'conteudo plantado',
        recebidos: { ...estado().recebidos, extra: 9 },
      }),
    );
    const lido = lerEstadoDosPendentes(caminho);
    assert.deepEqual(lido, estado(), 'igual ao estado sem as chaves estranhas');
    assert.ok(!JSON.stringify(lido).includes('5599900000000'));
    assert.ok(!JSON.stringify(lido).includes('plantado'));
  }));

test('o leitor recusa numero negativo ou fracionario onde o contrato pede inteiro', () =>
  comPasta((pasta) => {
    const caminho = join(pasta, 'p.json');
    const casos: Record<string, unknown>[] = [
      { ...estado(), pedidos: -1 },
      { ...estado(), pedidos: 1.5 },
      { ...estado(), recebidos: { ...estado().recebidos, mensagens: -3 } },
      { ...estado(), nosPorPedido: [100, -1] },
      { ...estado(), nosPorPedido: [100.5] },
      { ...estado(), socketCriadoEm: -1 },
      { ...estado(), falhasDeDecifra: -2 },
      { ...estado(), anunciados: { ...estado().anunciados, total: 1.5 } },
    ];
    for (const [i, caso] of casos.entries()) {
      writeFileSync(caminho, JSON.stringify(caso));
      assert.equal(lerEstadoDosPendentes(caminho), null, `caso ${i}`);
    }
  }));
