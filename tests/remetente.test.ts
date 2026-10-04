import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identificadoresDoRemetente } from '../src/nucleo/remetente.js';
import { identificarPorValor } from '../src/nucleo/identificar.js';
import {
  acervoDeIdentidade,
  PRECEDENCIA,
  ANA,
  BRUNO,
  BRUNO_LID,
  CARLA,
  CARLA_LID,
  DANI,
  EDU,
  SOLTO_LID,
} from './ajuda/identidade.js';

test('o valor canonico e o alternativo so como correspondencia alcancam o mesmo Identificador (#1129)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    assert.deepEqual(identificadoresDoRemetente(acervo, { valor: BRUNO }), [s.bruno]);
    assert.deepEqual(identificadoresDoRemetente(acervo, { valor: BRUNO_LID }), [s.bruno]);
  } finally {
    limpar();
  }
});

test('a forma alternativa gravada como linha alcanca as duas linhas, nos dois sentidos (#1129)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const esperado = [s.carla, s.carlaLid].sort();
    assert.deepEqual(identificadoresDoRemetente(acervo, { valor: CARLA }), esperado);
    assert.deepEqual(identificadoresDoRemetente(acervo, { valor: CARLA_LID }), esperado);
  } finally {
    limpar();
  }
});

test('valor que o Acervo nunca viu devolve lista vazia, e a Fonte restringe (#1129)', () => {
  const { acervo, limpar } = acervoDeIdentidade();
  try {
    assert.deepEqual(identificadoresDoRemetente(acervo, { valor: '000@lid' }), []);
    assert.deepEqual(identificadoresDoRemetente(acervo, { valor: BRUNO, fonte: 'instagram' }), []);
    assert.equal(identificadoresDoRemetente(acervo, { valor: BRUNO, fonte: 'whatsapp' }).length, 1);
  } finally {
    limpar();
  }
});

test('concorda com identificarPorValor para todo valor da fixture: sao a mesma pergunta (#1129)', () => {
  const { acervo, limpar } = acervoDeIdentidade();
  try {
    for (const valor of [ANA, BRUNO, BRUNO_LID, CARLA, CARLA_LID, DANI, EDU, SOLTO_LID, '000@lid']) {
      const dele = identificarPorValor(acervo, { valor }, PRECEDENCIA)
        .identificadores.map((i) => i.id)
        .sort();
      assert.deepEqual(identificadoresDoRemetente(acervo, { valor }), dele, valor);
    }
  } finally {
    limpar();
  }
});
