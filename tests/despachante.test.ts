import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { semearIdentidade } from './ajuda/identidade.js';
import { DespachanteDeLeituras, type ResultadoDoDespacho } from '../src/rede/despachante.js';
import type { InstrucaoDeTeste, PedidoDeLeitura } from '../src/rede/contrato-da-leitura.js';

/** Duas instalacoes (A e B) com Acervo de verdade: os workers rodam a rota de verdade. */
function cena() {
  const c = cenario();
  const a = c.novoInquilino('A');
  semearIdentidade(a.acervo);
  a.acervo.fechar();
  const b = c.novoInquilino('B');
  semearIdentidade(b.acervo);
  b.acervo.fechar();
  const pedido = (inq: 'A' | 'B', instrucao?: InstrucaoDeTeste): PedidoDeLeitura => ({
    metodo: 'GET',
    url: '/relatorio',
    chaveId: `chave-${inq}`,
    inquilinoId: inq === 'A' ? a.id : b.id,
    dados: c.raiz,
    ...(instrucao ? { instrucao } : {}),
  });
  return { c, pedido };
}

const nunca = new AbortController().signal;
const tipo = (r: ResultadoDoDespacho): string => r.tipo;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

function despachante(opcoes: Partial<ConstructorParameters<typeof DespachanteDeLeituras>[0]> = {}) {
  const linhas: string[] = [];
  const d = new DespachanteDeLeituras({
    trabalhadores: 4,
    prazoMs: 20_000,
    filaMaxima: 64,
    aoLogar: (l) => linhas.push(l),
    ...opcoes,
  });
  return { d, linhas };
}

test('executar devolve a resposta da rota, e o worker e reusado (#1132)', async () => {
  const { c, pedido } = cena();
  const { d } = despachante();
  try {
    const r1 = await d.executar(pedido('A'), nunca);
    assert.equal(r1.tipo, 'resposta');
    if (r1.tipo === 'resposta') assert.equal(r1.resposta.status, 200);
    await d.executar(pedido('A'), nunca);
    assert.equal(d.vivos, 1, 'duas leituras em sequencia usam o mesmo worker');
  } finally {
    await d.parar(0);
    c.limpar();
  }
});

test('PRAZO: estourou, o worker morre, a resposta e prazo, e o proximo pedido e atendido por um worker novo (#1132)', async () => {
  const { c, pedido } = cena();
  const { d, linhas } = despachante({ prazoMs: 400 });
  try {
    const t0 = Date.now();
    const r = await d.executar(pedido('A', { dormirMs: 5000 }), nunca);
    assert.equal(r.tipo, 'prazo');
    assert.ok(Date.now() - t0 < 1500, `respondeu no prazo, nao ao fim da consulta (${Date.now() - t0} ms)`);
    assert.equal(d.vivos, 0, 'o worker preso foi morto');
    const t1 = Date.now();
    const depois = await d.executar(pedido('A'), nunca);
    assert.equal(depois.tipo, 'resposta');
    assert.ok(Date.now() - t1 < 1500);
    assert.equal(d.vivos, 1, 'um worker novo assumiu');
    assert.ok(linhas.some((l) => /prazo estourado: GET \/relatorio/.test(l)), linhas.join('|'));
  } finally {
    await d.parar(0);
    c.limpar();
  }
});

test('ABANDONO em execucao: o cliente desiste, o worker morre, e com UM worker o proximo pedido nao espera (#1132)', async () => {
  const { c, pedido } = cena();
  const { d } = despachante({ trabalhadores: 1 });
  try {
    const abandono = new AbortController();
    const lenta = d.executar(pedido('A', { dormirMs: 5000 }), abandono.signal);
    await esperar(150);
    abandono.abort();
    assert.equal(tipo(await lenta), 'abandonado');
    const t0 = Date.now();
    const r = await d.executar(pedido('A'), nunca);
    assert.equal(r.tipo, 'resposta');
    assert.ok(Date.now() - t0 < 1000, `nao esperou os 5 s da abandonada (${Date.now() - t0} ms)`);
  } finally {
    await d.parar(0);
    c.limpar();
  }
});

test('ABANDONO na fila: sai da fila na hora (#1132)', async () => {
  const { c, pedido } = cena();
  const { d } = despachante({ trabalhadores: 1 });
  try {
    const ocupa = d.executar(pedido('A', { dormirMs: 600 }), nunca);
    await esperar(100);
    const abandono = new AbortController();
    const naFila = d.executar(pedido('A'), abandono.signal);
    await esperar(50);
    assert.equal(d.naFila, 1);
    abandono.abort();
    assert.equal(tipo(await naFila), 'abandonado');
    assert.equal(d.naFila, 0);
    await ocupa;
  } finally {
    await d.parar(0);
    c.limpar();
  }
});

test('FILA CHEIA: acima do teto, fila-cheia, sem rodar (#1132)', async () => {
  const { c, pedido } = cena();
  const { d } = despachante({ trabalhadores: 1, filaMaxima: 1 });
  try {
    const primeira = d.executar(pedido('A', { dormirMs: 700 }), nunca);
    await esperar(100);
    const segunda = d.executar(pedido('A'), nunca);
    const terceira = await d.executar(pedido('A'), nunca);
    assert.equal(terceira.tipo, 'fila-cheia');
    assert.equal(tipo(await primeira), 'resposta');
    assert.equal(tipo(await segunda), 'resposta');
  } finally {
    await d.parar(0);
    c.limpar();
  }
});

test('FILA POR INQUILINO: A nao enche a fila toda, e B ainda entra (#1132)', async () => {
  const { c, pedido } = cena();
  const { d } = despachante({ trabalhadores: 1, filaMaxima: 4 }); // teto por Inquilino: metade, 2
  try {
    const ocupa = d.executar(pedido('A', { dormirMs: 900 }), nunca);
    await esperar(100);
    const a1 = d.executar(pedido('A'), nunca);
    const a2 = d.executar(pedido('A'), nunca);
    const a3 = await d.executar(pedido('A'), nunca);
    assert.equal(a3.tipo, 'fila-cheia', 'a terceira de A na fila passa do teto do Inquilino');
    const b = d.executar(pedido('B'), nunca);
    assert.equal(d.naFila, 3, 'B entrou, ha lugar na fila');
    assert.equal(tipo(await b), 'resposta');
    await Promise.all([ocupa, a1, a2]);
  } finally {
    await d.parar(0);
    c.limpar();
  }
});

test('FILA CHEIA GLOBAL: o teto da fila vale mesmo abaixo do teto do Inquilino (#1132)', async () => {
  const { c, pedido } = cena();
  const { d } = despachante({ trabalhadores: 1, filaMaxima: 2, filaPorInquilino: 10 });
  try {
    const ocupa = d.executar(pedido('A', { dormirMs: 700 }), nunca);
    await esperar(100);
    const a1 = d.executar(pedido('A'), nunca);
    const a2 = d.executar(pedido('A'), nunca);
    const a3 = await d.executar(pedido('A'), nunca);
    assert.equal(a3.tipo, 'fila-cheia', 'tres na fila passam do teto de 2, embora o Inquilino pudesse ter 10');
    await Promise.all([ocupa, a1, a2]);
  } finally {
    await d.parar(0);
    c.limpar();
  }
});

test('AQUECER: com o arquivo do worker valido fica pronto e o worker e reusado; com arquivo invalido devolve false (#1132)', async () => {
  const { c, pedido } = cena();
  const bom = despachante();
  const ruim = despachante({ arquivoDoTrabalhador: new URL('file:///nao/existe/trabalhador.ts') });
  try {
    assert.equal(await bom.d.aquecer(5000), true);
    assert.equal(bom.d.vivos, 1);
    assert.equal(tipo(await bom.d.executar(pedido('A'), nunca)), 'resposta');
    assert.equal(bom.d.vivos, 1, 'o worker aquecido foi o que atendeu');
    assert.equal(await ruim.d.aquecer(5000), false);
    assert.equal(ruim.d.vivos, 0);
  } finally {
    await bom.d.parar(0);
    await ruim.d.parar(0);
    c.limpar();
  }
});

test('RESERVA: um Inquilino ocupa no maximo N-1, e o outro e atendido no worker livre (#1132)', async () => {
  const { c, pedido } = cena();
  const { d } = despachante({ trabalhadores: 4 });
  try {
    const lentas = [0, 1, 2, 3].map(() => d.executar(pedido('A', { dormirMs: 1500 }), nunca));
    await esperar(300);
    assert.equal(d.ocupados, 3, 'A ocupa 3 de 4');
    assert.equal(d.naFila, 1, 'a quarta de A espera');
    const t0 = Date.now();
    const b = await d.executar(pedido('B'), nunca);
    assert.equal(b.tipo, 'resposta');
    assert.ok(Date.now() - t0 < 800, `B nao esperou A (${Date.now() - t0} ms)`);
    await Promise.all(lentas);
  } finally {
    await d.parar(0);
    c.limpar();
  }
});

test('JUSTICA: quando um worker libera, vai para quem MENOS workers ocupa, nao para o pedido mais antigo (#1132)', async () => {
  const { c, pedido } = cena();
  const { d } = despachante({ trabalhadores: 4 });
  try {
    const inicio = Date.now();
    const fim: Record<string, number> = {};
    const marcar = (nome: string, p: Promise<ResultadoDoDespacho>) => p.then((r) => {
      fim[nome] = Date.now() - inicio;
      return r;
    });
    const todas = [
      marcar('A1', d.executar(pedido('A', { dormirMs: 600 }), nunca)),
      marcar('A2', d.executar(pedido('A', { dormirMs: 2500 }), nunca)),
      marcar('A3', d.executar(pedido('A', { dormirMs: 2500 }), nunca)),
      marcar('B1', d.executar(pedido('B', { dormirMs: 2500 }), nunca)),
    ];
    await esperar(200);
    todas.push(marcar('A4', d.executar(pedido('A', { dormirMs: 200 }), nunca))); // mais antiga na fila
    await esperar(50);
    todas.push(marcar('B2', d.executar(pedido('B', { dormirMs: 200 }), nunca))); // mais nova, de quem ocupa menos
    await Promise.all(todas);
    assert.ok(fim['B2']! < fim['A4']!, `B2 (${fim['B2']} ms) deveria vir antes de A4 (${fim['A4']} ms): A ocupa 2, B ocupa 1`);
  } finally {
    await d.parar(0);
    c.limpar();
  }
});

test('ERRO da rota: tipo erro, e o worker segue vivo (#1132)', async () => {
  const { c, pedido } = cena();
  const { d } = despachante();
  try {
    await d.executar(pedido('A'), nunca);
    const r = await d.executar(pedido('A', { lancar: 'boom da rota' }), nunca);
    assert.equal(r.tipo, 'erro');
    if (r.tipo === 'erro') assert.match(r.mensagem, /boom da rota/);
    assert.equal(d.vivos, 1, 'a excecao da rota nao mata o worker');
    assert.equal(tipo(await d.executar(pedido('A'), nunca)), 'resposta');
    const tarde = await d.executar(pedido('A', { lancarDepoisDoCabecalho: 'tarde' }), nunca);
    assert.equal(tarde.tipo, 'erro', 'cabecalho escrito e depois excecao: nunca uma resposta pela metade');
  } finally {
    await d.parar(0);
    c.limpar();
  }
});

test('o worker que MORRE no meio da leitura vira erro e e substituido (#1132)', async () => {
  const { c, pedido } = cena();
  const { d } = despachante();
  try {
    const r = await d.executar(pedido('A', { sair: true }), nunca);
    assert.equal(r.tipo, 'erro');
    assert.equal(d.vivos, 0);
    assert.equal(tipo(await d.executar(pedido('A'), nunca)), 'resposta');
    assert.equal(d.vivos, 1);
  } finally {
    await d.parar(0);
    c.limpar();
  }
});

test('worker que nao sobe: tenta duas vezes e devolve indisponivel, sem laco (#1132)', async () => {
  const { c, pedido } = cena();
  const { d } = despachante({ arquivoDoTrabalhador: new URL('file:///nao/existe/trabalhador.ts') });
  try {
    const t0 = Date.now();
    const r = await d.executar(pedido('A'), nunca);
    assert.equal(r.tipo, 'indisponivel');
    assert.ok(Date.now() - t0 < 5000);
    assert.equal(d.vivos, 0);
  } finally {
    await d.parar(0);
    c.limpar();
  }
});

test('PARAR: termina o que esta rodando, resolve a fila como indisponivel e recusa o resto (#1132)', async () => {
  const { c, pedido } = cena();
  const { d } = despachante({ trabalhadores: 1 });
  try {
    const rodando = d.executar(pedido('A', { dormirMs: 8000 }), nunca);
    await esperar(100);
    const naFila = d.executar(pedido('A'), nunca);
    const t0 = Date.now();
    await d.parar(400);
    assert.ok(Date.now() - t0 < 2000, `parou em ${Date.now() - t0} ms, nao esperou os 8 s`);
    assert.equal(tipo(await naFila), 'indisponivel');
    assert.equal(tipo(await rodando), 'indisponivel');
    assert.equal(tipo(await d.executar(pedido('A'), nunca)), 'indisponivel');
    assert.equal(d.vivos, 0);
  } finally {
    c.limpar();
  }
});

test('leitura lenta escreve uma linha com o caminho e SEM a query (#1132)', async () => {
  const { c, pedido } = cena();
  const { d, linhas } = despachante({ limiarDeLogMs: 100 });
  try {
    await d.executar({ ...pedido('A', { dormirMs: 250 }), url: '/relatorio?segredo=texto-de-conversa' }, nunca);
    const lenta = linhas.find((l) => /lenta/.test(l));
    assert.ok(lenta, linhas.join('|'));
    assert.match(lenta, /GET \/relatorio/);
    assert.doesNotMatch(lenta, /segredo|texto-de-conversa/);
  } finally {
    await d.parar(0);
    c.limpar();
  }
});
