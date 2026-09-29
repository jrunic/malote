import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { criarAcervoNoPiso } from './ajuda/acervo-no-piso.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { migrar } from '../src/nucleo/migracao.js';
import { PASSOS_DO_ACERVO, PLANO_DO_ACERVO } from '../src/nucleo/passos-do-acervo.js';

test('Anexo de audio presente ANTES da migracao 21 fica fora-de-escopo', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Padme');
    acervo.fechar();
    criarAcervoNoPiso(c.raiz, id);

    const caminho = join(c.raiz, 'acervos', `${id}.db`);
    const db = new Database(caminho);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    try {
      // Leva a base ATE 20 — um passo antes do novo — com um plano truncado.
      const planoAte20 = {
        ...PLANO_DO_ACERVO,
        corrente: 20,
        passos: PASSOS_DO_ACERVO.filter((p) => p.para <= 20),
      };
      migrar(db, caminho, planoAte20, { configuracoes: [CFG_WHATSAPP] });

      const agora = new Date().toISOString();
      db.prepare(
        `INSERT INTO conversas (id, fonte, id_externo, coletiva, criada_em) VALUES ('c1','whatsapp','c1@g.us',1,?)`,
      ).run(agora);
      db.prepare(
        `INSERT INTO mensagens (id, conversa_id, fonte, id_externo, ocorrida_em) VALUES ('m1','c1','whatsapp','m1',1000)`,
      ).run();
      // Anexo de audio PRESENTE — deve ficar fora-de-escopo depois da migracao.
      db.prepare(
        `INSERT INTO anexos (id, mensagem_id, tipo, presenca, caminho) VALUES ('a1','m1','audio','presente','/x/a1.opus')`,
      ).run();
      // Anexo de audio NUNCA-OBTIDO — nao e presente, entao nem fora-de-escopo:
      // nao ganha linha nenhuma em transcricoes.
      db.prepare(
        `INSERT INTO anexos (id, mensagem_id, tipo, presenca, caminho) VALUES ('a2','m1','audio','nunca-obtido',NULL)`,
      ).run();
      // Anexo de IMAGEM presente — nunca entra em transcricoes.
      db.prepare(
        `INSERT INTO anexos (id, mensagem_id, tipo, presenca, caminho) VALUES ('a3','m1','imagem','presente','/x/a3.jpg')`,
      ).run();

      migrar(db, caminho, PLANO_DO_ACERVO, { configuracoes: [CFG_WHATSAPP] });

      const linhas = db
        .prepare('SELECT anexo_id AS anexoId, estado FROM transcricoes ORDER BY anexo_id')
        .all() as { anexoId: string; estado: string }[];
      assert.deepEqual(linhas, [{ anexoId: 'a1', estado: 'fora-de-escopo' }]);
    } finally {
      db.close();
    }
  } finally {
    c.limpar();
  }
});
