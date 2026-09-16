import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { anotarPulos, lerPulos } from '../src/cli/pulos.js';

function alvo(): string {
  return join(mkdtempSync(join(tmpdir(), 'pulos-')), 'pulos.json');
}

test('ausente le zeros e NAO lanca', () => {
  assert.deepEqual(lerPulos(join(tmpdir(), 'nao-existe-jamais', 'pulos.json')), {
    enderecosOpacos: 0,
    favoritosSemMensagem: 0,
  });
});

test('somar e monotonico', () => {
  const a = alvo();
  anotarPulos(a, { enderecosOpacos: 2, favoritosSemMensagem: 0 });
  anotarPulos(a, { enderecosOpacos: 1, favoritosSemMensagem: 3 });
  assert.deepEqual(lerPulos(a), { enderecosOpacos: 3, favoritosSemMensagem: 3 });
});

test('corrompido le zeros e NAO lanca', () => {
  const a = alvo();
  writeFileSync(a, '{ truncad');
  assert.deepEqual(lerPulos(a), { enderecosOpacos: 0, favoritosSemMensagem: 0 });
});
