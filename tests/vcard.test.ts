import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerVCard } from '../src/adaptadores/contatos/vcard.js';

test('separa cartões e lê propriedade com e sem parâmetro', () => {
  const cartoes = lerVCard(
    [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Joana Prado',
      'TEL;TYPE=cell:+55 (11) 91234-5678',
      'TEL:+551133334444',
      'END:VCARD',
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Bruno Salles',
      'END:VCARD',
    ].join('\r\n'),
  );
  assert.equal(cartoes.length, 2);
  assert.equal(cartoes[0]?.nome, 'Joana Prado');
  assert.deepEqual(cartoes[0]?.telefones, ['+55 (11) 91234-5678', '+551133334444']);
  assert.deepEqual(cartoes[1]?.telefones, []);
});

test('desdobra linha continuada — 2.449 delas no material real', () => {
  // A dobra e por OCTETO, nao por palavra: o material real quebra em exatos 75
  // octetos, e o espaco inicial da continuacao e marcador de dobra, nao texto.
  // Desdobrar remove esse espaco — juntar com espaco corromperia o valor.
  const cartoes = lerVCard(
    [
      'BEGIN:VCARD',
      'FN:Maria da Sil',
      ' va Prado',
      'TEL:+5511',
      ' 999998888',
      'END:VCARD',
    ].join('\r\n'),
  );
  assert.equal(cartoes[0]?.nome, 'Maria da Silva Prado');
  assert.deepEqual(cartoes[0]?.telefones, ['+5511999998888']);
});

test('desescapa vírgula, ponto-e-vírgula e barra invertida', () => {
  // No arquivo estao os dois caracteres barra+virgula, barra+ponto-e-virgula e
  // barra+barra; em TypeScript cada barra do arquivo se escreve dobrada.
  const linha = 'FN:Prado\\, Joana\\; a\\\\dvogada';
  const cartoes = lerVCard(['BEGIN:VCARD', linha, 'END:VCARD'].join('\r\n'));
  assert.equal(cartoes[0]?.nome, 'Prado, Joana; a\\dvogada');
});

test('cartão sem FN e sem TEL entra na lista com nome nulo', () => {
  const cartoes = lerVCard(['BEGIN:VCARD', 'ORG:Acme;', 'END:VCARD'].join('\r\n'));
  assert.equal(cartoes.length, 1);
  assert.equal(cartoes[0]?.nome, null);
  assert.deepEqual(cartoes[0]?.emails, []);
});

test('coleta EMAIL — lido so para contar, nunca vira Identificador', () => {
  const cartoes = lerVCard(
    ['BEGIN:VCARD', 'FN:So Email', 'EMAIL;TYPE=other:alguem@exemplo.test', 'END:VCARD'].join('\r\n'),
  );
  assert.deepEqual(cartoes[0]?.emails, ['alguem@exemplo.test']);
  assert.deepEqual(cartoes[0]?.telefones, []);
});
