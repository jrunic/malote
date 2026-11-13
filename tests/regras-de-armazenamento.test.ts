import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDADE_MINIMA_DO_ARQUIVO_MS,
  arquivoMaduro,
  corteDaJanela,
  decidirApagarCopiaLocal,
  ordemDeEnvio,
  reduzirRitmo,
  type EntradaDaDecisao,
} from '../src/nucleo/regras-de-armazenamento.js';

const DIA = 24 * 60 * 60 * 1000;
const VERIFICADA = '2026-11-01T00:00:00.000Z';
const BASE: EntradaDaDecisao = {
  apagarLocalLiberado: true,
  janelaDias: 7,
  agora: Date.parse(VERIFICADA) + 8 * DIA,
  verificadaEm: VERIFICADA,
  transcricaoPorFazer: false,
};

test('apaga quando a trava esta liberada, a Janela passou e nao ha transcricao por fazer', () => {
  assert.deepEqual(decidirApagarCopiaLocal(BASE), { apagar: true });
});

test('a trava fechada vence tudo', () => {
  assert.deepEqual(decidirApagarCopiaLocal({ ...BASE, apagarLocalLiberado: false }), {
    apagar: false,
    motivo: 'trava-fechada',
  });
  // Mesmo com a Janela vencida e sem transcricao por fazer, o motivo e a trava.
  assert.equal(decidirApagarCopiaLocal({ ...BASE, apagarLocalLiberado: false, janelaDias: 0 }).apagar, false);
});

test('dentro da Janela nao apaga; a Janela conta da verificacao, ao milissegundo', () => {
  const venceEm = Date.parse(VERIFICADA) + 7 * DIA;
  assert.deepEqual(decidirApagarCopiaLocal({ ...BASE, agora: venceEm - 1 }), { apagar: false, motivo: 'dentro-da-janela' });
  assert.deepEqual(decidirApagarCopiaLocal({ ...BASE, agora: venceEm }), { apagar: true });
});

test('Janela de zero dias apaga logo depois de verificar', () => {
  assert.deepEqual(decidirApagarCopiaLocal({ ...BASE, janelaDias: 0, agora: Date.parse(VERIFICADA) }), { apagar: true });
});

test('o audio com transcricao por fazer nao sai, mesmo vencida a Janela', () => {
  assert.deepEqual(decidirApagarCopiaLocal({ ...BASE, transcricaoPorFazer: true }), {
    apagar: false,
    motivo: 'transcricao-por-fazer',
  });
});

test('o corte da Janela e agora menos a Janela', () => {
  assert.equal(corteDaJanela(Date.parse('2026-11-12T10:00:00.000Z'), 7), '2026-11-05T10:00:00.000Z');
  assert.equal(corteDaJanela(Date.parse('2026-11-12T10:00:00.000Z'), 0), '2026-11-12T10:00:00.000Z');
});

test('o arquivo so e maduro a partir da idade minima', () => {
  const agora = 1_000_000_000;
  assert.equal(arquivoMaduro(agora, agora - IDADE_MINIMA_DO_ARQUIVO_MS + 1), false);
  assert.equal(arquivoMaduro(agora, agora - IDADE_MINIMA_DO_ARQUIVO_MS), true);
});

test('o video vai primeiro', () => {
  assert.equal(ordemDeEnvio('video'), 0);
  for (const outro of ['image', 'audio', 'document', 'sticker', 'outros']) assert.equal(ordemDeEnvio(outro), 1);
});

test('o ritmo cai pela metade, nunca abaixo de 1, e a espera dobra ate o teto', () => {
  let r = { transferencias: 8, esperaMs: 0 };
  r = reduzirRitmo(r);
  assert.deepEqual(r, { transferencias: 4, esperaMs: 2_000 });
  r = reduzirRitmo(r);
  assert.deepEqual(r, { transferencias: 2, esperaMs: 4_000 });
  r = reduzirRitmo(reduzirRitmo(r));
  assert.deepEqual(r, { transferencias: 1, esperaMs: 16_000 });
  for (let i = 0; i < 10; i += 1) r = reduzirRitmo(r);
  assert.deepEqual(r, { transferencias: 1, esperaMs: 60_000 });
});
