import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIRECOES, ESTADOS_DE_TRANSCRICAO, FONTES, PRESENCAS, ehDirecao, ehEstadoDeTranscricao, ehFonte } from '../src/nucleo/tipos.js';

test('as Fontes conhecidas são declaradas em um só lugar', () => {
  assert.deepEqual([...FONTES], ['whatsapp', 'instagram', 'contatos']);
});

test('Presenca tem exatamente três estados, sem rebaixado', () => {
  assert.deepEqual([...PRESENCAS], ['presente', 'nunca-obtido', 'descartado']);
  assert.ok(!PRESENCAS.includes('rebaixado' as never));
});

test('ehFonte reconhece Fonte válida e recusa desconhecida', () => {
  assert.equal(ehFonte('whatsapp'), true);
  assert.equal(ehFonte('telegram'), false);
});

test('DIRECOES tem exatamente enviada e recebida', () => {
  assert.deepEqual([...DIRECOES], ['enviada', 'recebida']);
});

test('ehDirecao reconhece os dois valores e recusa o resto', () => {
  assert.equal(ehDirecao('enviada'), true);
  assert.equal(ehDirecao('recebida'), true);
  assert.equal(ehDirecao('desconhecida'), false);
});

test('ehEstadoDeTranscricao aceita os quatro estados e recusa o resto', () => {
  for (const estado of ESTADOS_DE_TRANSCRICAO) {
    assert.ok(ehEstadoDeTranscricao(estado));
  }
  assert.ok(!ehEstadoDeTranscricao('em-andamento'));
});
