import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nomeEscolhido, nomesDoIdentificador, nomeDoIdentificador } from '../src/nucleo/identidade.js';
import { acervoDeIdentidade, PRECEDENCIA } from './ajuda/identidade.js';

test('o nome escolhido diz DE QUAL Atribuicao veio: a origem de maior peso vence (#1126)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const escolhido = nomeEscolhido(nomesDoIdentificador(acervo, s.bruno), PRECEDENCIA);
    assert.equal(escolhido?.nome, 'Bruno Contato');
    assert.equal(escolhido?.origem, 'contatos');
    assert.equal(escolhido?.autoridade, 'titular');
  } finally {
    limpar();
  }
});

test('trocar a precedencia troca o vencedor, e a origem junto (#1126)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const invertida = { porOrigem: { whatsapp: 500, contatos: 10 }, catalogoPreferido: null };
    const escolhido = nomeEscolhido(nomesDoIdentificador(acervo, s.bruno), invertida);
    assert.equal(escolhido?.nome, 'Bruno Silva');
    assert.equal(escolhido?.origem, 'whatsapp');
  } finally {
    limpar();
  }
});

test('sem Atribuicao nenhuma, nao ha nome escolhido (#1126)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    assert.equal(nomeEscolhido(nomesDoIdentificador(acervo, s.edu), PRECEDENCIA), null);
  } finally {
    limpar();
  }
});

test('o texto do nome corrente continua o mesmo que antes (nomeDoIdentificador) (#1126)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    assert.equal(nomeDoIdentificador(acervo, s.bruno, PRECEDENCIA), 'Bruno Contato');
    assert.equal(nomeDoIdentificador(acervo, s.edu, PRECEDENCIA), null);
  } finally {
    limpar();
  }
});
