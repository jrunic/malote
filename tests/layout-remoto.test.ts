import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { caminhoDeMidia } from '../src/nucleo/caminho-de-midia.js';
import {
  CaminhoLocalInvalidoError,
  caminhoRemoto,
  caminhoRemotoCompleto,
} from '../src/nucleo/layout-remoto.js';

const INQUILINO = '5f0c2d9e-8a41-4a53-9a0e-1c2b3d4e5f60';

test('o caminho remoto rearranja o local: um nivel de pasta, o resto do identificador no nome', () => {
  const local = caminhoDeMidia({ inquilinoId: INQUILINO, anexoId: 'anexo-1', tipo: 'video' });
  const [inquilino, pasta, n1, n2, arquivo] = local.split('/') as [string, string, string, string, string];
  assert.equal(caminhoRemoto(local), `${inquilino}/${pasta}/${n1}/${n2}${arquivo}`);
  assert.equal(caminhoRemoto(local).split('/').length, 4, 'uma pasta a menos que o local');
});

test('e injetiva: 20 mil Anexos distintos nunca colidem', () => {
  const vistos = new Set<string>();
  for (let i = 0; i < 20_000; i += 1) {
    const local = caminhoDeMidia({ inquilinoId: INQUILINO, anexoId: randomUUID(), tipo: 'image' });
    vistos.add(caminhoRemoto(local));
  }
  assert.equal(vistos.size, 20_000);
});

test('o estoque cabe em poucas pastas: no maximo uma por tipo e primeiro nivel', () => {
  const pastas = new Set<string>();
  for (let i = 0; i < 20_000; i += 1) {
    const tipo = ['image', 'video', 'audio', 'document', 'sticker'][i % 5] as string;
    const local = caminhoDeMidia({ inquilinoId: INQUILINO, anexoId: randomUUID(), tipo });
    pastas.add(caminhoRemoto(local).split('/').slice(0, 3).join('/'));
  }
  assert.ok(pastas.size <= 5 * 256, `pastas: ${pastas.size}`);
});

test('nenhum caminho remoto contem dado pessoal, mesmo quando a origem carrega', () => {
  const local = caminhoDeMidia({
    inquilinoId: INQUILINO,
    anexoId: 'anexo-2',
    tipo: 'image',
    nomeOriginal: 'foto-da-leia-organa-+5565900000001.jpg',
    apelidoDaOrigem: 'han-solo',
  });
  const remoto = caminhoRemotoCompleto('malote', local).toLowerCase();
  for (const proibido of ['leia', 'organa', '5565900000001', 'foto-da', 'han', 'solo']) {
    assert.ok(!remoto.includes(proibido), `${proibido} apareceu em ${remoto}`);
  }
});

test('recusa a forma que o nucleo nao produz', () => {
  for (const ruim of [
    '',
    'a/b/c/d',
    `${INQUILINO}/image/ab/cd/${'0'.repeat(32)}.jpg/extra`,
    `${INQUILINO}/image/zz/cd/${'0'.repeat(32)}.jpg`,
    `${INQUILINO}/image/ab/cd/foto-da-leia.jpg`,
    `${INQUILINO}/../ab/cd/${'0'.repeat(32)}.jpg`,
    `/${INQUILINO}/image/ab/cd/${'0'.repeat(32)}.jpg`,
  ]) {
    assert.throws(() => caminhoRemoto(ruim), CaminhoLocalInvalidoError, ruim);
  }
});

test('a pasta-base e normalizada e a vazia nao deixa barra', () => {
  const local = caminhoDeMidia({ inquilinoId: INQUILINO, anexoId: 'anexo-3', tipo: 'audio' });
  const relativo = caminhoRemoto(local);
  assert.equal(caminhoRemotoCompleto('malote', local), `malote/${relativo}`);
  assert.equal(caminhoRemotoCompleto('/malote/midia/', local), `malote/midia/${relativo}`);
  assert.equal(caminhoRemotoCompleto('', local), relativo);
});
