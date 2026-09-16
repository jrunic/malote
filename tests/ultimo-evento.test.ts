import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lerUltimoEvento, marcarUltimoEvento } from '../src/cli/ultimo-evento.js';

test('marcar grava o instante, e ler devolve o que foi gravado', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-ue-'));
  try {
    const caminho = join(pasta, 'ultimo-evento.txt');
    assert.equal(lerUltimoEvento(caminho), null, 'ausencia nao e erro: e ouvinte que nunca rodou');
    marcarUltimoEvento(caminho, Date.parse('2026-09-02T12:00:00Z'));
    assert.equal(lerUltimoEvento(caminho), Date.parse('2026-09-02T12:00:00Z'));
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('a escrita nao deixa arquivo parcial para o verificador', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-ue-'));
  try {
    // Quem le este arquivo e um verificador de FORA, e leitura concorrente com
    // escrita direta devolve linha pela metade — que se le como instante
    // invalido, nao como erro. Por isso temporario mais renomeacao: no sistema
    // de arquivos, quem le ve a versao antiga inteira ou a nova inteira.
    const caminho = join(pasta, 'ultimo-evento.txt');
    marcarUltimoEvento(caminho, Date.now());
    marcarUltimoEvento(caminho, Date.now());
    const sobrando = readdirSync(pasta).filter((n) => n.endsWith('.parcial'));
    assert.deepEqual(sobrando, [], 'nenhum temporario fica para tras');
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('conteudo ilegivel devolve null, e nao derruba quem le', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-ue-'));
  try {
    const caminho = join(pasta, 'ultimo-evento.txt');
    writeFileSync(caminho, 'nao e um instante\n');
    assert.equal(lerUltimoEvento(caminho), null);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});
