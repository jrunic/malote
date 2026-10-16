import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerCartaoMultiploAoVivo } from '../src/adaptadores/whatsapp/contato-compartilhado.js';

// #1206: o envelope do cartao multiplo (`contactsArrayMessage.contacts`) e aberto elemento a elemento; o leitor de vCard
// e o de sempre. O nome de exibicao EXTERNO ("N contatos") nao entra aqui: so a lista chega ao leitor.

const ANA = 'BEGIN:VCARD\nVERSION:3.0\nFN:Ana Souza\nTEL;waid=5565999991234:+55 65 99999-1234\nEND:VCARD';
const BETO = 'BEGIN:VCARD\nVERSION:3.0\nFN:\nORG:Pizzaria do Ze;\nTEL:11999990000\nEND:VCARD';
const SEM_NOME = 'BEGIN:VCARD\nVERSION:3.0\nFN:\nTEL:11988880000\nEND:VCARD';

test('cada elemento da lista vira um cartao, na ordem', () => {
  const r = lerCartaoMultiploAoVivo([
    { displayName: 'Ana Souza', vcard: ANA },
    { displayName: 'Pizzaria', vcard: BETO },
  ]);
  assert.deepEqual(r.cartoes.map((c) => c.nome), ['Ana Souza', 'Pizzaria do Ze']);
  assert.equal(r.recusados, 0);
});

test('o nome de exibicao do ELEMENTO e o ultimo recurso do cartao sem nome, e o recurso e contado', () => {
  const r = lerCartaoMultiploAoVivo([{ displayName: 'Nome do Elemento', vcard: SEM_NOME }]);
  assert.deepEqual(r.cartoes.map((c) => c.nome), ['Nome do Elemento']);
  assert.equal(r.nomesPorRecurso['nome-do-evento'], 1);
});

test('cartao sem nome por caminho nenhum, ilegivel ou vazio e recusado e contado, sem derrubar os outros', () => {
  const r = lerCartaoMultiploAoVivo([
    { displayName: 'Ana Souza', vcard: ANA },
    { vcard: SEM_NOME },
    { displayName: 'Lixo', vcard: 'isto nao e um cartao' },
    { displayName: 'Vazio', vcard: '' },
    'nao e um objeto',
    null,
  ]);
  assert.deepEqual(r.cartoes.map((c) => c.nome), ['Ana Souza']);
  assert.equal(r.recusados, 4, 'sem nome, ilegivel, e os dois elementos que nao sao objeto; o vcard vazio nao conta');
});

test('lista vazia, ausente ou que nao e lista nao grava cartao nem recusa', () => {
  for (const entrada of [[], undefined, null, 'x', { 0: { vcard: ANA } }]) {
    const r = lerCartaoMultiploAoVivo(entrada);
    assert.deepEqual(r.cartoes, []);
    assert.equal(r.recusados, 0);
  }
});
