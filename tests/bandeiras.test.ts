import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANDEIRAS, recusarBandeiras, validarBandeiras } from '../src/cli/bandeiras.js';

test('flag que pede valor, no fim da linha, e erro de uso e nomeia a flag', () => {
  assert.equal(validarBandeiras(['conversas', '--coletiva']), 'A flag --coletiva pede um valor.');
  assert.equal(validarBandeiras(['conversas', '--busca']), 'A flag --busca pede um valor.');
  assert.equal(validarBandeiras(['conversas', '--limite']), 'A flag --limite pede um valor.');
});

test('flag seguida de outra flag NAO engole a seguinte como valor', () => {
  assert.equal(validarBandeiras(['conversas', '--coletiva', '--json']), 'A flag --coletiva pede um valor.');
  assert.equal(validarBandeiras(['anexos', '--conversa', 'c', '--tipo', '--json']), 'A flag --tipo pede um valor.');
});

test('flag com valor valido passa, e o valor e pulado (nao e lido como flag)', () => {
  assert.equal(validarBandeiras(['conversas', '--busca', 'ana', '--json']), undefined);
  assert.equal(validarBandeiras(['mensagens', '--conversa', 'c', '--desde', '2026-10-01', '--limite', '5']), undefined);
});

test('valor que comeca com um unico hifen segue valor', () => {
  assert.equal(validarBandeiras(['mensagens', '--antes', '-1']), undefined);
});

test('as bandeiras nao pedem valor, e nao consomem o argumento seguinte', () => {
  for (const b of BANDEIRAS) {
    assert.equal(validarBandeiras(['conversas', `--${b}`]), undefined, b);
    assert.equal(validarBandeiras(['conversas', `--${b}`, '--inquilino', 'x']), undefined, b);
  }
  assert.deepEqual([...BANDEIRAS].sort(), [
    'ajuda', 'com-efeito', 'confirmo', 'exposto', 'historico', 'incluir-absorvidas', 'json',
    'reprocessar', 'sobrescrever', 'versao',
  ]);
});

test('o primeiro argumento e o comando e nao e validado como flag', () => {
  assert.equal(validarBandeiras(['--ajuda']), undefined);
  assert.equal(validarBandeiras(['--versao']), undefined);
});

test('conjunto fechado: --coletiva e --fixada so aceitam true ou false', () => {
  assert.equal(validarBandeiras(['conversas', '--coletiva', 'true']), undefined);
  assert.equal(validarBandeiras(['conversas', '--coletiva', 'false']), undefined);
  assert.equal(validarBandeiras(['conversas', '--coletiva', 'banana']), 'A flag --coletiva aceita true ou false.');
  assert.equal(validarBandeiras(['conversas', '--fixada', 'talvez']), 'A flag --fixada aceita true ou false.');
});

test('recusarBandeiras escreve a mensagem e devolve 2; sem erro, nao escreve e devolve nada', () => {
  const linhas: string[] = [];
  assert.equal(recusarBandeiras(['conversas', '--coletiva'], (t) => linhas.push(t)), 2);
  assert.deepEqual(linhas, ['A flag --coletiva pede um valor.']);
  assert.equal(recusarBandeiras(['conversas', '--json'], (t) => linhas.push(t)), undefined);
  assert.equal(linhas.length, 1, 'uso valido nao escreve nada');
});
