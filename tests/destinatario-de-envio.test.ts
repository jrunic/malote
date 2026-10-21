import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enderecoEhDestinatarioDeEnvio } from '../src/adaptadores/whatsapp/destinatario-de-envio.js';

// #1323: so telefone, endereco opaco de pessoa e grupo recebem Envio. O feed de status e a lista de transmissao sao
// Conversas coletivas no Acervo, mas NAO sao destinatarios: enviar a um feed de status publicaria um Status.

test('telefone, endereco opaco de pessoa e grupo sao destinatarios de envio', () => {
  assert.equal(enderecoEhDestinatarioDeEnvio('5511900000001@s.whatsapp.net'), true);
  assert.equal(enderecoEhDestinatarioDeEnvio('123456789012345@lid'), true);
  assert.equal(enderecoEhDestinatarioDeEnvio('120363000000000001@g.us'), true);
});

test('feed de status, lista de transmissao e o que nao e endereco do WhatsApp nao sao destinatarios', () => {
  assert.equal(enderecoEhDestinatarioDeEnvio('5511900000001@status'), false);
  assert.equal(enderecoEhDestinatarioDeEnvio('123456789012345@lid.status'), false);
  assert.equal(enderecoEhDestinatarioDeEnvio('1234567890@broadcast'), false);
  assert.equal(enderecoEhDestinatarioDeEnvio('perfil_de_instagram'), false);
  assert.equal(enderecoEhDestinatarioDeEnvio(''), false);
});
