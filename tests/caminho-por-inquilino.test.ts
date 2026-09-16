import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caminhoDeMidia } from '../src/nucleo/caminho-de-midia.js';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

test('o caminho começa pelo Inquilino', () => {
  const c = caminhoDeMidia({ inquilinoId: A, anexoId: 'anexo-1', tipo: 'image' });
  assert.ok(c.startsWith(`${A}/`), `esperado começar por ${A}, veio ${c}`);
});

test('dois Inquilinos nunca compartilham árvore, mesmo com o mesmo Anexo', () => {
  const emA = caminhoDeMidia({ inquilinoId: A, anexoId: 'anexo-1', tipo: 'image' });
  const emB = caminhoDeMidia({ inquilinoId: B, anexoId: 'anexo-1', tipo: 'image' });
  assert.notEqual(emA, emB);
  // A guarda que importa: nenhum e prefixo do outro, entao apagar a subarvore
  // de um nunca alcanca o outro — mesmo com a MESMA raiz de Destino.
  assert.ok(!emA.startsWith(`${emB.split('/')[0]}/`), 'as árvores se cruzam');
});

test('o Inquilino no caminho não muda o resto do layout', () => {
  const c = caminhoDeMidia({ inquilinoId: A, anexoId: 'anexo-1', tipo: 'image' });
  const [inquilino, pasta, ...resto] = c.split('/');
  assert.equal(inquilino, A);
  assert.equal(pasta, 'image');
  assert.equal(resto.length, 3, 'dois níveis de dispersão mais o arquivo');
  assert.match(resto[2] as string, /^[0-9a-f]{32}\.jpg$/);
});
