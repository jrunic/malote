import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  atorAtual,
  atorDeAcesso,
  atorDeOperador,
  atorDeServico,
  comAtor,
  INDETERMINADO,
  LOCAL,
} from '../src/nucleo/ator.js';
import { cenario } from './ajuda/acervo.js';
import { VERSAO_SCHEMA_ACERVO } from '../src/nucleo/schema-acervo.js';
import { VERSAO_SCHEMA_REGISTRO } from '../src/registro/schema.js';
import { emOperacao, lerOperacao, listarOperacoes } from '../src/nucleo/trilha.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { criarRegistroNoPiso } from './ajuda/registro-no-piso.js';
import { executar } from '../src/cli/index.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('sem ninguem declarar, o Ator e INDETERMINADO — nunca `local`', () => {
  // Declarar `local` por omissao afirmaria "ninguem apresentou credencial"
  // quando a verdade e "ninguem disse nada". Num registro de auditoria a
  // diferenca importa: uma e um fato sobre a sessao, a outra e um defeito.
  assert.equal(atorAtual(), INDETERMINADO);
});

test('a declaracao vale dentro do escopo e nao vaza para fora', () => {
  comAtor('operador:abc', () => {
    assert.equal(atorAtual(), 'operador:abc');
  });
  assert.equal(atorAtual(), INDETERMINADO, 'restaurou ao sair');
});

test('escopos aninhados nao se contaminam', () => {
  comAtor('operador:externo', () => {
    comAtor('acesso:interno', () => {
      assert.equal(atorAtual(), 'acesso:interno');
    });
    assert.equal(atorAtual(), 'operador:externo', 'o de fora volta intacto');
  });
});

test('escopos CONCORRENTES nao se misturam — e este e o caso do servidor', async () => {
  // Com estado global de modulo, este teste passa em requisicao unica e falha
  // sob carga: a Operacao de uma requisicao sairia com o Ator de outra. O
  // defeito seria intermitente, proporcional a carga, e invisivel no teste que
  // a maioria escreveria. Auditoria que atribui ato a pessoa errada e pior que
  // auditoria nenhuma.
  const vistos: string[] = [];
  const umaRequisicao = (quem: string, espera: number): Promise<void> =>
    comAtor(quem, async () => {
      await new Promise((r) => setTimeout(r, espera));
      vistos.push(`${quem}=${atorAtual()}`);
    });

  await Promise.all([umaRequisicao('acesso:a', 30), umaRequisicao('acesso:b', 10)]);
  assert.deepEqual(vistos.sort(), ['acesso:a=acesso:a', 'acesso:b=acesso:b']);
});

test('o vocabulario e fechado POR MECANISMO — declarar forma desconhecida e recusado', () => {
  // Sem esta recusa, o criterio 16 seria convencao e nao garantia: `comAtor`
  // aceitaria qualquer string, e o campo voltaria a ser rotulo livre — que e a
  // razao pela qual o ciclo 8 deixou o Ator de fora.
  assert.throws(() => comAtor('deus:eu', () => undefined), /fora do vocabulario/);
  assert.throws(() => comAtor('', () => undefined), /fora do vocabulario/);
  // `indeterminado` e o DEFAULT, nunca uma declaracao: quem o declara esta
  // afirmando que nao sabe, o que nao e um fato sobre a sessao.
  assert.throws(() => comAtor(INDETERMINADO, () => undefined), /fora do vocabulario/);
  assert.doesNotThrow(() => comAtor('local', () => undefined));
});

test('os construtores produzem as formas do vocabulario', () => {
  assert.equal(atorDeOperador('k1'), 'operador:k1');
  assert.equal(atorDeAcesso('k2'), 'acesso:k2');
  assert.equal(atorDeServico('ouvinte-whatsapp'), 'servico:ouvinte-whatsapp');
  assert.equal(LOCAL, 'local');
});

test('as duas bases tem a coluna do Ator, e a forma subiu', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    assert.equal(VERSAO_SCHEMA_ACERVO, 20);
    assert.equal(VERSAO_SCHEMA_REGISTRO, 7);
    for (const base of [acervo.db, c.registro.db]) {
      const colunas = base.prepare("SELECT name FROM pragma_table_info('operacoes')").all() as {
        name: string;
      }[];
      assert.ok(
        colunas.some((x) => x.name === 'ator'),
        'a coluna existe',
      );
    }
  } finally {
    c.limpar();
  }
});

test('a Operacao grava o Ator declarado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    comAtor(atorDeOperador('chave-1'), () => {
      emOperacao(acervo, { natureza: 'teste', reversibilidade: 'irreversivel' }, () => undefined);
    });
    const op = acervo.db
      .prepare("SELECT ator FROM operacoes WHERE natureza = 'teste'")
      .get() as { ator: string };
    assert.equal(op.ator, 'operador:chave-1');
  } finally {
    c.limpar();
  }
});

test('sem declaracao, grava indeterminado — e nao NULL nem `local`', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Bail');
    emOperacao(acervo, { natureza: 'sem-ator', reversibilidade: 'irreversivel' }, () => undefined);
    const op = acervo.db
      .prepare("SELECT ator FROM operacoes WHERE natureza = 'sem-ator'")
      .get() as { ator: string | null };
    // NULL e reservado para linha anterior a migracao. Gravar NULL aqui
    // apagaria a diferenca entre "nao havia campo" e "ninguem declarou".
    assert.equal(op.ator, INDETERMINADO);
  } finally {
    c.limpar();
  }
});

test('o INSERT com Inquilino tambem grava o Ator', () => {
  // A trilha tem DOIS caminhos de INSERT — com e sem Inquilino —, e o segundo e
  // so do Registro. Acrescentar a coluna num e esquecer no outro produz
  // Operacao sem Ator exatamente onde a decisao de configuracao acontece.
  const c = cenario();
  try {
    const inquilino = criarInquilino(c.registro, { titularNome: 'Mon' });
    comAtor(atorDeAcesso('k9'), () => {
      emOperacao(
        c.registro,
        { natureza: 'com-inquilino', reversibilidade: 'irreversivel', inquilinoId: inquilino },
        () => undefined,
      );
    });
    const op = c.registro.db
      .prepare("SELECT ator, inquilino_id FROM operacoes WHERE natureza = 'com-inquilino'")
      .get() as { ator: string; inquilino_id: string };
    assert.equal(op.ator, 'acesso:k9');
    assert.equal(op.inquilino_id, inquilino);
  } finally {
    c.limpar();
  }
});

test('comando administrativo grava o Ator da Chave que autenticou', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const linhas: string[] = [];
    const escrever = (t: string): void => {
      linhas.push(t);
    };
    executar(['operador', 'chave', 'criar'], { dados: raiz, estado: raiz, escrever });
    const texto = linhas.join('\n');
    const chave = texto.match(/valor: (\S+)/)?.[1] ?? '';
    const chaveId = texto.match(/id:\s+(\S+)/)?.[1] ?? '';

    executar(['inquilino', 'criar', '--chave', chave, '--titular', 'Hera'], { dados: raiz, estado: raiz, escrever });

    const registro = abrirRegistro(raiz);
    try {
      const op = registro.db
        .prepare("SELECT ator FROM operacoes WHERE natureza = 'criar-inquilino'")
        .get() as { ator: string };
      // `operador:<id>` e PROVADO: houve credencial verificada. E o id da
      // chave, nunca o valor dela.
      assert.equal(op.ator, `operador:${chaveId}`);
      assert.ok(!op.ator.includes(chave), 'o valor da Chave nao entra no Ator');

      // UMA tentativa por invocacao. Resolver o Ator verificando a chave uma
      // segunda vez faria o log de tentativas mentir sobre quantas vezes ela
      // foi usada — e o log de tentativa e prova de acesso.
      const tentativas = registro.db
        .prepare('SELECT COUNT(*) AS n FROM tentativas_de_chave')
        .get() as { n: number };
      assert.equal(tentativas.n, 1);
    } finally {
      registro.fechar();
    }
  } finally {
    limpar();
  }
});

test('comando de Titular sem credencial grava `local`', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const linhas: string[] = [];
    const escrever = (t: string): void => {
      linhas.push(t);
    };
    executar(['operador', 'chave', 'criar'], { dados: raiz, estado: raiz, escrever });
    const chave = linhas.join('\n').match(/valor: (\S+)/)?.[1] ?? '';
    linhas.length = 0;
    executar(['inquilino', 'criar', '--chave', chave, '--titular', 'Sabine'], { dados: raiz, estado: raiz, escrever });
    const inq = linhas.join('\n').match(/id: (\S+)/)?.[1] ?? '';

    // Comando de Titular NAO exige credencial — e por isso que `local` existe.
    // E fato que o sistema conhece: nenhuma credencial foi apresentada.
    executar(['pessoa', 'vincular', '--inquilino', inq, '--identificador', 'x', '--nome', 'Y'], {
      dados: raiz, estado: raiz,
      escrever,
    });

    const registro = abrirRegistro(raiz);
    try {
      const atores = registro.db
        .prepare('SELECT DISTINCT ator FROM operacoes')
        .all() as { ator: string }[];
      assert.ok(
        !atores.some((a) => a.ator === INDETERMINADO),
        'nenhuma Operacao da CLI fica indeterminada',
      );
    } finally {
      registro.fechar();
    }
  } finally {
    limpar();
  }
});

test('o ouvinte embrulha a recepcao na fronteira SINCRONA, e nao o laco', () => {
  // Guarda de TEXTO, e nao de execucao, porque execucao nao consegue provar
  // isto: um teste com biblioteca injetada dispara de dentro do escopo dele,
  // entao o contexto sobrevive no dublê e morreria no real. A decisao que
  // precisa ser guardada e ESTRUTURAL — onde o escopo abre —, e e no texto que
  // ela se ve.
  //
  // `receberEvento` e sincrono; embrulha-lo faz o Ator valer por construcao.
  // Embrulhar o laco de recepcao dependeria de o contexto atravessar o
  // encanamento assincrono da biblioteca, que tem buffer proprio e religa por
  // temporizador — e sairia `indeterminado` em producao, intermitente ou
  // sempre.
  const fonte = readFileSync(join('src', 'cli', 'ouvir.ts'), 'utf8');
  const semComentario = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.match(
    semComentario,
    /aoReceber:\s*\(mensagens\)\s*=>\s*comAtor\(\s*atorDeServico\(/,
    'o escopo do Ator tem de abrir DENTRO do aoReceber',
  );
  // E a guarda precisa achar o alvo de verdade: sem isto ela passaria por
  // vacuidade se alguem renomeasse o arquivo.
  assert.ok(semComentario.includes('receberEvento('), 'o arquivo medido e o do ouvinte');
});

test('listar e ver Operacao mostram o Ator, e a linha antiga continua legivel', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ezra');
    comAtor(atorDeOperador('k7'), () => {
      emOperacao(acervo, { natureza: 'com-ator', reversibilidade: 'irreversivel' }, () => undefined);
    });
    // Simula a linha ANTERIOR ao ciclo 11: Ator ausente porque nao havia campo.
    // Nao e o mesmo que `indeterminado`, e a saida para humano tem de
    // distinguir as duas — campo em branco se le como erro de formatacao.
    acervo.db
      .prepare(
        `INSERT INTO operacoes (id, natureza, reversibilidade, ocorrida_em, ator)
         VALUES ('velha', 'antiga', 'irreversivel', '2026-01-01T00:00:00.000Z', NULL)`,
      )
      .run();

    const lista = listarOperacoes(acervo, { limite: 10 });
    const nova = lista.find((o) => o.natureza === 'com-ator');
    const velha = lista.find((o) => o.natureza === 'antiga');
    assert.equal(nova?.ator, 'operador:k7');
    assert.equal(velha?.ator, null, 'ausencia atravessa como ausencia');

    const vista = lerOperacao(acervo, 'velha');
    assert.equal(vista?.ator, null);
  } finally {
    c.limpar();
  }
});

test('a Operacao da MIGRACAO nao fica indeterminada', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    // Abrir a base pode MIGRAR, e migrar grava Operacao. Se a abertura
    // acontecer fora de um escopo de Ator, a Operacao mais digna de auditoria
    // do produto — a que muda a forma da base — e justamente a unica sem
    // autor. Achado em 03/09/2026 pela condicao de parada do plano, contra
    // copia da base real: 1 `indeterminado` em cada uma das duas bases, e era
    // a migracao.
    criarRegistroNoPiso(raiz);
    const linhas: string[] = [];
    executar(['inquilino', 'listar', '--chave', 'x'], { dados: raiz, estado: raiz, escrever: (t) => linhas.push(t) });

    const registro = abrirRegistro(raiz);
    try {
      const n = registro.db
        .prepare("SELECT COUNT(*) AS n FROM operacoes WHERE ator = 'indeterminado'")
        .get() as { n: number };
      assert.equal(n.n, 0, 'nenhuma Operacao da CLI fica sem autor');
      const migracao = registro.db
        .prepare("SELECT ator FROM operacoes WHERE natureza = 'migrar-base'")
        .get() as { ator: string } | undefined;
      assert.equal(migracao?.ator, LOCAL, 'a migracao pela CLI e do operador da maquina');
    } finally {
      registro.fechar();
    }
  } finally {
    limpar();
  }
});
