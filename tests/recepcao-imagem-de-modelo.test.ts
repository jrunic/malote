import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { receberEvento, type MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = 1_791_300_000_000;
const INSTANTE = Math.floor((AGORA - 60_000) / 1000);
const IMAGEM = { mimetype: 'image/jpeg', url: 'https://exemplo.invalid/cabecalho', directPath: '/v/sintetico/cabecalho', mediaKey: 'AAECAwQFBgcICQoLDA0ODw==', fileLength: '81572' };

function evento(id: string, message: Record<string, unknown>): MensagemRecebida {
  return { key: { remoteJid: '5511000000000@s.whatsapp.net', id, fromMe: false }, messageTimestamp: INSTANTE, message };
}
const modelo = (id: string, cabecalho: Record<string, unknown>): MensagemRecebida =>
  evento(id, { templateMessage: { templateId: 'sintetico', interactiveMessageTemplate: { header: cabecalho, body: { text: 'corpo do modelo' } } } });

function cena() {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular de Teste');
  const receber = (eventos: MensagemRecebida[]) => receberEvento(acervo, eventos, { origemDaChegada: 'ao-vivo', agora: AGORA, configuracao: CFG_WHATSAPP });
  const anexos = () => acervo.db.prepare('SELECT mensagem_id AS mensagemId, tipo, presenca, bruto FROM anexos').all() as Array<{ mensagemId: string; tipo: string; presenca: string; bruto: string }>;
  const mensagens = () => acervo.db.prepare('SELECT id, conteudo, bruto FROM mensagens ORDER BY id_externo').all() as Array<{ id: string; conteudo: string | null; bruto: string }>;
  return { acervo, receber, anexos, mensagens, limpar: c.limpar };
}

test('o modelo com imagem no cabecalho grava a Mensagem e UM Anexo image nunca-obtido, que entra no download ao vivo', () => {
  const k = cena();
  try {
    const r = k.receber([modelo('MOD1', { hasMediaAttachment: true, imageMessage: IMAGEM })]);
    assert.equal(r.gravados, 1);
    const [anexo] = k.anexos();
    assert.equal(k.anexos().length, 1);
    assert.equal(anexo?.tipo, 'image');
    assert.equal(anexo?.presenca, 'nunca-obtido');
    assert.deepEqual(JSON.parse(anexo?.bruto as string), IMAGEM);
    assert.equal(anexo?.mensagemId, k.mensagens()[0]?.id);
    assert.deepEqual(r.anexosNuncaObtidos.map((a) => ({ indice: a.indice, tipo: a.tipo })), [{ indice: 0, tipo: 'image' }]);
    assert.equal(typeof r.anexosNuncaObtidos[0]?.anexoId, 'string');
  } finally {
    k.limpar();
  }
});

test('a classificacao e o texto da Mensagem nao mudam: o corpo segue sendo o conteudo e o bruto segue inteiro', () => {
  const k = cena();
  try {
    k.receber([modelo('MOD1', { imageMessage: IMAGEM })]);
    const [m] = k.mensagens();
    assert.equal(m?.conteudo, 'corpo do modelo');
    assert.match(m?.bruto ?? '', /interactiveMessageTemplate/);
    assert.match(m?.bruto ?? '', /cabecalho/);
  } finally {
    k.limpar();
  }
});

test('a reentrega do mesmo evento nao duplica o Anexo nem pede outro download', () => {
  const k = cena();
  try {
    const ev = modelo('MOD1', { imageMessage: IMAGEM });
    k.receber([ev]);
    const segunda = k.receber([ev]);
    assert.equal(k.anexos().length, 1);
    assert.deepEqual(segunda.anexosNuncaObtidos, []);
  } finally {
    k.limpar();
  }
});

test('o modelo sem imagem, o hidratado e a imagem em forma nao reconhecida nao ganham Anexo', () => {
  const k = cena();
  try {
    k.receber([
      modelo('SEM1', { title: 'so texto' }),
      evento('HID1', { templateMessage: { templateId: 'h', hydratedTemplate: { hydratedContentText: 'corpo hidratado', hydratedHeader: { imageMessage: IMAGEM } } } }),
      modelo('RUIM1', { imageMessage: { ...IMAGEM, mediaKey: undefined } }),
    ]);
    assert.equal(k.mensagens().length, 3, 'as tres viram Mensagem, como antes');
    assert.equal(k.anexos().length, 0);
  } finally {
    k.limpar();
  }
});

test('a Mensagem de modelo que ja existia sem Anexo ganha o Anexo na reentrega, como qualquer midia', () => {
  const k = cena();
  try {
    const ev = modelo('MOD1', { imageMessage: IMAGEM });
    k.receber([modelo('MOD1', { title: 'versao antiga, sem imagem' })]);
    assert.equal(k.anexos().length, 0);
    k.receber([ev]);
    assert.equal(k.anexos().length, 1);
  } finally {
    k.limpar();
  }
});
