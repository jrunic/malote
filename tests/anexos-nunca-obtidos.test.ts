import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarConversa, registrarMensagem, registrarAnexo } from '../src/nucleo/escrita.js';
import { listarAnexosNuncaObtidosComBruto } from '../src/nucleo/consulta.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

test('lista Anexo nunca-obtido com o bruto da Mensagem, e ignora o presente (#1084)', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: '5511000000001@s.whatsapp.net',
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    const brutoAoVivo = JSON.stringify({
      key: { remoteJid: '5511000000001@s.whatsapp.net', id: 'M1', fromMe: false },
      messageTimestamp: 1_700_000_000,
      message: { videoMessage: { mediaKey: 'AAAA', directPath: '/x' } },
    });
    const mensagemNuncaObtida = registrarMensagem(acervo, {
      conversaId, fonte: 'whatsapp', idExterno: 'M1', ocorridaEm: 1_700_000_000_000,
      agora: Date.now(), direcao: 'recebida', bruto: brutoAoVivo,
    });
    const anexoNuncaObtido = registrarAnexo(acervo, {
      mensagemId: mensagemNuncaObtida, tipo: 'video', presenca: 'nunca-obtido', bruto: '{}',
    });

    const mensagemPresente = registrarMensagem(acervo, {
      conversaId, fonte: 'whatsapp', idExterno: 'M2', ocorridaEm: 1_700_000_001_000,
      agora: Date.now(), direcao: 'recebida', bruto: '{}',
    });
    registrarAnexo(acervo, {
      mensagemId: mensagemPresente, tipo: 'image', presenca: 'presente', bruto: '{}',
      caminho: '/tanto/faz', tamanho: 10,
    });

    const r = listarAnexosNuncaObtidosComBruto(acervo);
    assert.equal(r.length, 1);
    assert.equal(r[0]?.anexoId, anexoNuncaObtido);
    assert.equal(r[0]?.tipo, 'video');
    assert.equal(r[0]?.mensagemBruto, brutoAoVivo);
  } finally {
    c.limpar();
  }
});

test('filtro por fonte restringe a consulta', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const conversaWa = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: '5511000000001@s.whatsapp.net', coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    const conversaIg = registrarConversa(acervo, {
      fonte: 'instagram', idExterno: 'conversa:1', coletiva: false,
      configuracao: { id: 'cfg-ig', fonte: 'instagram' },
    });
    const mWa = registrarMensagem(acervo, {
      conversaId: conversaWa, fonte: 'whatsapp', idExterno: 'W1', ocorridaEm: 1_700_000_000_000,
      agora: Date.now(), direcao: 'recebida', bruto: '{}',
    });
    registrarAnexo(acervo, { mensagemId: mWa, tipo: 'video', presenca: 'nunca-obtido', bruto: '{}' });
    const mIg = registrarMensagem(acervo, {
      conversaId: conversaIg, fonte: 'instagram', idExterno: 'I1', ocorridaEm: 1_700_000_000_000,
      agora: Date.now(), direcao: 'recebida', bruto: '{}',
    });
    registrarAnexo(acervo, { mensagemId: mIg, tipo: 'video', presenca: 'nunca-obtido', bruto: '{}' });

    assert.equal(listarAnexosNuncaObtidosComBruto(acervo, { fonte: 'whatsapp' }).length, 1);
    assert.equal(listarAnexosNuncaObtidosComBruto(acervo).length, 2);
  } finally {
    c.limpar();
  }
});
