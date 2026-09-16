import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classificarEstado,
  itensDeConversa,
} from '../src/adaptadores/whatsapp/classificar-estado.js';
import { pareceRetrato } from '../src/cli/retrato.js';

function chat(id: string, pinned: boolean) {
  return { id, pinned, archived: false };
}

test('chats.update em lote com chave de marca e Retrato; um item e atualizacao', () => {
  const lote = Array.from({ length: 30 }, (_, i) => chat(`c${i}@s.whatsapp.net`, i < 3));
  assert.equal(classificarEstado('chats.update', lote), 'retrato');
  assert.equal(classificarEstado('chats.update', [chat('x@s.whatsapp.net', true)]), 'atualizacao');
});

test('messaging-history.set classifica pelas chats do envelope, nao pelo envelope', () => {
  const chats = Array.from({ length: 30 }, (_, i) => chat(`c${i}@s.whatsapp.net`, i === 0));
  const envelope = { chats, contacts: [{ id: 'n@s.whatsapp.net', name: 'X' }], messages: [{}] };
  assert.equal(itensDeConversa('messaging-history.set', envelope).length, 30);
  assert.equal(classificarEstado('messaging-history.set', envelope), 'retrato');
  assert.equal(
    classificarEstado('messaging-history.set', { contacts: chats, messages: chats }),
    'ignorar',
  );
});

test('messages.update com starred NUNCA e Retrato, mesmo em lote', () => {
  const lote = Array.from({ length: 40 }, () => ({ key: {}, update: { starred: true } }));
  assert.equal(classificarEstado('messages.update', lote), 'ignorar');
});

test('contacts.upsert NUNCA e Retrato', () => {
  const lote = Array.from({ length: 40 }, () => ({ id: 'a', name: 'N' }));
  assert.equal(classificarEstado('contacts.upsert', lote), 'ignorar');
});

test('pareceRetrato NAO e prova', () => {
  assert.equal(pareceRetrato(['id', 'pinned'], 2676), true);
  assert.equal(
    classificarEstado('messages.update', Array(40).fill({ id: 'x', pinned: true })),
    'ignorar',
  );
});
