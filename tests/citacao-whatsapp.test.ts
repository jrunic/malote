import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citacaoDaMensagem } from '../src/adaptadores/whatsapp/citacao.js';

const AUTOR = '109876543210987@lid';
const contexto = { stanzaId: 'ORIGINAL1', participant: AUTOR, quotedMessage: { conversation: 'trecho' } };

test('texto que cita: o id da citada e o endereco do autor dela', () => {
  assert.deepEqual(citacaoDaMensagem({ extendedTextMessage: { text: 'sim', contextInfo: contexto } }), {
    idExterno: 'ORIGINAL1',
    enderecoDoAutor: AUTOR,
  });
});

test('midia que cita: figurinha, audio, imagem, video e documento carregam a citacao no mesmo lugar', () => {
  for (const tipo of ['stickerMessage', 'audioMessage', 'imageMessage', 'videoMessage', 'documentMessage']) {
    assert.deepEqual(citacaoDaMensagem({ [tipo]: { contextInfo: contexto } }), { idExterno: 'ORIGINAL1', enderecoDoAutor: AUTOR }, tipo);
  }
});

test('documento com legenda: a citacao esta dentro do envelope', () => {
  const m = { documentWithCaptionMessage: { message: { documentMessage: { caption: 'x', contextInfo: contexto } } } };
  assert.deepEqual(citacaoDaMensagem(m), { idExterno: 'ORIGINAL1', enderecoDoAutor: AUTOR });
});

test('o acompanhante de chave de grupo nao atrapalha: a citacao esta no conteudo, nao nele', () => {
  const m = { senderKeyDistributionMessage: { groupId: 'g' }, extendedTextMessage: { text: 'sim', contextInfo: contexto } };
  assert.deepEqual(citacaoDaMensagem(m), { idExterno: 'ORIGINAL1', enderecoDoAutor: AUTOR });
});

test('sem contexto de citacao, ou com contexto sem id da citada, nao ha Citacao', () => {
  assert.equal(citacaoDaMensagem({ conversation: 'oi' }), undefined);
  assert.equal(citacaoDaMensagem({ extendedTextMessage: { text: 'oi' } }), undefined);
  assert.equal(citacaoDaMensagem({ extendedTextMessage: { text: 'oi', contextInfo: { mentionedJid: [AUTOR] } } }), undefined);
  assert.equal(citacaoDaMensagem({ extendedTextMessage: { text: 'oi', contextInfo: { stanzaId: '' } } }), undefined);
  assert.equal(citacaoDaMensagem(null), undefined);
  assert.equal(citacaoDaMensagem(undefined), undefined);
});

test('edicao, reacao, revogacao e pai de album nao sao Citacao, mesmo com o id da citada no registro', () => {
  const dentro = { contextInfo: contexto };
  assert.equal(citacaoDaMensagem({ protocolMessage: { type: 'MESSAGE_EDIT', editedMessage: { extendedTextMessage: { text: 'x', ...dentro } } } }), undefined);
  assert.equal(citacaoDaMensagem({ editedMessage: { message: { extendedTextMessage: { text: 'x', ...dentro } } } }), undefined);
  assert.equal(citacaoDaMensagem({ reactionMessage: { text: '👍', key: { id: 'X' }, ...dentro } }), undefined);
  assert.equal(citacaoDaMensagem({ albumMessage: { expectedImageCount: 2, ...dentro } }), undefined);
  assert.equal(citacaoDaMensagem({ protocolMessage: { type: 'REVOKE', key: { id: 'X' }, ...dentro } }), undefined);
});

test('citacao sem participant ainda e Citacao: so o autor fica desconhecido', () => {
  assert.deepEqual(citacaoDaMensagem({ extendedTextMessage: { text: 'sim', contextInfo: { stanzaId: 'ORIGINAL1' } } }), {
    idExterno: 'ORIGINAL1',
    enderecoDoAutor: undefined,
  });
});

test('a midia associada de album e aberta, como a recepcao a abre', () => {
  const m = { associatedChildMessage: { message: { videoMessage: { contextInfo: contexto } } } };
  assert.deepEqual(citacaoDaMensagem(m), { idExterno: 'ORIGINAL1', enderecoDoAutor: AUTOR });
});

test('forma de conteudo que nao vira Mensagem nao e Citacao, mesmo com o id de outra', () => {
  assert.equal(citacaoDaMensagem({ pollUpdateMessage: { contextInfo: contexto } }), undefined);
  assert.equal(citacaoDaMensagem({ templateMessage: { contextInfo: contexto } }), undefined);
  assert.equal(citacaoDaMensagem({ interactiveMessage: { contextInfo: contexto } }), undefined);
});
