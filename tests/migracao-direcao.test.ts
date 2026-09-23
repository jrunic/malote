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
