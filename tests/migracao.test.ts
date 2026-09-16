import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  migrar,
  migrarComTrilha,
  MigracaoReprovadaError,
  FormaAbaixoDoPisoError,
  contarTabelas,
  type PlanoDeMigracao,
  type PassoDeMigracao,
} from '../src/nucleo/migracao.js';

const CONTABILIDADE = `
  CREATE TABLE migracoes_aplicadas (
    de INTEGER NOT NULL, para INTEGER NOT NULL, descricao TEXT NOT NULL,
    aplicada_em TEXT NOT NULL, conferencia TEXT NOT NULL,
    midia_pendente TEXT, PRIMARY KEY (de, para)
  );
`;

/** Base sintética na forma dada, com a contabilidade já presente. */
function baseNaForma(versao: number): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE versao_schema (versao INTEGER NOT NULL);
    ${CONTABILIDADE}
    CREATE TABLE dados (id INTEGER PRIMARY KEY, v TEXT);
    INSERT INTO dados (id, v) VALUES (1, 'a'), (2, 'b'), (3, 'c');
  `);
  db.prepare('INSERT INTO versao_schema (versao) VALUES (?)').run(versao);
  return db;
}

function plano(passos: PassoDeMigracao[]): PlanoDeMigracao {
  return {
    nome: 'Teste',
    piso: 1,
    corrente: 1 + passos.length,
    passos,
    instrucaoAbaixoDoPiso: 'instrucao de teste',
  };
}

function versaoDe(db: Database.Database): number {
  return (db.prepare('SELECT versao FROM versao_schema').get() as { versao: number }).versao;
}

function quantasLinhas(db: Database.Database, tabela: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM "${tabela}"`).get() as { n: number }).n;
}

const acrescentaColuna: PassoDeMigracao = {
  de: 1,
  para: 2,
  descricao: 'acrescenta coluna a tabela povoada',
  aplicar: (db) => db.exec('ALTER TABLE dados ADD COLUMN extra TEXT'),
};

test('a forma anterior sobe, e a contabilidade registra o passo', () => {
  const db = baseNaForma(1);
  try {
    const r = migrar(db, ':memoria:', plano([acrescentaColuna]));
    assert.equal(r.de, 1);
    assert.equal(r.para, 2);
    assert.equal(r.passosAplicados.length, 1);
    assert.equal(versaoDe(db), 2);
    const linha = db.prepare('SELECT conferencia FROM migracoes_aplicadas WHERE para = 2').get() as
      | { conferencia: string }
      | undefined;
    assert.ok(linha, 'o passo tem de deixar registro');
    assert.match(linha.conferencia, /^ok:/, 'a conferência fica gravada, não "pendente"');
  } finally {
    db.close();
  }
});

test('rodar de novo é no-op que se anuncia', () => {
  const db = baseNaForma(1);
  try {
    migrar(db, ':memoria:', plano([acrescentaColuna]));
    const antes = contarTabelas(db);
    const segunda = migrar(db, ':memoria:', plano([acrescentaColuna]));
    assert.equal(segunda.passosAplicados.length, 0);
    assert.equal(segunda.de, 2);
    assert.equal(segunda.para, 2);
    assert.deepEqual(contarTabelas(db), antes, 'a segunda execução não tocou em nada');
  } finally {
    db.close();
  }
});

test('falha NO MEIO deixa a base na forma de ORIGEM, com as contagens de origem', () => {
  const db = baseNaForma(1);
  try {
    const explode: PassoDeMigracao = {
      de: 2,
      para: 3,
      descricao: 'apaga uma linha e entao falha',
      aplicar: (bd) => {
        bd.exec('DELETE FROM dados WHERE id = 1');
        throw new Error('falha deliberada no meio do passo');
      },
    };
    assert.throws(
      () => migrar(db, ':memoria:', plano([acrescentaColuna, explode])),
      /falha deliberada/,
    );

    // A forma de ORIGEM, e nao "o ultimo passo completado": a transacao e por
    // EXECUCAO. O primeiro passo tinha completado e foi desfeito junto.
    assert.equal(versaoDe(db), 1);
    assert.equal(quantasLinhas(db, 'dados'), 3);
    const colunas = db.pragma('table_info("dados")') as { name: string }[];
    assert.ok(!colunas.some((c) => c.name === 'extra'), 'o passo 1 também foi desfeito');
    assert.equal(quantasLinhas(db, 'migracoes_aplicadas'), 0);
  } finally {
    db.close();
  }
});

test('perda de linha NÃO declarada reprova, e a base fica intacta', () => {
  const db = baseNaForma(1);
  try {
    const perde: PassoDeMigracao = {
      de: 1,
      para: 2,
      descricao: 'perde linha em silencio',
      aplicar: (bd) => bd.exec('DELETE FROM dados WHERE id = 1'),
    };
    assert.throws(
      () => migrar(db, ':memoria:', plano([perde])),
      (erro: unknown) => {
        assert.ok(erro instanceof MigracaoReprovadaError);
        assert.match(erro.message, /tabela dados/);
        return true;
      },
    );
    assert.equal(quantasLinhas(db, 'dados'), 3);
    assert.equal(versaoDe(db), 1);
  } finally {
    db.close();
  }
});

test('a MESMA perda, declarada pelo passo, passa', () => {
  const db = baseNaForma(1);
  try {
    const perde: PassoDeMigracao = {
      de: 1,
      para: 2,
      descricao: 'remove linha derivada, e diz que remove',
      aplicar: (bd) => bd.exec('DELETE FROM dados WHERE id = 1'),
      divergenciasEsperadas: [{ tabela: 'dados', delta: -1 }],
    };
    assert.equal(migrar(db, ':memoria:', plano([perde])).para, 2);
    assert.equal(quantasLinhas(db, 'dados'), 2);
  } finally {
    db.close();
  }
});

test('buraco na sequência de passos recusa ANTES de tocar na base', () => {
  const db = baseNaForma(1);
  try {
    const salta: PassoDeMigracao = {
      de: 2,
      para: 3,
      descricao: 'salta o 1 para 2',
      aplicar: () => {},
    };
    assert.throws(
      () => migrar(db, ':memoria:', { ...plano([]), corrente: 3, passos: [salta] }),
      /buraco/i,
    );
    assert.equal(versaoDe(db), 1);
  } finally {
    db.close();
  }
});

test('forma abaixo do piso recusa, com classe própria', () => {
  const db = baseNaForma(1);
  try {
    assert.throws(
      () => migrar(db, ':memoria:', { ...plano([]), piso: 2, corrente: 3, passos: [] }),
      FormaAbaixoDoPisoError,
    );
    assert.equal(versaoDe(db), 1);
  } finally {
    db.close();
  }
});

test('forma POSTERIOR à corrente recusa', () => {
  const db = baseNaForma(5);
  try {
    assert.throws(
      () => migrar(db, ':memoria:', { ...plano([]), corrente: 3, passos: [] }),
      /POSTERIOR/,
    );
  } finally {
    db.close();
  }
});

test('violação de chave HERDADA não aborta migração que não a causou', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE versao_schema (versao INTEGER NOT NULL);
      ${CONTABILIDADE}
      CREATE TABLE pai (id INTEGER PRIMARY KEY);
      CREATE TABLE filho (id INTEGER PRIMARY KEY, pai_id INTEGER REFERENCES pai(id));
    `);
    db.prepare('INSERT INTO versao_schema (versao) VALUES (1)').run();
    // Orfa PRE-EXISTENTE, com o enforcement desligado: e o estado de um banco
    // envelhecido, e e exatamente o que derrubou a API na V006 do jd-tasks.
    db.pragma('foreign_keys = OFF');
    db.exec('INSERT INTO filho (id, pai_id) VALUES (1, 99)');
    db.pragma('foreign_keys = ON');

    const r = migrar(
      db,
      ':memoria:',
      plano([
        {
          de: 1,
          para: 2,
          descricao: 'passo inocente',
          aplicar: (bd) => bd.exec('INSERT INTO pai (id) VALUES (1)'),
          divergenciasEsperadas: [{ tabela: 'pai', delta: 1 }],
        },
      ]),
    );
    assert.equal(r.para, 2, 'dano herdado não é dano próprio');
  } finally {
    db.close();
  }
});

test('violação de chave NOVA, causada pelo passo, reprova', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE versao_schema (versao INTEGER NOT NULL);
      ${CONTABILIDADE}
      CREATE TABLE pai (id INTEGER PRIMARY KEY);
      CREATE TABLE filho (id INTEGER PRIMARY KEY, pai_id INTEGER REFERENCES pai(id));
    `);
    db.prepare('INSERT INTO versao_schema (versao) VALUES (1)').run();

    assert.throws(
      () =>
        migrar(
          db,
          ':memoria:',
          plano([
            {
              de: 1,
              para: 2,
              // Recria a tabela referenciada: o enforcement fica desligado, e e
              // por isso que o orfao consegue entrar sem o SQLite reclamar na
              // hora. Quem tem de pega-lo e a comparacao contra a linha de base.
              descricao: 'passo que produz órfão',
              recriaTabelaReferenciada: true,
              aplicar: (bd) => bd.exec('INSERT INTO filho (id, pai_id) VALUES (1, 99)'),
              divergenciasEsperadas: [{ tabela: 'filho', delta: 1 }],
            },
          ]),
        ),
      (erro: unknown) => {
        assert.ok(erro instanceof MigracaoReprovadaError);
        assert.match(erro.message, /chave estrangeira/);
        return true;
      },
    );
    assert.equal((db.prepare('SELECT versao FROM versao_schema').get() as { versao: number }).versao, 1);
  } finally {
    db.close();
  }
});

test('migrarComTrilha sobre base JÁ corrente não abre Operação', () => {
  const db = baseNaForma(2);
  try {
    db.exec(`
      CREATE TABLE operacoes (
        id TEXT PRIMARY KEY, natureza TEXT NOT NULL, reversibilidade TEXT NOT NULL,
        ocorrida_em TEXT NOT NULL, desfaz_id TEXT, ator TEXT
      );
      CREATE TABLE linhas_de_efeito (
        id TEXT PRIMARY KEY, operacao_id TEXT NOT NULL, ordem INTEGER NOT NULL,
        natureza TEXT NOT NULL, tabela TEXT, chave TEXT, campo TEXT, antes TEXT, depois TEXT
      );
    `);

    // Exercita a PORTA, e nao a abertura: os dois abridores so a chamam quando
    // ha trabalho, entao um teste pela abertura nunca alcanca esta guarda.
    // Medido em 01/09/2026 — a versao anterior deste teste passava com a
    // guarda removida, porque o cenario nao chegava na linha.
    const r = migrarComTrilha(db, ':memoria:', plano([acrescentaColuna]));
    assert.equal(r.passosAplicados.length, 0);
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM operacoes').get() as { n: number }).n,
      0,
      'abertura sem trabalho não pode encher a trilha',
    );
  } finally {
    db.close();
  }
});

test('migrarComTrilha COM trabalho abre exatamente uma Operação', () => {
  const db = baseNaForma(1);
  try {
    db.exec(`
      CREATE TABLE operacoes (
        id TEXT PRIMARY KEY, natureza TEXT NOT NULL, reversibilidade TEXT NOT NULL,
        ocorrida_em TEXT NOT NULL, desfaz_id TEXT, ator TEXT
      );
      CREATE TABLE linhas_de_efeito (
        id TEXT PRIMARY KEY, operacao_id TEXT NOT NULL, ordem INTEGER NOT NULL,
        natureza TEXT NOT NULL, tabela TEXT, chave TEXT, campo TEXT, antes TEXT, depois TEXT
      );
    `);

    const r = migrarComTrilha(db, ':memoria:', {
      ...plano([]),
      corrente: 2,
      // Sem divergencia declarada para `operacoes`, e a razao MUDOU em
      // 03/09/2026. Antes, a Operacao era inserida ANTES de `migrar` tomar a
      // linha de base, e ja entrava na contagem de partida. Agora ela e
      // inserida DEPOIS de `migrar` retornar — porque uma migracao pode estar
      // alterando a propria tabela da trilha —, entao a conferencia, que roda
      // dentro de `migrar`, tambem nao a ve. A conclusao e a mesma e o
      // mecanismo e outro: declarar +1 aqui continua REPROVANDO a migracao.
      passos: [acrescentaColuna],
    });
    assert.equal(r.para, 2);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM operacoes WHERE natureza = 'migrar-base'").get() as {
        n: number;
      }).n,
      1,
    );
  } finally {
    db.close();
  }
});
