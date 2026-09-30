import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { criarAcervoNoPiso } from './ajuda/acervo-no-piso.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { migrar } from '../src/nucleo/migracao.js';
import { PASSOS_DO_ACERVO, PLANO_DO_ACERVO } from '../src/nucleo/passos-do-acervo.js';
import { VERSAO_SCHEMA_ACERVO } from '../src/nucleo/schema-acervo.js';

/** Sobe a base do piso ate 21 — um passo antes do novo — com plano truncado. */
function abrirNaFormaV21(caminho: string): Database.Database {
  const db = new Database(caminho);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const planoAte21 = {
    ...PLANO_DO_ACERVO,
    corrente: 21,
    passos: PASSOS_DO_ACERVO.filter((p) => p.para <= 21),
  };
  migrar(db, caminho, planoAte21, { configuracoes: [CFG_WHATSAPP] });
  return db;
}

const AGORA = new Date().toISOString();

test('Conversa @status SEM Mensagem e removida, com participacao e metadados', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Ahsoka');
    acervo.fechar();
    criarAcervoNoPiso(c.raiz, id);
    const caminho = join(c.raiz, 'acervos', `${id}.db`);
    const db = abrirNaFormaV21(caminho);
    try {
      db.prepare(
        `INSERT INTO conversas (id, fonte, id_externo, coletiva, criada_em, bruto)
         VALUES ('cf1', 'whatsapp', '556599344486@status', 1, ?, ?)`,
      ).run(AGORA, JSON.stringify({ ZSESSIONTYPE: 3, ZCONTACTIDENTIFIER: '556599344486@status' }));
      db.prepare(
        `INSERT INTO metadados_de_coletiva (conversa_id) VALUES ('cf1')`,
      ).run();
      db.prepare(
        `INSERT INTO identificadores (id, fonte, valor, visto_em) VALUES ('id1', 'whatsapp', '5511999990001@s.whatsapp.net', ?)`,
      ).run(AGORA);
      db.prepare(
        `INSERT INTO participacoes (conversa_id, identificador_id, observada_em)
         VALUES ('cf1', 'id1', ?)`,
      ).run(AGORA);

      const r = migrar(db, caminho, PLANO_DO_ACERVO, { configuracoes: [CFG_WHATSAPP] });
      assert.equal(r.para, VERSAO_SCHEMA_ACERVO);

      assert.equal(
        db.prepare('SELECT 1 FROM conversas WHERE id = ?').get('cf1'),
        undefined,
        'a Conversa fantasma foi removida',
      );
      assert.equal(
        db.prepare('SELECT 1 FROM metadados_de_coletiva WHERE conversa_id = ?').get('cf1'),
        undefined,
        'os metadados cascatearam',
      );
      assert.equal(
        db.prepare('SELECT 1 FROM participacoes WHERE conversa_id = ?').get('cf1'),
        undefined,
        'a participacao cascateou',
      );
    } finally {
      db.close();
    }
  } finally {
    c.limpar();
  }
});

test('Conversa @lid.status (forma LID) SEM Mensagem tambem e removida', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Ahsoka');
    acervo.fechar();
    criarAcervoNoPiso(c.raiz, id);
    const caminho = join(c.raiz, 'acervos', `${id}.db`);
    const db = abrirNaFormaV21(caminho);
    try {
      db.prepare(
        `INSERT INTO conversas (id, fonte, id_externo, coletiva, criada_em, bruto)
         VALUES ('cf2', 'whatsapp', '81999549198343@lid.status', 1, ?, ?)`,
      ).run(AGORA, JSON.stringify({ ZSESSIONTYPE: 3, ZCONTACTJID: '81999549198343@lid.status' }));
      db.prepare(`INSERT INTO metadados_de_coletiva (conversa_id) VALUES ('cf2')`).run();

      migrar(db, caminho, PLANO_DO_ACERVO, { configuracoes: [CFG_WHATSAPP] });

      assert.equal(
        db.prepare('SELECT 1 FROM conversas WHERE id = ?').get('cf2'),
        undefined,
        'a Conversa fantasma na forma LID foi removida',
      );
    } finally {
      db.close();
    }
  } finally {
    c.limpar();
  }
});

test('Conversa @status COM Mensagem e PRESERVADA — nao e chat, mas nao se perde dado', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Ahsoka');
    acervo.fechar();
    criarAcervoNoPiso(c.raiz, id);
    const caminho = join(c.raiz, 'acervos', `${id}.db`);
    const db = abrirNaFormaV21(caminho);
    try {
      db.prepare(
        `INSERT INTO conversas (id, fonte, id_externo, coletiva, criada_em, bruto)
         VALUES ('cf3', 'whatsapp', '556596068218@status', 1, ?, ?)`,
      ).run(AGORA, JSON.stringify({ ZSESSIONTYPE: 3 }));
      db.prepare(`INSERT INTO metadados_de_coletiva (conversa_id) VALUES ('cf3')`).run();
      db.prepare(
        `INSERT INTO mensagens (id, conversa_id, fonte, id_externo, ocorrida_em)
         VALUES ('mf1', 'cf3', 'whatsapp', 'mf1', 1000)`,
      ).run();

      migrar(db, caminho, PLANO_DO_ACERVO, { configuracoes: [CFG_WHATSAPP] });

      assert.notEqual(
        db.prepare('SELECT 1 FROM conversas WHERE id = ?').get('cf3'),
        undefined,
        'a Conversa com Mensagem NAO e removida',
      );
      assert.notEqual(
        db.prepare('SELECT 1 FROM mensagens WHERE id = ?').get('mf1'),
        undefined,
      );
    } finally {
      db.close();
    }
  } finally {
    c.limpar();
  }
});

test('grupo real (ZSESSIONTYPE=1) e @g.us sem ZSESSIONTYPE NAO sao tocados', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Ahsoka');
    acervo.fechar();
    criarAcervoNoPiso(c.raiz, id);
    const caminho = join(c.raiz, 'acervos', `${id}.db`);
    const db = abrirNaFormaV21(caminho);
    try {
      db.prepare(
        `INSERT INTO conversas (id, fonte, id_externo, coletiva, criada_em, bruto)
         VALUES ('grp1', 'whatsapp', '120363000000000001@g.us', 1, ?, ?)`,
      ).run(AGORA, JSON.stringify({ ZSESSIONTYPE: 1 }));
      db.prepare(`INSERT INTO metadados_de_coletiva (conversa_id) VALUES ('grp1')`).run();
      // Grupo real ao vivo: nasce sem ZSESSIONTYPE nenhum no bruto (forma
      // ChaveRecebida, nao ZWACHATSESSION do backup).
      db.prepare(
        `INSERT INTO conversas (id, fonte, id_externo, coletiva, criada_em, bruto)
         VALUES ('grp2', 'whatsapp', '120363000000000002@g.us', 1, ?, ?)`,
      ).run(AGORA, JSON.stringify({ remoteJid: '120363000000000002@g.us' }));
      db.prepare(`INSERT INTO metadados_de_coletiva (conversa_id) VALUES ('grp2')`).run();

      migrar(db, caminho, PLANO_DO_ACERVO, { configuracoes: [CFG_WHATSAPP] });

      assert.notEqual(db.prepare('SELECT 1 FROM conversas WHERE id = ?').get('grp1'), undefined);
      assert.notEqual(db.prepare('SELECT 1 FROM conversas WHERE id = ?').get('grp2'), undefined);
    } finally {
      db.close();
    }
  } finally {
    c.limpar();
  }
});

test('base sem NENHUMA candidata sobe a forma sem trabalho (delta zero declarado)', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Ahsoka');
    acervo.fechar();
    criarAcervoNoPiso(c.raiz, id);
    const caminho = join(c.raiz, 'acervos', `${id}.db`);
    const db = abrirNaFormaV21(caminho);
    try {
      const r = migrar(db, caminho, PLANO_DO_ACERVO, { configuracoes: [CFG_WHATSAPP] });
      assert.equal(r.para, VERSAO_SCHEMA_ACERVO);
    } finally {
      db.close();
    }
  } finally {
    c.limpar();
  }
});
