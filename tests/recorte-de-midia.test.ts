import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerRecorteDeMidia, linhasDoEnsaioDeMidia } from '../src/cli/recorte-de-midia.js';

const ler = (...resto: string[]) => lerRecorteDeMidia(['midia', 'reprocessar', '--inquilino', 'i1', ...resto]);

test('sem nenhuma flag de recorte: sem recorte, sem tudo e sem ensaio', () => {
  assert.deepEqual(ler(), { filtro: {}, ensaio: false, tudo: false, temRecorte: false });
});

test('desde e ate viram instantes em UTC, inclusivos nas duas pontas', () => {
  const r = ler('--desde', '2026-09-21', '--ate', '2026-09-28');
  assert.ok(!('erro' in r));
  assert.equal(r.filtro.desde, Date.UTC(2026, 8, 21, 0, 0, 0, 0));
  assert.equal(r.filtro.ate, Date.UTC(2026, 8, 28, 23, 59, 59, 999));
  assert.equal(r.temRecorte, true);
});

test('tipo aceita o vocabulario do Acervo e os apelidos, e recusa palavra que nao existe', () => {
  assert.deepEqual((ler('--tipo', 'imagem') as { filtro: object }).filtro, { tipo: 'image' });
  assert.deepEqual((ler('--tipo', 'video') as { filtro: object }).filtro, { tipo: 'video' });
  assert.deepEqual((ler('--tipo', 'documento') as { filtro: object }).filtro, { tipo: 'document' });
  assert.match((ler('--tipo', 'foto') as { erro: string }).erro, /--tipo aceita/);
});

test('mensagem e limite entram; limite so aceita inteiro positivo', () => {
  const r = ler('--mensagem', 'abc', '--limite', '20');
  assert.ok(!('erro' in r));
  assert.deepEqual(r.filtro, { mensagemId: 'abc' });
  assert.equal(r.limite, 20);
  for (const ruim of ['0', '-3', '2.5', 'dez', '1e3', '']) {
    assert.match((ler('--limite', ruim) as { erro: string }).erro, /--limite/, `limite ${JSON.stringify(ruim)}`);
  }
});

test('data invalida e intervalo invertido recusam com a flag nomeada', () => {
  assert.match((ler('--desde', '21/09/2026') as { erro: string }).erro, /--desde/);
  assert.match((ler('--ate', 'ontem') as { erro: string }).erro, /--ate/);
  assert.match((ler('--desde', '2026-09-28', '--ate', '2026-09-21') as { erro: string }).erro, /depois de --ate/);
});

test('so o limite ja conta como recorte (ele limita o volume); tudo e ensaio sozinhos nao', () => {
  assert.equal((ler('--limite', '5') as { temRecorte: boolean }).temRecorte, true);
  const tudo = ler('--tudo') as { tudo: boolean; temRecorte: boolean };
  assert.equal(tudo.tudo, true);
  assert.equal(tudo.temRecorte, false);
  assert.equal((ler('--ensaio') as { ensaio: boolean }).ensaio, true);
});

test('o ensaio diz o que contou, por tipo e por dia, e o que nao baixou', () => {
  const linhas = linhasDoEnsaioDeMidia({
    recuperados: 0, bytesRecuperados: 0, falhas: 0, naoElegiveis: 2, elegiveis: 3, tentados: 0, foraDoLimite: 0,
    ensaio: {
      candidatos: 5, tentaria: 3,
      porTipo: { video: 1, image: 2 },
      porDia: { '2026-09-23': 2, '2026-09-21': 1 },
    },
  });
  assert.deepEqual(linhas, [
    'Ensaio: nada foi baixado e nada foi escrito.',
    'candidatos: 5',
    'elegiveis: 3 (tentaria 3)',
    'nao elegiveis: 2 (nao vieram de recepcao ao vivo)',
    'por tipo: image 2, video 1',
    'por dia (UTC): 2026-09-21 1, 2026-09-23 2',
  ]);
});
