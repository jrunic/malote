import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caminhoDeMidia } from '../src/nucleo/caminho-de-midia.js';

/** Inquilino sintetico: o caminho passou a comecar por ele no ciclo 5. */
const INQUILINO = '00000000-0000-0000-0000-000000000000';

test('o caminho é derivado do id do Anexo, não do nome do arquivo', () => {
  const a = caminhoDeMidia({ inquilinoId: INQUILINO, anexoId: 'aaaaaaaa-1111-2222-3333-444444444444', tipo: 'video' });
  const b = caminhoDeMidia({ inquilinoId: INQUILINO, anexoId: 'bbbbbbbb-1111-2222-3333-444444444444', tipo: 'video' });
  assert.notEqual(a, b);
  assert.equal(caminhoDeMidia({ inquilinoId: INQUILINO, anexoId: 'aaaaaaaa-1111-2222-3333-444444444444', tipo: 'video' }), a);
});

test('nenhum caminho contém dado pessoal, mesmo quando a origem carrega', () => {
  // O nome original traz nome de pessoa, apelido e número. Nada disso pode
  // atravessar para o caminho — foi defeito real no acervo de origem, onde a
  // mídia do Instagram ia para uma pasta com o apelido no nome.
  const caminho = caminhoDeMidia({
    inquilinoId: INQUILINO,
    anexoId: 'cccccccc-1111-2222-3333-444444444444',
    tipo: 'image',
    nomeOriginal: 'foto-da-leia-organa-+5565900000001.jpg',
    apelidoDaOrigem: 'leia.organa',
  });

  for (const proibido of ['leia', 'organa', '5565900000001', 'foto-da']) {
    assert.ok(!caminho.toLowerCase().includes(proibido), `caminho vazou "${proibido}": ${caminho}`);
  }
});

test('o layout é por tipo e sharded, para não estourar diretório', () => {
  const caminho = caminhoDeMidia({ inquilinoId: INQUILINO, anexoId: 'dddddddd-1111-2222-3333-444444444444', tipo: 'audio' });
  // O primeiro segmento e o Inquilino desde o ciclo 5; a forma do layout
  // comeca no segundo.
  const [inquilino, ...partes] = caminho.split('/');
  assert.equal(inquilino, INQUILINO);
  assert.equal(partes[0], 'audio');
  assert.equal(partes[1]?.length, 2, 'primeiro nível de sharding com 2 caracteres');
  assert.equal(partes[2]?.length, 2, 'segundo nível de sharding com 2 caracteres');
  assert.equal(partes.length, 4);
});

test('a extensão vem do tipo, não do nome original', () => {
  const caminho = caminhoDeMidia({
    inquilinoId: INQUILINO,
    anexoId: 'eeeeeeee-1111-2222-3333-444444444444',
    tipo: 'image',
    nomeOriginal: 'coisa.EXE',
  });
  assert.ok(caminho.endsWith('.jpg'), `extensão inesperada: ${caminho}`);
});

test('tipo desconhecido cai numa pasta própria, sem inventar extensão', () => {
  const caminho = caminhoDeMidia({ inquilinoId: INQUILINO, anexoId: 'ffffffff-1111-2222-3333-444444444444', tipo: 'vcard' });
  assert.ok(caminho.startsWith(`${INQUILINO}/outros/`), caminho);
  assert.ok(caminho.endsWith('.bin'), caminho);
});

test('o caminho é sempre relativo — quem junta com o Destino é quem grava', () => {
  const caminho = caminhoDeMidia({ inquilinoId: INQUILINO, anexoId: '11111111-1111-2222-3333-444444444444', tipo: 'video' });
  assert.ok(!caminho.startsWith('/'), 'caminho absoluto amarraria o Acervo a um Destino');
  assert.ok(!caminho.includes('..'), 'nenhum caminho escapa da raiz do Destino');
});
