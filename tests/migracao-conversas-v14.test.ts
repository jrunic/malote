import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrar } from '../src/nucleo/migracao.js';
import { PLANO_DO_ACERVO } from '../src/nucleo/passos-do-acervo.js';

/**
 * FORMA CONGELADA da v13, escrita aqui e nao importada do schema fresco.
 *
 * Mesma regra que os passos seguem: derivar a base "antiga" do schema corrente
 * contamina os dois lados da comparacao, e o teste passa a nao medir nada — foi
 * o defeito de fixture que o ciclo 14 pagou em 01/09/2026.
 *
 * `baseNaForma` de `migracao.test.ts` nao serve: ela monta uma base sintetica
 * com tabela `dados`, sem `conversas`.
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
    -- fonte e bruto: a cadeia continua ate o passo 18 -> 19 (Direcao da
    -- Mensagem, WhatsApp), que le as duas. Acrescentadas pelo mesmo motivo
    -- das tabelas de identidade acima.
    fonte       TEXT,
    bruto       TEXT,
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

interface Semente {
  id: string;
  idExterno: string;
  coletiva: 0 | 1;
  fonte?: string;
  mensagens?: number;
}

function baseV13(sementes: readonly Semente[]): Database.Database {
  const db = new Database(':memory:');
  db.exec(V13);
  db.prepare('INSERT INTO versao_schema (versao) VALUES (13)').run();
  for (const s of sementes) {
    db.prepare(
      `INSERT INTO conversas (id, fonte, id_externo, coletiva, criada_em, bruto)
       VALUES (?, ?, ?, ?, '2026-09-08T00:00:00Z', NULL)`,
    ).run(s.id, s.fonte ?? 'whatsapp', s.idExterno, s.coletiva);
    for (let i = 0; i < (s.mensagens ?? 0); i += 1) {
      db.prepare('INSERT INTO mensagens (id, conversa_id) VALUES (?, ?)').run(`${s.id}-m${i}`, s.id);
    }
  }
  return db;
}

const CFG_WHATSAPP = { id: 'cfg-1', fonte: 'whatsapp' };

/**
 * A Configuracao vive no REGISTRO, e migrar acontece ao ABRIR o Acervo para
 * escrita — quem abre nem sempre tem o Registro, e o ouvinte nao tem. Passo que
 * exige contexto e nao o recebe RECUSA, em vez de escolher uma Configuracao.
 */
test('o passo 13 -> 14 RECUSA sem contexto, em vez de escolher uma Configuracao', () => {
  const db = baseV13([{ id: 'c1', idExterno: '5565@s.whatsapp.net', coletiva: 0, mensagens: 1 }]);
  try {
    assert.throws(() => migrar(db, 'acervo-de-teste', PLANO_DO_ACERVO), /acervo migrar/);
    assert.equal(
      (db.prepare('SELECT versao FROM versao_schema').get() as { versao: number }).versao,
      13,
      'a forma subiu mesmo com o passo recusando',
    );
  } finally {
    db.close();
  }
});

test('o passo preenche a direta, deixa a coletiva nula e nao perde linha', () => {
  // A terceira semente e uma Conversa direta SEM Mensagem. Sao 706 no Acervo
  // real, medidas em 08/09/2026, e sao invisiveis para qualquer conferencia
  // que conte Mensagens — a classe que um rebuild descuidado perde calado.
  const db = baseV13([
    { id: 'c1', idExterno: '5565@s.whatsapp.net', coletiva: 0, mensagens: 3 },
    { id: 'c2', idExterno: '120@g.us', coletiva: 1, mensagens: 2 },
    { id: 'c3', idExterno: '5566@s.whatsapp.net', coletiva: 0, mensagens: 0 },
  ]);
  try {
    migrar(db, 'acervo-de-teste', PLANO_DO_ACERVO, { configuracoes: [CFG_WHATSAPP] });

    const linhas = db
      .prepare('SELECT id, coletiva, configuracao_id FROM conversas ORDER BY id')
      .all() as { id: string; coletiva: number; configuracao_id: string | null }[];
    assert.equal(linhas.length, 3, 'a Conversa sem Mensagem sumiu no rebuild');
    assert.equal(linhas[0]?.configuracao_id, 'cfg-1');
    assert.equal(linhas[1]?.configuracao_id, null, 'coletiva ganhou Configuracao');
    assert.equal(linhas[2]?.configuracao_id, 'cfg-1', 'direta vazia ficou sem Configuracao');
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM mensagens').get() as { n: number }).n,
      5,
      'o rebuild levou Mensagem junto',
    );
  } finally {
    db.close();
  }
});

/**
 * Atribuir a unica Configuracao que existe funcionaria hoje e mentiria no dia
 * em que o Instagram entrar. O passo mede as Fontes ANTES de preencher.
 */
test('o passo RECUSA quando ha Conversa de Fonte sem Configuracao correspondente', () => {
  const db = baseV13([
    { id: 'c1', idExterno: 'perfil', coletiva: 0, fonte: 'instagram', mensagens: 1 },
  ]);
  try {
    assert.throws(
      () => migrar(db, 'acervo-de-teste', PLANO_DO_ACERVO, { configuracoes: [CFG_WHATSAPP] }),
      /instagram/,
    );
  } finally {
    db.close();
  }
});

/**
 * Este passo e DDL congelado: roda em qualquer v13 para sempre, inclusive num
 * Registro que ja tenha DUAS Configuracoes de WhatsApp. Um mapa de valor unico
 * faria a ultima vencer em silencio, e TODAS as diretas iriam para ela.
 */
test('o passo RECUSA quando a Fonte tem MAIS DE UMA Configuracao', () => {
  const db = baseV13([{ id: 'c1', idExterno: '5565@s.whatsapp.net', coletiva: 0, mensagens: 1 }]);
  try {
    assert.throws(
      () =>
        migrar(db, 'acervo-de-teste', PLANO_DO_ACERVO, {
          configuracoes: [CFG_WHATSAPP, { id: 'cfg-2', fonte: 'whatsapp' }],
        }),
      /mais de uma|2 Configuracoes/i,
    );
  } finally {
    db.close();
  }
});

/**
 * O TESTE QUE FALTAVA, e o mutante o revelou.
 *
 * Os quatro acima medem o ESTADO logo depois do passo, e todos sobreviveram a
 * um mutante que deixava a restricao `UNIQUE (fonte, id_externo)` embutida na
 * tabela nova. Com ela viva, os dois indices parciais existem, as contagens
 * batem, o preenchimento esta certo — e a segunda Conversa direta continua
 * recusada pela chave velha. O defeito so aparece ESCREVENDO depois de migrar.
 *
 * E o mesmo desfecho que a spec descreve para o aceite: suite verde, criterio 1
 * reprovando so contra o Acervo real.
 */
test('depois de migrar, duas diretas com o mesmo endereco e Configuracoes diferentes ENTRAM', () => {
  const db = baseV13([{ id: 'c1', idExterno: '5565@s.whatsapp.net', coletiva: 0, mensagens: 1 }]);
  try {
    migrar(db, 'acervo-de-teste', PLANO_DO_ACERVO, { configuracoes: [CFG_WHATSAPP] });
    db.prepare(
      `INSERT INTO conversas (id, fonte, id_externo, coletiva, configuracao_id, criada_em, bruto)
       VALUES ('c2', 'whatsapp', '5565@s.whatsapp.net', 0, 'cfg-2', '2026-09-08T00:00:00Z', NULL)`,
    ).run();
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM conversas').get() as { n: number }).n,
      2,
      'a chave velha sobreviveu ao rebuild e recusou o segundo fio',
    );
  } finally {
    db.close();
  }
});
