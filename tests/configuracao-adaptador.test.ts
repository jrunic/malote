import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import {
  APELIDO_PADRAO,
  configuracoesPorApelido,
  definirContaDaConfiguracao,
  listarConfiguracoes,
  resolverConfiguracao,
  resolverFiltroDeConfiguracao,
} from '../src/registro/configuracao-adaptador.js';

test('a Configuração padrão nasce por demanda e é estável', () => {
  const c = cenario();
  try {
    const { id } = c.novoInquilino('Leia Organa');
    const a = resolverConfiguracao(c.registro, id, 'whatsapp');
    const b = resolverConfiguracao(c.registro, id, 'whatsapp');
    assert.equal(a.id, b.id, 'resolver duas vezes não pode criar duas Configurações');
    assert.equal(a.apelido, APELIDO_PADRAO);
    assert.equal(a.conta, null, 'sem conta declarada, é nula — nunca um palpite');
  } finally {
    c.limpar();
  }
});

test('Configurações da mesma Fonte convivem sob apelidos distintos', () => {
  const c = cenario();
  try {
    const { id } = c.novoInquilino('Leia Organa');
    const pessoal = resolverConfiguracao(c.registro, id, 'whatsapp', 'pessoal');
    const trabalho = resolverConfiguracao(c.registro, id, 'whatsapp', 'trabalho');
    assert.notEqual(pessoal.id, trabalho.id);
    assert.equal(listarConfiguracoes(c.registro, id).length, 2);
  } finally {
    c.limpar();
  }
});

test('a conta é do Adaptador e o Registro a guarda opaca', () => {
  const c = cenario();
  try {
    const { id } = c.novoInquilino('Leia Organa');
    const cfg = resolverConfiguracao(c.registro, id, 'whatsapp', 'trabalho');
    definirContaDaConfiguracao(c.registro, cfg.id, 'business');
    assert.equal(resolverConfiguracao(c.registro, id, 'whatsapp', 'trabalho').conta, 'business');
  } finally {
    c.limpar();
  }
});

test('Configuração não atravessa Inquilino', () => {
  const c = cenario();
  try {
    const { id: leia } = c.novoInquilino('Leia Organa');
    const { id: han } = c.novoInquilino('Han Solo');
    resolverConfiguracao(c.registro, leia, 'whatsapp');
    assert.equal(listarConfiguracoes(c.registro, han).length, 0);
  } finally {
    c.limpar();
  }
});

test('Inquilino desconhecido é recusado', () => {
  const c = cenario();
  try {
    assert.throws(
      () => resolverConfiguracao(c.registro, 'nao-existe', 'whatsapp'),
      /Inquilino desconhecido/,
    );
  } finally {
    c.limpar();
  }
});

test('configuracoesPorApelido devolve todas as Configuracoes com aquele apelido, em Fontes diferentes', () => {
  const c = cenario();
  try {
    const { id: inquilino } = c.novoInquilino('Leia');
    resolverConfiguracao(c.registro, inquilino, 'whatsapp', 'orlando');
    resolverConfiguracao(c.registro, inquilino, 'instagram', 'orlando');
    resolverConfiguracao(c.registro, inquilino, 'whatsapp', 'freud');

    const achadas = configuracoesPorApelido(c.registro, inquilino, 'orlando');

    assert.equal(achadas.length, 2);
    assert.deepEqual(achadas.map((a) => a.fonte).sort(), ['instagram', 'whatsapp']);
  } finally {
    c.limpar();
  }
});

test('configuracoesPorApelido devolve lista vazia quando nao ha candidato', () => {
  const c = cenario();
  try {
    const { id: inquilino } = c.novoInquilino('Leia');
    assert.deepEqual(configuracoesPorApelido(c.registro, inquilino, 'inexistente'), []);
  } finally {
    c.limpar();
  }
});

test('resolverFiltroDeConfiguracao resolve direto quando a Fonte e informada', () => {
  const c = cenario();
  try {
    const { id: inquilino } = c.novoInquilino('Leia');
    const cfg = resolverConfiguracao(c.registro, inquilino, 'whatsapp', 'orlando');

    const r = resolverFiltroDeConfiguracao(c.registro, inquilino, 'orlando', 'whatsapp');

    assert.equal(r.ok, true);
    assert.equal(r.ok && r.configuracao.id, cfg.id);
  } finally {
    c.limpar();
  }
});

test('resolverFiltroDeConfiguracao resolve sem Fonte quando ha SO UM candidato', () => {
  const c = cenario();
  try {
    const { id: inquilino } = c.novoInquilino('Leia');
    const cfg = resolverConfiguracao(c.registro, inquilino, 'whatsapp', 'freud');

    const r = resolverFiltroDeConfiguracao(c.registro, inquilino, 'freud');

    assert.equal(r.ok, true);
    assert.equal(r.ok && r.configuracao.id, cfg.id);
  } finally {
    c.limpar();
  }
});

test('resolverFiltroDeConfiguracao recusa apelido AMBIGUO sem Fonte, nomeando as Fontes', () => {
  const c = cenario();
  try {
    const { id: inquilino } = c.novoInquilino('Leia');
    resolverConfiguracao(c.registro, inquilino, 'whatsapp', 'orlando');
    resolverConfiguracao(c.registro, inquilino, 'instagram', 'orlando');

    const r = resolverFiltroDeConfiguracao(c.registro, inquilino, 'orlando');

    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.erro : '', /ambigu/i);
    assert.match(!r.ok ? r.erro : '', /instagram/);
    assert.match(!r.ok ? r.erro : '', /whatsapp/);
  } finally {
    c.limpar();
  }
});

test('resolverFiltroDeConfiguracao recusa apelido DESCONHECIDO', () => {
  const c = cenario();
  try {
    const { id: inquilino } = c.novoInquilino('Leia');
    const r = resolverFiltroDeConfiguracao(c.registro, inquilino, 'nao-existe');
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.erro : '', /desconhec/i);
  } finally {
    c.limpar();
  }
});
