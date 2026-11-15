import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ehEnderecoDeWhatsapp,
  enderecoDoParametro,
} from '../src/adaptadores/whatsapp/endereco-de-whatsapp.js';

test('as formas legitimas medidas no Acervo sao enderecos', () => {
  for (const v of [
    '5565911110001@s.whatsapp.net',
    '109876543210987@lid',
    '120363000000000001@g.us',
    '5565999990000-1597000000@g.us',
    'status@broadcast',
    '123456@broadcast',
    'titular@malote.local',
  ]) {
    assert.equal(ehEnderecoDeWhatsapp(v), true, v);
  }
});

test('o objeto serializado e o lixo nao sao enderecos', () => {
  for (const v of [
    '{"id":"109876543210987@lid","phoneNumber":"5565911110001@s.whatsapp.net","admin":null}',
    '{"id":"109876543210987@lid","admin":null}',
    'sem arroba',
    '@lid',
    'a b@lid',
    '',
    'x"y@lid',
    // decisao: sufixo de dispositivo (`:12`) nao e forma de Identificador (o Acervo grava sem ele e nao tem nenhum assim, medido)
    '5565991110001:12@s.whatsapp.net',
  ]) {
    assert.equal(ehEnderecoDeWhatsapp(v), false, v);
  }
});

test('o parametro de evento vira endereco: puro, ou o id do objeto serializado', () => {
  assert.equal(enderecoDoParametro('109876543210987@lid'), '109876543210987@lid');
  assert.equal(
    enderecoDoParametro(
      '{"id":"109876543210987@lid","phoneNumber":"5565911110001@s.whatsapp.net","admin":null}',
    ),
    '109876543210987@lid',
  );
  assert.equal(
    enderecoDoParametro('{"id":"109876543210987@lid","admin":null}'),
    '109876543210987@lid',
  );
});

test('parametro sem endereco legivel devolve nulo', () => {
  for (const p of [
    '0',
    'texto',
    '{',
    '{"id":5}',
    '{"id":"nao e endereco"}',
    '[]',
    '',
    'null',
    '{"id":null}',
  ]) {
    assert.equal(enderecoDoParametro(p), null, p);
  }
});
