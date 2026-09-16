import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executar } from '../src/cli/index.js';

function rodarComEnv(
  dados: string,
  vars: Record<string, string>,
  argumentos: string[],
): { codigo: number; saida: string } {
  const linhas: string[] = [];
  const codigo = executar(argumentos, {
    dados,
    estado: dados,
    escrever: (t: string) => linhas.push(t),
    ...(vars.MALOTE_SERVIDOR !== undefined || vars.MALOTE_CHAVE_DE_ACESSO !== undefined
      ? { servidor: vars.MALOTE_SERVIDOR, chave: vars.MALOTE_CHAVE_DE_ACESSO }
      : {}),
  } as Parameters<typeof executar>[1]);
  return { codigo, saida: linhas.join('\n') };
}

test('escrita com modo rede recusa ANTES de abrir base e sem efeito em disco', () => {
  const dados = mkdtempSync(join(tmpdir(), 'malote-modo-'));
  try {
    const r = rodarComEnv(dados, { MALOTE_SERVIDOR: 'http://x', MALOTE_CHAVE_DE_ACESSO: 'k' },
      ['inquilino', 'criar', '--chave', 'v', '--titular', 'T']);
    assert.equal(r.codigo, 2);
    assert.match(r.saida, /LOCAL/);
    assert.equal(existsSync(join(dados, 'registro.db')), false, 'a invocacao abriu base');
  } finally {
    rmSync(dados, { recursive: true, force: true });
  }
});

test('sem servidor declarado, o modo e local — byte a byte como hoje', () => {
  const dados = mkdtempSync(join(tmpdir(), 'malote-modo-'));
  try {
    const r = rodarComEnv(dados, {}, ['buscar']);
    // `buscar` sem --inquilino recusa no modo local: e o comportamento de
    // hoje, e e ele que prova que nada de rede interferiu.
    assert.equal(r.codigo, 1);
    assert.match(r.saida, /--inquilino/);
  } finally {
    rmSync(dados, { recursive: true, force: true });
  }
});
