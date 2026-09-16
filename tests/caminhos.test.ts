import { test } from 'node:test';
import assert from 'node:assert/strict';
import { raizDeDados, raizDeEstado } from '../src/cli/caminhos.js';
import { garantirPasta } from '../src/nucleo/caminhos.js';
import { mkdtempSync, statSync } from 'node:fs';

const CASA = '/home/exemplo';

test('sem variavel nenhuma: defaults do XDG, separados por categoria', () => {
  assert.equal(raizDeDados({ HOME: CASA }), joinSeguro(CASA, '.local/share/malote'));
  assert.equal(raizDeEstado({ HOME: CASA }), joinSeguro(CASA, '.local/state/malote'));
});

test('XDG vazio conta como ausente', () => {
  assert.equal(raizDeDados({ HOME: CASA, XDG_DATA_HOME: '' }), joinSeguro(CASA, '.local/share/malote'));
  assert.equal(raizDeEstado({ HOME: CASA, XDG_STATE_HOME: '' }), joinSeguro(CASA, '.local/state/malote'));
});

test('XDG relativo e invalido e se ignora, caindo no default', () => {
  assert.equal(raizDeDados({ HOME: CASA, XDG_DATA_HOME: 'caminho/relativo' }), joinSeguro(CASA, '.local/share/malote'));
  assert.equal(raizDeEstado({ HOME: CASA, XDG_STATE_HOME: './aqui' }), joinSeguro(CASA, '.local/state/malote'));
});

test('XDG absoluto e obedecido', () => {
  assert.equal(raizDeDados({ HOME: CASA, XDG_DATA_HOME: '/d' }), joinSeguro('/d', 'malote'));
  assert.equal(raizDeEstado({ HOME: CASA, XDG_STATE_HOME: '/e' }), joinSeguro('/e', 'malote'));
});

test('MALOTE_HOME colapsa as categorias e vence tudo', () => {
  const env = { HOME: CASA, MALOTE_HOME: '/uma/pasta', XDG_DATA_HOME: '/d', XDG_STATE_HOME: '/e' };
  assert.equal(raizDeDados(env), '/uma/pasta');
  assert.equal(raizDeEstado(env), '/uma/pasta');
});

test('MALOTE_HOME vazio ou relativo tambem e ignorado', () => {
  assert.equal(raizDeDados({ HOME: CASA, MALOTE_HOME: '' }), joinSeguro(CASA, '.local/share/malote'));
  assert.equal(raizDeDados({ HOME: CASA, MALOTE_HOME: 'relativo' }), joinSeguro(CASA, '.local/share/malote'));
});

test('MALOTE_RAIZ nao tem mais efeito nenhum', () => {
  const env = { HOME: CASA, MALOTE_RAIZ: '/velha/raiz', XDG_DATA_HOME: '/d', XDG_STATE_HOME: '/e' };
  assert.equal(raizDeDados(env), joinSeguro('/d', 'malote'));
  assert.equal(raizDeEstado(env), joinSeguro('/e', 'malote'));
});

test('pasta criada pelo produto nasce 0700 no modo efetivo, mesmo sob umask 0', () => {
  const antes = process.umask(0o000);
  try {
    const pasta = joinSeguro(mkdtempSync('/tmp/malote-modo-'), 'install');
    garantirPasta(pasta);
    assert.equal(statSync(pasta).mode & 0o777, 0o700);
  } finally {
    process.umask(antes);
  }
});

function joinSeguro(...partes: string[]): string {
  return partes.join('/');
}
