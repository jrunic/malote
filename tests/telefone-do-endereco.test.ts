import { test } from 'node:test';
import assert from 'node:assert/strict';
import { telefoneDoEndereco } from '../src/adaptadores/whatsapp/telefone-do-endereco.js';

test('so o endereco que e um numero vira telefone: o opaco, o grupo e o texto livre nao', () => {
  assert.equal(telefoneDoEndereco('5565900000001@s.whatsapp.net'), '5565900000001');
  assert.equal(telefoneDoEndereco('5565900000001:12@s.whatsapp.net'), '5565900000001', 'com sufixo de dispositivo');
  for (const nao of ['123456789012345@lid', '5511999990000-1600000000@g.us', 'abc@s.whatsapp.net', '123@s.whatsapp.net', '5565900000001', '']) {
    assert.equal(telefoneDoEndereco(nao), null, nao);
  }
});
