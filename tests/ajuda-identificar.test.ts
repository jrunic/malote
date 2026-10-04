import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executar } from '../src/cli/index.js';

test('a ajuda lista identificar nos dois modos (#1126)', () => {
  const linhas: string[] = [];
  assert.equal(
    executar(['--ajuda'], { dados: '/nao/usado', estado: '/nao/usado', escrever: (t: string) => linhas.push(t) }),
    0,
  );
  const saida = linhas.join('\n');
  assert.match(saida, /malote identificar\s+<valor> --inquilino <id>/);
  assert.match(saida, /malote identificar\s+<valor> \[--fonte <fonte>\] \[--json\]/);
});
