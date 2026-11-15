import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { abrirAcervo, VERSAO_SCHEMA_ACERVO } from '../src/nucleo/acervo.js';
import { PLANO_DO_ACERVO } from '../src/nucleo/passos-do-acervo.js';
import { registrarConversa, registrarIdentificador, registrarMensagem } from '../src/nucleo/escrita.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

// #1519, Plano 3 (decisao do Titular, 15/11/2026): remover um Identificador dispara o `ON DELETE SET NULL` de
// `mensagens.citada_autor_id`, e sem indice isso varria a tabela inteira dentro do lock (1,1 s por item no Acervo do Titular).

const INDICE = 'idx_mensagens_citada_autor';

function semear(acervo: Parameters<typeof registrarConversa>[0]): void {
  const conversa = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: 'g1@g.us', coletiva: true });
  const autor = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565991110001@s.whatsapp.net' }).id;
  for (let i = 0; i < 2; i += 1) {
    registrarMensagem(acervo, {
      origemDaChegada: 'importacao',
      conversaId: conversa,
      fonte: 'whatsapp',
      idExterno: `m-${i}`,
      autorId: autor,
      conteudo: `t${i}`,
      ocorridaEm: 1_700_000_000_000 + i,
      agora: Date.now(),
      direcao: 'recebida',
    });
  }
}

test('o Acervo na v32 sobe ate a versao corrente com o indice de autor da citada, sem perder Mensagem', () => {
  assert.equal(VERSAO_SCHEMA_ACERVO, 33);
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Teste');
    semear(acervo);
    // Reproduz a forma da v32: sem o indice, com a versao gravada 32.
    acervo.db.exec(`DROP INDEX ${INDICE}`);
    acervo.db.prepare('UPDATE versao_schema SET versao = 32').run();
    acervo.fechar();

    const migrado = abrirAcervo(join(c.raiz, 'acervos'), id, { configuracoes: [CFG_WHATSAPP] });
    try {
      assert.equal((migrado.db.prepare('SELECT versao FROM versao_schema').get() as { versao: number }).versao, 33);
      assert.equal((migrado.db.prepare('SELECT COUNT(*) AS n FROM mensagens').get() as { n: number }).n, 2, 'perdeu Mensagem');
      assert.ok(
        migrado.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(INDICE),
        'o passo nao criou o indice',
      );
      assert.ok(migrado.db.prepare('SELECT conferencia FROM migracoes_aplicadas WHERE para = 33').get(), 'o passo 33 tem de deixar registro');
    } finally {
      migrado.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('o Acervo novo ja nasce com o indice, e a pergunta por autor da citada o usa em vez de varrer a tabela', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const plano = (acervo.db.prepare('EXPLAIN QUERY PLAN SELECT 1 FROM mensagens WHERE citada_autor_id = ?').all('x') as Array<{ detail: string }>)
      .map((l) => l.detail)
      .join(' | ');
    assert.match(plano, new RegExp(INDICE), plano);
    assert.doesNotMatch(plano, /SCAN mensagens/, plano);
  } finally {
    c.limpar();
  }
});

test('o passo v33 e idempotente: aplicado de novo sobre a forma v33 nao falha nem muda nada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    semear(acervo);
    const passo = PLANO_DO_ACERVO.passos.find((p) => p.para === 33);
    assert.ok(passo, 'nao ha passo v32 -> v33');
    const antes = (acervo.db.prepare('SELECT COUNT(*) AS n FROM sqlite_master').get() as { n: number }).n;
    passo.aplicar(acervo.db);
    passo.aplicar(acervo.db);
    assert.equal((acervo.db.prepare('SELECT COUNT(*) AS n FROM sqlite_master').get() as { n: number }).n, antes);
    assert.equal((acervo.db.prepare('SELECT COUNT(*) AS n FROM mensagens').get() as { n: number }).n, 2);
  } finally {
    c.limpar();
  }
});
