import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrarConversa } from '../src/nucleo/escrita.js';
import { fonteDaConversa } from '../src/nucleo/consulta.js';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

test('fonteDaConversa devolve a Fonte da Conversa', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const id = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: '111@s.whatsapp.net',
      coletiva: false, configuracao: CFG_WHATSAPP,
    });
    assert.equal(fonteDaConversa(acervo, id), 'whatsapp');
  } finally {
    c.limpar();
  }
});

test('fonteDaConversa devolve undefined quando a Conversa nao existe', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    assert.equal(fonteDaConversa(acervo, 'nao-existe'), undefined);
  } finally {
    c.limpar();
  }
});
