import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outraFormaDoCelular } from '../src/adaptadores/whatsapp/celular-br.js';
import { mesmoTelefone } from '../src/adaptadores/whatsapp/identidade-da-conta.js';

const SEM_NOVE = '556599991234@s.whatsapp.net';
const COM_NOVE = '5565999991234@s.whatsapp.net';

test('celular de 12 digitos devolve a forma com o 9', () => {
  assert.equal(outraFormaDoCelular(SEM_NOVE), COM_NOVE);
});

test('celular de 13 digitos devolve a forma sem o 9', () => {
  assert.equal(outraFormaDoCelular(COM_NOVE), SEM_NOVE);
});

test('a regra e uma involucao: aplicar duas vezes devolve o endereco', () => {
  assert.equal(outraFormaDoCelular(outraFormaDoCelular(SEM_NOVE) as string), SEM_NOVE);
  assert.equal(outraFormaDoCelular(outraFormaDoCelular(COM_NOVE) as string), COM_NOVE);
});

test('assinante de 8 digitos comecando em 6, 7 e 8 tambem e celular', () => {
  assert.equal(outraFormaDoCelular('556561234567@s.whatsapp.net'), '5565961234567@s.whatsapp.net');
  assert.equal(outraFormaDoCelular('556571234567@s.whatsapp.net'), '5565971234567@s.whatsapp.net');
  assert.equal(outraFormaDoCelular('556581234567@s.whatsapp.net'), '5565981234567@s.whatsapp.net');
});

test('fixo (assinante comecando em 2 a 5) nao ganha 9', () => {
  assert.equal(outraFormaDoCelular('556532221234@s.whatsapp.net'), null);
  assert.equal(outraFormaDoCelular('556542221234@s.whatsapp.net'), null);
  assert.equal(outraFormaDoCelular('556552221234@s.whatsapp.net'), null);
});

test('13 digitos com 9 seguido de 0 a 5 nao e celular pela regra da conta', () => {
  assert.equal(outraFormaDoCelular('5565905551234@s.whatsapp.net'), null);
  assert.equal(outraFormaDoCelular('5565915551234@s.whatsapp.net'), null);
  assert.equal(outraFormaDoCelular('5565955551234@s.whatsapp.net'), null);
});

test('outro pais, outro sufixo e outro formato nao sao celular brasileiro', () => {
  assert.equal(outraFormaDoCelular('14155550123@s.whatsapp.net'), null);
  assert.equal(outraFormaDoCelular('100000000000001@lid'), null);
  assert.equal(outraFormaDoCelular('120363000000000001@g.us'), null);
  assert.equal(outraFormaDoCelular('556599991234'), null);
  assert.equal(outraFormaDoCelular('556599991234:12@s.whatsapp.net'), null);
  assert.equal(outraFormaDoCelular('5565999991234@s.whatsapp.net '), null);
  assert.equal(outraFormaDoCelular(''), null);
});

test('comprimentos errados nao casam', () => {
  assert.equal(outraFormaDoCelular('55659999123@s.whatsapp.net'), null); // 11 digitos
  assert.equal(outraFormaDoCelular('55659999912345@s.whatsapp.net'), null); // 14 digitos
});

test('a regra concorda com `mesmoTelefone` da identidade da conta, para todo par de enderecos da tabela', () => {
  const enderecos = [
    SEM_NOVE,
    COM_NOVE,
    '556561234567@s.whatsapp.net',
    '5565961234567@s.whatsapp.net',
    '556532221234@s.whatsapp.net',
    '5565932221234@s.whatsapp.net',
    '5565905551234@s.whatsapp.net',
    '556699991234@s.whatsapp.net',
    '5566999991234@s.whatsapp.net',
    '14155550123@s.whatsapp.net',
  ];
  const digitos = (e: string): string => e.replace('@s.whatsapp.net', '');
  for (const a of enderecos) {
    for (const b of enderecos) {
      if (a === b) continue;
      assert.equal(
        outraFormaDoCelular(a) === b,
        mesmoTelefone(digitos(a), digitos(b)),
        `as duas regras divergem em ${a} contra ${b}`,
      );
    }
  }
});
