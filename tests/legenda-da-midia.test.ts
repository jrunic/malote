import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { importarMaterial } from '../src/adaptadores/whatsapp/importar.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { legendaDeImagemOuVideo, legendaDoBrutoAoVivo, legendaDoRegistroDeMidia } from '../src/adaptadores/whatsapp/legenda.js';
import { indiceDeBuscaEstaIntegro } from '../src/nucleo/texto-da-mensagem.js';
import { buscarMensagens } from '../src/nucleo/consulta.js';
import type { Acervo } from '../src/nucleo/acervo.js';

/**
 * A legenda de foto, de video e de documento como texto da Mensagem (#1530): a extracao pura, a recepcao ao vivo, a busca e o
 * importador do backup do iPhone. Texto de legenda SINTETICO: o caso de origem nao entra em teste (repo publico).
 */

const AGORA = Date.parse('2026-11-18T12:00:00Z');
const EM_USO = '2026-06-15T10:00:00Z';
const CONTATO = '5511900000001@s.whatsapp.net';
const LEGENDA = 'Legenda sintetica de teste';

function evento(id: string, message: Record<string, unknown>) {
  return {
    key: { remoteJid: CONTATO, id, fromMe: false },
    messageTimestamp: Math.floor(Date.parse('2026-11-18T10:00:00Z') / 1000),
    pushName: 'Pessoa de Teste',
    message,
  };
}

const recebe = (acervo: Acervo, ev: ReturnType<typeof evento>) =>
  receberEvento(acervo, [ev], { origemDaChegada: 'ao-vivo', agora: AGORA, configuracao: CFG_WHATSAPP });

const conteudoDe = (acervo: Acervo, idExterno: string): string | null =>
  (acervo.db.prepare('SELECT conteudo FROM mensagens WHERE id_externo = ?').get(idExterno) as { conteudo: string | null }).conteudo;

test('a extracao pura: imagem e video com legenda, e a legenda vazia, de espacos ou ausente NAO e legenda', () => {
  assert.equal(legendaDeImagemOuVideo({ imageMessage: { caption: LEGENDA } }), LEGENDA);
  assert.equal(legendaDeImagemOuVideo({ videoMessage: { caption: LEGENDA } }), LEGENDA);
  assert.equal(legendaDeImagemOuVideo({ imageMessage: { caption: '' } }), undefined);
  assert.equal(legendaDeImagemOuVideo({ imageMessage: { caption: '   ' } }), undefined);
  assert.equal(legendaDeImagemOuVideo({ imageMessage: {} }), undefined);
  assert.equal(legendaDeImagemOuVideo({ conversation: 'oi' }), undefined);
  assert.equal(legendaDeImagemOuVideo(null), undefined);
});

test('a extracao do Conteudo Bruto ao vivo: a legenda da PROPRIA midia, nunca a da mensagem citada', () => {
  const bruto = (message: Record<string, unknown>): string => JSON.stringify({ key: { id: 'X' }, message });
  assert.equal(legendaDoBrutoAoVivo(bruto({ imageMessage: { caption: LEGENDA } })), LEGENDA);
  assert.equal(legendaDoBrutoAoVivo(bruto({ videoMessage: { caption: LEGENDA } })), LEGENDA);
  assert.equal(legendaDoBrutoAoVivo(bruto({ documentMessage: { caption: LEGENDA } })), LEGENDA, 'documento direto (as 24 anteriores a v0.34.0)');
  assert.equal(
    legendaDoBrutoAoVivo(bruto({ documentWithCaptionMessage: { message: { documentMessage: { caption: LEGENDA } } } })),
    LEGENDA,
    'documento embrulhado',
  );
  assert.equal(
    legendaDoBrutoAoVivo(bruto({ associatedChildMessage: { message: { videoMessage: { caption: LEGENDA } } } })),
    LEGENDA,
    'envelope de midia associada: a legenda do interior',
  );
  // A legenda so dentro da citada: a Mensagem e uma midia SEM legenda que cita outra com legenda.
  assert.equal(
    legendaDoBrutoAoVivo(
      bruto({ imageMessage: { contextInfo: { quotedMessage: { imageMessage: { caption: LEGENDA } } } } }),
    ),
    undefined,
    'a legenda da citada nao e da Mensagem',
  );
  assert.equal(
    legendaDoBrutoAoVivo(bruto({ extendedTextMessage: { text: 'sim', contextInfo: { quotedMessage: { imageMessage: { caption: LEGENDA } } } } })),
    undefined,
  );
  assert.equal(legendaDoBrutoAoVivo('{nao e json'), undefined);
  assert.equal(legendaDoBrutoAoVivo('"texto"'), undefined);
});

test('a extracao do registro de midia do backup: imagem e video sim, DOCUMENTO nao (o titulo e o nome do arquivo)', () => {
  const registro = JSON.stringify({ ZTITLE: LEGENDA });
  assert.equal(legendaDoRegistroDeMidia(registro, 'image'), LEGENDA);
  assert.equal(legendaDoRegistroDeMidia(registro, 'video'), LEGENDA);
  assert.equal(legendaDoRegistroDeMidia(registro, 'document'), undefined);
  assert.equal(legendaDoRegistroDeMidia(registro, 'audio'), undefined);
  assert.equal(legendaDoRegistroDeMidia(JSON.stringify({ ZTITLE: '  ' }), 'image'), undefined);
  assert.equal(legendaDoRegistroDeMidia(JSON.stringify({}), 'image'), undefined);
  assert.equal(legendaDoRegistroDeMidia(undefined, 'image'), undefined);
  assert.equal(legendaDoRegistroDeMidia('nao e json', 'image'), undefined);
});

test('ao vivo: a legenda de imagem e de video vira o texto da Mensagem; sem legenda, ou vazia, o texto segue NULO', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    assert.equal(recebe(acervo, evento('I1', { imageMessage: { mimetype: 'image/jpeg', caption: LEGENDA } })).gravados, 1);
    assert.equal(recebe(acervo, evento('V1', { videoMessage: { mimetype: 'video/mp4', caption: LEGENDA } })).gravados, 1);
    assert.equal(recebe(acervo, evento('I2', { imageMessage: { mimetype: 'image/jpeg' } })).gravados, 1);
    assert.equal(recebe(acervo, evento('I3', { imageMessage: { mimetype: 'image/jpeg', caption: '' } })).gravados, 1);
    assert.equal(conteudoDe(acervo, 'I1'), LEGENDA);
    assert.equal(conteudoDe(acervo, 'V1'), LEGENDA);
    assert.equal(conteudoDe(acervo, 'I2'), null, 'sem legenda: nulo');
    assert.equal(conteudoDe(acervo, 'I3'), null, 'legenda vazia: nulo, nunca texto vazio');
  } finally {
    c.limpar();
  }
});

test('o reprocessamento grava a legenda pela mesma extracao (origem reprocesso)', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const r = receberEvento(acervo, [evento('RP1', { imageMessage: { mimetype: 'image/jpeg', caption: LEGENDA } })], {
      origemDaChegada: 'reprocesso',
      agora: AGORA,
      configuracao: CFG_WHATSAPP,
    });
    assert.equal(r.gravados, 1);
    assert.equal(conteudoDe(acervo, 'RP1'), LEGENDA);
  } finally {
    c.limpar();
  }
});

test('a regra do vazio: imagem e video tratam a legenda so de espacos como ausente, o documento segue a da v0.34.0 (so a vazia)', () => {
  const bruto = (message: Record<string, unknown>): string => JSON.stringify({ key: { id: 'X' }, message });
  assert.equal(legendaDoBrutoAoVivo(bruto({ imageMessage: { caption: '   ' } })), undefined);
  assert.equal(legendaDoBrutoAoVivo(bruto({ documentMessage: { caption: '' } })), undefined);
  assert.equal(legendaDoBrutoAoVivo(bruto({ documentMessage: { caption: '   ' } })), '   ', 'como a recepcao ja gravava desde a v0.34.0');
});

test('ao vivo: a legenda so da mensagem CITADA nao vira texto da Mensagem', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    recebe(
      acervo,
      evento('Q1', { imageMessage: { mimetype: 'image/jpeg', contextInfo: { stanzaId: 'ORIG', quotedMessage: { imageMessage: { caption: LEGENDA } } } } }),
    );
    assert.equal(conteudoDe(acervo, 'Q1'), null);
  } finally {
    c.limpar();
  }
});

test('ao vivo: o documento com legenda segue gravando (regressao da v0.34.0), e o envelope de midia associada leva a legenda do interior', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    recebe(acervo, evento('D1', { documentWithCaptionMessage: { message: { documentMessage: { mimetype: 'application/pdf', caption: LEGENDA } } } }));
    assert.equal(conteudoDe(acervo, 'D1'), LEGENDA);
    recebe(acervo, evento('A1', { associatedChildMessage: { message: { videoMessage: { mimetype: 'video/mp4', caption: LEGENDA } } } }));
    assert.equal(conteudoDe(acervo, 'A1'), LEGENDA);
  } finally {
    c.limpar();
  }
});

test('ao vivo: a Mensagem ja gravada NAO e alterada pela reentrega com legenda (primeiro escritor vence)', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    recebe(acervo, evento('R1', { imageMessage: { mimetype: 'image/jpeg' } }));
    assert.equal(conteudoDe(acervo, 'R1'), null);
    recebe(acervo, evento('R1', { imageMessage: { mimetype: 'image/jpeg', caption: LEGENDA } }));
    assert.equal(conteudoDe(acervo, 'R1'), null, 'o estoque cobre as que ficaram nulas, a reentrega nao');
  } finally {
    c.limpar();
  }
});

test('a legenda gravada ao vivo e ACHADA pela busca de texto, e o indice segue integro na forma que compara com o conteudo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    recebe(acervo, evento('B1', { imageMessage: { mimetype: 'image/jpeg', caption: LEGENDA } }));
    recebe(acervo, evento('B2', { imageMessage: { mimetype: 'image/jpeg' } }));
    const achadas = buscarMensagens(acervo, { texto: 'sintetica' });
    assert.equal(achadas.length, 1);
    assert.equal(indiceDeBuscaEstaIntegro(acervo), true);
  } finally {
    c.limpar();
  }
});

function backupComMidia(mensagens: Array<{ id: string; tipo: number; texto: string | null; titulo?: string }>) {
  return backupFalso({
    conversas: [{ pk: 1, endereco: CONTATO, nome: 'Pessoa de Teste', tipoDeSessao: 0 }],
    mensagens: mensagens.map((m) => ({
      stanzaId: m.id,
      chatSessionPk: 1,
      texto: m.texto,
      dataCoreData: paraCoreData(EM_USO),
      tipo: m.tipo,
      caminhoDeMidia: `Media/${m.id}.bin`,
      ...(m.titulo === undefined ? {} : { titulo: m.titulo }),
    })),
  });
}

test('backup do iPhone: o titulo da midia de imagem e de video vira o texto da Mensagem quando a linha nao tem texto (nulo ou vazio)', () => {
  const c = cenario();
  const b = backupComMidia([
    { id: 'i1', tipo: 1, texto: null, titulo: LEGENDA },
    { id: 'v1', tipo: 2, texto: '', titulo: LEGENDA },
    { id: 'i2', tipo: 1, texto: null },
    { id: 'i3', tipo: 1, texto: 'texto da linha', titulo: 'outro titulo' },
  ]);
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });
    assert.equal(conteudoDe(acervo, 'i1'), LEGENDA);
    assert.equal(conteudoDe(acervo, 'v1'), LEGENDA, 'texto vazio na linha tambem conta como sem texto');
    assert.equal(conteudoDe(acervo, 'i2'), null, 'sem titulo: nulo');
    assert.equal(conteudoDe(acervo, 'i3'), 'texto da linha', 'o texto da linha vence o titulo');
    assert.equal(buscarMensagens(acervo, { texto: 'sintetica' }).length, 2, 'e a busca as acha');
    assert.equal(indiceDeBuscaEstaIntegro(acervo), true);
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('backup do iPhone: o titulo do DOCUMENTO e o nome do arquivo e NAO vira texto; reimportar nao muda o que esta gravado', () => {
  const c = cenario();
  const b = backupComMidia([
    { id: 'd1', tipo: 8, texto: null, titulo: 'relatorio-de-teste.pdf' },
    { id: 'i1', tipo: 1, texto: null, titulo: LEGENDA },
  ]);
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });
    assert.equal(conteudoDe(acervo, 'd1'), null, 'documento nao');
    assert.equal(conteudoDe(acervo, 'i1'), LEGENDA);
    importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });
    assert.equal(conteudoDe(acervo, 'i1'), LEGENDA, 'reimportar nao muda');
    assert.equal((acervo.db.prepare('SELECT COUNT(*) AS n FROM mensagens').get() as { n: number }).n, 2);
  } finally {
    b.limpar();
    c.limpar();
  }
});
