import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soDigitos, variantesDeEndereco } from '../src/adaptadores/contatos/telefone.js';

test('reduz a dígitos os quatro formatos mais frequentes do material real', () => {
  assert.equal(soDigitos('+5511912345678'), '5511912345678');
  assert.equal(soDigitos('+55 (11) 91234-5678'), '5511912345678');
  assert.equal(soDigitos('+55 (11) 3333-4444'), '551133334444');
  assert.equal(soDigitos('+55 11 91234-5678'), '5511912345678');
});

test('do celular com nono dígito nasce também a forma de oito', () => {
  const v = variantesDeEndereco('+55 (11) 91234-5678');
  assert.deepEqual([...v].sort(), ['551112345678', '5511912345678']);
});

test('do celular sem nono dígito nasce também a forma de nove — o sentido inverso', () => {
  const v = variantesDeEndereco('+55 11 8123-4567');
  assert.deepEqual([...v].sort(), ['551181234567', '5511981234567']);
});

test('fixo de oito dígitos NÃO ganha nono — só móvel ganhou', () => {
  // 2xxx e 3xxx sao fixos; inventar o nono neles casaria com um celular real.
  const v = variantesDeEndereco('+55 (11) 3333-4444');
  assert.deepEqual([...v], ['551133334444']);
});

test('número que não é brasileiro passa intacto e sem variante', () => {
  const v = variantesDeEndereco('+1 415-555-0134');
  assert.deepEqual([...v], ['14155550134']);
});

test('vazio e lixo não produzem endereço', () => {
  assert.equal(variantesDeEndereco('   ').size, 0);
  assert.equal(variantesDeEndereco('--').size, 0);
});
