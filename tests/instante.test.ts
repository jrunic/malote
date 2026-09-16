import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ehInstantePlausivel, INICIO_DA_FONTE, motivoDaRejeicao } from '../src/nucleo/instante.js';

const AGORA = Date.parse('2026-08-24T12:00:00Z');

test('instante dentro da faixa da Fonte é plausível', () => {
  const emUso = Date.parse('2021-06-15T10:00:00Z');
  assert.equal(ehInstantePlausivel('whatsapp', emUso, AGORA), true);
});

test('instante zero é implausível — é o defeito real do acervo de origem', () => {
  assert.equal(ehInstantePlausivel('whatsapp', 0, AGORA), false);
  assert.match(motivoDaRejeicao('whatsapp', 0, AGORA) ?? '', /anterior ao inicio da Fonte/);
});

test('instante no futuro é implausível', () => {
  const amanha = AGORA + 24 * 60 * 60 * 1000;
  assert.equal(ehInstantePlausivel('whatsapp', amanha, AGORA), false);
  assert.match(motivoDaRejeicao('whatsapp', amanha, AGORA) ?? '', /no futuro/);
});

test('cada Fonte declara a própria faixa, e elas diferem', () => {
  // O Instagram como Fonte de mensagens é posterior ao WhatsApp: uma data de
  // 2010 é plausível num e não no outro. Se as faixas fossem iguais, este
  // teste passaria com a tabela colapsada num valor só.
  const em2010 = Date.parse('2010-06-15T10:00:00Z');
  assert.equal(ehInstantePlausivel('whatsapp', em2010, AGORA), true);
  assert.equal(ehInstantePlausivel('instagram', em2010, AGORA), false);
  assert.notEqual(INICIO_DA_FONTE.whatsapp, INICIO_DA_FONTE.instagram);
});

test('instante plausível não tem motivo de rejeição', () => {
  const emUso = Date.parse('2021-06-15T10:00:00Z');
  assert.equal(motivoDaRejeicao('whatsapp', emUso, AGORA), null);
});

test('o limite é inclusivo no início da Fonte e no agora', () => {
  assert.equal(ehInstantePlausivel('whatsapp', INICIO_DA_FONTE.whatsapp, AGORA), true);
  assert.equal(ehInstantePlausivel('whatsapp', AGORA, AGORA), true);
  assert.equal(ehInstantePlausivel('whatsapp', INICIO_DA_FONTE.whatsapp - 1, AGORA), false);
  assert.equal(ehInstantePlausivel('whatsapp', AGORA + 1, AGORA), false);
});
