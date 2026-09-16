import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chaveDeNome } from '../src/nucleo/chave-de-nome.js';

// A fixture se CONSTROI por escape, nunca por literal colado: um editor que
// normaliza, ou um copiar-colar pelo terminal, perde a marca — e o teste nasce
// comparando duas strings iguais, passando sem medir nada. E o proprio defeito
// que este modulo trata.
const LRE = '\u202A';
const PDF = '\u202C';
const NBSP = '\u00A0';
const HIFEN_NB = '\u2011';

// GUARDA DE VACUIDADE. Se um escape estiver errado e virar string vazia, os
// testes abaixo comparam duas strings IGUAIS e passam sem exercitar nada. Esta
// assercao e o que separa verde de vazio.
test('a fixture e mesmo diferente antes de normalizar', () => {
  assert.notEqual(LRE + 'Maria Silva' + PDF, 'Maria Silva');
  assert.notEqual('+55' + NBSP + '65', '+55 65');
  assert.notEqual('99999' + HIFEN_NB + '9999', '99999-9999');
});

test('marca de direcao invisivel nao distingue dois nomes', () => {
  assert.equal(chaveDeNome(LRE + 'Maria Silva' + PDF), chaveDeNome('Maria Silva'));
});

test('espaco nao-quebravel e hifen nao-ASCII viram a forma ASCII', () => {
  assert.equal(
    chaveDeNome('+55' + NBSP + '65' + NBSP + '99999' + HIFEN_NB + '9999'),
    chaveDeNome('+55 65 99999-9999'),
  );
});

test('nomes de fato diferentes continuam diferentes', () => {
  assert.notEqual(chaveDeNome('Maria Silva'), chaveDeNome('Maria Silvia'));
});

test('acento e caixa NAO sao normalizados — a chave nao funde pessoas', () => {
  assert.notEqual(chaveDeNome('Joao'), chaveDeNome('João'));
  assert.notEqual(chaveDeNome('maria'), chaveDeNome('Maria'));
});
