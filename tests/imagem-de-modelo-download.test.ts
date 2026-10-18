import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { extrairImagensDeModelo } from '../src/adaptadores/whatsapp/extrair-imagem-de-modelo.js';
import { reprocessarMidiaNuncaObtida } from '../src/adaptadores/whatsapp/reprocessar-midia.js';

const BRUTO = JSON.stringify({
  key: { remoteJid: '5565900000001@s.whatsapp.net', id: 'MOD1', fromMe: false },
  messageTimestamp: 1_792_000_000,
  message: {
    templateMessage: {
      interactiveMessageTemplate: {
        body: { text: 'oferta' },
        header: { imageMessage: { mimetype: 'image/jpeg', mediaKey: 'ZRu4OBFsg5OwyKys+RJWDjiKtxfUpvBfdmaLXEKi5nY=', directPath: '/v/t62/x' } },
      },
    },
  },
});

test('de ponta a ponta: o comando cria o Anexo e o midia reprocessar --mensagem o baixa, entregando a imagem na raiz', async () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const conversaId = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '5565900000001@s.whatsapp.net', coletiva: false, configuracao: CFG_WHATSAPP });
    const mensagemId = registrarMensagem(acervo, {
      conversaId, fonte: 'whatsapp', idExterno: 'MOD1', ocorridaEm: Date.parse('2026-10-14T10:00:00Z'), agora: Date.parse('2026-10-18T10:00:00Z'),
      direcao: 'recebida', bruto: BRUTO,
    });
    registrarMensagem(acervo, {
      conversaId, fonte: 'whatsapp', idExterno: 'OUTRA', ocorridaEm: Date.parse('2026-10-14T11:00:00Z'), agora: Date.parse('2026-10-18T10:00:00Z'),
      direcao: 'recebida', bruto: BRUTO.replace('MOD1', 'OUTRA'),
    });
    extrairImagensDeModelo(acervo, { comEfeito: true });

    const recebidas: unknown[] = [];
    const r = await reprocessarMidiaNuncaObtida(acervo, d.raiz, {
      filtro: { mensagemId },
      baixar: (m) => {
        recebidas.push(m);
        return Promise.resolve(Buffer.from('jpeg-sintetico'));
      },
    });

    assert.equal(r.recuperados, 1);
    assert.equal(recebidas.length, 1, 'so a Mensagem pedida foi tentada');
    const m = recebidas[0] as { key: { id: string }; message: Record<string, unknown> };
    assert.equal(m.key.id, 'MOD1');
    assert.deepEqual(Object.keys(m.message), ['imageMessage']);
    const presenca = acervo.db.prepare('SELECT presenca FROM anexos WHERE mensagem_id = ?').get(mensagemId) as { presenca: string };
    assert.equal(presenca.presenca, 'presente');
  } finally {
    c.limpar();
    d.limpar();
  }
});
