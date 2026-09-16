import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, VERSAO_SCHEMA_REGISTRO } from '../src/registro/registro.js';

test('abrir o Registro cria o arquivo e aplica o schema na versão corrente', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    assert.ok(existsSync(join(raiz, 'registro.db')));
    assert.equal(registro.versaoDoSchema(), VERSAO_SCHEMA_REGISTRO);
    registro.fechar();
  } finally {
    limpar();
  }
});

test('abrir o Registro duas vezes é idempotente e não perde dado', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const primeiro = abrirRegistro(raiz);
    primeiro.fechar();
    const segundo = abrirRegistro(raiz);
    assert.equal(segundo.versaoDoSchema(), VERSAO_SCHEMA_REGISTRO);
    segundo.fechar();
  } finally {
    limpar();
  }
});

test('o Registro nasce com integridade referencial ligada', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const linha = registro.db.pragma('foreign_keys', { simple: true });
    assert.equal(linha, 1);
    registro.fechar();
  } finally {
    limpar();
  }
});
