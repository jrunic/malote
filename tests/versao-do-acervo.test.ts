import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { cenario } from './ajuda/acervo.js';
import { criarAcervoNoPiso } from './ajuda/acervo-no-piso.js';
import {
  abrirAcervo,
  abrirAcervoSomenteLeitura,
  AcervoDeOutraVersaoError,
  PISO_SCHEMA_ACERVO,
  VERSAO_SCHEMA_ACERVO,
} from '../src/nucleo/acervo.js';
import { FormaAbaixoDoPisoError } from '../src/nucleo/migracao.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

/** Grava direto na tabela de versão para simular Acervo de outra forma. */
function marcarVersao(raiz: string, inquilinoId: string, versao: number): void {
  const db = new Database(join(raiz, 'acervos', `${inquilinoId}.db`));
  db.prepare('UPDATE versao_schema SET versao = ?').run(versao);
  db.close();
}

function versaoEmDisco(raiz: string, inquilinoId: string): number {
  const db = new Database(join(raiz, 'acervos', `${inquilinoId}.db`));
  try {
    return (db.prepare('SELECT versao FROM versao_schema').get() as { versao: number }).versao;
  } finally {
    db.close();
  }
}

test('Acervo na forma do PISO sobe ao abrir para escrita, e a contabilidade registra', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Leia Organa');
    acervo.fechar();
    criarAcervoNoPiso(c.raiz, id);

    const reaberto = abrirAcervo(join(c.raiz, 'acervos'), id, { configuracoes: [CFG_WHATSAPP] });
    try {
      assert.equal(reaberto.versaoDoSchema(), VERSAO_SCHEMA_ACERVO);
      const linha = reaberto.db
        .prepare('SELECT descricao, conferencia FROM migracoes_aplicadas WHERE para = ?')
        .get(VERSAO_SCHEMA_ACERVO) as { descricao: string; conferencia: string } | undefined;
      assert.ok(linha, 'o passo tem de deixar registro');
      assert.match(linha.conferencia, /^ok:/, 'a conferência fica gravada');
    } finally {
      reaberto.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('Acervo ABAIXO do piso recusa, e a mensagem manda RECRIAR', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Han Solo');
    acervo.fechar();
    marcarVersao(c.raiz, id, PISO_SCHEMA_ACERVO - 1);

    assert.throws(
      () => abrirAcervo(join(c.raiz, 'acervos'), id, { configuracoes: [CFG_WHATSAPP] }),
      (erro: unknown) => {
        assert.ok(erro instanceof FormaAbaixoDoPisoError);
        assert.match(erro.message, /piso/);
        assert.match(erro.message, /recrie/i);
        return true;
      },
    );
  } finally {
    c.limpar();
  }
});

test('Acervo de versão POSTERIOR também é recusado', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Lando');
    acervo.fechar();
    marcarVersao(c.raiz, id, VERSAO_SCHEMA_ACERVO + 1);

    assert.throws(
      () => abrirAcervo(join(c.raiz, 'acervos'), id, { configuracoes: [CFG_WHATSAPP] }),
      (erro: unknown) => {
        assert.ok(erro instanceof AcervoDeOutraVersaoError);
        assert.match(erro.message, /versao POSTERIOR/);
        return true;
      },
    );
  } finally {
    c.limpar();
  }
});

test('leitura sobre forma anterior recusa, e manda MIGRAR — não recriar', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Chewbacca');
    acervo.fechar();
    criarAcervoNoPiso(c.raiz, id);

    assert.throws(
      () => abrirAcervoSomenteLeitura(join(c.raiz, 'acervos'), id),
      (erro: unknown) => {
        assert.ok(erro instanceof AcervoDeOutraVersaoError);
        assert.match(erro.message, /acervo migrar/);
        return true;
      },
    );

    // E a leitura NAO alterou a forma gravada: ler nao muda o que se le.
    assert.equal(versaoEmDisco(c.raiz, id), PISO_SCHEMA_ACERVO);
  } finally {
    c.limpar();
  }
});

test('Acervo na versão corrente abre sem migrar nada', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Padme');
    assert.equal(acervo.versaoDoSchema(), VERSAO_SCHEMA_ACERVO);
    acervo.fechar();

    const reaberto = abrirAcervo(join(c.raiz, 'acervos'), id, { configuracoes: [CFG_WHATSAPP] });
    try {
      assert.equal(reaberto.versaoDoSchema(), VERSAO_SCHEMA_ACERVO);
      // Base nascida corrente nunca migrou: contabilidade vazia. Se houver
      // linha aqui, algum passo rodou sobre um banco que ja estava na forma.
      const n = reaberto.db
        .prepare('SELECT COUNT(*) AS n FROM migracoes_aplicadas')
        .get() as { n: number };
      assert.equal(n.n, 0);
    } finally {
      reaberto.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('o passo 15 para 16 dá forma às três tabelas de identidade, pela CADEIA DE PASSOS', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Leia Organa');
    acervo.fechar();
    criarAcervoNoPiso(c.raiz, id);

    const reaberto = abrirAcervo(join(c.raiz, 'acervos'), id, { configuracoes: [CFG_WHATSAPP] });
    try {
      const colunas = (tabela: string): string[] =>
        (reaberto.db.pragma(`table_info(${JSON.stringify(tabela)})`) as { name: string }[]).map(
          (x) => x.name,
        );

      const cartao = colunas('cartoes_de_catalogo');
      assert.ok(cartao.includes('configuracao_id'), 'o Cartão diz de qual catálogo veio');
      assert.ok(cartao.includes('ultimo_avistamento'), 'e quando foi visto pela última vez');
      assert.ok(cartao.includes('ausente_em'), 'e se sumiu da origem');

      const nome = colunas('atribuicoes_de_nome');
      assert.ok(nome.includes('configuracao_id'), 'a Atribuição diz de qual catálogo veio');
      assert.ok(nome.includes('ultimo_avistamento'));

      assert.ok(colunas('identificadores').includes('configuracao_id'));

      // A chave primária do Cartão passa a incluir a Configuração: o mesmo
      // endereço no mesmo cartão de duas bases são DUAS evidências, e
      // colapsá-las perderia a ponte que o critério 12 persegue.
      const pk = (
        reaberto.db.pragma('table_info("cartoes_de_catalogo")') as {
          name: string;
          pk: number;
        }[]
      )
        .filter((x) => x.pk > 0)
        .map((x) => x.name)
        .sort();
      assert.deepEqual(pk, ['cartao', 'configuracao_id', 'identificador_id']);

      // Os QUATRO índices parciais. O ramo IS NULL é o que mantém a
      // idempotência das atribuições sem Configuração — sem ele, o SQLite
      // trata NULL como distinto de NULL e a reimportação duplica em silêncio.
      const indices = (
        reaberto.db.pragma('index_list("atribuicoes_de_nome")') as {
          name: string;
          unique: number;
        }[]
      )
        // `sqlite_%` fica de fora: e o indice implicito da chave primaria,
        // que o SQLite cria sozinho e que nao e declaracao de ninguem.
        .filter((i) => i.unique === 1 && !i.name.startsWith('sqlite_'))
        .map((i) => i.name)
        .sort();
      assert.deepEqual(indices, [
        'idx_nome_da_pessoa',
        'idx_nome_da_pessoa_sem_config',
        'idx_nome_do_identificador',
        'idx_nome_do_identificador_sem_config',
      ]);

      const passo = reaberto.db
        .prepare('SELECT descricao FROM migracoes_aplicadas WHERE de = 15 AND para = 16')
        .get() as { descricao: string } | undefined;
      assert.ok(passo, 'o passo tem de deixar registro na contabilidade');
    } finally {
      reaberto.fechar();
    }
  } finally {
    c.limpar();
  }
});
