import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pareceValorSentinela } from '../src/adaptadores/whatsapp/nome-sentinela-de-contato.js';

test('o filtro do #1101 segue recusando o nome em bloco: a etiqueta NAO vem por contacts.upsert', () => {
  // `+EAA=` e a forma mais comum dos 8.553 nomes em bloco de um unico lote de contatos: um evento
  // de agenda sem grupo, que nao se atribui a Conversa nenhuma. A Etiqueta de Participacao chega por
  // `messages.upsert`, como protocolMessage. Quem achar que o filtro "esconde etiqueta" e o afrouxar
  // volta a gravar lixo como nome corrente (14 Pessoas ja o exibiram antes do conserto).
  assert.equal(pareceValorSentinela('+EAA='), true);
  assert.equal(pareceValorSentinela('Torre A'), false, 'texto humano nao e sentinela');
});
