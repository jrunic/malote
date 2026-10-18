import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carregarDecodificador } from '../src/adaptadores/whatsapp/conexao.js';
import { decidirEdicao, lerEdicaoRecebida, lerMensagemEditada } from '../src/adaptadores/whatsapp/edicao.js';
import { receberEvento, type MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { lerEdicoes } from '../src/nucleo/edicao.js';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { cifrarEdicao, segredoSintetico } from './ajuda/edicao-cifrada.js';

const AGORA = 1_791_300_000_000;
const T_EDICAO = AGORA - 300_000;
const GRUPO = '120363000000000001@g.us';
const AUTOR = '5511000000009@lid';

test('o decodificador chama a biblioteca por import dinamico, so quando pedido, e pede os enums como nome', async () => {
  const chamadas: unknown[] = [];
  let carregou = 0;
  const falsa = {
    proto: {
      Message: {
        decode: (b: Uint8Array) => ({ lido: b.length }),
        toObject: (m: unknown, o: unknown) => {
          chamadas.push(o);
          return { protocolMessage: { type: 'MESSAGE_EDIT' }, de: m };
        },
      },
    },
  };
  const decodificar = await carregarDecodificador({
    carregarBiblioteca: async () => {
      carregou += 1;
      return falsa;
    },
  });
  assert.equal(carregou, 1);
  const lido = decodificar(new Uint8Array([1, 2, 3]));
  assert.deepEqual(lido, { protocolMessage: { type: 'MESSAGE_EDIT' }, de: { lido: 3 } });
  assert.deepEqual(chamadas, [{ longs: Number, bytes: String, enums: String }]);
});

test('com a biblioteca real: o protobuf de uma edicao volta como objeto simples, enum por nome e instante numerico', async () => {
  const lib = (await import('baileys')) as unknown as {
    proto: {
      Message: {
        create: (o: unknown) => unknown;
        encode: (m: unknown) => { finish: () => Uint8Array };
        ProtocolMessage: { Type: { MESSAGE_EDIT: number } };
      };
    };
  };
  const bytes = lib.proto.Message.encode(
    lib.proto.Message.create({
      protocolMessage: {
        type: lib.proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
        key: { id: 'ORIG-1' },
        editedMessage: { conversation: 'texto novo' },
        timestampMs: T_EDICAO,
      },
    }),
  ).finish();

  const decodificar = await carregarDecodificador();
  const objeto = decodificar(bytes);
  const protocolo = objeto['protocolMessage'] as Record<string, unknown>;
  assert.equal(protocolo['type'], 'MESSAGE_EDIT');
  assert.equal(typeof protocolo['timestampMs'], 'number');
  assert.deepEqual(lerMensagemEditada(protocolo), { texto: 'texto novo', instanteMs: T_EDICAO });
});

test('de ponta a ponta com a biblioteca real: o envelope cifrado com protobuf vira Edicao', async () => {
  const lib = (await import('baileys')) as unknown as {
    proto: {
      Message: {
        create: (o: unknown) => unknown;
        encode: (m: unknown) => { finish: () => Uint8Array };
        ProtocolMessage: { Type: { MESSAGE_EDIT: number } };
      };
    };
  };
  const claro = Buffer.from(
    lib.proto.Message.encode(
      lib.proto.Message.create({
        protocolMessage: {
          type: lib.proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
          key: { id: 'ORIG-1' },
          editedMessage: { extendedTextMessage: { text: 'texto novo' } },
          timestampMs: T_EDICAO,
        },
      }),
    ).finish(),
  );
  const segredo = segredoSintetico();
  const { encIv, encPayload } = cifrarEdicao({ segredo, idOriginal: 'ORIG-1', editor: AUTOR, claro });
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular de Teste');
    const original: MensagemRecebida = {
      key: { remoteJid: GRUPO, id: 'ORIG-1', fromMe: false, participant: AUTOR },
      messageTimestamp: Math.floor((AGORA - 600_000) / 1000),
      message: { conversation: 'texto original', messageContextInfo: { messageSecret: segredo.toString('base64') } },
    };
    const envelope: MensagemRecebida = {
      key: { remoteJid: GRUPO, id: 'EV-1', fromMe: false, participant: AUTOR },
      messageTimestamp: Math.floor(T_EDICAO / 1000),
      message: {
        secretEncryptedMessage: {
          targetMessageKey: { remoteJid: GRUPO, fromMe: false, id: 'ORIG-1' },
          encPayload,
          encIv,
          secretEncType: 'MESSAGE_EDIT',
        },
      },
    };
    const opcoes = { agora: AGORA, configuracao: CFG_WHATSAPP, decodificar: await carregarDecodificador() };
    receberEvento(acervo, [original], opcoes);
    const r = receberEvento(acervo, [envelope], opcoes);
    assert.equal(r.edicoes, 1);
    const id = (acervo.db.prepare('SELECT id FROM mensagens WHERE id_externo = ?').get('ORIG-1') as { id: string }).id;
    assert.deepEqual(
      (lerEdicoes(acervo, [id]).get(id) ?? []).map((e) => [e.texto, e.editadaEm]),
      [['texto novo', T_EDICAO]],
    );
    // As funcoes puras nao se perdem de vista: o envelope e reconhecido como cifrado.
    assert.equal((lerEdicaoRecebida(envelope) as { origem: string }).origem, 'cifrada');
    assert.equal(typeof decidirEdicao, 'function');
  } finally {
    c.limpar();
  }
});
