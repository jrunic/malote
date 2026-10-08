import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import {
  receberEvento,
  type MensagemRecebida,
} from '../src/adaptadores/whatsapp/ao-vivo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = 1_791_300_000_000;
const INSTANTE = Math.floor((AGORA - 60_000) / 1000);
const DIRETA = '5511000000000@s.whatsapp.net';
const DOCUMENTO = { mimetype: 'text/csv', fileName: 'relatorio.csv', fileLength: '1024' };

function evento(id: string, message: Record<string, unknown>): MensagemRecebida {
  return { key: { remoteJid: DIRETA, id, fromMe: false }, messageTimestamp: INSTANTE, message };
}

function passarDuasVezes(e: MensagemRecebida) {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular de Teste');
    const opcoes = { agora: AGORA, configuracao: CFG_WHATSAPP };
    const primeira = receberEvento(acervo, [e], opcoes);
    const segunda = receberEvento(acervo, [e], opcoes);
    const n = (tabela: string): number =>
      (acervo.db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number }).n;
    return { primeira, segunda, mensagens: n('mensagens'), anexos: n('anexos') };
  } finally {
    c.limpar();
  }
}

// Medido em 07/10/2026: a Mensagem e idempotente por (fonte, id_externo), o Anexo nao era.
// Reentrega offline, lote drenado do derrame e `ouvinte reprocessar` passam o MESMO evento
// de novo, e cada passagem gravava mais um Anexo `nunca-obtido`. NAO se afirma `gravados`:
// a reentrega segue contada como gravada, e isso ja era conhecido.
for (const [nome, message] of [
  ['imagem', { imageMessage: { mimetype: 'image/jpeg', fileLength: '10' } }],
  ['documento', { documentMessage: DOCUMENTO }],
  ['audio', { audioMessage: { mimetype: 'audio/ogg', seconds: 3 } }],
  [
    'documento com legenda embrulhado',
    { documentWithCaptionMessage: { message: { documentMessage: { ...DOCUMENTO, caption: 'oi' } } } },
  ],
] as const) {
  test(`o mesmo evento de ${nome} duas vezes grava UM Anexo`, () => {
    const r = passarDuasVezes(evento(`REENT-${nome}`, message));
    assert.equal(r.mensagens, 1);
    assert.equal(r.anexos, 1, 'a reentrega duplicou o Anexo');
    assert.equal(r.primeira.anexosNuncaObtidos.length, 1);
    // Sem isto o ouvinte baixaria de novo os bytes de um Anexo que ja tem linha.
    assert.equal(r.segunda.anexosNuncaObtidos.length, 0, 'a reentrega pediu outro download');
  });
}

test('eventos de midia DIFERENTES continuam gravando um Anexo cada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular de Teste');
    receberEvento(
      acervo,
      [
        evento('DIF1', { imageMessage: { mimetype: 'image/jpeg', fileLength: '10' } }),
        evento('DIF2', { imageMessage: { mimetype: 'image/jpeg', fileLength: '10' } }),
        evento('DIF3', { documentMessage: DOCUMENTO }),
      ],
      { agora: AGORA, configuracao: CFG_WHATSAPP },
    );
    const n = (acervo.db.prepare('SELECT COUNT(*) AS n FROM anexos').get() as { n: number }).n;
    assert.equal(n, 3);
  } finally {
    c.limpar();
  }
});

test('Mensagem que ja existia SEM Anexo recebe o Anexo da reentrega', () => {
  // Mensagem de texto gravada antes, depois a mesma chave chega como midia: nao ha Anexo a proteger.
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular de Teste');
    const opcoes = { agora: AGORA, configuracao: CFG_WHATSAPP };
    receberEvento(acervo, [evento('SEM1', { conversation: 'texto' })], opcoes);
    const r = receberEvento(
      acervo,
      [evento('SEM1', { imageMessage: { mimetype: 'image/jpeg', fileLength: '10' } })],
      opcoes,
    );
    const n = (acervo.db.prepare('SELECT COUNT(*) AS n FROM anexos').get() as { n: number }).n;
    assert.equal(n, 1);
    assert.equal(r.anexosNuncaObtidos.length, 1);
  } finally {
    c.limpar();
  }
});
