import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { lerMensagens } from '../src/nucleo/consulta.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

test('lerMensagens filtra por Direcao, e a devolve em cada Mensagem', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'a@s.whatsapp.net',
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    registrarMensagem(acervo, {
      conversaId, fonte: 'whatsapp', idExterno: 'm-enviada',
      ocorridaEm: 1700000000000, agora: Date.now(), direcao: 'enviada',
    });
    registrarMensagem(acervo, {
      conversaId, fonte: 'whatsapp', idExterno: 'm-recebida',
      ocorridaEm: 1700000001000, agora: Date.now(), direcao: 'recebida',
    });

    const recebidas = lerMensagens(acervo, { direcao: 'recebida' });
    assert.equal(recebidas.length, 1);
    assert.equal(recebidas[0]?.direcao, 'recebida', 'a Mensagem lida traz sua propria Direcao');

    const enviadas = lerMensagens(acervo, { direcao: 'enviada' });
    assert.equal(enviadas.length, 1);
    assert.equal(enviadas[0]?.direcao, 'enviada');

    const todas = lerMensagens(acervo, {});
    assert.equal(todas.length, 2, 'sem filtro, as duas aparecem');
  } finally {
    c.limpar();
  }
});
