import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cenarioDeRede, type CenarioDeRede } from './ajuda/rede.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { registrarAnexo, registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { gravarArquivoDeAnexo } from '../src/nucleo/arquivo-de-anexo.js';
import { listarAnexosPresentes } from '../src/nucleo/anexos-presentes.js';
import { configurarDestinoDeMidia } from '../src/registro/destino-midia.js';
import { PADROES_DO_DESTINO_REMOTO, configurarDestinoRemotoDeMidia } from '../src/registro/destino-remoto.js';
import type { PedidoDeBusca, ResultadoDaBusca } from '../src/nucleo/midia-remota.js';

const BYTES = Buffer.from('conteudo de um anexo que ja saiu do disco');

/** Um Anexo `presente` com arquivo no Destino local; `apagarArquivo` o tira do disco (a copia local saiu). */
function anexoDe(c: CenarioDeRede, inquilino: string, opcoes: { tipo?: string; remoto?: boolean; apagarArquivo?: boolean }) {
  const destino = mkdtempSync(join(tmpdir(), 'malote-midia-remota-'));
  configurarDestinoDeMidia(c.registro, inquilino, { natureza: 'local', endereco: destino });
  if (opcoes.remoto === true) {
    configurarDestinoRemotoDeMidia(c.registro, inquilino, { remoto: 'remoto_de_teste', ...PADROES_DO_DESTINO_REMOTO });
  }
  const acervo = abrirAcervo(join(c.raiz, 'acervos'), inquilino);
  try {
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: `${inquilino}-conv@s.whatsapp.net`, coletiva: false,
      configuracao: { id: 'cfg-1', fonte: 'whatsapp' },
    });
    const mensagemId = registrarMensagem(acervo, {
      origemDaChegada: 'importacao', direcao: 'recebida', conversaId, fonte: 'whatsapp', idExterno: `m-${inquilino}`,
      ocorridaEm: Date.parse('2026-09-01T12:00:00Z'), agora: Date.now(),
    });
    const anexoId = registrarAnexo(acervo, { origemDaChegada: 'importacao', mensagemId, tipo: opcoes.tipo ?? 'image', presenca: 'nunca-obtido' });
    gravarArquivoDeAnexo(acervo, { origemDaChegada: 'importacao', anexoId, destino, bytes: BYTES });
    if (opcoes.apagarArquivo === true) {
      const a = listarAnexosPresentes(acervo, { limite: 10 }).find((x) => x.id === anexoId);
      rmSync(join(destino, a?.caminho as string));
    }
    return anexoId;
  } finally {
    acervo.fechar();
  }
}

function buscadorQue(resultado: ResultadoDaBusca, pedidos: PedidoDeBusca[] = []) {
  return (p: PedidoDeBusca): Promise<ResultadoDaBusca> => {
    pedidos.push(p);
    return Promise.resolve(resultado);
  };
}

test('arquivo local presente: entrega local e o Servico nem e consultado', async () => {
  const pedidos: PedidoDeBusca[] = [];
  const c = await cenarioDeRede({ buscarMidiaRemota: buscadorQue({ tipo: 'sem-localizacao' }, pedidos) });
  try {
    const chave = c.emitir(c.inquilinoA);
    const id = anexoDe(c, c.inquilinoA, { remoto: true });
    const r = await c.pedirBinario(`/midia/${id}`, chave.valor);
    assert.equal(r.status, 200);
    assert.deepEqual(r.bytes, BYTES);
    assert.equal(pedidos.length, 0);
  } finally {
    await c.parar();
  }
});

test('copia local ausente com Destino Remoto: o Servico entrega, com o Inquilino da CHAVE e o content-type do tipo', async () => {
  const pedidos: PedidoDeBusca[] = [];
  const c = await cenarioDeRede({ buscarMidiaRemota: buscadorQue({ tipo: 'bytes', bytes: BYTES }, pedidos) });
  try {
    const chave = c.emitir(c.inquilinoA);
    const id = anexoDe(c, c.inquilinoA, { remoto: true, apagarArquivo: true });
    const r = await c.pedirBinario(`/midia/${id}`, chave.valor);
    assert.equal(r.status, 200);
    assert.equal(r.contentType, 'image/jpeg');
    assert.deepEqual(r.bytes, BYTES);
    assert.equal(pedidos.length, 1);
    assert.equal(pedidos[0]?.inquilinoId, c.inquilinoA);
    assert.equal(pedidos[0]?.anexoId, id);
    assert.ok((pedidos[0]?.prazoMs ?? 0) > 0 && (pedidos[0]?.prazoMs ?? 0) <= 25_000);
  } finally {
    await c.parar();
  }
});

test('sem Destino Remoto, ou sem buscador, ou Anexo de outro Inquilino: 404 vazio como antes, e o Servico nao e consultado', async () => {
  const pedidos: PedidoDeBusca[] = [];
  const c = await cenarioDeRede({ buscarMidiaRemota: buscadorQue({ tipo: 'bytes', bytes: BYTES }, pedidos) });
  try {
    const chaveA = c.emitir(c.inquilinoA);
    const semRemoto = anexoDe(c, c.inquilinoA, { apagarArquivo: true });
    const r1 = await c.pedir(`/midia/${semRemoto}`, chaveA.valor);
    assert.equal(r1.status, 404);
    assert.equal(r1.corpo, '');

    const deB = anexoDe(c, c.inquilinoB, { remoto: true, apagarArquivo: true });
    const r2 = await c.pedir(`/midia/${deB}`, chaveA.valor);
    assert.equal(r2.status, 404, 'a Chave de A nao alcanca o Anexo de B, nem pelo remoto');
    assert.equal(pedidos.length, 0);
  } finally {
    await c.parar();
  }
  const semBuscador = await cenarioDeRede();
  try {
    const chave = semBuscador.emitir(semBuscador.inquilinoA);
    const id = anexoDe(semBuscador, semBuscador.inquilinoA, { remoto: true, apagarArquivo: true });
    assert.equal((await semBuscador.pedir(`/midia/${id}`, chave.valor)).status, 404);
  } finally {
    await semBuscador.parar();
  }
});

test('video continua 415 mesmo com Destino Remoto, e o Servico nao e consultado', async () => {
  const pedidos: PedidoDeBusca[] = [];
  const c = await cenarioDeRede({ buscarMidiaRemota: buscadorQue({ tipo: 'bytes', bytes: BYTES }, pedidos) });
  try {
    const chave = c.emitir(c.inquilinoA);
    const id = anexoDe(c, c.inquilinoA, { tipo: 'video', remoto: true, apagarArquivo: true });
    assert.equal((await c.pedir(`/midia/${id}`, chave.valor)).status, 415);
    assert.equal(pedidos.length, 0);
  } finally {
    await c.parar();
  }
});

test('cada resultado do Servico tem o seu sinal: sem Localizacao 404, grande demais 413, inacessivel e fora 502 (nunca 404), ocupado 503', async () => {
  const casos: Array<[ResultadoDaBusca, number]> = [
    [{ tipo: 'sem-localizacao' }, 404],
    [{ tipo: 'grande-demais', tamanho: 99, maximo: 50 }, 413],
    [{ tipo: 'inacessivel', motivo: 'o remoto nao respondeu' }, 502],
    [{ tipo: 'servico-fora' }, 502],
    [{ tipo: 'ocupado' }, 503],
  ];
  for (const [resultado, esperado] of casos) {
    const c = await cenarioDeRede({ buscarMidiaRemota: buscadorQue(resultado) });
    try {
      const chave = c.emitir(c.inquilinoA);
      const id = anexoDe(c, c.inquilinoA, { remoto: true, apagarArquivo: true });
      const r = await c.pedir(`/midia/${id}`, chave.valor);
      assert.equal(r.status, esperado, resultado.tipo);
      if (esperado === 413) assert.match(r.corpo, /tamanho maximo/);
      if (esperado === 502) assert.ok(!/remoto nao respondeu/.test(r.corpo), 'o corpo nao repete a razao interna');
    } finally {
      await c.parar();
    }
  }
});

test('o prazo e do servidor: buscador que nao responde vira 504 e solta a reserva', async () => {
  let sinalDoBuscador: AbortSignal | undefined;
  const c = await cenarioDeRede({
    // 2 workers: o teto e de 1 busca por Inquilino, entao uma reserva que vazasse no 504 faria a segunda ser 503.
    trabalhadores: 2,
    prazoMs: 1_500,
    buscarMidiaRemota: (p) => {
      sinalDoBuscador = p.sinal;
      return new Promise<ResultadoDaBusca>(() => undefined);
    },
  });
  try {
    const chave = c.emitir(c.inquilinoA);
    const id = anexoDe(c, c.inquilinoA, { remoto: true, apagarArquivo: true });
    await c.pedir('/relatorio', chave.valor); // aquece o worker: a subida de um worker novo nao entra na conta do prazo
    const inicio = Date.now();
    const r = await c.pedir(`/midia/${id}`, chave.valor);
    assert.equal(r.status, 504);
    assert.ok(Date.now() - inicio < 5_000);
    assert.equal(sinalDoBuscador?.aborted, true, 'o buscador foi avisado de que o prazo estourou');
    const outra = await c.pedir(`/midia/${id}`, chave.valor);
    assert.equal(outra.status, 504, 'a reserva foi solta: a segunda tambem entra, e tambem estoura');
  } finally {
    await c.parar();
  }
});

test('o cliente que vai embora aborta a busca no Servico', async () => {
  let sinalDoBuscador: AbortSignal | undefined;
  let comecou: () => void = () => undefined;
  const iniciou = new Promise<void>((r) => (comecou = r));
  const c = await cenarioDeRede({
    buscarMidiaRemota: (p) => {
      sinalDoBuscador = p.sinal;
      comecou();
      return new Promise<ResultadoDaBusca>(() => undefined);
    },
  });
  try {
    const chave = c.emitir(c.inquilinoA);
    const id = anexoDe(c, c.inquilinoA, { remoto: true, apagarArquivo: true });
    const abandono = new AbortController();
    const pedido = fetch(`http://${c.endereco}:${c.porta}/midia/${id}`, {
      headers: { authorization: `Bearer ${chave.valor}` },
      signal: abandono.signal,
    }).catch(() => undefined);
    await iniciou;
    abandono.abort();
    await pedido;
    for (let i = 0; i < 100 && sinalDoBuscador?.aborted !== true; i += 1) await new Promise((r) => setTimeout(r, 20));
    assert.equal(sinalDoBuscador?.aborted, true);
  } finally {
    await c.parar();
  }
});

test('a reserva: com 2 workers um Inquilino ocupa 1 busca, a segunda dele e 503 e o outro Inquilino e atendido', async () => {
  const liberar: Array<() => void> = [];
  let chamadas = 0;
  const c = await cenarioDeRede({
    trabalhadores: 2,
    buscarMidiaRemota: (p) => {
      chamadas += 1;
      if (p.anexoId.length === 0) return Promise.resolve({ tipo: 'sem-localizacao' });
      return new Promise<ResultadoDaBusca>((resolver) => liberar.push(() => resolver({ tipo: 'bytes', bytes: BYTES })));
    },
  });
  try {
    const chaveA = c.emitir(c.inquilinoA);
    const chaveB = c.emitir(c.inquilinoB);
    const idA = anexoDe(c, c.inquilinoA, { remoto: true, apagarArquivo: true });
    const idB = anexoDe(c, c.inquilinoB, { remoto: true, apagarArquivo: true });

    const primeiraDeA = c.pedirBinario(`/midia/${idA}`, chaveA.valor);
    for (let i = 0; i < 100 && chamadas < 1; i += 1) await new Promise((r) => setTimeout(r, 20));
    const segundaDeA = await c.pedir(`/midia/${idA}`, chaveA.valor);
    assert.equal(segundaDeA.status, 503, 'A ja ocupa o teto de buscas');

    const deB = c.pedirBinario(`/midia/${idB}`, chaveB.valor);
    for (let i = 0; i < 100 && chamadas < 2; i += 1) await new Promise((r) => setTimeout(r, 20));
    assert.equal(chamadas, 2, 'B entrou enquanto A esta no teto');

    for (const l of liberar) l();
    assert.equal((await primeiraDeA).status, 200);
    assert.equal((await deB).status, 200);
  } finally {
    await c.parar();
  }
});
