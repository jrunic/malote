import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  identidadeDoVinculo,
  mesmoTelefone,
} from '../src/adaptadores/whatsapp/identidade-da-conta.js';

test('a identidade do vinculo sai sem o sufixo de dispositivo, na forma medida em campo', () => {
  const r = identidadeDoVinculo({
    id: '5511900000001:14@s.whatsapp.net',
    lid: '100000000000001:14@lid',
    name: 'Conta Sintetica',
  });
  assert.deepEqual(r, {
    telefone: '5511900000001',
    jid: '5511900000001@s.whatsapp.net',
    lid: '100000000000001@lid',
  });
});

test('identidade sem LID devolve lid nulo (vinculo anterior a plataforma entregar LID)', () => {
  const r = identidadeDoVinculo({ id: '5511900000001:3@s.whatsapp.net' });
  assert.deepEqual(r, { telefone: '5511900000001', jid: '5511900000001@s.whatsapp.net', lid: null });
});

test('identidade sem sufixo de dispositivo tambem e aceita', () => {
  const r = identidadeDoVinculo({ id: '5511900000001@s.whatsapp.net', lid: '100000000000001@lid' });
  assert.equal(r?.jid, '5511900000001@s.whatsapp.net');
  assert.equal(r?.lid, '100000000000001@lid');
});

test('o id em forma de LID, com o jid em campo proprio, tambem e lido (tipo da biblioteca)', () => {
  const r = identidadeDoVinculo({
    id: '100000000000001:14@lid',
    jid: '5511900000001:14@s.whatsapp.net',
    name: 'Conta Sintetica',
  });
  assert.deepEqual(r, {
    telefone: '5511900000001',
    jid: '5511900000001@s.whatsapp.net',
    lid: '100000000000001@lid',
  });
});

test('o campo jid vence o id quando os dois sao de telefone', () => {
  const r = identidadeDoVinculo({ id: '5511900000009:1@s.whatsapp.net', jid: '5511900000001:14@s.whatsapp.net' });
  assert.equal(r?.telefone, '5511900000001');
});

test('so LID, sem nenhum JID legivel, devolve undefined (nao se inventa o telefone)', () => {
  assert.equal(identidadeDoVinculo({ id: '100000000000001:14@lid', lid: '100000000000001:14@lid' }), undefined);
});

test('identidade ilegivel devolve undefined, nunca um palpite', () => {
  assert.equal(identidadeDoVinculo({}), undefined);
  assert.equal(identidadeDoVinculo({ id: 'sem-arroba' }), undefined);
  assert.equal(identidadeDoVinculo({ id: 'abc:1@s.whatsapp.net' }), undefined);
  assert.equal(identidadeDoVinculo({ id: '5511900000001:14@g.us' }), undefined);
});

test('telefone igual confere', () => {
  assert.equal(mesmoTelefone('5511900000001', '5511900000001'), true);
});

test('nono digito: declarado COM 9 contra JID SEM 9 confere (e o inverso)', () => {
  // 55 11 9 9999 0001 (13 digitos) e 55 11 9999 0001 (12): o antigo tem 8 digitos
  // depois do DDD e comeca em 6 a 9. Forma medida: o JID de contas antigas vem sem o 9.
  assert.equal(mesmoTelefone('5511999990001', '551199990001'), true);
  assert.equal(mesmoTelefone('551199990001', '5511999990001'), true);
});

test('mesma terminacao em OUTRO DDD nao confere', () => {
  assert.equal(mesmoTelefone('5511999990001', '552199990001'), false);
});

test('outro pais com a mesma terminacao nao confere', () => {
  assert.equal(mesmoTelefone('5511999990001', '351999990001'), false);
});

test('fixo (8 digitos comecando em 2 a 5) nao ganha 9 por equivalencia', () => {
  assert.equal(mesmoTelefone('551132221234', '5511932221234'), false);
});

test('numero diferente nao confere, e lixo nao confere', () => {
  assert.equal(mesmoTelefone('5511900000001', '5511900000002'), false);
  assert.equal(mesmoTelefone('', '5511900000001'), false);
  assert.equal(mesmoTelefone('abc', '5511900000001'), false);
});
