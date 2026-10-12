// tests/sinal-da-conexao.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  INTERVALO_DO_SINAL_MS,
  criarMarcadorDoSinal,
  falhasDoSinal,
  lerSinalDaConexao,
} from '../src/cli/sinal-da-conexao.js';

const T0 = Date.parse('2026-10-12T12:00:00Z');

function pasta(): { p: string; limpar: () => void } {
  const p = mkdtempSync(join(tmpdir(), 'malote-sinal-'));
  return { p, limpar: () => rmSync(p, { recursive: true, force: true }) };
}

test('o primeiro frame grava de imediato o instante', () => {
  const { p, limpar } = pasta();
  try {
    const caminho = join(p, 'ultimo-sinal.txt');
    const marcar = criarMarcadorDoSinal({ caminho, agora: () => T0, avisar: () => undefined });
    assert.equal(lerSinalDaConexao(caminho), null, 'antes do primeiro frame nao ha sinal');
    marcar();
    assert.equal(lerSinalDaConexao(caminho), T0);
  } finally {
    limpar();
  }
});

test('frames dentro da janela NAO regravam: o arquivo fica no ultimo instante gravado', () => {
  const { p, limpar } = pasta();
  try {
    const caminho = join(p, 'ultimo-sinal.txt');
    let agora = T0;
    const marcar = criarMarcadorDoSinal({ caminho, agora: () => agora, avisar: () => undefined });
    marcar();
    agora = T0 + 5_000;
    marcar();
    agora = T0 + INTERVALO_DO_SINAL_MS - 1;
    marcar();
    assert.equal(lerSinalDaConexao(caminho), T0);
  } finally {
    limpar();
  }
});

test('o primeiro frame depois da janela grava de imediato', () => {
  const { p, limpar } = pasta();
  try {
    const caminho = join(p, 'ultimo-sinal.txt');
    let agora = T0;
    const marcar = criarMarcadorDoSinal({ caminho, agora: () => agora, avisar: () => undefined });
    marcar();
    agora = T0 + INTERVALO_DO_SINAL_MS;
    marcar();
    assert.equal(lerSinalDaConexao(caminho), T0 + INTERVALO_DO_SINAL_MS);
  } finally {
    limpar();
  }
});

test('relogio que volta para tras nao congela o sinal', () => {
  const { p, limpar } = pasta();
  try {
    const caminho = join(p, 'ultimo-sinal.txt');
    let agora = T0;
    const marcar = criarMarcadorDoSinal({ caminho, agora: () => agora, avisar: () => undefined });
    marcar();
    agora = T0 - 3_600_000;
    marcar();
    assert.equal(lerSinalDaConexao(caminho), T0 - 3_600_000);
  } finally {
    limpar();
  }
});

test('o intervalo pode ser trocado', () => {
  const { p, limpar } = pasta();
  try {
    const caminho = join(p, 'ultimo-sinal.txt');
    let agora = T0;
    const marcar = criarMarcadorDoSinal({
      caminho,
      agora: () => agora,
      avisar: () => undefined,
      intervaloMs: 1_000,
    });
    marcar();
    agora = T0 + 1_000;
    marcar();
    assert.equal(lerSinalDaConexao(caminho), T0 + 1_000);
  } finally {
    limpar();
  }
});

test('pasta ausente: avisa UMA vez, nao lanca, tenta de novo so depois da janela e NAO cria a pasta', () => {
  const { p, limpar } = pasta();
  try {
    const caminho = join(p, 'nao-existe', 'ultimo-sinal.txt');
    const avisos: string[] = [];
    let agora = T0;
    const marcar = criarMarcadorDoSinal({ caminho, agora: () => agora, avisar: (t) => avisos.push(t) });
    const antes = falhasDoSinal();

    assert.doesNotThrow(() => marcar());
    agora = T0 + 1_000;
    assert.doesNotThrow(() => marcar());
    assert.equal(falhasDoSinal() - antes, 1, 'dentro da janela nao tenta de novo: disco que falha nao leva uma tentativa por frame');

    agora = T0 + INTERVALO_DO_SINAL_MS;
    assert.doesNotThrow(() => marcar());
    assert.equal(falhasDoSinal() - antes, 2);

    assert.equal(avisos.length, 1, 'o aviso sai uma vez, nao a cada tentativa');
    assert.match(avisos[0] ?? '', /ENOENT/);
    assert.doesNotMatch(avisos[0] ?? '', new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'o aviso nao carrega caminho');
    assert.equal(existsSync(join(p, 'nao-existe')), false, 'o sinal nunca cria pasta');
  } finally {
    limpar();
  }
});

test('a escrita nao deixa temporario para tras', () => {
  const { p, limpar } = pasta();
  try {
    const caminho = join(p, 'ultimo-sinal.txt');
    criarMarcadorDoSinal({ caminho, agora: () => T0, avisar: () => undefined })();
    assert.equal(existsSync(`${caminho}.parcial`), false);
  } finally {
    limpar();
  }
});
