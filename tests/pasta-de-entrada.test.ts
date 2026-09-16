import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalacaoTemporaria, instalacaoComInquilino, rodar } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import {
  declararPastaDeEntrada,
  lerPastaDeEntrada,
  listarPastasDeEntrada,
} from '../src/registro/pasta-de-entrada.js';

test('declarar e ler devolve o que foi declarado', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    try {
      const inq = criarInquilino(registro, { titularNome: 'Leia Organa' });
      const cfg = resolverConfiguracao(registro, inq, 'instagram', 'conta-a');
      declararPastaDeEntrada(registro, cfg.id, {
        pasta: '/tmp/entrada-a',
        natureza: 'parcial',
        nomeDoTitularNaFonte: 'Leia Organa',
      });
      const lida = lerPastaDeEntrada(registro, cfg.id);
      assert.equal(lida?.pasta, '/tmp/entrada-a');
      assert.equal(lida?.natureza, 'parcial');
      assert.equal(lida?.nomeDoTitularNaFonte, 'Leia Organa');
    } finally {
      registro.fechar();
    }
  } finally {
    limpar();
  }
});

test('quem nao declarou nao tem pasta, e isso nao e erro', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    try {
      const inq = criarInquilino(registro, { titularNome: 'Leia Organa' });
      const cfg = resolverConfiguracao(registro, inq, 'whatsapp', 'conta-b');
      assert.equal(lerPastaDeEntrada(registro, cfg.id), null);
      assert.deepEqual(listarPastasDeEntrada(registro, inq), []);
    } finally {
      registro.fechar();
    }
  } finally {
    limpar();
  }
});

test('declarar de novo substitui, e nao duplica', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    try {
      const inq = criarInquilino(registro, { titularNome: 'Leia Organa' });
      const cfg = resolverConfiguracao(registro, inq, 'contatos', 'google-x');
      declararPastaDeEntrada(registro, cfg.id, { pasta: '/tmp/um', natureza: 'completo' });
      declararPastaDeEntrada(registro, cfg.id, { pasta: '/tmp/dois', natureza: 'completo' });
      assert.equal(lerPastaDeEntrada(registro, cfg.id)?.pasta, '/tmp/dois');
      assert.equal(listarPastasDeEntrada(registro, inq).length, 1);
    } finally {
      registro.fechar();
    }
  } finally {
    limpar();
  }
});

test('a declaracao grava UMA Operacao, com o Inquilino dono', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    try {
      const inq = criarInquilino(registro, { titularNome: 'Leia Organa' });
      const cfg = resolverConfiguracao(registro, inq, 'contatos', 'google-x');
      declararPastaDeEntrada(registro, cfg.id, { pasta: '/tmp/um', natureza: 'completo' });
      const ops = registro.db
        .prepare(
          "SELECT inquilino_id FROM operacoes WHERE natureza = 'declarar-pasta-de-entrada'",
        )
        .all() as { inquilino_id: string | null }[];
      assert.equal(ops.length, 1);
      assert.equal(ops[0]?.inquilino_id, inq, 'a trilha do Registro diz de quem e a decisao');
    } finally {
      registro.fechar();
    }
  } finally {
    limpar();
  }
});

test('natureza fora do vocabulario e recusada', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    try {
      const inq = criarInquilino(registro, { titularNome: 'Leia Organa' });
      const cfg = resolverConfiguracao(registro, inq, 'contatos', 'google-y');
      assert.throws(
        () =>
          declararPastaDeEntrada(registro, cfg.id, {
            pasta: '/tmp/tres',
            natureza: 'incremental' as never,
          }),
        /natureza/i,
      );
    } finally {
      registro.fechar();
    }
  } finally {
    limpar();
  }
});

test('Configuracao desconhecida e recusada', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    try {
      assert.throws(
        () =>
          declararPastaDeEntrada(registro, 'nao-existe', {
            pasta: '/tmp/x',
            natureza: 'completo',
          }),
        /Configuracao desconhecida/,
      );
    } finally {
      registro.fechar();
    }
  } finally {
    limpar();
  }
});

test('entrada declarar grava e entrada listar mostra', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);

    const decl = rodar(raiz, [
      'entrada', 'declarar',
      '--inquilino', inquilino,
      '--fonte', 'contatos',
      '--configuracao', 'catalogo',
      '--pasta', '/tmp/contatos-catalogo',
      '--natureza', 'completo',
    ]);
    assert.equal(decl.codigo, 0, decl.saida);

    const lista = rodar(raiz, ['entrada', 'listar', '--inquilino', inquilino]);
    assert.equal(lista.codigo, 0, lista.saida);
    assert.match(lista.saida, /contatos\/catalogo/);
    assert.match(lista.saida, /completo/);
    assert.match(lista.saida, /\/tmp\/contatos-catalogo/);
  } finally {
    limpar();
  }
});

test('entrada declarar recusa natureza desconhecida com codigo 2', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const r = rodar(raiz, [
      'entrada', 'declarar', '--inquilino', inquilino, '--fonte', 'contatos',
      '--configuracao', 'google-z', '--pasta', '/tmp/x', '--natureza', 'incremental',
    ]);
    assert.equal(r.codigo, 2, r.saida);
    // NAO basta casar /natureza/: o ramo de comando desconhecido ECOA a linha
    // inteira — que contem `--natureza` — e tambem devolve 2. Medido em
    // 12/09/2026: com esta assercao frouxa o teste passava ANTES da
    // implementacao existir. O que so a recusa de verdade produz e o
    // vocabulario valido na mensagem.
    assert.match(r.saida, /completo/);
    assert.match(r.saida, /parcial/);
    assert.doesNotMatch(r.saida, /Comando desconhecido/);
  } finally {
    limpar();
  }
});

test('entrada listar de Inquilino sem declaracao sai 0 e nao inventa linha', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const r = rodar(raiz, ['entrada', 'listar', '--inquilino', inquilino]);
    assert.equal(r.codigo, 0, r.saida);
    assert.doesNotMatch(r.saida, /completo|parcial/);
  } finally {
    limpar();
  }
});

test('entrada declarar RECUSA fonte que a varredura nao sabe processar', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    // `whatsapp` e Fonte legitima do produto e NAO e varrivel: ela chega pelo
    // ouvinte e por `importar`, nunca por pasta vigiada. Aceitar a declaracao
    // criaria uma Configuracao (resolverConfiguracao CRIA quando nao acha) cuja
    // varredura recusa TODO arquivo para sempre, imprimindo o motivo a cada
    // execucao agendada — e, com a pasta vazia, em silencio total, saindo 0.
    const r = rodar(raiz, [
      'entrada', 'declarar', '--inquilino', inquilino, '--fonte', 'whatsapp',
      '--configuracao', 'pessoal', '--pasta', '/tmp/x', '--natureza', 'completo',
    ]);
    assert.equal(r.codigo, 2, r.saida);
    assert.match(r.saida, /contatos/);
    assert.match(r.saida, /instagram/);
    assert.doesNotMatch(r.saida, /Comando desconhecido/);

    // E nao pode ter deixado a Configuracao nem a entrada para tras.
    const lista = rodar(raiz, ['entrada', 'listar', '--inquilino', inquilino]);
    assert.doesNotMatch(lista.saida, /whatsapp/);
  } finally {
    limpar();
  }
});
