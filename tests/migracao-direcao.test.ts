import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { cenario } from './ajuda/acervo.js';
import { criarAcervoNoPiso } from './ajuda/acervo-no-piso.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

test('passo 18->19 preenche Direcao do WhatsApp a partir do bruto — material e ao vivo', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Padme');
    acervo.fechar();
    criarAcervoNoPiso(c.raiz, id); // piso = forma 10; sobe por TODOS os passos

    const db = new Database(join(c.raiz, 'acervos', `${id}.db`));
    // Fixture direto no banco, na FORMA DO PISO (sem coluna direcao ainda) —
    // é exatamente a situação real: Mensagem gravada antes desta mudança.
    db.exec(`
      INSERT INTO conversas (id, fonte, id_externo, coletiva, criada_em)
      VALUES ('conversa-1', 'whatsapp', 'conversa-1@s.whatsapp.net', 0, '2026-01-01T00:00:00.000Z');
      INSERT INTO mensagens (id, conversa_id, fonte, id_externo, ocorrida_em, bruto)
      VALUES
        ('m-material-enviada', 'conversa-1', 'whatsapp', 'ext-1', 1700000000000, '{"ZISFROMME":1}'),
        ('m-material-recebida', 'conversa-1', 'whatsapp', 'ext-2', 1700000001000, '{"ZISFROMME":0}'),
        ('m-ao-vivo-enviada', 'conversa-1', 'whatsapp', 'ext-3', 1700000002000, '{"key":{"fromMe":true}}'),
        ('m-ao-vivo-recebida', 'conversa-1', 'whatsapp', 'ext-4', 1700000003000, '{"key":{"fromMe":false}}');
    `);
    db.close();

    const migrado = abrirAcervo(join(c.raiz, 'acervos'), id, { configuracoes: [CFG_WHATSAPP] });
    try {
      const linhas = migrado
        .preparar('SELECT id, direcao FROM mensagens ORDER BY id')
        .all() as { id: string; direcao: string | null }[];
      assert.deepEqual(linhas, [
        { id: 'm-ao-vivo-enviada', direcao: 'enviada' },
        { id: 'm-ao-vivo-recebida', direcao: 'recebida' },
        { id: 'm-material-enviada', direcao: 'enviada' },
        { id: 'm-material-recebida', direcao: 'recebida' },
      ]);
    } finally {
      migrado.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('passo 19->20 preenche Direcao do Instagram em Conversa direta, pela Configuracao', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Padme');
    acervo.fechar();
    criarAcervoNoPiso(c.raiz, id);

    const cfgId = 'cfg-instagram-1';
    const db = new Database(join(c.raiz, 'acervos', `${id}.db`));
    db.exec(`
      INSERT INTO conversas (id, fonte, id_externo, coletiva, criada_em)
      VALUES ('conversa-ig', 'instagram', 'conversa-ig-externo', 0, '2026-01-01T00:00:00.000Z');
      INSERT INTO mensagens (id, conversa_id, fonte, id_externo, ocorrida_em, bruto)
      VALUES
        ('m-titular', 'conversa-ig', 'instagram', 'ext-1', 1700000000000, '{"sender_name":"Bail Organa"}'),
        ('m-terceiro', 'conversa-ig', 'instagram', 'ext-2', 1700000001000, '{"sender_name":"Outra Pessoa"}');
    `);
    db.close();

    const nomeDoTitularNaFonte = new Map([[cfgId, 'Bail Organa']]);
    const migrado = abrirAcervo(join(c.raiz, 'acervos'), id, {
      configuracoes: [{ id: cfgId, fonte: 'instagram' }],
      nomeDoTitularNaFonte,
    });
    try {
      const linhas = migrado
        .preparar('SELECT id, direcao FROM mensagens WHERE fonte = ? ORDER BY id')
        .all('instagram') as { id: string; direcao: string | null }[];
      assert.deepEqual(linhas, [
        { id: 'm-terceiro', direcao: 'recebida' },
        { id: 'm-titular', direcao: 'enviada' },
      ]);
    } finally {
      migrado.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('passo 19->20 deixa Direcao NULL quando a Configuracao nao declara o Nome do Titular na Fonte', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Padme');
    acervo.fechar();
    criarAcervoNoPiso(c.raiz, id);

    const cfgId = 'cfg-instagram-sem-nome';
    const db = new Database(join(c.raiz, 'acervos', `${id}.db`));
    db.exec(`
      INSERT INTO conversas (id, fonte, id_externo, coletiva, criada_em)
      VALUES ('conversa-ig', 'instagram', 'conversa-ig-externo', 0, '2026-01-01T00:00:00.000Z');
      INSERT INTO mensagens (id, conversa_id, fonte, id_externo, ocorrida_em, bruto)
      VALUES ('m-1', 'conversa-ig', 'instagram', 'ext-1', 1700000000000, '{"sender_name":"Alguem"}');
    `);
    db.close();

    // SEM nomeDoTitularNaFonte para esta Configuracao — mapa vazio.
    const migrado = abrirAcervo(join(c.raiz, 'acervos'), id, {
      configuracoes: [{ id: cfgId, fonte: 'instagram' }],
      nomeDoTitularNaFonte: new Map(),
    });
    try {
      const linha = migrado.preparar('SELECT direcao FROM mensagens WHERE id = ?').get('m-1') as
        { direcao: string | null };
      assert.equal(linha.direcao, null);
    } finally {
      migrado.fechar();
    }
  } finally {
    c.limpar();
  }
});

// Nao parte do piso: CONVERSA_POR_CONFIGURACAO_V14 (passo 13->14) recusa
// subir quando uma Fonte tem mais de uma Configuracao E alguma Conversa
// direta pre-existente daquela Fonte — ele nao sabe, retroativamente, a
// qual Configuracao cada Conversa antiga pertence. Em producao isso nunca
// dispara porque a segunda Configuracao de Instagram so passou a existir
// DEPOIS de o passo 13->14 ja ter rodado uma vez — toda Conversa direta
// criada depois disso ja nasce com configuracao_id explicito, pela
// importacao, sem depender desta migracao de novo. Reproduz esse mesmo
// caminho: cria um Acervo fresco (ja na forma corrente, com configuracao_id
// e direcao estruturalmente presentes), insere as Conversas com
// configuracao_id ja resolvido como a importacao real faria, e FORCA a
// linha de versao de volta para 19 — simulando "esta base ainda nao rodou
// o passo do Instagram" sem reconstruir a cadeia inteira do piso. Reabrir
// entao dispara exclusivamente o passo pendente 19->20.
test('passo 19->20 deixa NULL a Mensagem de coletiva ambigua, e resolve a direta normalmente', () => {
  const c = cenario();
  try {
    const cfgIdDireta = 'cfg-a';
    const { id, acervo } = c.novoInquilino('Padme'); // fresco, ja na forma corrente
    const dbDireto = new Database(join(c.raiz, 'acervos', `${id}.db`));
    dbDireto.exec(`
      UPDATE versao_schema SET versao = 19;
      INSERT INTO conversas (id, fonte, id_externo, coletiva, configuracao_id, criada_em)
      VALUES ('conversa-ig-coletiva', 'instagram', 'grupo-externo', 1, NULL, '2026-01-01T00:00:00.000Z');
      INSERT INTO conversas (id, fonte, id_externo, coletiva, configuracao_id, criada_em)
      VALUES ('conversa-ig-direta', 'instagram', 'conversa-direta-externo', 0, '${cfgIdDireta}', '2026-01-01T00:00:00.000Z');
      INSERT INTO mensagens (id, conversa_id, fonte, id_externo, ocorrida_em, bruto)
      VALUES
        ('m-coletiva', 'conversa-ig-coletiva', 'instagram', 'ext-1', 1700000000000, '{"sender_name":"Alguem"}'),
        ('m-direta', 'conversa-ig-direta', 'instagram', 'ext-2', 1700000001000, '{"sender_name":"Bail Organa"}');
    `);
    dbDireto.close();
    acervo.fechar();

    const migrado = abrirAcervo(join(c.raiz, 'acervos'), id, {
      configuracoes: [
        { id: cfgIdDireta, fonte: 'instagram' },
        { id: 'cfg-b', fonte: 'instagram' },
      ],
      nomeDoTitularNaFonte: new Map([
        [cfgIdDireta, 'Bail Organa'],
        ['cfg-b', 'Outro Titular'],
      ]),
    });
    try {
      const linhas = migrado
        .preparar('SELECT id, direcao FROM mensagens ORDER BY id')
        .all() as { id: string; direcao: string | null }[];
      assert.deepEqual(linhas, [
        { id: 'm-coletiva', direcao: null }, // ambiguo — nao adivinhado
        { id: 'm-direta', direcao: 'enviada' }, // resolvido pela Configuracao da propria Conversa
      ]);
    } finally {
      migrado.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('abrir Acervo pre-v20 SEM contexto (o caso do ouvinte) recusa e nomeia "acervo migrar"', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Padme');
    acervo.fechar();
    criarAcervoNoPiso(c.raiz, id);

    assert.throws(
      () => abrirAcervo(join(c.raiz, 'acervos'), id), // sem segundo argumento — como ouvir.ts:250
      /malote acervo migrar/,
    );
  } finally {
    c.limpar();
  }
});
