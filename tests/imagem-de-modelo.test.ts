import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leituraDoModelo } from '../src/adaptadores/whatsapp/imagem-de-modelo.js';

const IMAGEM = {
  mimetype: 'image/jpeg',
  mediaKey: 'AAECAwQFBgcICQoLDA0ODw==',
  directPath: '/v/t62.7118-24/sintetico',
  url: 'https://mmg.exemplo.invalid/sintetico',
  fileLength: '81572',
  jpegThumbnail: 'miniatura-sintetica',
};

const modelo = (cabecalho: unknown) => ({
  templateMessage: { interactiveMessageTemplate: { body: { text: 'oferta' }, header: cabecalho } },
});

test('a forma medida devolve o conteudo da imagem, o mesmo objeto do bruto', () => {
  const message = modelo({ imageMessage: IMAGEM });
  const r = leituraDoModelo(message);
  assert.equal(r.tipo, 'imagem');
  if (r.tipo === 'imagem') assert.equal(r.conteudo, IMAGEM, 'sem copia: o mediaKey binario chega como veio');
});

test('mediaKey serializado como Buffer tambem e reconhecido', () => {
  const r = leituraDoModelo(modelo({ imageMessage: { ...IMAGEM, mediaKey: { type: 'Buffer', data: [1, 2, 3, 4] } } }));
  assert.equal(r.tipo, 'imagem');
});

test('mediaKey binario (a mensagem crua da biblioteca) tambem e reconhecido, sem copia', () => {
  const imagem = { ...IMAGEM, mediaKey: new Uint8Array([1, 2, 3, 4]) };
  const r = leituraDoModelo(modelo({ imageMessage: imagem }));
  assert.equal(r.tipo, 'imagem');
  if (r.tipo === 'imagem') assert.ok(r.conteudo['mediaKey'] instanceof Uint8Array, 'o binario chega como veio');
  assert.equal(leituraDoModelo(modelo({ imageMessage: { ...IMAGEM, mediaKey: new Uint8Array(0) } })).tipo, 'nao-reconhecida');
});

test('modelo sem imagem no cabecalho (so texto, ou outra midia) e "sem-imagem"', () => {
  assert.equal(leituraDoModelo(modelo(undefined)).tipo, 'sem-imagem');
  assert.equal(leituraDoModelo(modelo({ title: 'oferta' })).tipo, 'sem-imagem');
  assert.equal(leituraDoModelo(modelo({ videoMessage: { mediaKey: 'AAAA', directPath: '/v' } })).tipo, 'sem-imagem');
});

test('imagem em lugar que nao e o medido ou sem chave legivel e "nao-reconhecida", nunca adivinhada', () => {
  const hidratado = { templateMessage: { hydratedTemplate: { hydratedHeader: { imageMessage: IMAGEM } } } };
  assert.equal(leituraDoModelo(hidratado).tipo, 'nao-reconhecida');
  assert.equal(leituraDoModelo(modelo({ imageMessage: { ...IMAGEM, mediaKey: undefined } })).tipo, 'nao-reconhecida');
  assert.equal(leituraDoModelo(modelo({ imageMessage: { ...IMAGEM, mediaKey: '' } })).tipo, 'nao-reconhecida');
  assert.equal(leituraDoModelo(modelo({ imageMessage: { mediaKey: 'AAAA' } })).tipo, 'nao-reconhecida', 'sem url nem directPath');
  assert.equal(leituraDoModelo(modelo({ imageMessage: 'nao e objeto' })).tipo, 'nao-reconhecida');
});

test('o que nao e mensagem de modelo e "sem-imagem", inclusive a imagem comum e a entrada invalida', () => {
  assert.equal(leituraDoModelo({ imageMessage: IMAGEM }).tipo, 'sem-imagem');
  assert.equal(leituraDoModelo({ interactiveMessage: { header: { imageMessage: IMAGEM } } }).tipo, 'sem-imagem');
  for (const ruim of [null, undefined, 'texto', 42, []]) {
    assert.equal(leituraDoModelo(ruim).tipo, 'sem-imagem', String(ruim));
  }
});
