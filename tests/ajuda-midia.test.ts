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

test('a ajuda lista exportar nos dois modos e diz que os horarios sao UTC (#1129)', () => {
  const linhas: string[] = [];
  assert.equal(
    executar(['--ajuda'], { dados: '/nao/usado', estado: '/nao/usado', escrever: (t: string) => linhas.push(t) }),
    0,
  );
  const ajuda = linhas.join('\n');
  assert.match(ajuda, /malote exportar\s+--inquilino <id> --conversa <id>/);
  assert.match(ajuda, /malote exportar\s+--conversa <id>[^\n]*\n[^\n]*MALOTE_SERVIDOR/);
  assert.match(ajuda, /UTC/);
  assert.match(ajuda, /--sobrescrever/);
  assert.match(ajuda, /use --saida/);
});
