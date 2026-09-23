import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

test('registrarMensagem grava a Direcao', () => {
  const c = cenario();
  try {
    const acervo = c.novoInquilino('Padme').acervo;
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'conversa-1@s.whatsapp.net',
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    const id = registrarMensagem(acervo, {
      conversaId,
      fonte: 'whatsapp',
      idExterno: 'ext-1',
      ocorridaEm: Date.now(),
      agora: Date.now(),
      direcao: 'enviada',
    });
    const linha = acervo.preparar('SELECT direcao FROM mensagens WHERE id = ?').get(id) as {
      direcao: string;
    };
    assert.equal(linha.direcao, 'enviada');
  } finally {
    c.limpar();
  }
});
