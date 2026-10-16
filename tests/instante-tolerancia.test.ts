import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ehInstantePlausivel,
  INICIO_DA_FONTE,
  motivoDaRejeicao,
  TOLERANCIA_DE_RELOGIO_AO_VIVO_MS,
} from '../src/nucleo/instante.js';

// #1204: a guarda ganha uma tolerancia PARA A FRENTE, opcional, com padrao zero. Quem nao a passa (a importacao)
// continua com o limite de sempre, e o teste do limite do nucleo (`instante.test.ts`) nao muda.

const AGORA = Date.parse('2026-10-13T20:12:03.835Z');

test('sem tolerancia informada o limite e o de sempre: 1 ms a frente e recusado', () => {
  assert.equal(motivoDaRejeicao('whatsapp', AGORA + 1, AGORA), 'instante no futuro');
  assert.equal(ehInstantePlausivel('whatsapp', AGORA + 1, AGORA), false);
});

test('com tolerancia, a borda e inclusiva e 1 ms alem dela e recusado', () => {
  assert.equal(motivoDaRejeicao('whatsapp', AGORA + 5_000, AGORA, 5_000), null);
  assert.equal(motivoDaRejeicao('whatsapp', AGORA + 5_001, AGORA, 5_000), 'instante no futuro');
  assert.equal(ehInstantePlausivel('whatsapp', AGORA + 5_000, AGORA, 5_000), true);
  assert.equal(ehInstantePlausivel('whatsapp', AGORA + 5_001, AGORA, 5_000), false);
});

test('o caso MEDIDO pela espiga (165 ms a frente) entra com a tolerancia da recepcao ao vivo', () => {
  assert.equal(motivoDaRejeicao('whatsapp', AGORA + 165, AGORA, TOLERANCIA_DE_RELOGIO_AO_VIVO_MS), null);
});

test('a tolerancia e so para a frente: o inicio da Fonte e o zero nao se movem', () => {
  assert.equal(ehInstantePlausivel('whatsapp', INICIO_DA_FONTE.whatsapp - 1, AGORA, TOLERANCIA_DE_RELOGIO_AO_VIVO_MS), false);
  assert.match(motivoDaRejeicao('whatsapp', 0, AGORA, TOLERANCIA_DE_RELOGIO_AO_VIVO_MS) ?? '', /anterior ao inicio da Fonte/);
  assert.equal(ehInstantePlausivel('whatsapp', INICIO_DA_FONTE.whatsapp, AGORA, TOLERANCIA_DE_RELOGIO_AO_VIVO_MS), true);
});

test('a janela da recepcao ao vivo e de 5 s (decisao D1 da spec, 16/10/2026)', () => {
  assert.equal(TOLERANCIA_DE_RELOGIO_AO_VIVO_MS, 5_000);
});
