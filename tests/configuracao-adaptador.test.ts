import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import {
  APELIDO_PADRAO,
  definirContaDaConfiguracao,
  listarConfiguracoes,
  resolverConfiguracao,
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
