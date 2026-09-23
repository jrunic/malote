import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrarConversa, registrarMensagem, registrarAnexo } from '../src/nucleo/escrita.js';
import { lerAnexoPorId } from '../src/nucleo/consulta.js';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

test('lerAnexoPorId devolve o Anexo pelo id', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: '111@s.whatsapp.net', coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    const mensagemId = registrarMensagem(acervo, {
      direcao: 'recebida',
      conversaId, fonte: 'whatsapp', idExterno: 'm1',
      ocorridaEm: Date.parse('2026-09-01T12:00:00Z'), agora: Date.now(),
    });
    const anexoId = registrarAnexo(acervo, {
      mensagemId, tipo: 'image', presenca: 'nunca-obtido',
    });

    const anexo = lerAnexoPorId(acervo, anexoId);
    assert.equal(anexo?.id, anexoId);
    assert.equal(anexo?.tipo, 'image');
    assert.equal(anexo?.presenca, 'nunca-obtido');
    assert.equal(anexo?.caminho, null);
  } finally {
    c.limpar();
  }
});

test('lerAnexoPorId devolve undefined quando o Anexo nao existe', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    assert.equal(lerAnexoPorId(acervo, 'nao-existe'), undefined);
  } finally {
    c.limpar();
  }
});
