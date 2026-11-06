import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { criarAcervoNoPiso } from './ajuda/acervo-no-piso.js';
import { abrirAcervo, VERSAO_SCHEMA_ACERVO } from '../src/nucleo/acervo.js';
import { PASSOS_DO_ACERVO } from '../src/nucleo/passos-do-acervo.js';
import { marcarEnvioEnviado, registrarEnvio } from '../src/nucleo/envio.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

interface Coluna {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}

function colunaDaReferencia(db: import('better-sqlite3').Database): Coluna | undefined {
  return (db.prepare("SELECT name, type, \"notnull\", dflt_value FROM pragma_table_info('envios')").all() as Coluna[]).find(
    (c) => c.name === 'referencia_externa_da_mensagem',
  );
}

test('o Acervo na v31 sobe para a v32 com a Referencia Externa no Envio, sem perder Envio', () => {
  assert.equal(VERSAO_SCHEMA_ACERVO, 32);
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Teste');
    const pendente = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '556599991234@s.whatsapp.net' },
      conteudo: { tipo: 'texto', texto: 'um' },
    });
    const enviado = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '556599991235@s.whatsapp.net' },
      conteudo: { tipo: 'texto', texto: 'dois' },
    });
    marcarEnvioEnviado(acervo, enviado.envioId);
    // Reproduz a forma da v31: sem o indice e sem a coluna, com a versao gravada 31.
    acervo.db.exec('DROP INDEX envios_por_referencia');
    acervo.db.exec('ALTER TABLE envios DROP COLUMN referencia_externa_da_mensagem');
    acervo.db.prepare('UPDATE versao_schema SET versao = 31').run();
    assert.equal(colunaDaReferencia(acervo.db), undefined, 'a forma v31 nao deveria ter a coluna');
    acervo.fechar();

    const migrado = abrirAcervo(join(c.raiz, 'acervos'), id, { configuracoes: [CFG_WHATSAPP] });
    try {
      assert.equal((migrado.db.prepare('SELECT versao FROM versao_schema').get() as { versao: number }).versao, 32);
      const coluna = colunaDaReferencia(migrado.db);
      assert.ok(coluna, 'o passo nao criou a coluna');
      assert.equal(coluna.type, 'TEXT');
      assert.equal(coluna.notnull, 0, 'a coluna aceita nulo');
      assert.equal(coluna.dflt_value, null);
      const indice = migrado.db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'envios_por_referencia'")
        .get() as { sql: string } | undefined;
      assert.ok(indice, 'o passo nao criou o indice');
      assert.match(indice.sql, /WHERE referencia_externa_da_mensagem IS NOT NULL/, 'o indice tem de ser parcial');
      const linhas = migrado.db
        .prepare('SELECT id, estado, referencia_externa_da_mensagem AS ref FROM envios ORDER BY solicitada_em, id')
        .all() as Array<{ id: string; estado: string; ref: string | null }>;
      assert.equal(linhas.length, 2, 'perdeu Envio');
      const porId = new Map(linhas.map((l) => [l.id, l]));
      assert.equal(porId.get(pendente.envioId)?.estado, 'pendente');
      assert.equal(porId.get(enviado.envioId)?.estado, 'enviado');
      assert.equal(porId.get(enviado.envioId)?.ref, null, 'sem preenchimento retroativo');
      assert.equal(porId.get(pendente.envioId)?.ref, null);
      const registro = migrado.db
        .prepare('SELECT conferencia FROM migracoes_aplicadas WHERE para = 32')
        .get() as { conferencia: string } | undefined;
      assert.ok(registro, 'o passo 32 tem de deixar registro');
      assert.match(registro.conferencia, /^ok:/);
    } finally {
      migrado.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('o passo v32 e idempotente: aplicado de novo sobre a forma v32 nao falha nem muda nada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const passo = PASSOS_DO_ACERVO.find((p) => p.para === 32);
    assert.ok(passo, 'falta o passo 32');
    assert.equal(passo.de, 31);
    assert.equal(passo.exigeContexto, undefined, 'passo leve: nao exige contexto');
    assert.equal(passo.tabelasNovas, undefined);
    const antes = acervo.db.prepare("SELECT name, sql FROM sqlite_master WHERE tbl_name = 'envios' ORDER BY name").all();
    passo.aplicar(acervo.db, {} as never);
    passo.aplicar(acervo.db, {} as never);
    const depois = acervo.db.prepare("SELECT name, sql FROM sqlite_master WHERE tbl_name = 'envios' ORDER BY name").all();
    assert.deepEqual(depois, antes);
  } finally {
    c.limpar();
  }
});

test('o Acervo criado do piso passa pela cadeia inteira e termina com a coluna e o indice', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Teste');
    acervo.fechar();
    criarAcervoNoPiso(c.raiz, id);
    const migrado = abrirAcervo(join(c.raiz, 'acervos'), id, { configuracoes: [CFG_WHATSAPP] });
    try {
      assert.ok(colunaDaReferencia(migrado.db));
      assert.ok(migrado.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'envios_por_referencia'").get());
    } finally {
      migrado.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('o Acervo novo tem o indice parcial e a coluna que aceita nulo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const coluna = colunaDaReferencia(acervo.db);
    assert.ok(coluna);
    assert.equal(coluna.notnull, 0);
    const indice = acervo.db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'envios_por_referencia'")
      .get() as { sql: string } | undefined;
    assert.ok(indice, 'o schema fresco nao tem o indice');
    assert.match(indice.sql, /WHERE referencia_externa_da_mensagem IS NOT NULL/, 'o indice tem de ser parcial');
  } finally {
    c.limpar();
  }
});
