import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { lerForma } from './ajuda/forma.js';

test('a forma é lida por estrutura, e não pelo texto do CREATE', () => {
  const a = new Database(':memory:');
  const b = new Database(':memory:');
  try {
    a.exec('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL);');
    // Mesma estrutura, texto diferente: IF NOT EXISTS, espacamento, quebra de
    // linha. Comparar `sqlite_master.sql` reprovaria; comparar estrutura, nao.
    b.exec('CREATE TABLE IF NOT EXISTS t (\n  id TEXT PRIMARY KEY,\n  n INTEGER NOT NULL\n);');
    assert.deepEqual(lerForma(a), lerForma(b));
  } finally {
    a.close();
    b.close();
  }
});

test('diferença estrutural real é vista', () => {
  const a = new Database(':memory:');
  const b = new Database(':memory:');
  try {
    a.exec('CREATE TABLE t (id TEXT PRIMARY KEY);');
    b.exec('CREATE TABLE t (id TEXT PRIMARY KEY, extra TEXT);');
    assert.notDeepEqual(lerForma(a), lerForma(b));
  } finally {
    a.close();
    b.close();
  }
});

test('gatilho entra na forma, normalizado em espaços', () => {
  const a = new Database(':memory:');
  const b = new Database(':memory:');
  try {
    const tabela = 'CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER);';
    a.exec(tabela);
    b.exec(tabela);
    a.exec(
      "CREATE TRIGGER g BEFORE UPDATE OF n ON t WHEN NEW.n < 0 BEGIN SELECT RAISE(ABORT, 'negativo'); END;",
    );
    b.exec(
      "CREATE TRIGGER IF NOT EXISTS g BEFORE UPDATE OF n ON t\n  WHEN NEW.n < 0\n  BEGIN SELECT RAISE(ABORT, 'negativo'); END;",
    );
    assert.deepEqual(lerForma(a), lerForma(b));
  } finally {
    a.close();
    b.close();
  }
});
