import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

test('o runner de testes executa TypeScript', () => {
  const dobro = (n: number): number => n * 2;
  assert.equal(dobro(21), 42);
});

test('better-sqlite3 abre banco em memória e responde consulta', () => {
  const db = new Database(':memory:');
  const linha = db.prepare('SELECT 1 AS um').get() as { um: number };
  assert.equal(linha.um, 1);
  db.close();
});
