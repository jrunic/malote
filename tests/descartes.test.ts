// tests/descartes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TIPOS_POR_DIA,
  anotarDescartes,
  lerDescartes,
} from '../src/cli/descartes.js';
import { DIAS_GUARDADOS } from '../src/cli/vigilancia.js';

function pasta(): { caminho: string; limpar: () => void } {
  const raiz = mkdtempSync(join(tmpdir(), 'malote-descartes-'));
  return {
    caminho: join(raiz, 'ouvinte', 'c', 'descartes.json'),
    limpar: () => rmSync(raiz, { recursive: true, force: true }),
  };
}

const DIA = 86_400_000;
const HOJE = Date.parse('2026-10-07T12:00:00Z');

test('soma por tipo no balde do dia UTC e SOBREVIVE a reabrir (lido do disco)', () => {
  const p = pasta();
  try {
    anotarDescartes(p.caminho, { protocolMessage: 2, cifrada: 1 }, HOJE);
    anotarDescartes(p.caminho, { protocolMessage: 3 }, HOJE + 3_600_000);
    assert.deepEqual(lerDescartes(p.caminho), {
      '2026-10-07': { protocolMessage: 5, cifrada: 1 },
    });
  } finally {
    p.limpar();
  }
});

test('lote sem descarte nao cria balde', () => {
  const p = pasta();
  try {
    anotarDescartes(p.caminho, {}, HOJE);
    assert.deepEqual(lerDescartes(p.caminho), {});
  } finally {
    p.limpar();
  }
});

test('o arquivo NAO tem conteudo: so tipos e numeros', () => {
  const p = pasta();
  try {
    anotarDescartes(p.caminho, { protocolMessage: 1 }, HOJE);
    assert.equal(readFileSync(p.caminho, 'utf8'), '{"2026-10-07":{"protocolMessage":1}}');
  } finally {
    p.limpar();
  }
});

test('poda o que passou de DIAS_GUARDADOS e guarda o limite', () => {
  const p = pasta();
  try {
    anotarDescartes(p.caminho, { velho: 1 }, HOJE - (DIAS_GUARDADOS + 1) * DIA);
    anotarDescartes(p.caminho, { limite: 1 }, HOJE - DIAS_GUARDADOS * DIA);
    anotarDescartes(p.caminho, { hoje: 1 }, HOJE);
    const dias = Object.keys(lerDescartes(p.caminho));
    assert.deepEqual(dias, ['2026-09-07', '2026-10-07']);
  } finally {
    p.limpar();
  }
});

test('10.000 eventos do mesmo tipo nao aumentam o arquivo', () => {
  const p = pasta();
  try {
    anotarDescartes(p.caminho, { protocolMessage: 1 }, HOJE);
    const antes = readFileSync(p.caminho, 'utf8').length;
    anotarDescartes(p.caminho, { protocolMessage: 9_999 }, HOJE);
    assert.equal(readFileSync(p.caminho, 'utf8').length, antes + 4, 'cresceu mais que os digitos do numero');
  } finally {
    p.limpar();
  }
});

test('tipos alem do teto por dia somam num rotulo unico', () => {
  const p = pasta();
  try {
    const muitos: Record<string, number> = {};
    for (let i = 0; i < TIPOS_POR_DIA + 20; i += 1) muitos[`tipo${i}`] = 1;
    anotarDescartes(p.caminho, muitos, HOJE);
    const balde = lerDescartes(p.caminho)['2026-10-07'] ?? {};
    assert.equal(Object.keys(balde).length, TIPOS_POR_DIA + 1);
    assert.equal(balde['outros'], 20);
    // Um tipo que JA esta no balde continua somando no proprio rotulo, mesmo com o teto cheio.
    anotarDescartes(p.caminho, { tipo0: 4 }, HOJE);
    assert.equal(lerDescartes(p.caminho)['2026-10-07']?.['tipo0'], 5);
  } finally {
    p.limpar();
  }
});

test('arquivo ausente ou corrompido le como vazio', () => {
  const p = pasta();
  try {
    assert.deepEqual(lerDescartes(p.caminho), {});
    anotarDescartes(p.caminho, { x: 1 }, HOJE);
    writeFileSync(p.caminho, '{"2026-10-07":{"x":');
    assert.deepEqual(lerDescartes(p.caminho), {});
  } finally {
    p.limpar();
  }
});

test('a escrita e por troca atomica: nao sobra o temporario', () => {
  const p = pasta();
  try {
    anotarDescartes(p.caminho, { x: 1 }, HOJE);
    assert.throws(() => readFileSync(`${p.caminho}.parcial`), /ENOENT/);
  } finally {
    p.limpar();
  }
});
