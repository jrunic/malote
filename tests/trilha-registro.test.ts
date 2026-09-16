import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { definirPoliticaDeRetencao } from '../src/registro/politica-de-retencao.js';
import { configurarDestinoDeMidia } from '../src/registro/destino-midia.js';
import { definirPrecedenciaDeNome } from '../src/registro/precedencia-de-nome.js';
import { definirIntervaloEsperado } from '../src/registro/intervalo-esperado.js';
import {
  definirContaDaConfiguracao,
  resolverConfiguracao,
} from '../src/registro/configuracao-adaptador.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import {
  criarChaveDeOperador,
  revogarChaveDeOperador,
  verificarChaveDeOperador,
} from '../src/registro/chave-operador.js';
import { listarOperacoesCruas, linhasDaOperacao } from '../src/nucleo/trilha.js';

test('criar Inquilino grava Operação com o Inquilino nomeado', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    const id = criarInquilino(registro, { titularNome: 'Leia Organa' });

    const ops = listarOperacoesCruas(registro).filter((o) => o.natureza === 'criar-inquilino');
    assert.equal(ops.length, 1);
    const linhas = linhasDaOperacao(registro, ops[0]?.id ?? '');
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0]?.tabela, 'inquilinos');
    assert.equal(linhas[0]?.chave, id);
    assert.equal(linhas[0]?.antes, null);

    const coluna = registro.db
      .prepare('SELECT inquilino_id FROM operacoes WHERE id = ?')
      .get(ops[0]?.id) as { inquilino_id: string | null };
    assert.equal(coluna.inquilino_id, id);
  } finally {
    registro.fechar();
    limpar();
  }
});

test('criar Chave de Operador grava Operação SEM Inquilino e sem material da credencial', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    const { id, valor } = criarChaveDeOperador(registro);

    const ops = listarOperacoesCruas(registro).filter(
      (o) => o.natureza === 'criar-chave-operador',
    );
    assert.equal(ops.length, 1);

    const coluna = registro.db
      .prepare('SELECT inquilino_id FROM operacoes WHERE id = ?')
      .get(ops[0]?.id) as { inquilino_id: string | null };
    assert.equal(coluna.inquilino_id, null, 'ato de instalação não é de Inquilino nenhum');

    const linhas = linhasDaOperacao(registro, ops[0]?.id ?? '');
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0]?.chave, id);
    assert.equal(linhas[0]?.depois, id);

    // A credencial NAO ganha uma segunda casa. Nem o valor, nem o hash, nem o sal.
    const tudo = JSON.stringify(linhas);
    assert.doesNotMatch(tudo, new RegExp(valor.slice(0, 12)), 'o valor não vaza para a trilha');
    for (const campo of ['sal', 'hash']) {
      assert.equal(
        linhas.some((l) => l.campo === campo),
        false,
        `${campo} não entra na trilha`,
      );
    }
  } finally {
    registro.fechar();
    limpar();
  }
});

test('revogar Chave grava Operação; revogar de novo não é ato', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    const primeira = criarChaveDeOperador(registro);
    criarChaveDeOperador(registro); // a guarda recusa revogar a ultima ativa

    revogarChaveDeOperador(registro, primeira.id);
    revogarChaveDeOperador(registro, primeira.id);

    const ops = listarOperacoesCruas(registro).filter(
      (o) => o.natureza === 'revogar-chave-operador',
    );
    assert.equal(ops.length, 1, 'a segunda revogação é sem efeito e não é ato');

    const linhas = linhasDaOperacao(registro, ops[0]?.id ?? '');
    const revogada = linhas.find((l) => l.campo === 'revogada_em');
    assert.equal(revogada?.antes, null);
    assert.match(revogada?.depois ?? '', /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    registro.fechar();
    limpar();
  }
});

test('a verificação de chave NÃO grava Operação — tentativa é log, não decisão', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    const { valor } = criarChaveDeOperador(registro);
    const antes = listarOperacoesCruas(registro).length;

    verificarChaveDeOperador(registro, valor);
    verificarChaveDeOperador(registro, 'errada');

    assert.equal(listarOperacoesCruas(registro).length, antes, 'verificar não é decisão');
    const tentativas = registro.db
      .prepare('SELECT COUNT(*) AS n FROM tentativas_de_chave')
      .get() as { n: number };
    assert.equal(tentativas.n, 2, 'mas o log de tentativas continua sendo escrito');
  } finally {
    registro.fechar();
    limpar();
  }
});

test('redefinir a Política guarda o valor ANTERIOR, que hoje se perde', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    const inq = criarInquilino(registro, { titularNome: 'Leia Organa' });

    definirPoliticaDeRetencao(registro, inq, { maisVelhoQueDias: 365 });
    definirPoliticaDeRetencao(registro, inq, { maisVelhoQueDias: 90 });

    const ops = listarOperacoesCruas(registro).filter((o) => o.natureza === 'definir-politica');
    assert.equal(ops.length, 2);

    // A mais recente vem primeiro.
    const daSegunda = linhasDaOperacao(registro, ops[0]?.id ?? '');
    const dias = daSegunda.find((l) => l.campo === 'mais_velho_que_dias');
    assert.equal(dias?.antes, '365', 'o valor anterior fica registrado');
    assert.equal(dias?.depois, '90');

    const daPrimeira = linhasDaOperacao(registro, ops[1]?.id ?? '');
    assert.equal(
      daPrimeira.find((l) => l.campo === 'mais_velho_que_dias')?.antes,
      null,
      'não havia Política antes',
    );
  } finally {
    registro.fechar();
    limpar();
  }
});

test('redefinir com o MESMO valor não inventa mudança que não houve', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    const inq = criarInquilino(registro, { titularNome: 'Han Solo' });
    definirPoliticaDeRetencao(registro, inq, { maisVelhoQueDias: 365 });
    definirPoliticaDeRetencao(registro, inq, { maisVelhoQueDias: 365 });

    const ops = listarOperacoesCruas(registro).filter((o) => o.natureza === 'definir-politica');
    assert.equal(ops.length, 2, 'os dois atos aconteceram');
    assert.equal(
      linhasDaOperacao(registro, ops[0]?.id ?? '').length,
      0,
      'ato sem mudança grava Operação sem linha de efeito',
    );
  } finally {
    registro.fechar();
    limpar();
  }
});

test('Destino, Precedência e Intervalo também gravam Operação com o Inquilino', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    const inq = criarInquilino(registro, { titularNome: 'Chewbacca' });
    configurarDestinoDeMidia(registro, inq, { natureza: 'local', endereco: join(raiz, 'midia') });
    definirPrecedenciaDeNome(registro, inq, 'whatsapp', 50);
    // resolverConfiguracao devolve o OBJETO ConfiguracaoDeAdaptador, nao o id.
    const cfg = resolverConfiguracao(registro, inq, 'whatsapp', 'principal');
    definirIntervaloEsperado(registro, cfg.id, 7);

    const naturezas = listarOperacoesCruas(registro).map((o) => o.natureza);
    for (const esperada of [
      'configurar-destino',
      'definir-precedencia',
      'resolver-configuracao',
      'definir-intervalo',
    ]) {
      assert.ok(naturezas.includes(esperada), `falta ${esperada}`);
    }

    // Toda decisão de configuração é de um Inquilino, e a coluna diz qual.
    const semInquilino = registro.db
      .prepare(
        `SELECT COUNT(*) AS n FROM operacoes
          WHERE natureza IN ('configurar-destino','definir-precedencia','definir-intervalo')
            AND inquilino_id IS NULL`,
      )
      .get() as { n: number };
    assert.equal(semInquilino.n, 0);
  } finally {
    registro.fechar();
    limpar();
  }
});

test('resolver Configuração grava Operação só quando cria', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    const inq = criarInquilino(registro, { titularNome: 'Leia Organa' });

    const primeira = resolverConfiguracao(registro, inq, 'whatsapp', 'principal');
    const segunda = resolverConfiguracao(registro, inq, 'whatsapp', 'principal');
    assert.equal(primeira.id, segunda.id, 'a segunda devolve a mesma');

    const ops = listarOperacoesCruas(registro).filter(
      (o) => o.natureza === 'resolver-configuracao',
    );
    assert.equal(ops.length, 1, 'resolver o que já existe não é ato');
    assert.equal(linhasDaOperacao(registro, ops[0]?.id ?? '')[0]?.chave, primeira.id);
  } finally {
    registro.fechar();
    limpar();
  }
});

test('definir a conta da Configuração grava Operação com o valor anterior', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    const inq = criarInquilino(registro, { titularNome: 'Han Solo' });
    const cfg = resolverConfiguracao(registro, inq, 'whatsapp', 'principal').id;

    definirContaDaConfiguracao(registro, cfg, 'pessoal');
    definirContaDaConfiguracao(registro, cfg, 'business');

    const ops = listarOperacoesCruas(registro).filter((o) => o.natureza === 'definir-conta');
    assert.equal(ops.length, 2);
    const daSegunda = linhasDaOperacao(registro, ops[0]?.id ?? '');
    assert.equal(daSegunda.find((l) => l.campo === 'conta')?.antes, 'pessoal');
    assert.equal(daSegunda.find((l) => l.campo === 'conta')?.depois, 'business');
  } finally {
    registro.fechar();
    limpar();
  }
});

test('os 9 comandos de decisão do Registro gravam Operação — nem mais, nem menos', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    const inq = criarInquilino(registro, { titularNome: 'Leia Organa' });
    const primeira = criarChaveDeOperador(registro);
    criarChaveDeOperador(registro);
    revogarChaveDeOperador(registro, primeira.id);
    const cfg = resolverConfiguracao(registro, inq, 'whatsapp', 'principal').id;
    definirContaDaConfiguracao(registro, cfg, 'pessoal');
    configurarDestinoDeMidia(registro, inq, { natureza: 'local', endereco: join(raiz, 'midia') });
    definirIntervaloEsperado(registro, cfg, 7);
    definirPoliticaDeRetencao(registro, inq, { maisVelhoQueDias: 365 });
    definirPrecedenciaDeNome(registro, inq, 'whatsapp', 50);

    const naturezas = listarOperacoesCruas(registro).map((o) => o.natureza);
    assert.deepEqual(
      [...new Set(naturezas)].sort(),
      [
        'configurar-destino',
        'criar-chave-operador',
        'criar-inquilino',
        'definir-conta',
        'definir-intervalo',
        'definir-politica',
        'definir-precedencia',
        'resolver-configuracao',
        'revogar-chave-operador',
      ],
      'os nove comandos de decisão do Registro',
    );
    // 10 Operações: `criar-chave-operador` foi chamado duas vezes.
    assert.equal(naturezas.length, 10);
  } finally {
    registro.fechar();
    limpar();
  }
});
