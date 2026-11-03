import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import {
  aprenderCorrespondencia,
  enderecoEhCanonico,
  enderecoTemIdentificador,
  removerCorrespondencia,
} from '../src/nucleo/correspondencia.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import { emOperacao, linhasDaOperacao } from '../src/nucleo/trilha.js';

const contar = (acervo: { db: { prepare(s: string): { get(): unknown } } }): number =>
  (acervo.db.prepare('SELECT COUNT(*) AS n FROM correspondencias_de_endereco').get() as { n: number }).n;

test('enderecoEhCanonico: so o valor que algum par aponta como canonico', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: 'alt', canonico: 'can' });
    assert.equal(enderecoEhCanonico(acervo, 'whatsapp', 'can'), true);
    assert.equal(enderecoEhCanonico(acervo, 'whatsapp', 'alt'), false);
    assert.equal(enderecoEhCanonico(acervo, 'whatsapp', 'nenhum'), false);
    assert.equal(enderecoEhCanonico(acervo, 'instagram', 'can'), false, 'a Fonte conta');
  } finally {
    c.limpar();
  }
});

test('enderecoTemIdentificador: pela Fonte e pelo valor exato', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: 'v1' });
    assert.equal(enderecoTemIdentificador(acervo, 'whatsapp', 'v1'), true);
    assert.equal(enderecoTemIdentificador(acervo, 'whatsapp', 'v2'), false);
    assert.equal(enderecoTemIdentificador(acervo, 'instagram', 'v1'), false, 'a Fonte conta');
  } finally {
    c.limpar();
  }
});

test('aprender com op relata UMA linha de efeito; sem op nao relata', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const id = emOperacao(acervo, { natureza: 'teste-de-efeito', reversibilidade: 'por-efeito' }, (op) => {
      aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: 'a1', canonico: 'c1' }, op);
      // Idempotente: o mesmo par de novo nao relata de novo.
      aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: 'a1', canonico: 'c1' }, op);
      return op.id;
    });
    const linhas = linhasDaOperacao(acervo, id);
    assert.equal(linhas.length, 1);
    assert.deepEqual(
      { t: linhas[0]?.tabela, k: linhas[0]?.chave, c: linhas[0]?.campo, a: linhas[0]?.antes, d: linhas[0]?.depois },
      { t: 'correspondencias_de_endereco', k: JSON.stringify(['whatsapp', 'a1']), c: 'canonico', a: null, d: 'c1' },
    );

    const id2 = emOperacao(acervo, { natureza: 'teste-sem-op', reversibilidade: 'por-efeito' }, (op) => {
      aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: 'a2', canonico: 'c2' });
      return op.id;
    });
    assert.equal(linhasDaOperacao(acervo, id2).length, 0, 'sem op passada, nada e relatado');
  } finally {
    c.limpar();
  }
});

test('removerCorrespondencia remove so o par exato; canonico diferente nao remove', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: 'a1', canonico: 'c1' });
    assert.equal(removerCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: 'a1', canonico: 'outro' }), false);
    assert.equal(contar(acervo), 1);
    assert.equal(removerCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: 'a1', canonico: 'c1' }), true);
    assert.equal(contar(acervo), 0);
    assert.equal(removerCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: 'a1', canonico: 'c1' }), false);
  } finally {
    c.limpar();
  }
});
