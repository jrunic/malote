import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { receberEvento, type MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = 1_791_300_000_000;
const INSTANTE = Math.floor((AGORA - 60_000) / 1000);
const DIRETA = '5511000000000@s.whatsapp.net';
const GRUPO = '120363000000000001@g.us';

const VIDEO = {
  mimetype: 'video/mp4',
  seconds: 9,
  fileLength: '2048',
  url: 'https://exemplo.invalid/video',
  directPath: '/v/t62.sintetico/video',
  mediaKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
};

function evento(id: string, message: Record<string, unknown>, remoteJid = DIRETA, instante = INSTANTE): MensagemRecebida {
  return { key: { remoteJid, id, fromMe: false }, messageTimestamp: instante, message };
}

/** O envelope medido em campo: o evento traz o video dentro e a associacao ao lado, em `messageContextInfo`. */
function envelope(id: string, interior: Record<string, unknown>, tipo = 'HD_VIDEO_DUAL_UPLOAD', remoteJid = DIRETA): MensagemRecebida {
  return evento(
    id,
    {
      associatedChildMessage: { message: interior },
      messageContextInfo: { messageAssociation: { associationType: tipo, parentMessageKey: { remoteJid, id: 'PAI1', fromMe: false } } },
    },
    remoteJid,
  );
}

function cena() {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular de Teste');
  const receber = (eventos: MensagemRecebida[]) => receberEvento(acervo, eventos, { agora: AGORA, configuracao: CFG_WHATSAPP });
  const mensagens = () =>
    acervo.db.prepare('SELECT id_externo, conteudo, bruto FROM mensagens ORDER BY id_externo').all() as {
      id_externo: string;
      conteudo: string | null;
      bruto: string;
    }[];
  const anexos = () =>
    acervo.db
      .prepare('SELECT m.id_externo AS id_externo, a.tipo AS tipo, a.presenca AS presenca FROM anexos a JOIN mensagens m ON m.id = a.mensagem_id ORDER BY m.id_externo')
      .all() as { id_externo: string; tipo: string; presenca: string }[];
  return { receber, mensagens, anexos, limpar: c.limpar };
}

test('o envelope de midia associada vira Mensagem PROPRIA, com Anexo de video, como um video comum', () => {
  const k = cena();
  try {
    const r = k.receber([
      envelope('FILHO1', { videoMessage: { ...VIDEO, caption: 'legenda sintetica' } }),
      evento('COMUM1', { videoMessage: { ...VIDEO, caption: 'legenda sintetica' } }),
    ]);
    assert.equal(r.gravados, 2);
    assert.equal(r.descartados.length, 0);
    assert.equal(r.ignorados['associatedChildMessage'], undefined);
    const [filho, comum] = [k.mensagens().find((m) => m.id_externo === 'FILHO1'), k.mensagens().find((m) => m.id_externo === 'COMUM1')];
    assert.ok(filho !== undefined && comum !== undefined);
    // A legenda de video ao vivo fica no Conteudo Bruto, nao no texto: o envelope segue a regra de todo video.
    assert.equal(filho.conteudo, comum.conteudo);
    assert.match(filho.bruto, /legenda sintetica/);
    assert.deepEqual(k.anexos(), [
      { id_externo: 'COMUM1', tipo: 'video', presenca: 'nunca-obtido' },
      { id_externo: 'FILHO1', tipo: 'video', presenca: 'nunca-obtido' },
    ]);
    assert.equal(r.anexosNuncaObtidos.length, 2);
  } finally {
    k.limpar();
  }
});

test('o Conteudo Bruto guarda o evento inteiro, e a associacao ao pai e legivel nele', () => {
  const k = cena();
  try {
    const ev = envelope('FILHO2', { videoMessage: VIDEO }, 'MOTION_PHOTO');
    k.receber([ev]);
    const bruto = JSON.parse(k.mensagens()[0]?.bruto ?? 'null') as MensagemRecebida;
    assert.deepEqual(bruto, ev);
    const assoc = (bruto.message as { messageContextInfo: { messageAssociation: { associationType: string; parentMessageKey: { id: string } } } })
      .messageContextInfo.messageAssociation;
    assert.equal(assoc.associationType, 'MOTION_PHOTO');
    assert.equal(assoc.parentMessageKey.id, 'PAI1');
  } finally {
    k.limpar();
  }
});

test('a Mensagem original NAO muda: com o pai presente, conteudo, bruto e Anexos ficam iguais', () => {
  const k = cena();
  try {
    k.receber([evento('PAI1', { videoMessage: { ...VIDEO, caption: 'original' } })]);
    const paiAntes = k.mensagens().find((m) => m.id_externo === 'PAI1');
    const anexosDoPaiAntes = k.anexos().filter((a) => a.id_externo === 'PAI1');
    k.receber([envelope('FILHO3', { videoMessage: VIDEO })]);
    assert.deepEqual(k.mensagens().find((m) => m.id_externo === 'PAI1'), paiAntes);
    assert.deepEqual(k.anexos().filter((a) => a.id_externo === 'PAI1'), anexosDoPaiAntes);
    assert.equal(k.mensagens().length, 2, 'o filho criou ou alterou outra Mensagem alem da propria');
    assert.equal(k.anexos().length, 2);
  } finally {
    k.limpar();
  }
});

test('o filho e gravado mesmo com o pai AUSENTE (chega primeiro) e nada alem dele', () => {
  const k = cena();
  try {
    k.receber([envelope('FILHO4', { videoMessage: VIDEO })]);
    assert.deepEqual(k.mensagens().map((m) => m.id_externo), ['FILHO4']);
    assert.deepEqual(k.anexos().map((a) => a.id_externo), ['FILHO4']);
  } finally {
    k.limpar();
  }
});

test('a reentrega do mesmo evento NAO duplica Mensagem nem Anexo', () => {
  const k = cena();
  try {
    const ev = envelope('FILHO5', { videoMessage: VIDEO });
    k.receber([ev]);
    k.receber([ev]);
    assert.equal(k.mensagens().length, 1);
    assert.equal(k.anexos().length, 1);
  } finally {
    k.limpar();
  }
});

test('envelope SEM conteudo que vire Mensagem NAO e aberto: segue descartado com o rotulo de sempre', () => {
  const k = cena();
  try {
    const r = k.receber([
      envelope('VAZIO1', {}),
      envelope('DESC1', { tipoNuncaVistoMessage: { x: 1 } }),
    ]);
    assert.equal(r.gravados, 0);
    assert.deepEqual(r.descartados.map((d) => [d.motivo, d.ruido]), [
      ['associatedChildMessage', false],
      ['associatedChildMessage', false],
    ]);
    assert.equal(k.mensagens().length, 0, 'um envelope vazio virou Mensagem vazia');
  } finally {
    k.limpar();
  }
});

test('o envelope dentro de uma Mensagem CITADA nunca gera Mensagem nem Anexo', () => {
  const k = cena();
  try {
    k.receber([
      evento('TXT1', {
        extendedTextMessage: {
          text: 'respondendo',
          contextInfo: { quotedMessage: { associatedChildMessage: { message: { videoMessage: VIDEO } } } },
        },
      }),
    ]);
    assert.deepEqual(k.mensagens().map((m) => [m.id_externo, m.conteudo]), [['TXT1', 'respondendo']]);
    assert.equal(k.anexos().length, 0);
  } finally {
    k.limpar();
  }
});

test('o tipo de associacao NAO decide: um tipo que a medicao nao viu e gravado igual, e fica legivel no bruto', () => {
  const k = cena();
  try {
    k.receber([envelope('FILHO6', { videoMessage: VIDEO }, 'TIPO_INVENTADO_PELO_TESTE', GRUPO)]);
    assert.deepEqual(k.mensagens().map((m) => m.id_externo), ['FILHO6']);
    assert.match(k.mensagens()[0]?.bruto ?? '', /TIPO_INVENTADO_PELO_TESTE/);
  } finally {
    k.limpar();
  }
});
