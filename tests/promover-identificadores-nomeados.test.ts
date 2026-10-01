import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import {
  criarPessoa,
  lerPessoa,
  lerVinculo,
  listarElegiveisParaPromocao,
  nomesDoIdentificador,
  promoverIdentificadores,
  registrarNome,
  vincularIdentificador,
} from '../src/nucleo/identidade.js';
import { listarOperacoesCruas } from '../src/nucleo/trilha.js';
import { desfazerOperacao } from '../src/nucleo/desfazer.js';
import { aplicarConjunto } from '../src/nucleo/aplicacao.js';

test('sem Atribuição nenhuma, não é elegível', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000001' });

    assert.equal(listarElegiveisParaPromocao(acervo).length, 0);
  } finally {
    c.limpar();
  }
});

test('com Atribuição só terceiro, é elegível', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000002' });
    registrarNome(acervo, { identificadorId: id, origem: 'whatsapp', nome: 'Han', autoridade: 'terceiro' });

    const elegiveis = listarElegiveisParaPromocao(acervo);
    assert.equal(elegiveis.length, 1);
    assert.equal(elegiveis[0]?.identificadorId, id);
    assert.equal(elegiveis[0]?.fonte, 'whatsapp');
    assert.equal(elegiveis[0]?.valor, '5565900000002');
  } finally {
    c.limpar();
  }
});

test('com Atribuição mas já vinculado a Pessoa, não é elegível de novo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000003' });
    registrarNome(acervo, { identificadorId: id, origem: 'whatsapp', nome: 'Han', autoridade: 'terceiro' });
    const pessoa = criarPessoa(acervo);
    vincularIdentificador(acervo, { identificadorId: id, pessoaId: pessoa, procedencia: 'humano' });

    assert.equal(listarElegiveisParaPromocao(acervo).length, 0);
  } finally {
    c.limpar();
  }
});

test('com Atribuição pendurada na Pessoa, não se aplica — já tem Pessoa', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000004' });
    const pessoa = criarPessoa(acervo);
    vincularIdentificador(acervo, { identificadorId: id, pessoaId: pessoa, procedencia: 'humano' });
    registrarNome(acervo, { pessoaId: pessoa, origem: 'manual', nome: 'Han Solo', autoridade: 'titular' });

    assert.equal(listarElegiveisParaPromocao(acervo).length, 0);
  } finally {
    c.limpar();
  }
});

test('promove cria uma Pessoa por Identificador, com Procedencia material', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const a = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000010' });
    const b = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000011' });
    registrarNome(acervo, { identificadorId: a.id, origem: 'whatsapp', nome: 'Han', autoridade: 'terceiro' });
    registrarNome(acervo, { identificadorId: b.id, origem: 'whatsapp', nome: 'Leia', autoridade: 'titular' });

    const r = promoverIdentificadores(acervo, [a.id, b.id]);

    assert.equal(r.pessoasCriadas.length, 2);
    assert.equal(r.vinculos.length, 2);
    const vinculoA = lerVinculo(acervo, a.id);
    assert.equal(vinculoA?.procedencia, 'material');
    assert.ok(vinculoA?.pessoaId);
    const vinculoB = lerVinculo(acervo, b.id);
    assert.equal(vinculoB?.procedencia, 'material');
  } finally {
    c.limpar();
  }
});

test('a invocacao inteira grava UMA Operacao so, nao uma por vinculo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const a = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000012' });
    const b = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000013' });
    registrarNome(acervo, { identificadorId: a.id, origem: 'whatsapp', nome: 'Han', autoridade: 'terceiro' });
    registrarNome(acervo, { identificadorId: b.id, origem: 'whatsapp', nome: 'Leia', autoridade: 'titular' });

    promoverIdentificadores(acervo, [a.id, b.id]);

    const operacoes = listarOperacoesCruas(acervo);
    const doPromover = operacoes.filter((o) => o.natureza === 'promover-identificadores-nomeados');
    assert.equal(doPromover.length, 1);
    const internas = operacoes.filter(
      (o) => o.natureza === 'criar-pessoa' || o.natureza === 'vincular',
    );
    assert.equal(internas.length, 0, 'as chamadas internas se juntam a Operacao de fora');
  } finally {
    c.limpar();
  }
});

test('promoverIdentificadores com lista vazia nao grava Operacao nenhuma', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const antes = listarOperacoesCruas(acervo).length;

    const r = promoverIdentificadores(acervo, []);

    assert.deepEqual(r, { pessoasCriadas: [], vinculos: [] });
    assert.equal(listarOperacoesCruas(acervo).length, antes);
  } finally {
    c.limpar();
  }
});

test('desfazer a Operacao de uma promocao desvincula; a Pessoa e recusada e permanece', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const a = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000014' });
    registrarNome(acervo, { identificadorId: a.id, origem: 'whatsapp', nome: 'Han', autoridade: 'terceiro' });
    const r = promoverIdentificadores(acervo, [a.id]);
    const pessoaId = r.pessoasCriadas[0];
    assert.ok(pessoaId);
    const operacaoId = listarOperacoesCruas(acervo)[0]?.id;
    assert.ok(operacaoId);

    const desfeito = desfazerOperacao(acervo, operacaoId);

    assert.equal(lerVinculo(acervo, a.id), null, 'Identificador volta a orfao');
    assert.equal(desfeito.recusados.length, 1);
    assert.ok(lerPessoa(acervo, pessoaId, { porOrigem: {}, catalogoPreferido: null }));
    assert.equal(nomesDoIdentificador(acervo, a.id).length, 1, 'a Atribuicao do endereco continua la');
  } finally {
    c.limpar();
  }
});

test('catalogo que aponta pro mesmo endereco ja promovido vincula, sem criar Pessoa nova', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const doWhats = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000020' });
    registrarNome(acervo, { identificadorId: doWhats.id, origem: 'whatsapp', nome: 'Han', autoridade: 'terceiro' });
    const r = promoverIdentificadores(acervo, [doWhats.id]);
    const pessoaMaterial = r.pessoasCriadas[0];

    const doCatalogo = registrarIdentificador(acervo, { fonte: 'contatos', valor: 'han@example.com' });

    const resultado = aplicarConjunto(acervo, [doWhats.id, doCatalogo.id]);

    assert.equal(resultado.pessoasCriadas.length, 0, 'nao cria Pessoa nova');
    assert.equal(resultado.vinculos.length, 1, 'so o de catalogo precisa de vinculo novo');
    const vinculoCatalogo = lerVinculo(acervo, doCatalogo.id);
    assert.equal(vinculoCatalogo?.pessoaId, pessoaMaterial);
  } finally {
    c.limpar();
  }
});

test('dois Identificadores promovidos separadamente se fundem quando um catalogo liga os dois', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const a = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000021' });
    const b = registrarIdentificador(acervo, { fonte: 'instagram', valor: 'conversa:99' });
    registrarNome(acervo, { identificadorId: a.id, origem: 'whatsapp', nome: 'Han', autoridade: 'terceiro' });
    registrarNome(acervo, { identificadorId: b.id, origem: 'instagram', nome: 'Han Solo', autoridade: 'terceiro' });
    const rA = promoverIdentificadores(acervo, [a.id]);
    const rB = promoverIdentificadores(acervo, [b.id]);
    assert.notEqual(rA.pessoasCriadas[0], rB.pessoasCriadas[0], 'duas Pessoas material distintas');

    const doCatalogo = registrarIdentificador(acervo, { fonte: 'contatos', valor: 'han@example.com' });
    const resultado = aplicarConjunto(acervo, [a.id, b.id, doCatalogo.id]);

    assert.equal(resultado.mesclagens.length, 1, 'as duas Pessoas material se fundem');
    assert.equal(resultado.mesclagens[0]?.regra, 'ordem-de-chamada', 'nenhum dos dois tem catalogo ainda');
  } finally {
    c.limpar();
  }
});
