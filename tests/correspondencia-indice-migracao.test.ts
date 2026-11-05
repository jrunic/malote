import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { abrirAcervo, VERSAO_SCHEMA_ACERVO } from '../src/nucleo/acervo.js';
import { aprenderCorrespondencia, SQL_ENDERECO_EH_CANONICO } from '../src/nucleo/correspondencia.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

// O plano de consulta da MESMA constante que a porta `enderecoEhCanonico` usa: se a porta mudar a consulta, o teste muda junto.
const PLANO_DA_PERGUNTA = `EXPLAIN QUERY PLAN ${SQL_ENDERECO_EH_CANONICO}`;

test('o Acervo na v30 sobe para a v31 com o indice por canonico, sem perder par', () => {
  assert.equal(VERSAO_SCHEMA_ACERVO, 31);
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Teste');
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: 'a1', canonico: 'c1' });
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: 'a2', canonico: 'c2' });
    // Reproduz a forma da v30: sem o indice, com a versao gravada 30.
    acervo.db.exec('DROP INDEX correspondencias_por_canonico');
    acervo.db.prepare('UPDATE versao_schema SET versao = 30').run();
    acervo.fechar();

    const migrado = abrirAcervo(join(c.raiz, 'acervos'), id, { configuracoes: [CFG_WHATSAPP] });
    try {
      assert.equal((migrado.db.prepare('SELECT versao FROM versao_schema').get() as { versao: number }).versao, 31);
      assert.equal(
        (migrado.db.prepare('SELECT COUNT(*) AS n FROM correspondencias_de_endereco').get() as { n: number }).n,
        2,
        'perdeu par',
      );
      const indice = migrado.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'correspondencias_por_canonico'")
        .get();
      assert.ok(indice, 'o passo nao criou o indice');
      const registro = migrado.db.prepare('SELECT conferencia FROM migracoes_aplicadas WHERE para = 31').get();
      assert.ok(registro, 'o passo 31 tem de deixar registro');
    } finally {
      migrado.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('a pergunta "este valor e canonico?" usa o indice, e nao varre a tabela', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const plano = acervo.db.prepare(PLANO_DA_PERGUNTA).all('whatsapp', 'x') as Array<{ detail: string }>;
    assert.ok(
      plano.some((l) => l.detail.includes('correspondencias_por_canonico')),
      `o plano nao usa o indice: ${JSON.stringify(plano)}`,
    );
  } finally {
    c.limpar();
  }
});
