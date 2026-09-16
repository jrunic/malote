import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrar } from '../src/nucleo/migracao.js';
import { PLANO_DO_ACERVO } from '../src/nucleo/passos-do-acervo.js';

/**
 * FORMA CONGELADA da v13 — a mesma de `migracao-conversas-v14.test.ts`, e pelo
 * mesmo motivo: derivar a base antiga do schema corrente contamina os dois
 * lados da comparacao e o teste deixa de medir.
 */
const V13 = `
  CREATE TABLE versao_schema (versao INTEGER NOT NULL);
  CREATE TABLE migracoes_aplicadas (
    de INTEGER NOT NULL, para INTEGER NOT NULL, descricao TEXT NOT NULL,
    aplicada_em TEXT NOT NULL, conferencia TEXT NOT NULL,
    midia_pendente TEXT, PRIMARY KEY (de, para)
  );
  CREATE TABLE conversas (
    id          TEXT PRIMARY KEY,
    fonte       TEXT NOT NULL,
    id_externo  TEXT NOT NULL,
    coletiva    INTEGER NOT NULL DEFAULT 0,
    criada_em   TEXT NOT NULL,
    bruto       TEXT,
    UNIQUE (fonte, id_externo)
  );
  CREATE TABLE mensagens (
    id          TEXT PRIMARY KEY,
    conversa_id TEXT NOT NULL,
    FOREIGN KEY (conversa_id) REFERENCES conversas(id) ON DELETE CASCADE
  );
  -- As tabelas de identidade, na forma de ENTAO.
  --
  -- Nao sao usadas por este teste, e existem porque a CADEIA continua depois do
  -- passo que ele mede: o passo 15 -> 16 as reconstroi, e uma fixture sem elas
  -- representaria uma v13 que nao existe no mundo. Acrescentadas quando o passo
  -- 16 entrou, e a falta delas derrubou este arquivo.
  CREATE TABLE identificadores (
    id           TEXT PRIMARY KEY,
    fonte        TEXT NOT NULL,
    valor        TEXT NOT NULL,
    pessoa_id    TEXT,
    procedencia  TEXT,
    vinculado_em TEXT,
    visto_em     TEXT NOT NULL,
    UNIQUE (fonte, valor)
  );
  CREATE TABLE cartoes_de_catalogo (
    identificador_id TEXT NOT NULL,
    cartao           TEXT NOT NULL,
    visto_em         TEXT NOT NULL,
    PRIMARY KEY (identificador_id, cartao)
  );
  CREATE TABLE atribuicoes_de_nome (
    id               TEXT PRIMARY KEY,
    pessoa_id        TEXT,
    identificador_id TEXT,
    origem           TEXT NOT NULL,
    nome             TEXT NOT NULL,
    atribuido_em     TEXT NOT NULL
  );
`;

const CFG = { id: 'cfg-1', fonte: 'whatsapp' };

function baseV13(
  sementes: readonly { id: string; idExterno: string; coletiva: 0 | 1; mensagens?: number }[],
): Database.Database {
  const db = new Database(':memory:');
  db.exec(V13);
  db.prepare('INSERT INTO versao_schema (versao) VALUES (13)').run();
  for (const s of sementes) {
    db.prepare(
      `INSERT INTO conversas (id, fonte, id_externo, coletiva, criada_em, bruto)
       VALUES (?, 'whatsapp', ?, ?, '2026-09-08T00:00:00Z', NULL)`,
    ).run(s.id, s.idExterno, s.coletiva);
    for (let i = 0; i < (s.mensagens ?? 0); i += 1) {
      db.prepare('INSERT INTO mensagens (id, conversa_id) VALUES (?, ?)').run(`${s.id}-m${i}`, s.id);
    }
  }
  return db;
}

/**
 * Medido em 08/09/2026 contra o Acervo real: 11 Conversas de broadcast/status
 * marcadas DIRETA, contra 1.054 marcadas coletiva, e 29.035 Mensagens
 * penduradas nas 11. Nenhum dos 11 enderecos existe TAMBEM como coletiva — por
 * isso este passo vira, e nao funde.
 */
test('o passo 14 -> 15 vira broadcast e status para coletiva, e limpa a Configuracao', () => {
  const db = baseV13([
    { id: 'c1', idExterno: 'status@broadcast', coletiva: 0, mensagens: 4 },
    { id: 'c2', idExterno: '1681043162@broadcast', coletiva: 0, mensagens: 1 },
    { id: 'c3', idExterno: '556599344486@status', coletiva: 0, mensagens: 2 },
    { id: 'c4', idExterno: '160094922797102@lid.status', coletiva: 0, mensagens: 1 },
  ]);
  try {
    migrar(db, 'acervo-de-teste', PLANO_DO_ACERVO, { configuracoes: [CFG] });
    const linhas = db
      .prepare('SELECT id, coletiva, configuracao_id FROM conversas ORDER BY id')
      .all() as { id: string; coletiva: number; configuracao_id: string | null }[];
    assert.equal(linhas.length, 4, 'perdeu Conversa');
    for (const l of linhas) {
      assert.equal(l.coletiva, 1, `${l.id} continuou direta`);
      assert.equal(l.configuracao_id, null, `${l.id} manteve Configuracao sendo coletiva`);
    }
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM mensagens').get() as { n: number }).n,
      8,
      'as Mensagens penduradas nas viradas se perderam',
    );
  } finally {
    db.close();
  }
});

test('o passo NAO alarga: conversa direta comum e grupo ficam como estao', () => {
  const db = baseV13([
    { id: 'd1', idExterno: '5565999999999@s.whatsapp.net', coletiva: 0, mensagens: 3 },
    { id: 'g1', idExterno: '120363000000000001@g.us', coletiva: 1, mensagens: 2 },
    // O caso que quase casa e NAO pode casar: `status` no meio, nao no fim.
    { id: 'd2', idExterno: 'status@s.whatsapp.net', coletiva: 0, mensagens: 1 },
  ]);
  try {
    migrar(db, 'acervo-de-teste', PLANO_DO_ACERVO, { configuracoes: [CFG] });
    const linhas = db
      .prepare('SELECT id, coletiva, configuracao_id FROM conversas ORDER BY id')
      .all() as { id: string; coletiva: number; configuracao_id: string | null }[];
    assert.deepEqual(
      linhas.map((l) => [l.id, l.coletiva, l.configuracao_id]),
      [
        ['d1', 0, 'cfg-1'],
        ['d2', 0, 'cfg-1'],
        ['g1', 1, null],
      ],
    );
  } finally {
    db.close();
  }
});

test('reaplicar o plano sobre uma base ja na forma 15 nao muda nada', () => {
  const db = baseV13([{ id: 'c1', idExterno: 'status@broadcast', coletiva: 0, mensagens: 4 }]);
  try {
    migrar(db, 'acervo-de-teste', PLANO_DO_ACERVO, { configuracoes: [CFG] });
    const antes = db.prepare('SELECT id, coletiva, configuracao_id FROM conversas').all();
    migrar(db, 'acervo-de-teste', PLANO_DO_ACERVO, { configuracoes: [CFG] });
    assert.deepEqual(db.prepare('SELECT id, coletiva, configuracao_id FROM conversas').all(), antes);
  } finally {
    db.close();
  }
});
