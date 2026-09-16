import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro } from '../src/registro/registro.js';
import { emOperacao, listarOperacoesCruas, linhasDaOperacao } from '../src/nucleo/trilha.js';

test('o Acervo v8 tem as tabelas da trilha', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const tabelas = (
      acervo.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('operacoes', 'linhas_de_efeito')",
        )
        .all() as Array<{ name: string }>
    ).map((l) => l.name);
    assert.deepEqual(tabelas.sort(), ['linhas_de_efeito', 'operacoes']);
  } finally {
    c.limpar();
  }
});

test('uma Operação só pode ser desfeita uma vez — a guarda é do schema', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    const inserir = acervo.db.prepare(
      `INSERT INTO operacoes (id, natureza, reversibilidade, ocorrida_em, desfaz_id)
       VALUES (?, ?, ?, ?, ?)`,
    );
    inserir.run('op-alvo', 'vincular', 'por-efeito', '2026-08-29T10:00:00.000Z', null);
    inserir.run('op-desfaz-1', 'desfazer', 'por-efeito', '2026-08-29T11:00:00.000Z', 'op-alvo');

    assert.throws(
      () =>
        inserir.run('op-desfaz-2', 'desfazer', 'por-efeito', '2026-08-29T12:00:00.000Z', 'op-alvo'),
      /UNIQUE/i,
    );
  } finally {
    c.limpar();
  }
});

test('linha de efeito por referência não carrega valor, e por valor exige campo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Chewbacca');
    acervo.db
      .prepare(
        `INSERT INTO operacoes (id, natureza, reversibilidade, ocorrida_em, desfaz_id)
         VALUES ('op-1', 'mesclar', 'por-delegacao', '2026-08-29T10:00:00.000Z', NULL)`,
      )
      .run();
    const inserir = acervo.db.prepare(
      `INSERT INTO linhas_de_efeito (id, operacao_id, ordem, natureza, tabela, chave, campo, antes, depois)
       VALUES (?, 'op-1', ?, ?, ?, ?, ?, ?, ?)`,
    );

    // Referência válida: sem campo e sem valores.
    inserir.run('l-1', 1, 'referencia', 'atos_de_mesclagem', 'ato-7', null, null, null);

    // Referência com valor é recusada pelo CHECK.
    assert.throws(
      () => inserir.run('l-2', 2, 'referencia', 'atos_de_mesclagem', 'ato-8', null, 'x', null),
      /CHECK/i,
    );

    // Valor sem campo é recusado pelo CHECK.
    assert.throws(
      () => inserir.run('l-3', 3, 'valor', 'identificadores', 'ident-1', null, 'a', 'b'),
      /CHECK/i,
    );
  } finally {
    c.limpar();
  }
});

test('a Operação envolve o trabalho e grava uma linha de efeito por relato', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');

    const devolvido = emOperacao(
      acervo,
      { natureza: 'teste', reversibilidade: 'por-efeito' },
      (op) => {
        op.valor({
          tabela: 'identificadores',
          chave: 'ident-1',
          campo: 'pessoa_id',
          antes: null,
          depois: 'p-1',
        });
        op.referencia({ tabela: 'atos_de_mesclagem', chave: 'ato-1' });
        return 'resultado';
      },
    );

    assert.equal(devolvido, 'resultado');

    const operacoes = listarOperacoesCruas(acervo);
    assert.equal(operacoes.length, 1);
    assert.equal(operacoes[0]?.natureza, 'teste');
    assert.equal(operacoes[0]?.reversibilidade, 'por-efeito');

    const linhas = linhasDaOperacao(acervo, operacoes[0]?.id ?? '');
    assert.equal(linhas.length, 2);
    assert.equal(linhas[0]?.natureza, 'valor');
    assert.equal(linhas[0]?.campo, 'pessoa_id');
    assert.equal(linhas[0]?.antes, null);
    assert.equal(linhas[0]?.depois, 'p-1');
    assert.equal(linhas[1]?.natureza, 'referencia');
    assert.equal(linhas[1]?.chave, 'ato-1');
  } finally {
    c.limpar();
  }
});

test('Operação aninhada SE JUNTA à de fora — um comando, uma Operação', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');

    emOperacao(acervo, { natureza: 'lote', reversibilidade: 'por-efeito' }, (fora) => {
      fora.valor({ tabela: 'pessoas', chave: 'p-1', campo: 'criada', antes: null, depois: 'sim' });
      emOperacao(acervo, { natureza: 'vincular', reversibilidade: 'por-efeito' }, (dentro) => {
        dentro.valor({
          tabela: 'identificadores',
          chave: 'i-1',
          campo: 'pessoa_id',
          antes: null,
          depois: 'p-1',
        });
      });
    });

    const operacoes = listarOperacoesCruas(acervo);
    assert.equal(operacoes.length, 1, 'a de dentro não abre Operação própria');
    assert.equal(operacoes[0]?.natureza, 'lote', 'a natureza é a do comando de fora');
    assert.equal(linhasDaOperacao(acervo, operacoes[0]?.id ?? '').length, 2);
  } finally {
    c.limpar();
  }
});

test('trabalho que lança não deixa Operação nem efeito — tudo na mesma transação', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Chewbacca');

    assert.throws(() => {
      emOperacao(acervo, { natureza: 'vincular', reversibilidade: 'por-efeito' }, (op) => {
        op.valor({
          tabela: 'identificadores',
          chave: 'i-1',
          campo: 'pessoa_id',
          antes: null,
          depois: 'p-1',
        });
        throw new Error('falha no meio do trabalho');
      });
    }, /falha no meio do trabalho/);

    assert.equal(listarOperacoesCruas(acervo).length, 0, 'nenhuma Operação órfã');
    const sobrou = acervo.db.prepare('SELECT COUNT(*) AS n FROM linhas_de_efeito').get() as {
      n: number;
    };
    assert.equal(sobrou.n, 0, 'nenhuma linha de efeito órfã');
  } finally {
    c.limpar();
  }
});

test('trecho aninhado que lança desfaz os PRÓPRIOS relatos, e não os de fora', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Lando');

    emOperacao(acervo, { natureza: 'lote', reversibilidade: 'por-efeito' }, (fora) => {
      fora.valor({ tabela: 'pessoas', chave: 'p-1', campo: 'criada', antes: null, depois: 'sim' });
      // O chamador ENGOLE o erro do item — é o padrão do lote: atômico por
      // item, recusa não aborta o resto.
      try {
        emOperacao(acervo, { natureza: 'item', reversibilidade: 'por-efeito' }, (dentro) => {
          dentro.valor({
            tabela: 'identificadores',
            chave: 'i-1',
            campo: 'pessoa_id',
            antes: null,
            depois: 'p-1',
          });
          throw new Error('item recusado');
        });
      } catch {
        // segue o lote
      }
      fora.valor({ tabela: 'pessoas', chave: 'p-2', campo: 'criada', antes: null, depois: 'sim' });
    });

    const operacoes = listarOperacoesCruas(acervo);
    assert.equal(operacoes.length, 1);
    const linhas = linhasDaOperacao(acervo, operacoes[0]?.id ?? '');
    assert.equal(linhas.length, 2, 'o relato do item recusado foi desfeito');
    assert.deepEqual(
      linhas.map((l) => l.chave),
      ['p-1', 'p-2'],
    );
  } finally {
    c.limpar();
  }
});

test('Operação de ingestão não grava efeito de valor, mas grava a referência', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('BB-8');

    emOperacao(
      acervo,
      { natureza: 'importar-material', reversibilidade: 'irreversivel', registraEfeito: false },
      (op) => {
        // Mil relatos de valor — o que a ingestão real produz — e nenhum é gravado.
        for (let i = 0; i < 1000; i += 1) {
          op.valor({
            tabela: 'atribuicoes_de_nome',
            chave: `n-${i}`,
            campo: 'id',
            antes: null,
            depois: `n-${i}`,
          });
        }
        op.referencia({ tabela: 'materiais', chave: 'mat-1' });
      },
    );

    const operacoes = listarOperacoesCruas(acervo);
    assert.equal(operacoes.length, 1);
    const linhas = linhasDaOperacao(acervo, operacoes[0]?.id ?? '');
    assert.equal(linhas.length, 1, 'só a referência');
    assert.equal(linhas[0]?.natureza, 'referencia');
    assert.equal(linhas[0]?.chave, 'mat-1');
  } finally {
    c.limpar();
  }
});

test('Operação sem relato nenhum ainda é gravada — o ato aconteceu', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('R2-D2');
    emOperacao(acervo, { natureza: 'sem-efeito', reversibilidade: 'irreversivel' }, () => undefined);
    assert.equal(listarOperacoesCruas(acervo).length, 1);
  } finally {
    c.limpar();
  }
});

test('a Operação com Inquilino grava a coluna; sem Inquilino, grava nulo', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    emOperacao(
      registro,
      { natureza: 'criar-inquilino', reversibilidade: 'por-efeito', inquilinoId: 'inq-1' },
      (op) => {
        op.valor({
          tabela: 'inquilinos',
          chave: 'inq-1',
          campo: 'id',
          antes: null,
          depois: 'inq-1',
        });
      },
    );
    emOperacao(registro, { natureza: 'criar-chave', reversibilidade: 'por-efeito' }, (op) => {
      op.valor({
        tabela: 'chaves_de_operador',
        chave: 'k-1',
        campo: 'id',
        antes: null,
        depois: 'k-1',
      });
    });

    const linhas = registro.db
      .prepare('SELECT natureza, inquilino_id FROM operacoes ORDER BY rowid')
      .all() as Array<{ natureza: string; inquilino_id: string | null }>;
    assert.equal(linhas.length, 2);
    assert.equal(linhas[0]?.inquilino_id, 'inq-1', 'decisão de Inquilino carrega o Inquilino');
    assert.equal(linhas[1]?.inquilino_id, null, 'ato de instalação não tem Inquilino');
  } finally {
    registro.fechar();
    limpar();
  }
});
