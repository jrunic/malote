import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  migrar,
  pendenciasDeMidia,
  baixarPendenciaDeMidia,
  type PassoDeMigracao,
  type PlanoDeMigracao,
} from '../src/nucleo/migracao.js';
import { cenario } from './ajuda/acervo.js';
import { criarAcervoNoPiso } from './ajuda/acervo-no-piso.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

function baseNaForma(versao: number): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE versao_schema (versao INTEGER NOT NULL);
    CREATE TABLE migracoes_aplicadas (
      de INTEGER NOT NULL, para INTEGER NOT NULL, descricao TEXT NOT NULL,
      aplicada_em TEXT NOT NULL, conferencia TEXT NOT NULL,
      midia_pendente TEXT, PRIMARY KEY (de, para)
    );
  `);
  db.prepare('INSERT INTO versao_schema (versao) VALUES (?)').run(versao);
  return db;
}

const comMidia: PassoDeMigracao = {
  de: 1,
  para: 2,
  descricao: 'passo que exige acao sobre os arquivos',
  aplicar: () => {},
  midiaPendente: 'reorganizar-subarvore-por-fonte',
};

const PLANO: PlanoDeMigracao = {
  nome: 'Teste',
  piso: 1,
  corrente: 2,
  passos: [comMidia],
  instrucaoAbaixoDoPiso: 'instrucao de teste',
};

test('a pendência é gravada na MESMA transação que muda o banco', () => {
  const db = baseNaForma(1);
  try {
    const r = migrar(db, ':memoria:', PLANO);
    assert.equal(r.passosAplicados[0]?.midiaPendente, 'reorganizar-subarvore-por-fonte');
    const abertas = pendenciasDeMidia(db);
    assert.equal(abertas.length, 1);
    assert.equal(abertas[0]?.acao, 'reorganizar-subarvore-por-fonte');
  } finally {
    db.close();
  }
});

test('a pendência sobrevive a quem morreu antes de executá-la', () => {
  const db = baseNaForma(1);
  try {
    migrar(db, ':memoria:', PLANO);
    // Ninguem executou a acao de arquivo: e a janela. Quem abrir a base DEPOIS
    // tem de encontrar a pendencia de pe — e nao um banco que se diz pronto
    // enquanto os arquivos estao na forma velha.
    assert.equal(pendenciasDeMidia(db).length, 1);
  } finally {
    db.close();
  }
});

test('baixar a pendência a fecha, e é idempotente', () => {
  const db = baseNaForma(1);
  try {
    migrar(db, ':memoria:', PLANO);
    baixarPendenciaDeMidia(db, 1, 2);
    assert.deepEqual(pendenciasDeMidia(db), []);
    baixarPendenciaDeMidia(db, 1, 2);
    assert.deepEqual(pendenciasDeMidia(db), [], 'baixar duas vezes não é erro');
  } finally {
    db.close();
  }
});

test('passo SEM ação de mídia não deixa pendência nenhuma', () => {
  const db = baseNaForma(1);
  try {
    migrar(db, ':memoria:', {
      ...PLANO,
      passos: [{ de: 1, para: 2, descricao: 'so banco', aplicar: () => {} }],
    });
    assert.deepEqual(pendenciasDeMidia(db), []);
  } finally {
    db.close();
  }
});

test('Acervo com pendência de mídia em aberto NÃO abre como se estivesse pronto', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Leia Organa');
    acervo.fechar();
    criarAcervoNoPiso(c.raiz, id);

    // Sobe normalmente — nenhum passo real deste ciclo mexe em midia.
    abrirAcervo(join(c.raiz, 'acervos'), id, { configuracoes: [CFG_WHATSAPP] }).fechar();

    // Agora forja uma pendencia, como a deixaria um passo de midia futuro que
    // fez o banco e morreu antes de mover os arquivos.
    const cru = new Database(join(c.raiz, 'acervos', `${id}.db`));
    cru.prepare('UPDATE migracoes_aplicadas SET midia_pendente = ? WHERE para = ?').run(
      'mover-subarvore',
      11,
    );
    cru.close();

    assert.throws(
      () => abrirAcervo(join(c.raiz, 'acervos'), id, { configuracoes: [CFG_WHATSAPP] }),
      (erro: unknown) => {
        assert.ok(erro instanceof Error);
        assert.match(erro.message, /pendente/i);
        assert.match(erro.message, /mover-subarvore/, 'a mensagem diz QUAL é a pendência');
        return true;
      },
    );
  } finally {
    c.limpar();
  }
});
