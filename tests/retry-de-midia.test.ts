import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconstituirMensagemParaRetry } from '../src/adaptadores/whatsapp/retry-de-midia.js';

const BASE = {
  key: { remoteJid: '5511000000001@s.whatsapp.net', id: 'M1', fromMe: false },
  messageTimestamp: 1_700_000_000,
};

test('mediaKey em string base64 (a forma medida nos dois casos reais) e reconstituido em Buffer', () => {
  const bruto = JSON.stringify({
    ...BASE,
    message: { videoMessage: { mediaKey: 'ZRu4OBFsg5OwyKys+RJWDjiKtxfUpvBfdmaLXEKi5nY=', directPath: '/x' } },
  });
  const r = reconstituirMensagemParaRetry('video', bruto) as {
    message: { videoMessage: { mediaKey: Buffer } };
  } | null;
  assert.notEqual(r, null);
  assert.ok(Buffer.isBuffer(r!.message.videoMessage.mediaKey));
  assert.equal(
    r!.message.videoMessage.mediaKey.toString('base64'),
    'ZRu4OBFsg5OwyKys+RJWDjiKtxfUpvBfdmaLXEKi5nY=',
  );
});

test('mediaKey na forma {type:Buffer,data} (pos round-trip de JSON) tambem e reconstituido', () => {
  const bruto = JSON.stringify({
    ...BASE,
    message: { imageMessage: { mediaKey: { type: 'Buffer', data: [1, 2, 3, 4] }, directPath: '/x' } },
  });
  const r = reconstituirMensagemParaRetry('image', bruto) as {
    message: { imageMessage: { mediaKey: Buffer } };
  } | null;
  assert.notEqual(r, null);
  assert.deepEqual([...r!.message.imageMessage.mediaKey], [1, 2, 3, 4]);
});

test('bruto de material IMPORTADO (forma ZWAMESSAGE, sem key.remoteJid) nunca e elegivel', () => {
  const brutoDeBackup = JSON.stringify({
    Z_PK: 123, ZMESSAGETYPE: 1, ZMEDIAITEM: 456,
  });
  assert.equal(reconstituirMensagemParaRetry('video', brutoDeBackup), null);
});

test('ao vivo, mas SEM conteudo do tipo do Anexo, nao e elegivel', () => {
  const bruto = JSON.stringify({ ...BASE, message: { imageMessage: { mediaKey: 'AAAA' } } });
  // O Anexo diz 'video', mas so ha imageMessage no bruto.
  assert.equal(reconstituirMensagemParaRetry('video', bruto), null);
});

test('ao vivo, conteudo do tipo certo mas SEM mediaKey nenhuma, nao e elegivel', () => {
  const bruto = JSON.stringify({ ...BASE, message: { videoMessage: { directPath: '/x' } } });
  assert.equal(reconstituirMensagemParaRetry('video', bruto), null);
});

test('JSON malformado nao derruba, devolve null', () => {
  assert.equal(reconstituirMensagemParaRetry('video', '{nao e json'), null);
});
