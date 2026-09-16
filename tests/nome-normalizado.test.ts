import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarNome } from '../src/adaptadores/contatos/nome.js';

test('acento não distingue', () => {
  assert.equal(normalizarNome('José Antônio'), normalizarNome('Jose Antonio'));
});

test('caixa e espaço não distinguem', () => {
  assert.equal(normalizarNome('  JOANA   PRADO '), 'joana prado');
});

test('preserva alfabeto não latino em vez de apagá-lo', () => {
  // A versao agressiva do script de medicao de 28/08 zeraria isto, e dois
  // nomes distintos colidiriam como string vazia. Medido: as duas formas dao
  // o mesmo numero no catalogo real, entao fica a que nao apaga ninguem.
  assert.notEqual(normalizarNome('Ана'), '');
  assert.notEqual(normalizarNome('Ана'), normalizarNome('Ольга'));
});

test('nome vazio ou só espaço normaliza para vazio', () => {
  assert.equal(normalizarNome('   '), '');
  assert.equal(normalizarNome(''), '');
});
