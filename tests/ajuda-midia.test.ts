import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executar } from '../src/cli/index.js';

test('a ajuda lista anexos e --remetente nos dois modos (#1129)', () => {
  const linhas: string[] = [];
  assert.equal(
    executar(['--ajuda'], { dados: '/nao/usado', estado: '/nao/usado', escrever: (t: string) => linhas.push(t) }),
    0,
  );
  const ajuda = linhas.join('\n');
  assert.match(ajuda, /malote anexos\s+--inquilino <id> --conversa <id>/);
  assert.match(ajuda, /malote anexos\s+--conversa <id>[^\n]*\n[^\n]*MALOTE_SERVIDOR/);
  assert.match(ajuda, /--remetente <valor>/);
  assert.match(ajuda, /image\|video\|audio\|document\|sticker\|other/);
});
