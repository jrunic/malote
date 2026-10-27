import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarIdentificador } from '../src/nucleo/escrita.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const TABELAS_NOVAS = ['edicoes', 'edicoes_texto'];

test('um Acervo na v27 sobe para a v28 sem perder linha e ganha as tabelas da Edicao', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Padme');
    // Dado ja gravado ANTES da migracao: e ele que tem de sobreviver.
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '120363000000000001@g.us', coletiva: true });
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565911110001@s.whatsapp.net' });
    // Reproduz a forma da v27: sem as tabelas novas, com a versao gravada 27.
    acervo.db.exec(`
      DROP TABLE edicoes_texto;
      DROP TABLE edicoes;
    `);
    acervo.db.prepare('UPDATE versao_schema SET versao = 27').run();
    acervo.fechar();

    const migrado = abrirAcervo(join(c.raiz, 'acervos'), id, { configuracoes: [CFG_WHATSAPP] });
    try {
      const versao = migrado.db.prepare('SELECT versao FROM versao_schema').get() as { versao: number };
      assert.equal(versao.versao, 30);
      for (const nome of TABELAS_NOVAS) {
        const t = migrado.db.prepare('SELECT name FROM sqlite_master WHERE name = ?').get(nome);
        assert.ok(t !== undefined, `a tabela ${nome} nao existe depois de migrar`);
      }
      const conversas = migrado.db.prepare('SELECT COUNT(*) AS n FROM conversas').get() as { n: number };
      const identificadores = migrado.db.prepare('SELECT COUNT(*) AS n FROM identificadores').get() as { n: number };
      assert.equal(conversas.n, 1, 'a migracao perdeu Conversa');
      assert.equal(identificadores.n, 1, 'a migracao perdeu Identificador');
    } finally {
      migrado.fechar();
    }
  } finally {
    c.limpar();
  }
});
