import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pareceValorSentinela } from '../src/adaptadores/whatsapp/nome-sentinela-de-contato.js';

// Valores REAIS medidos no Acervo de produção em 30/09/2026 (tarefa #1101).
// Não são dado pessoal: são o valor que `action.contactAction.fullName`
// (WAProto, campo 1) traz quando o contato nunca foi nomeado de verdade —
// artefato de protocolo, não nome. `+EAA=` sozinho é 5.897 das 7.253
// ocorrências medidas em identificadores sem Pessoa (81%); os demais têm a
// mesma forma com comprimento maior (mais campos presentes na mutação).
const SENTINELAS_REAIS = [
  '+EAA=',
  '+EAAY9Lyw0wY=',
  '+CgAQ9/GbyQY=',
  '+GPr48dMGIAE=',
  '+EAAYxN+p0wYgAQ==',
  '+EAAYrfnM1AYgAQ==',
  '+CgAQ38CXyAY=',
];

test('reconhece os valores-sentinela medidos em produção', () => {
  for (const v of SENTINELAS_REAIS) {
    assert.equal(pareceValorSentinela(v), true, v);
  }
});

test('nome humano não é confundido com sentinela', () => {
  for (const nome of ['Ana Prado', 'Han Solo', 'Zé', 'Bea Nunes', 'Marcus | 89075 | Privilege']) {
    assert.equal(pareceValorSentinela(nome), false, nome);
  }
});

test('telefone formatado (nome repete endereço) não é sentinela — outra regra cuida disso', () => {
  assert.equal(pareceValorSentinela('+55 65 99229-0832'), false);
});

test('string vazia não é sentinela', () => {
  assert.equal(pareceValorSentinela(''), false);
});

test('quase-sentinela sem o "=" de padding final não é reconhecido', () => {
  // Precisão do discriminador: exige a FORMA inteira (prefixo +, alfabeto
  // base64, padding), não só o prefixo — nome real começando com caractere
  // parecido não deve ser pego por coincidência de um pedaço só.
  assert.equal(pareceValorSentinela('+EAA'), false);
});
