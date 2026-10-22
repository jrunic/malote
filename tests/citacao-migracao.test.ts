import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { criarAcervoNoPiso } from './ajuda/acervo-no-piso.js';
import Database from 'better-sqlite3';
import { abrirAcervo, VERSAO_SCHEMA_ACERVO } from '../src/nucleo/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const COLUNAS_NOVAS = ['citada_id_externo', 'citada_autor_id', 'citada_direcao'];

test('o Acervo na v29 e o schema da Citacao: tres colunas novas na Mensagem e o indice parcial do vinculo tardio', () => {
  assert.equal(VERSAO_SCHEMA_ACERVO, 29);
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Padme');
    acervo.fechar();
    // Do piso, a cadeia inteira de passos roda: o ultimo e o que acrescenta a Citacao.
    criarAcervoNoPiso(c.raiz, id);
    const migrado = abrirAcervo(join(c.raiz, 'acervos'), id, { configuracoes: [CFG_WHATSAPP] });
    try {
      const colunas = (migrado.db.prepare('PRAGMA table_info(mensagens)').all() as Array<{ name: string }>).map((l) => l.name);
      for (const nome of COLUNAS_NOVAS) assert.ok(colunas.includes(nome), `falta a coluna ${nome}`);
      const indice = migrado.db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'mensagens_por_citada_externa'")
        .get() as { sql: string } | undefined;
      assert.ok(indice, 'falta o indice do vinculo tardio');
      assert.match(indice.sql, /WHERE citada_id_externo IS NOT NULL/, 'o indice tem de ser parcial');
      const chaves = migrado.db.prepare('PRAGMA foreign_key_list(mensagens)').all() as Array<{ from: string; table: string; on_delete: string }>;
      const doAutorDaCitada = chaves.find((k) => k.from === 'citada_autor_id');
      assert.equal(doAutorDaCitada?.table, 'identificadores', 'o autor da citada tem chave estrangeira');
      assert.equal(doAutorDaCitada?.on_delete, 'SET NULL');
      const passo = migrado.db
        .prepare('SELECT conferencia FROM migracoes_aplicadas WHERE para = 29')
        .get() as { conferencia: string } | undefined;
      assert.ok(passo, 'o passo 29 tem de deixar registro');
      assert.match(passo.conferencia, /^ok:/);
    } finally {
      migrado.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('a direcao da citada recusa valor fora de enviada e recebida', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    try {
      acervo.db.exec(
        "INSERT INTO conversas (id, fonte, id_externo, coletiva, criada_em) VALUES ('c1', 'whatsapp', 'x@g.us', 1, '2026-01-01T00:00:00Z')",
      );
      assert.throws(
        () =>
          acervo.db.exec(
            "INSERT INTO mensagens (id, conversa_id, fonte, id_externo, ocorrida_em, direcao, citada_direcao) " +
              "VALUES ('m1', 'c1', 'whatsapp', 'E1', 1, 'recebida', 'talvez')",
          ),
        /CHECK/,
      );
    } finally {
      acervo.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('uma Mensagem gravada antes da migracao sobrevive a ela, com a Citacao nula', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Padme');
    acervo.fechar();
    criarAcervoNoPiso(c.raiz, id);
    const caminho = join(c.raiz, 'acervos', `${id}.db`);
    const antes = new Database(caminho);
    try {
      antes.exec(`
        INSERT INTO conversas (id, fonte, id_externo, coletiva, criada_em) VALUES ('c1', 'whatsapp', '120363000000000001@g.us', 1, '2026-01-01T00:00:00Z');
        INSERT INTO mensagens (id, conversa_id, fonte, id_externo, conteudo, ocorrida_em, citada_id, bruto)
          VALUES ('m1', 'c1', 'whatsapp', 'E1', 'texto sintetico', 1790000000000, 'm0', '{"key":{"fromMe":false}}');
      `);
    } finally {
      antes.close();
    }

    const migrado = abrirAcervo(join(c.raiz, 'acervos'), id, { configuracoes: [CFG_WHATSAPP] });
    try {
      const m = migrado.db
        .prepare('SELECT conteudo, citada_id, citada_id_externo, citada_autor_id, citada_direcao FROM mensagens WHERE id = ?')
        .get('m1') as Record<string, unknown>;
      assert.deepEqual(m, {
        conteudo: 'texto sintetico',
        citada_id: 'm0',
        citada_id_externo: null,
        citada_autor_id: null,
        citada_direcao: null,
      });
    } finally {
      migrado.fechar();
    }
  } finally {
    c.limpar();
  }
});
