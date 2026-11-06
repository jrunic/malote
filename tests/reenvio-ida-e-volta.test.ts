// tests/reenvio-ida-e-volta.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { reconstituirMensagemDoEco, type ProtoDoReenvio } from '../src/adaptadores/whatsapp/reenvio.js';

/**
 * A PROPRIEDADE DO CRITERIO 2 (#1420), com a BIBLIOTECA REAL e sem rede: para cada tipo de mensagem que o malote
 * envia, `codificar(reconstituir(registro(m))) = codificar(m)`, no nivel de `proto.Message.encode` (antes do
 * preenchimento aleatorio que vai ao fio, que nunca se repete). `registro` e o caminho do ouvinte: a ida e volta de
 * JSON da conexao e o `JSON.stringify` da gravacao. A forma gravada depende da versao da biblioteca; por isso a versao
 * esta pinada no ultimo teste, e troca-la obriga a rodar esta propriedade de novo.
 */

interface Codificado {
  finish: () => Uint8Array;
}
interface MensagemDaBiblioteca {
  key: { id?: string; remoteJid?: string; fromMe?: boolean };
  message: unknown;
}
interface BibliotecaReal {
  proto: ProtoDoReenvio & {
    Message: { encode: (m: unknown) => Codificado };
    WebMessageInfo: { fromObject: (o: unknown) => unknown };
  };
  generateWAMessage: (jid: string, conteudo: unknown, opcoes: unknown) => Promise<MensagemDaBiblioteca>;
  generateWAMessageFromContent: (jid: string, conteudo: unknown, opcoes: unknown) => MensagemDaBiblioteca;
}

const carregar = async (): Promise<BibliotecaReal> => (await import('baileys')) as unknown as BibliotecaReal;

const CONTATO = '5511900000001@s.whatsapp.net';
const COLETIVA = '120363000000000001@g.us';
const OPACO = '100000000000001@lid';
const DA_CONTA = '5511900000009:3@s.whatsapp.net';

const silencioso = {
  level: 'silent',
  child() {
    return silencioso;
  },
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
// Upload SIMULADO: o caminho de midia da biblioteca cifra e calcula os hashes de verdade, so nao sobe.
const upload = (): Promise<{ mediaUrl: string; directPath: string }> =>
  Promise.resolve({ mediaUrl: 'https://midia.exemplo/x', directPath: '/v/t62/x?ccb=1' });
let sequencia = 0;
const opcoes = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  userJid: DA_CONTA,
  upload,
  logger: silencioso,
  messageId: `3EB0SINTETICO${String((sequencia += 1)).padStart(6, '0')}`,
  ...extra,
});

/** O caminho do ouvinte: `conexao.ts` (ida e volta de JSON do lote) e `ao-vivo.ts` (`bruto: JSON.stringify(m)`). */
function registroDoEco(m: MensagemDaBiblioteca): string {
  const normalizadas = JSON.parse(JSON.stringify([m])) as unknown[];
  return JSON.stringify(normalizadas[0]);
}

function confere(lib: BibliotecaReal, m: MensagemDaBiblioteca): void {
  const original = Buffer.from(lib.proto.Message.encode(m.message).finish());
  const reconstituida = reconstituirMensagemDoEco(lib.proto, registroDoEco(m));
  assert.notEqual(reconstituida, undefined, 'o eco local tem a forma aceita');
  const volta = Buffer.from(lib.proto.Message.encode(reconstituida).finish());
  assert.ok(original.length > 0);
  assert.equal(volta.toString('hex'), original.toString('hex'));
}

test('ida e volta: texto para contato, para coletiva e para endereco opaco', async () => {
  const lib = await carregar();
  confere(lib, await lib.generateWAMessage(CONTATO, { text: 'ola' }, opcoes()));
  confere(lib, await lib.generateWAMessage(COLETIVA, { text: 'ola coletiva' }, opcoes()));
  confere(lib, await lib.generateWAMessage(OPACO, { text: 'ola opaco' }, opcoes()));
});

test('ida e volta: resposta a mensagem citada com imagem aninhada (binarios, longo acima de 2^32)', async () => {
  const lib = await carregar();
  const citada = lib.proto.WebMessageInfo.fromObject({
    key: { remoteJid: COLETIVA, fromMe: false, id: 'CITADA-SINTETICA', participant: '5511900000002@s.whatsapp.net' },
    message: {
      imageMessage: {
        url: 'https://midia.exemplo/c',
        mimetype: 'image/jpeg',
        mediaKey: randomBytes(32),
        fileSha256: randomBytes(32),
        fileEncSha256: randomBytes(32),
        fileLength: '5000000000',
        mediaKeyTimestamp: '1762400000',
        jpegThumbnail: randomBytes(500),
        caption: 'foto',
        contextInfo: { stanzaId: 'X' },
      },
    },
    messageTimestamp: 1_762_400_000,
  });
  confere(lib, await lib.generateWAMessage(COLETIVA, { text: 'resposta' }, opcoes({ quoted: citada })));
});

test('ida e volta: imagem, documento e audio pelo caminho de midia real (upload simulado)', async () => {
  const lib = await carregar();
  confere(
    lib,
    await lib.generateWAMessage(
      CONTATO,
      {
        image: randomBytes(2000),
        mimetype: 'image/jpeg',
        caption: 'legenda',
        jpegThumbnail: randomBytes(300).toString('base64'),
      },
      opcoes(),
    ),
  );
  confere(
    lib,
    await lib.generateWAMessage(
      CONTATO,
      { document: randomBytes(3000), mimetype: 'application/pdf', fileName: 'a.pdf', caption: 'doc' },
      opcoes(),
    ),
  );
  confere(
    lib,
    await lib.generateWAMessage(
      CONTATO,
      { audio: randomBytes(3000), mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: 3 },
      opcoes(),
    ),
  );
});

test('ida e volta: enumeracoes por nome, messageContextInfo e longos (o caso em que encode direto do JSON erra)', async () => {
  const lib = await carregar();
  const m = lib.generateWAMessageFromContent(
    CONTATO,
    {
      extendedTextMessage: {
        text: 'x',
        previewType: 1,
        font: 2,
        inviteLinkGroupTypeV2: 1,
        contextInfo: { isForwarded: true, forwardingScore: 0, externalAdReply: { mediaType: 2, title: 't', thumbnail: randomBytes(10) } },
      },
      messageContextInfo: {
        messageSecret: randomBytes(32),
        deviceListMetadataVersion: 2,
        deviceListMetadata: {
          senderKeyHash: randomBytes(10),
          senderTimestamp: '1762400000',
          recipientKeyHash: randomBytes(10),
          recipientTimestamp: '1762400001',
        },
      },
    },
    opcoes(),
  );
  confere(lib, m);
  // A forma gravada leva o enum pelo NOME: e por isso que o inverso e `fromObject`, e nao `encode` do objeto lido.
  const lido = JSON.parse(registroDoEco(m)) as { message: { extendedTextMessage: { previewType: unknown } } };
  assert.equal(typeof lido.message.extendedTextMessage.previewType, 'string');
  const cru = Buffer.from(lib.proto.Message.encode(lido.message).finish());
  assert.notEqual(cru.toString('hex'), Buffer.from(lib.proto.Message.encode(m.message).finish()).toString('hex'));
});

test('ida e volta: longos acima de 2^53, padroes explicitos e enum com valor desconhecido', async () => {
  const lib = await carregar();
  confere(
    lib,
    lib.generateWAMessageFromContent(
      CONTATO,
      {
        documentMessage: {
          url: 'u',
          mimetype: 'application/pdf',
          fileName: 'n',
          mediaKey: randomBytes(32),
          fileSha256: randomBytes(32),
          fileEncSha256: randomBytes(32),
          fileLength: '18446744073709551615',
          mediaKeyTimestamp: '9007199254740993',
          pageCount: 3,
          jpegThumbnail: randomBytes(100),
        },
      },
      opcoes(),
    ),
  );
  confere(
    lib,
    lib.generateWAMessageFromContent(
      CONTATO,
      {
        extendedTextMessage: { text: '', contextInfo: { forwardingScore: 0, isForwarded: false } },
        messageContextInfo: { messageSecret: Buffer.alloc(0) },
      },
      opcoes(),
    ),
  );
  confere(lib, lib.generateWAMessageFromContent(CONTATO, { extendedTextMessage: { text: 'y', previewType: 99 } }, opcoes()));
});

test('so a forma do eco local: fromMe falso, sem mensagem, mensagem que nao e objeto e registro do backup dao undefined', async () => {
  const lib = await carregar();
  const m = await lib.generateWAMessage(CONTATO, { text: 'ola' }, opcoes());
  const eco = JSON.parse(registroDoEco(m)) as Record<string, unknown> & { key: Record<string, unknown> };
  const comChave = (key: unknown, resto: Record<string, unknown> = {}): string => JSON.stringify({ ...eco, key, ...resto });
  assert.equal(reconstituirMensagemDoEco(lib.proto, comChave({ ...eco.key, fromMe: false })), undefined, 'a forma recebida');
  assert.equal(reconstituirMensagemDoEco(lib.proto, comChave({ ...eco.key, fromMe: 'true' })), undefined, 'so o booleano');
  assert.equal(reconstituirMensagemDoEco(lib.proto, comChave(eco.key, { message: null })), undefined, 'sem mensagem');
  assert.equal(reconstituirMensagemDoEco(lib.proto, comChave(eco.key, { message: 'texto' })), undefined, 'mensagem nao objeto');
  assert.equal(reconstituirMensagemDoEco(lib.proto, comChave(eco.key, { message: [1] })), undefined, 'mensagem vetor');
  assert.equal(reconstituirMensagemDoEco(lib.proto, JSON.stringify({ Z_PK: 1, ZTEXT: 'x', ZISFROMME: 1 })), undefined, 'backup');
  assert.equal(reconstituirMensagemDoEco(lib.proto, '[]'), undefined);
  assert.equal(reconstituirMensagemDoEco(lib.proto, 'null'), undefined);
  assert.throws(() => reconstituirMensagemDoEco(lib.proto, '{corrompido'), SyntaxError, 'JSON invalido lanca: quem chama conta erro');
});

test('a versao da biblioteca esta pinada em 6.7.24: trocar obriga a rodar a propriedade de ida e volta de novo', () => {
  const manifesto = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> };
  const instalada = JSON.parse(readFileSync('node_modules/baileys/package.json', 'utf8')) as { version: string };
  assert.equal(manifesto.dependencies['baileys'], '6.7.24');
  assert.equal(instalada.version, '6.7.24');
});
