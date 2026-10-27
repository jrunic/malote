import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { criarAcervoNoPiso } from './ajuda/acervo-no-piso.js';
import { abrirAcervo, VERSAO_SCHEMA_ACERVO } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarIdentificador } from '../src/nucleo/escrita.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

test('o Acervo na v29 sobe para a v30 sem perder linha e ganha o Diario semeado, sem Chegada retroativa', () => {
  assert.equal(VERSAO_SCHEMA_ACERVO, 30);
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Padme');
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '120363000000000001@g.us', coletiva: true });
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565911110001@s.whatsapp.net' });
    // Reproduz a forma da v29: sem as tabelas do Diario, com a versao gravada 29.
    acervo.db.exec('DROP TABLE chegadas');
    acervo.db.exec('DROP TABLE diario_de_chegadas');
    acervo.db.prepare('UPDATE versao_schema SET versao = 29').run();
    acervo.fechar();

    const migrado = abrirAcervo(join(c.raiz, 'acervos'), id, { configuracoes: [CFG_WHATSAPP] });
    try {
      assert.equal((migrado.db.prepare('SELECT versao FROM versao_schema').get() as { versao: number }).versao, 30);
      assert.equal((migrado.db.prepare('SELECT COUNT(*) AS n FROM conversas').get() as { n: number }).n, 1, 'perdeu Conversa');
      assert.equal(
        (migrado.db.prepare('SELECT COUNT(*) AS n FROM identificadores').get() as { n: number }).n,
        1,
        'perdeu Identificador',
      );
      assert.deepEqual(migrado.db.prepare('SELECT seq, tipo, origem FROM chegadas').all(), [
        { seq: 1, tipo: 'inicio-do-diario', origem: null },
      ]);
      assert.equal((migrado.db.prepare('SELECT piso FROM diario_de_chegadas').get() as { piso: number }).piso, 1);
      const registro = migrado.db.prepare('SELECT conferencia FROM migracoes_aplicadas WHERE para = 30').get();
      assert.ok(registro, 'o passo 30 tem de deixar registro');
    } finally {
      migrado.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('o passo v30 e idempotente: Acervo fresco com a versao posta em 29 nao ganha segunda semente nem muda a epoca', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Padme');
    const antes = acervo.db.prepare('SELECT epoca, piso FROM diario_de_chegadas').get();
    acervo.db.prepare('UPDATE versao_schema SET versao = 29').run();
    acervo.fechar();
    const migrado = abrirAcervo(join(c.raiz, 'acervos'), id, { configuracoes: [CFG_WHATSAPP] });
    try {
      assert.deepEqual(migrado.db.prepare('SELECT epoca, piso FROM diario_de_chegadas').get(), antes);
      assert.equal((migrado.db.prepare('SELECT COUNT(*) AS n FROM chegadas').get() as { n: number }).n, 1);
    } finally {
      migrado.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('o Acervo criado ja na v30 e o migrado do piso nascem com a mesma semente (a equivalencia de forma compara estrutura, nao linhas)', () => {
  const c = cenario();
  try {
    const fresco = c.novoInquilino('Padme').acervo;
    const sementeFresca = fresco.db.prepare('SELECT seq, tipo, origem, conversa_id FROM chegadas').all();
    const pisoFresco = fresco.db.prepare('SELECT piso FROM diario_de_chegadas').get();
    fresco.fechar();

    const { id, acervo } = c.novoInquilino('Bail');
    acervo.fechar();
    criarAcervoNoPiso(c.raiz, id);
    const migrado = abrirAcervo(join(c.raiz, 'acervos'), id, { configuracoes: [CFG_WHATSAPP] });
    try {
      assert.deepEqual(migrado.db.prepare('SELECT seq, tipo, origem, conversa_id FROM chegadas').all(), sementeFresca);
      assert.deepEqual(migrado.db.prepare('SELECT piso FROM diario_de_chegadas').get(), pisoFresco);
    } finally {
      migrado.fechar();
    }
  } finally {
    c.limpar();
  }
});
