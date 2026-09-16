import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { contarTabelas, conferir } from '../src/nucleo/migracao.js';

function bancoComDuasTabelas(): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE a (id INTEGER PRIMARY KEY); CREATE TABLE b (id INTEGER PRIMARY KEY);');
  db.exec('INSERT INTO a (id) VALUES (1), (2), (3); INSERT INTO b (id) VALUES (1);');
  return db;
}

test('contagem ignora as tabelas internas do SQLite', () => {
  const db = bancoComDuasTabelas();
  try {
    const contagem = contarTabelas(db);
    assert.deepEqual([...contagem.keys()].sort(), ['a', 'b']);
    assert.equal(contagem.get('a'), 3);
  } finally {
    db.close();
  }
});

test('nenhuma mudança de contagem passa', () => {
  const db = bancoComDuasTabelas();
  try {
    const antes = contarTabelas(db);
    assert.deepEqual(conferir(antes, contarTabelas(db), []), []);
  } finally {
    db.close();
  }
});

test('linha perdida sem declaração REPROVA, e a queixa nomeia a tabela', () => {
  const db = bancoComDuasTabelas();
  try {
    const antes = contarTabelas(db);
    db.exec('DELETE FROM a WHERE id = 3');
    const queixas = conferir(antes, contarTabelas(db), []);
    assert.equal(queixas.length, 1);
    assert.match(queixas[0] ?? '', /tabela a:/);
  } finally {
    db.close();
  }
});

test('a MESMA perda, declarada, passa', () => {
  const db = bancoComDuasTabelas();
  try {
    const antes = contarTabelas(db);
    db.exec('DELETE FROM a WHERE id = 3');
    assert.deepEqual(conferir(antes, contarTabelas(db), [{ tabela: 'a', delta: -1 }]), []);
  } finally {
    db.close();
  }
});

test('divergência declarada MAIOR que a real também reprova', () => {
  const db = bancoComDuasTabelas();
  try {
    const antes = contarTabelas(db);
    db.exec('DELETE FROM a WHERE id = 3');
    // Declarou -2 e removeu -1: a declaracao e contrato, nao teto. Sem esta
    // asserção, um passo poderia declarar uma perda enorme e esconder qualquer
    // perda menor dentro dela.
    assert.equal(conferir(antes, contarTabelas(db), [{ tabela: 'a', delta: -2 }]).length, 1);
  } finally {
    db.close();
  }
});

test('tabela nova não declarada reprova; declarada, passa', () => {
  const db = bancoComDuasTabelas();
  try {
    const antes = contarTabelas(db);
    db.exec('CREATE TABLE c (id INTEGER PRIMARY KEY)');
    assert.equal(conferir(antes, contarTabelas(db), []).length, 1);
    assert.deepEqual(conferir(antes, contarTabelas(db), [], ['c']), []);
  } finally {
    db.close();
  }
});

test('tabela que SOME sempre reprova, ainda que a divergência seja declarada', () => {
  const db = bancoComDuasTabelas();
  try {
    const antes = contarTabelas(db);
    db.exec('DROP TABLE b');
    // Sumir nao e esvaziar, e nenhuma declaracao de delta cobre isso.
    assert.equal(conferir(antes, contarTabelas(db), [{ tabela: 'b', delta: -1 }]).length, 1);
  } finally {
    db.close();
  }
});
