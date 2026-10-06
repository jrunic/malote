import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerMudancaDeEtiqueta } from '../src/adaptadores/whatsapp/etiqueta-ao-vivo.js';
import { mudancaDeEtiqueta } from './ajuda/etiqueta-ao-vivo.js';

test('o tipo pelo NOME entra — e a forma que chega depois do round-trip de JSON', () => {
  const r = lerMudancaDeEtiqueta(mudancaDeEtiqueta({ id: 'E1', texto: 'Torre A' }));
  assert.equal(r?.texto, 'Torre A');
});

test('o tipo pelo NUMERO entra, como numero e como cadeia', () => {
  assert.equal(lerMudancaDeEtiqueta(mudancaDeEtiqueta({ id: 'E1', texto: 'x', tipo: 30 }))?.texto, 'x');
  assert.equal(lerMudancaDeEtiqueta(mudancaDeEtiqueta({ id: 'E1', texto: 'x', tipo: '30' }))?.texto, 'x');
});

test('outro tipo de protocolo NAO vira etiqueta, mesmo trazendo memberLabel', () => {
  for (const tipo of ['REVOKE', 'EPHEMERAL_SETTING', 5, 'GROUP_MEMBER_LABEL_CHANGE_FUTURO']) {
    assert.equal(lerMudancaDeEtiqueta(mudancaDeEtiqueta({ id: 'E1', texto: 'x', tipo })), null, String(tipo));
  }
});

test('mensagem comum, sem protocolo, nao e etiqueta', () => {
  assert.equal(
    lerMudancaDeEtiqueta({
      key: { remoteJid: 'g@g.us', id: 'M1', fromMe: false },
      messageTimestamp: 1,
      message: { conversation: 'oi' },
    }),
    null,
  );
  assert.equal(
    lerMudancaDeEtiqueta({ key: { remoteJid: 'g@g.us', id: 'M2', fromMe: false }, messageTimestamp: 1, message: null }),
    null,
  );
});

test('tipo certo sem memberLabel utilizavel nao vira etiqueta (cai no descarte contado)', () => {
  const sem = mudancaDeEtiqueta({ id: 'E1', texto: 'x' });
  (sem.message as { protocolMessage: Record<string, unknown> }).protocolMessage['memberLabel'] = null;
  assert.equal(lerMudancaDeEtiqueta(sem), null);
  const numerico = mudancaDeEtiqueta({ id: 'E2', texto: 'x' });
  ((numerico.message as { protocolMessage: { memberLabel: Record<string, unknown> } }).protocolMessage.memberLabel)[
    'label'
  ] = 7;
  assert.equal(lerMudancaDeEtiqueta(numerico), null, 'label que nao e cadeia e malformado');
});

test('a remocao e um evento de texto VAZIO, nao a ausencia do campo', () => {
  const r = lerMudancaDeEtiqueta(mudancaDeEtiqueta({ id: 'E1', texto: '' }));
  assert.equal(r?.texto, '');
});

test('o instante e o declarado pela etiqueta (segundos para milissegundos), e cai no da Mensagem se ausente', () => {
  const declarado = lerMudancaDeEtiqueta(
    mudancaDeEtiqueta({ id: 'E1', texto: 'x', labelTimestamp: '1791215028', messageTimestamp: 1_791_215_029 }),
  );
  assert.equal(declarado?.instante, 1_791_215_028_000, 'a etiqueta difere da Mensagem em 1 s, e vale a da etiqueta');
  const ausente = lerMudancaDeEtiqueta(
    mudancaDeEtiqueta({ id: 'E2', texto: 'x', labelTimestamp: null, messageTimestamp: 1_791_215_029 }),
  );
  assert.equal(ausente?.instante, 1_791_215_029_000);
  const lixo = lerMudancaDeEtiqueta(mudancaDeEtiqueta({ id: 'E3', texto: 'x', labelTimestamp: 'abc', messageTimestamp: 1_791_215_029 }));
  assert.equal(lixo?.instante, 1_791_215_029_000, 'instante ilegivel cai no da Mensagem, nunca no de recebimento');
});

test('o bruto guarda o protocolMessage INTEIRO, como a Fonte o entregou', () => {
  const r = lerMudancaDeEtiqueta(mudancaDeEtiqueta({ id: 'E1', texto: 'Torre A' }));
  assert.deepEqual(JSON.parse(r?.bruto ?? '{}'), {
    type: 'GROUP_MEMBER_LABEL_CHANGE',
    memberLabel: { label: 'Torre A', labelTimestamp: '1791215000' },
  });
});
