import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codificarCursor, decodificarCursor } from '../src/nucleo/cursor.js';

test('cursor codifica (instante, id) e decodifica idêntico', () => {
  const c = codificarCursor({ ocorridaEm: 1789506000000, id: 'abc-123' });
  assert.deepEqual(decodificarCursor(c), { ocorridaEm: 1789506000000, id: 'abc-123' });
});

test('cursor inválido devolve undefined, nunca lança — quem recusa é a rota', () => {
  assert.equal(decodificarCursor('lixo!!'), undefined);
  assert.equal(decodificarCursor(''), undefined);
});
