import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { criarRegistroNoPiso } from './ajuda/registro-no-piso.js';
import {
  abrirRegistro,
  abrirRegistroSomenteLeitura,
  RegistroDeOutraVersaoError,
  PISO_SCHEMA_REGISTRO,
  VERSAO_SCHEMA_REGISTRO,
} from '../src/registro/registro.js';
import { FormaAbaixoDoPisoError } from '../src/nucleo/migracao.js';

function versaoEmDisco(raiz: string): number {
  const db = new Database(join(raiz, 'registro.db'));
  try {
    return (db.prepare('SELECT versao FROM versao_schema').get() as { versao: number }).versao;
  } finally {
    db.close();
  }
}

test('forma do PISO sobe por passos ao abrir — o Registro não pode ser recriado', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    criarRegistroNoPiso(raiz);

    const r = abrirRegistro(raiz);
    try {
      assert.equal(r.versaoDoSchema(), VERSAO_SCHEMA_REGISTRO, 'subiu ao abrir');
      const linha = r.db
        .prepare('SELECT conferencia FROM migracoes_aplicadas WHERE para = ?')
        .get(VERSAO_SCHEMA_REGISTRO) as { conferencia: string } | undefined;
      assert.ok(linha, 'o passo tem de deixar registro');
      assert.match(linha.conferencia, /^ok:/);

      // E continua utilizável: as tabelas dos ciclos anteriores estão lá.
      const t = r.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='operacoes'")
        .get() as { name: string } | undefined;
      assert.notEqual(t, undefined);
    } finally {
      r.fechar();
    }
  } finally {
    limpar();
  }
});

test('forma ABAIXO do piso recusa, e a mensagem NÃO manda recriar', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    criarRegistroNoPiso(raiz);
    const cru = new Database(join(raiz, 'registro.db'));
    cru.prepare('UPDATE versao_schema SET versao = 1').run();
    cru.close();

    assert.throws(
      () => abrirRegistro(raiz),
      (erro: unknown) => {
        assert.ok(erro instanceof FormaAbaixoDoPisoError);
        assert.match(erro.message, /piso/);
        // O NOME deste teste promete isto, e ate 01/09/2026 ele nao asseverava
        // nada disso — a mensagem generica da classe dizia "recrie a base",
        // inclusive aqui, onde nao existe comando de recriar. A instrucao
        // passou a ser declarada por base.
        // O alvo e a INSTRUCAO, nao a palavra: a mensagem pode — e deve —
        // dizer que a base nao pode ser recriada. O que ela nao pode e mandar
        // recriar, apontando para um comando que nao existe.
        assert.doesNotMatch(erro.message, /recri(e|ar)\b/i);
        assert.match(erro.message, /nao pode ser recriada/i);
        assert.match(erro.message, /versao do malote/i);
        return true;
      },
    );
  } finally {
    limpar();
  }
});

test('forma POSTERIOR recusa abrir, e a mensagem NÃO manda recriar', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    abrirRegistro(raiz).fechar();

    const cru = new Database(join(raiz, 'registro.db'));
    cru.prepare('UPDATE versao_schema SET versao = ?').run(VERSAO_SCHEMA_REGISTRO + 1);
    cru.close();

    assert.throws(
      () => abrirRegistro(raiz),
      (erro: unknown) => {
        assert.ok(erro instanceof RegistroDeOutraVersaoError);
        // Nao existe `registro recriar`. Mandar recriar seria mentira: a base
        // guarda Inquilino e Chave, e nada os reconstroi.
        assert.doesNotMatch(erro.message, /recri/i);
        assert.match(erro.message, /versao do malote/i);
        return true;
      },
    );
  } finally {
    limpar();
  }
});

test('Registro novo nasce na versão corrente, sem migrar nada', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const r = abrirRegistro(raiz);
    try {
      assert.equal(r.versaoDoSchema(), VERSAO_SCHEMA_REGISTRO);
      const n = r.db.prepare('SELECT COUNT(*) AS n FROM migracoes_aplicadas').get() as {
        n: number;
      };
      assert.equal(n.n, 0, 'base nascida corrente nunca migrou');
    } finally {
      r.fechar();
    }
  } finally {
    limpar();
  }
});

test('a abertura somente-leitura do Registro recusa escrever', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    abrirRegistro(raiz).fechar();

    const leitura = abrirRegistroSomenteLeitura(raiz);
    try {
      assert.equal(leitura.versaoDoSchema(), VERSAO_SCHEMA_REGISTRO);
      assert.throws(
        () =>
          leitura.db
            .prepare('INSERT INTO inquilinos (id, titular_nome, criado_em) VALUES (?, ?, ?)')
            .run('x', 'y', 'z'),
        /readonly/i,
      );
    } finally {
      leitura.fechar();
    }
  } finally {
    limpar();
  }
});

test('somente-leitura RECUSA um Registro de forma anterior, e não o altera', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    criarRegistroNoPiso(raiz);

    // MUDOU no ciclo 14. Antes esta porta abria assim mesmo, porque toda forma
    // anterior so tinha acrescentado TABELA. Com passos isso deixou de valer:
    // um passo pode alterar coluna, e ler forma desconhecida produz resultado
    // silenciosamente errado.
    assert.throws(() => abrirRegistroSomenteLeitura(raiz), RegistroDeOutraVersaoError);

    assert.equal(versaoEmDisco(raiz), PISO_SCHEMA_REGISTRO, 'a leitura não alterou a forma');
  } finally {
    limpar();
  }
});

test('a migração grava UMA Operação na trilha, com um efeito por passo', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    criarRegistroNoPiso(raiz);

    const r = abrirRegistro(raiz);
    try {
      const ops = r.db
        .prepare("SELECT id, reversibilidade FROM operacoes WHERE natureza = 'migrar-base'")
        .all() as { id: string; reversibilidade: string }[];
      assert.equal(ops.length, 1, 'uma Operação por execução, não uma por passo');
      assert.equal(ops[0]?.reversibilidade, 'irreversivel');

      const efeitos = r.db
        .prepare('SELECT COUNT(*) AS n FROM linhas_de_efeito WHERE operacao_id = ?')
        .get(ops[0]?.id) as { n: number };
      // Contra a CONTABILIDADE, e nao contra um numero cravado. A asserção
      // dizia `1` porque havia um passo; ao entrar o segundo (Chave de Acesso,
      // ciclo 11) ela quebrou sem que o invariante tivesse mudado. Comparar as
      // duas escritas independentes — a trilha e `migracoes_aplicadas` — mede o
      // que o nome do teste promete, e vale para qualquer quantidade de passos.
      const passos = r.db
        .prepare('SELECT COUNT(*) AS n FROM migracoes_aplicadas')
        .get() as { n: number };
      assert.ok(passos.n >= 1, 'o cenario tem de aplicar pelo menos um passo');
      assert.equal(efeitos.n, passos.n, 'um efeito por passo aplicado');
    } finally {
      r.fechar();
    }
  } finally {
    limpar();
  }
});

test('abrir base JÁ corrente não grava Operação nenhuma', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    abrirRegistro(raiz).fechar();
    // O que este teste garante e o RAMO do chamador: forma corrente nao invoca
    // a maquina. A guarda equivalente DENTRO de `migrarComTrilha` e medida por
    // outro teste, que a exercita pela porta — este aqui passa com ela
    // removida, e isso foi medido em 01/09/2026.
    const r = abrirRegistro(raiz);
    try {
      const n = r.db
        .prepare("SELECT COUNT(*) AS n FROM operacoes WHERE natureza = 'migrar-base'")
        .get() as { n: number };
      assert.equal(n.n, 0);
    } finally {
      r.fechar();
    }
  } finally {
    limpar();
  }
});

test('o passo 5 para 6 acrescenta entradas_de_adaptador a uma base que já existe', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    criarRegistroNoPiso(raiz);
    const r = abrirRegistro(raiz);
    try {
      const t = r.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get('entradas_de_adaptador') as { name: string } | undefined;
      assert.notEqual(t, undefined, 'a tabela precisa chegar pela CADEIA DE PASSOS');
      assert.equal(r.versaoDoSchema(), VERSAO_SCHEMA_REGISTRO);

      const passo = r.db
        .prepare('SELECT descricao FROM migracoes_aplicadas WHERE de = 5 AND para = 6')
        .get() as { descricao: string } | undefined;
      assert.ok(passo, 'o passo tem de deixar registro na contabilidade');
    } finally {
      r.fechar();
    }
  } finally {
    limpar();
  }
});
