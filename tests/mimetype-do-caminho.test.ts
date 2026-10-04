import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mimetypeDoCaminho } from '../src/cli/mimetype-do-caminho.js';

test('mimetypeDoCaminho resolve pela extensao, sem diferenciar maiuscula', () => {
  assert.equal(mimetypeDoCaminho('/x/foto.JPG'), 'image/jpeg');
  assert.equal(mimetypeDoCaminho('/x/foto.jpeg'), 'image/jpeg');
  assert.equal(mimetypeDoCaminho('relatorio.pdf'), 'application/pdf');
  assert.equal(mimetypeDoCaminho('a.png'), 'image/png');
});

test('mimetypeDoCaminho cai em octet-stream para extensao desconhecida ou ausente', () => {
  assert.equal(mimetypeDoCaminho('/x/arquivo.xyz'), 'application/octet-stream');
  assert.equal(mimetypeDoCaminho('/x/semextensao'), 'application/octet-stream');
});
