import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subirCenaDeIdentidade } from './ajuda/identidade.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (corpo: string): any => JSON.parse(corpo);
const conteudos = (corpo: string): string[] => j(corpo).mensagens.map((m: { conteudo: string }) => m.conteudo);

test('GET /buscar: o padrao e mais recente primeiro, e traz truncado: false quando nada foi cortado', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const r = await cena.pedir('/buscar?texto=texto', cena.chave.valor);
    assert.equal(r.status, 200, r.corpo);
    assert.equal(conteudos(r.corpo)[0], 'texto 9');
    assert.equal(conteudos(r.corpo).length, 9);
    assert.equal(j(r.corpo).truncado, false);
  } finally {
    cena.encerrar();
  }
});

test('GET /buscar: ordem=cronologica devolve a mais antiga primeiro', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const r = await cena.pedir('/buscar?texto=texto&ordem=cronologica', cena.chave.valor);
    assert.equal(conteudos(r.corpo)[0], 'texto 1');
  } finally {
    cena.encerrar();
  }
});

test('GET /buscar: limite menor que o total traz truncado: true, e o limite exato nao', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const cortada = await cena.pedir('/buscar?texto=texto&limite=3', cena.chave.valor);
    assert.deepEqual(conteudos(cortada.corpo), ['texto 9', 'texto 8', 'texto 7']);
    assert.equal(j(cortada.corpo).truncado, true);
    const exata = await cena.pedir('/buscar?texto=texto&limite=9', cena.chave.valor);
    assert.equal(j(exata.corpo).truncado, false);
  } finally {
    cena.encerrar();
  }
});

test('GET /buscar: ordem invalida e 400, e nao e ignorada em silencio', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const r = await cena.pedir('/buscar?texto=texto&ordem=banana', cena.chave.valor);
    assert.equal(r.status, 400);
    assert.match(j(r.corpo).erro, /ordem/);
  } finally {
    cena.encerrar();
  }
});
