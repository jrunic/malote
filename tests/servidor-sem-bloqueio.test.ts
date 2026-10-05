import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { semearIdentidade } from './ajuda/identidade.js';
import { emitirChaveDeAcesso } from '../src/registro/chave-de-acesso.js';

const ENTRADA = join(import.meta.dirname, 'ajuda', 'servidor-de-teste-lento.ts');

interface Cena {
  porta: number;
  chaveA: string;
  chaveB: string;
  filho: ChildProcess;
  pedir: (caminho: string, chave?: string, sinal?: AbortSignal) => Promise<{ status: number; corpo: string; ms: number; cabecalhos: Headers }>;
  parar: () => Promise<number | null>;
  limpar: () => void;
}

/** O SERVIDOR roda em processo filho, e o relogio do teste e o do processo de fora. */
async function subir(args: { trabalhadores?: number; prazoMs?: number; filaMaxima?: number } = {}): Promise<Cena> {
  const c = cenario();
  const a = c.novoInquilino('A');
  semearIdentidade(a.acervo);
  a.acervo.fechar();
  const b = c.novoInquilino('B');
  semearIdentidade(b.acervo);
  b.acervo.fechar();
  const chaveA = emitirChaveDeAcesso(c.registro, a.id).valor;
  const chaveB = emitirChaveDeAcesso(c.registro, b.id).valor;

  const filho = spawn(
    process.execPath,
    ['--import', 'tsx', ENTRADA, c.raiz, String(args.trabalhadores ?? ''), String(args.prazoMs ?? ''), String(args.filaMaxima ?? '')],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const porta = await new Promise<number>((resolver, rejeitar) => {
    let saida = '';
    filho.stdout!.on('data', (d) => {
      saida += d;
      const m = /PORTA (\d+)/.exec(saida);
      if (m) resolver(Number(m[1]));
    });
    filho.once('exit', (codigo) => rejeitar(new Error(`o servidor de teste saiu (${codigo}) antes de subir`)));
  });
  const saida = new Promise<number | null>((r) => filho.once('exit', (codigo) => r(codigo)));
  return {
    porta,
    chaveA,
    chaveB,
    filho,
    pedir: async (caminho, chave, sinal) => {
      const t0 = Date.now();
      const r = await fetch(`http://127.0.0.1:${porta}${caminho}`, {
        headers: chave ? { authorization: `Bearer ${chave}` } : {},
        ...(sinal ? { signal: sinal } : {}),
      });
      return { status: r.status, corpo: await r.text(), ms: Date.now() - t0, cabecalhos: r.headers };
    },
    parar: async () => {
      filho.kill('SIGTERM');
      return saida;
    },
    limpar: c.limpar,
  };
}

test('ISOLAMENTO: com uma leitura de 3 s em andamento, outra leitura responde em menos de 1 s (#1132)', async () => {
  const cena = await subir();
  try {
    const inicio = Date.now();
    const lenta = cena.pedir('/relatorio?__dormir=3000', cena.chaveA);
    await new Promise((r) => setTimeout(r, 300));
    const rapida = await cena.pedir('/relatorio', cena.chaveA);
    assert.equal(rapida.status, 200);
    assert.ok(rapida.ms < 1000, `a leitura rapida esperou ${rapida.ms} ms`);
    assert.ok(Date.now() - inicio < 2500, 'a rapida terminou bem antes da lenta');
    const fimDaLenta = await lenta;
    assert.equal(fimDaLenta.status, 200);
    assert.ok(Date.now() - inicio >= 2900, 'a lenta de fato levou os 3 s');
  } finally {
    await cena.parar();
    cena.limpar();
  }
});

test('PRAZO: leitura que passa do prazo responde 504 de corpo vazio, e o servidor segue (#1132)', async () => {
  const cena = await subir({ prazoMs: 1000 });
  try {
    const r = await cena.pedir('/relatorio?__dormir=10000', cena.chaveA);
    assert.equal(r.status, 504);
    assert.equal(r.corpo, '');
    assert.ok(r.ms >= 900 && r.ms < 2500, `504 em ${r.ms} ms`);
    const depois = await cena.pedir('/relatorio', cena.chaveA);
    assert.equal(depois.status, 200);
    assert.ok(depois.ms < 1500);
  } finally {
    await cena.parar();
    cena.limpar();
  }
});

test('ABANDONO: com UM worker, a leitura lenta que o cliente abandona nao segura a seguinte (#1132)', async () => {
  const cena = await subir({ trabalhadores: 1, prazoMs: 30_000 });
  try {
    const sinal = new AbortController();
    const lenta = cena.pedir('/relatorio?__dormir=15000', cena.chaveA, sinal.signal).catch(() => 'abortada');
    await new Promise((r) => setTimeout(r, 400));
    sinal.abort();
    assert.equal(await lenta, 'abortada');
    await new Promise((r) => setTimeout(r, 200));
    const seguinte = await cena.pedir('/relatorio', cena.chaveA);
    assert.equal(seguinte.status, 200);
    assert.ok(seguinte.ms < 1000, `a seguinte esperou ${seguinte.ms} ms: o worker da abandonada nao foi morto`);
  } finally {
    await cena.parar();
    cena.limpar();
  }
});

test('EQUIDADE: A com 4 leituras lentas ocupa 3 workers, e B e atendido no livre (#1132)', async () => {
  const cena = await subir({ trabalhadores: 4 });
  try {
    const inicio = Date.now();
    const lentas = [0, 1, 2, 3].map(() => cena.pedir('/relatorio?__dormir=2000', cena.chaveA).then((r) => ({ ...r, fim: Date.now() - inicio })));
    await new Promise((r) => setTimeout(r, 400));
    const b = await cena.pedir('/relatorio', cena.chaveB);
    assert.equal(b.status, 200);
    assert.ok(b.ms < 1000, `B esperou ${b.ms} ms`);
    const fins = (await Promise.all(lentas)).map((r) => r.fim).sort((x, y) => x - y);
    assert.ok(fins[3]! >= 3800, `a quarta de A so comecou quando uma das tres terminou (${fins.join(', ')} ms)`);
  } finally {
    await cena.parar();
    cena.limpar();
  }
});

test('FILA CHEIA: acima do teto, 503 de corpo vazio com retry-after 1 (#1132)', async () => {
  const cena = await subir({ trabalhadores: 1, filaMaxima: 1, prazoMs: 30_000 });
  try {
    const rodando = cena.pedir('/relatorio?__dormir=1500', cena.chaveA);
    await new Promise((r) => setTimeout(r, 300));
    const naFila = cena.pedir('/relatorio', cena.chaveA);
    await new Promise((r) => setTimeout(r, 100));
    const cheia = await cena.pedir('/relatorio', cena.chaveA);
    assert.equal(cheia.status, 503);
    assert.equal(cheia.corpo, '');
    assert.equal(cheia.cabecalhos.get('retry-after'), '1');
    assert.equal((await rodando).status, 200);
    assert.equal((await naFila).status, 200);
  } finally {
    await cena.parar();
    cena.limpar();
  }
});

test('CONTENCAO: excecao, excecao depois do cabecalho e worker que morre viram 500 de corpo vazio, e o servidor segue (#1132)', async () => {
  const cena = await subir();
  try {
    for (const instrucao of ['__lancar=boom', '__lancardepois=tarde', '__sair=1']) {
      const r = await cena.pedir(`/relatorio?${instrucao}`, cena.chaveA);
      assert.equal(r.status, 500, instrucao);
      assert.equal(r.corpo, '', `${instrucao}: o corpo nao diz nada do que aconteceu por dentro`);
      assert.equal((await cena.pedir('/relatorio', cena.chaveA)).status, 200, `${instrucao}: o proximo pedido e atendido`);
    }
  } finally {
    await cena.parar();
    cena.limpar();
  }
});

test('CREDENCIAL: pedido sem Chave valida e 401 na hora e nao ocupa worker (#1132)', async () => {
  const cena = await subir({ trabalhadores: 1, prazoMs: 30_000 });
  try {
    const lenta = cena.pedir('/relatorio?__dormir=2000', cena.chaveA);
    await new Promise((r) => setTimeout(r, 300));
    const sem = await cena.pedir('/relatorio');
    const errada = await cena.pedir('/relatorio', 'chave-que-nao-existe');
    assert.equal(sem.status, 401);
    assert.equal(errada.status, 401);
    assert.ok(sem.ms < 800 && errada.ms < 800, `401 em ${sem.ms} e ${errada.ms} ms, sem esperar o unico worker`);
    await lenta;
  } finally {
    await cena.parar();
    cena.limpar();
  }
});

test('PARADA: SIGTERM com uma leitura lenta em andamento sai 0 em ate 6 s (#1132)', async () => {
  const cena = await subir({ prazoMs: 30_000 });
  try {
    void cena.pedir('/relatorio?__dormir=20000', cena.chaveA).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 400));
    const t0 = Date.now();
    const codigo = await cena.parar();
    assert.equal(codigo, 0);
    assert.ok(Date.now() - t0 < 6000, `parou em ${Date.now() - t0} ms`);
  } finally {
    cena.limpar();
  }
});
