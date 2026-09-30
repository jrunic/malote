import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import {
  criarPessoa,
  listarElegiveisParaPromocao,
  registrarNome,
  vincularIdentificador,
} from '../src/nucleo/identidade.js';

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
