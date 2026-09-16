import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalacaoTemporaria, instalacaoComInquilino, rodar } from './ajuda/instalacao.js';
import { criarAcervoNoPiso } from './ajuda/acervo-no-piso.js';
import { PISO_SCHEMA_ACERVO, VERSAO_SCHEMA_ACERVO } from '../src/nucleo/schema-acervo.js';

test('acervo migrar sobe a forma e nomeia o passo aplicado', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const id = instalacaoComInquilino(raiz);
    criarAcervoNoPiso(raiz, id);

    const r = rodar(raiz, ['acervo', 'migrar', '--inquilino', id]);
    assert.equal(r.codigo, 0);
    assert.match(r.saida, new RegExp(`forma ${PISO_SCHEMA_ACERVO} subiu para ${VERSAO_SCHEMA_ACERVO}`));
    assert.match(r.saida, /contabilidade/, 'nomeia o passo');
    assert.match(r.saida, /\[ok:/, 'mostra o resultado da conferência');
  } finally {
    limpar();
  }
});

test('acervo migrar sobre base já corrente se anuncia como sem trabalho', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const id = instalacaoComInquilino(raiz);
    const r = rodar(raiz, ['acervo', 'migrar', '--inquilino', id]);
    assert.equal(r.codigo, 0);
    assert.match(r.saida, /nada a aplicar/i);
  } finally {
    limpar();
  }
});

test('acervo migrar recusa Inquilino desconhecido', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    instalacaoComInquilino(raiz);
    const r = rodar(raiz, ['acervo', 'migrar', '--inquilino', 'nao-existe']);
    assert.notEqual(r.codigo, 0);
  } finally {
    limpar();
  }
});

test('o comando que a mensagem de erro do relatório nomeia existe de verdade', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const id = instalacaoComInquilino(raiz);
    criarAcervoNoPiso(raiz, id);

    // O relatorio manda rodar `malote acervo migrar`. Comando citado em
    // mensagem passa pelo teste de existencia: mensagem que aponta comando
    // inexistente e pior que mensagem sem instrucao.
    const relatorio = rodar(raiz, ['acervo', 'relatar', '--inquilino', id]);
    if (/acervo migrar/.test(relatorio.saida)) {
      assert.equal(rodar(raiz, ['acervo', 'migrar', '--inquilino', id]).codigo, 0);
    }
    assert.match(rodar(raiz, ['--ajuda']).saida, /acervo migrar/);
  } finally {
    limpar();
  }
});
