import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = 1_756_100_000_000;
const DIRETA = '5511000000000@s.whatsapp.net';
const DOCUMENTO = { mimetype: 'text/csv', fileName: 'relatorio.csv', fileLength: '1024' };

function receber(message: Record<string, unknown>, id: string) {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular de Teste');
  const evento = {
    key: { remoteJid: DIRETA, id, fromMe: false },
    messageTimestamp: Math.floor((AGORA - 60_000) / 1000),
    message,
  };
  const relato = receberEvento(acervo, [evento], { agora: AGORA, configuracao: CFG_WHATSAPP });
  const mensagem = acervo.db
    .prepare('SELECT conteudo, bruto FROM mensagens')
    .all() as { conteudo: string | null; bruto: string }[];
  const anexos = acervo.db.prepare('SELECT tipo, bruto FROM anexos').all() as {
    tipo: string;
    bruto: string;
  }[];
  c.limpar();
  return { relato, mensagem, anexos, evento };
}

test('documento com legenda embrulhado vira Mensagem, com Anexo e a legenda como texto', () => {
  // Medido em 06/10/2026: o WhatsApp entrega o documento com legenda dentro de
  // `documentWithCaptionMessage`, e a recepcao o descartava em silencio.
  const embrulhado = {
    documentWithCaptionMessage: {
      message: { documentMessage: { ...DOCUMENTO, caption: 'Bom dia, segue' } },
    },
  };
  const r = receber(embrulhado, 'LEG1');

  assert.equal(r.relato.gravados, 1);
  assert.equal(r.relato.ignorados['documentWithCaptionMessage'], undefined);
  assert.equal(r.mensagem.length, 1);
  assert.equal(r.mensagem[0]?.conteudo, 'Bom dia, segue');
  assert.equal(r.anexos.length, 1);
  assert.equal(r.anexos[0]?.tipo, 'document');
  assert.equal(r.relato.anexosNuncaObtidos.length, 1);
});

test('o Conteudo Bruto do documento embrulhado guarda o evento inteiro, embrulho incluso', () => {
  const embrulhado = {
    documentWithCaptionMessage: {
      message: { documentMessage: { ...DOCUMENTO, caption: 'x' } },
    },
  };
  const r = receber(embrulhado, 'LEG2');
  assert.deepEqual(JSON.parse(r.mensagem[0]?.bruto ?? 'null'), r.evento);
});

test('documento simples sem legenda segue gravando sem texto', () => {
  const r = receber({ documentMessage: DOCUMENTO }, 'SEM1');
  assert.equal(r.relato.gravados, 1);
  assert.equal(r.mensagem[0]?.conteudo, null);
  assert.equal(r.anexos.length, 1);
});

test('os outros embrulhos seguem ignorados e contados ate a medicao decidir', () => {
  // `ephemeralMessage`, `viewOnce*` e `editedMessage` NAO foram medidos contra
  // captura real (restricao do repo: classificacao e medida, nunca deduzida).
  // `editedMessage` e edicao, nao Mensagem nova — tratar como nova duplicaria.
  for (const tipo of ['ephemeralMessage', 'viewOnceMessage', 'editedMessage']) {
    const r = receber({ [tipo]: { message: { conversation: 'oi' } } }, `OUT-${tipo}`);
    assert.equal(r.relato.gravados, 0, tipo);
    assert.equal(r.relato.ignorados[tipo], 1, tipo);
  }
});
