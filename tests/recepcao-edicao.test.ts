import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { receberEvento, type MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { lerEdicoes } from '../src/nucleo/edicao.js';
import type { CausaDeEdicaoNaoGravada } from '../src/adaptadores/whatsapp/edicao.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { cifrarEdicao, decodificadorDeTeste, segredoSintetico } from './ajuda/edicao-cifrada.js';

const AGORA = 1_791_300_000_000;
const T_ORIGINAL = Math.floor((AGORA - 600_000) / 1000);
// Com fracao de segundo de proposito: o instante da edicao (milissegundos) nao pode ser confundido com o do envelope (segundos).
const T_EDICAO = AGORA - 299_877;
const GRUPO = '120363000000000001@g.us';
const OUTRO_GRUPO = '120363000000000002@g.us';
const AUTOR = '5511000000009@lid';

function original(id: string, texto: string, segredo: Buffer | null, remoteJid = GRUPO): MensagemRecebida {
  return {
    key: { remoteJid, id, fromMe: false, participant: AUTOR },
    messageTimestamp: T_ORIGINAL,
    message: {
      conversation: texto,
      ...(segredo !== null ? { messageContextInfo: { messageSecret: segredo.toString('base64') } } : {}),
    },
  };
}

function claro(alvoId: string, editada: Record<string, unknown>, timestampMs: number | null = T_EDICAO): Record<string, unknown> {
  return {
    protocolMessage: {
      type: 'MESSAGE_EDIT',
      key: { remoteJid: GRUPO, fromMe: false, id: alvoId, participant: AUTOR },
      editedMessage: editada,
      ...(timestampMs !== null ? { timestampMs } : {}),
    },
  };
}

function cifrada(
  idEvento: string,
  alvoId: string,
  segredo: Buffer,
  plano: Record<string, unknown>,
  opcoes: { remoteJid?: string; editor?: string; tipo?: string; timestamp?: number } = {},
): MensagemRecebida {
  const remoteJid = opcoes.remoteJid ?? GRUPO;
  const editor = opcoes.editor ?? AUTOR;
  const { encIv, encPayload } = cifrarEdicao({ segredo, idOriginal: alvoId, editor, claro: plano });
  return {
    key: { remoteJid, id: idEvento, fromMe: false, participant: AUTOR },
    messageTimestamp: Math.floor((opcoes.timestamp ?? T_EDICAO) / 1000),
    message: {
      secretEncryptedMessage: {
        targetMessageKey: { remoteJid, fromMe: false, id: alvoId },
        encPayload,
        encIv,
        secretEncType: opcoes.tipo ?? 'MESSAGE_EDIT',
      },
    },
  };
}

function aberta(idEvento: string, alvoId: string, editada: Record<string, unknown>, timestampMs: number | null = T_EDICAO): MensagemRecebida {
  return {
    key: { remoteJid: GRUPO, id: idEvento, fromMe: false, participant: AUTOR },
    messageTimestamp: Math.floor(T_EDICAO / 1000),
    message: claro(alvoId, editada, timestampMs),
  };
}

function cena(comDecodificador = true) {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular de Teste');
  const receber = (eventos: MensagemRecebida[]) =>
    receberEvento(acervo, eventos, {
      agora: AGORA,
      configuracao: CFG_WHATSAPP,
      ...(comDecodificador ? { decodificar: decodificadorDeTeste } : {}),
    });
  const idDe = (idExterno: string) =>
    (acervo.db.prepare('SELECT id FROM mensagens WHERE id_externo = ?').get(idExterno) as { id: string }).id;
  const contagem = (tabela: string) => (acervo.db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number }).n;
  return { c, acervo, receber, idDe, contagem };
}

test('a edicao cifrada vira uma Edicao ligada a Mensagem, sem Mensagem nova e sem mexer na original', () => {
  const { c, acervo, receber, idDe, contagem } = cena();
  try {
    const segredo = segredoSintetico();
    receber([original('ORIG-1', 'texto original', segredo)]);
    const antes = acervo.db.prepare('SELECT conteudo, bruto FROM mensagens WHERE id_externo = ?').get('ORIG-1');
    const r = receber([cifrada('EV-1', 'ORIG-1', segredo, claro('ORIG-1', { conversation: 'texto corrigido' }))]);

    assert.equal(r.edicoes, 1);
    assert.equal(r.gravados, 0);
    assert.deepEqual(r.descartados, []);
    assert.deepEqual(r.ignorados, {});
    assert.equal(contagem('mensagens'), 1, 'a edicao nao pode criar Mensagem');
    const lidas = lerEdicoes(acervo, [idDe('ORIG-1')]).get(idDe('ORIG-1')) ?? [];
    assert.deepEqual(
      lidas.map((e) => ({ texto: e.texto, editadaEm: e.editadaEm, origem: e.origem })),
      [{ texto: 'texto corrigido', editadaEm: T_EDICAO, origem: 'cifrada' }],
    );
    assert.deepEqual(acervo.db.prepare('SELECT conteudo, bruto FROM mensagens WHERE id_externo = ?').get('ORIG-1'), antes);
    // O bruto da Edicao e o evento como chegou.
    const bruto = (acervo.db.prepare('SELECT bruto FROM edicoes').get() as { bruto: string }).bruto;
    assert.equal((JSON.parse(bruto) as MensagemRecebida).key.id, 'EV-1');
  } finally {
    c.limpar();
  }
});

test('a edicao nao cifrada vira a mesma Edicao, com origem aberta', () => {
  const { c, acervo, receber, idDe } = cena();
  try {
    receber([original('ORIG-1', 'texto original', null)]);
    const r = receber([aberta('EV-1', 'ORIG-1', { conversation: 'texto corrigido' })]);
    assert.equal(r.edicoes, 1);
    assert.deepEqual(r.descartados, []);
    const lidas = lerEdicoes(acervo, [idDe('ORIG-1')]).get(idDe('ORIG-1')) ?? [];
    assert.deepEqual(lidas.map((e) => [e.texto, e.origem]), [['texto corrigido', 'aberta']]);
  } finally {
    c.limpar();
  }
});

test('a reentrega do mesmo evento de edicao nao cria outra Edicao e e contada como repetida', () => {
  const { c, receber, contagem } = cena();
  try {
    const segredo = segredoSintetico();
    receber([original('ORIG-1', 'texto original', segredo)]);
    const evento = cifrada('EV-1', 'ORIG-1', segredo, claro('ORIG-1', { conversation: 'novo' }));
    assert.equal(receber([evento]).edicoes, 1);
    const r2 = receber([evento]);
    assert.equal(r2.edicoes, 0);
    assert.equal(r2.edicoesRepetidas, 1);
    assert.equal(contagem('edicoes'), 1);
  } finally {
    c.limpar();
  }
});

test('duas edicoes da mesma Mensagem entram as duas, na ordem do instante', () => {
  const { c, acervo, receber, idDe } = cena();
  try {
    const segredo = segredoSintetico();
    receber([original('ORIG-1', 'texto original', segredo)]);
    receber([
      cifrada('EV-2', 'ORIG-1', segredo, claro('ORIG-1', { conversation: 'segunda' }, T_EDICAO + 60_000), { timestamp: T_EDICAO + 60_000 }),
      cifrada('EV-1', 'ORIG-1', segredo, claro('ORIG-1', { conversation: 'primeira' })),
    ]);
    const lidas = lerEdicoes(acervo, [idDe('ORIG-1')]).get(idDe('ORIG-1')) ?? [];
    assert.deepEqual(lidas.map((e) => e.texto), ['primeira', 'segunda']);
  } finally {
    c.limpar();
  }
});

test('o texto sai do texto simples, do estendido e da legenda de imagem, de video e de documento', () => {
  const { c, acervo, receber, idDe } = cena();
  try {
    const segredo = segredoSintetico();
    const formas: [string, Record<string, unknown>, string][] = [
      ['F-1', { extendedTextMessage: { text: 'estendido novo' } }, 'estendido novo'],
      ['F-2', { imageMessage: { caption: 'legenda de imagem' } }, 'legenda de imagem'],
      ['F-3', { videoMessage: { caption: 'legenda de video' } }, 'legenda de video'],
      ['F-4', { documentWithCaptionMessage: { message: { documentMessage: { caption: 'legenda de documento' } } } }, 'legenda de documento'],
      ['F-5', { documentMessage: { caption: 'documento sem embrulho' } }, 'documento sem embrulho'],
      ['F-6', { imageMessage: { mimetype: 'image/jpeg' } }, ''],
    ];
    for (const [alvo, editada, esperado] of formas) {
      receber([original(alvo, 'x', segredo)]);
      const r = receber([cifrada(`EV-${alvo}`, alvo, segredo, claro(alvo, editada))]);
      assert.equal(r.edicoes, 1, alvo);
      const texto = lerEdicoes(acervo, [idDe(alvo)]).get(idDe(alvo))?.[0]?.texto;
      assert.equal(texto, esperado, alvo);
    }
  } finally {
    c.limpar();
  }
});

test('o instante da edicao cai no do envelope quando a mensagem editada nao o traz', () => {
  const { c, acervo, receber, idDe } = cena();
  try {
    const segredo = segredoSintetico();
    receber([original('ORIG-1', 'x', segredo)]);
    receber([cifrada('EV-1', 'ORIG-1', segredo, claro('ORIG-1', { conversation: 'novo' }, null))]);
    assert.equal(lerEdicoes(acervo, [idDe('ORIG-1')]).get(idDe('ORIG-1'))?.[0]?.editadaEm, Math.floor(T_EDICAO / 1000) * 1000);
  } finally {
    c.limpar();
  }
});

test('a edicao com o instante a frente do relogio, dentro da tolerancia da recepcao, e gravada com o instante declarado', () => {
  const { c, acervo, receber, idDe } = cena();
  try {
    const segredo = segredoSintetico();
    receber([original('ORIG-1', 'x', segredo)]);
    const adiantado = AGORA + 3_000;
    const r = receber([cifrada('EV-1', 'ORIG-1', segredo, claro('ORIG-1', { conversation: 'novo' }, adiantado), { timestamp: adiantado })]);
    assert.equal(r.edicoes, 1);
    assert.equal(lerEdicoes(acervo, [idDe('ORIG-1')]).get(idDe('ORIG-1'))?.[0]?.editadaEm, adiantado);
  } finally {
    c.limpar();
  }
});

interface CasoDeRecusa {
  nome: string;
  causa: CausaDeEdicaoNaoGravada;
  motivo: string;
  prepara: (receber: (e: MensagemRecebida[]) => unknown, segredo: Buffer) => MensagemRecebida;
  semDecodificador?: boolean;
}

const RECUSAS: CasoDeRecusa[] = [
  {
    nome: 'original ausente',
    causa: 'original-ausente',
    motivo: 'secretEncryptedMessage',
    prepara: (_r, segredo) => cifrada('EV-1', 'NAO-EXISTE', segredo, claro('NAO-EXISTE', { conversation: 'x' })),
  },
  {
    nome: 'original sem segredo',
    causa: 'sem-segredo',
    motivo: 'secretEncryptedMessage',
    prepara: (receber, segredo) => {
      receber([original('ORIG-1', 'x', null)]);
      return cifrada('EV-1', 'ORIG-1', segredo, claro('ORIG-1', { conversation: 'x' }));
    },
  },
  {
    nome: 'tag que nao autentica (segredo diferente)',
    causa: 'tag-invalida',
    motivo: 'secretEncryptedMessage',
    prepara: (receber, segredo) => {
      receber([original('ORIG-1', 'x', segredo)]);
      return cifrada('EV-1', 'ORIG-1', segredoSintetico(), claro('ORIG-1', { conversation: 'x' }));
    },
  },
  {
    nome: 'editor trocado na derivacao',
    causa: 'tag-invalida',
    motivo: 'secretEncryptedMessage',
    prepara: (receber, segredo) => {
      receber([original('ORIG-1', 'x', segredo)]);
      return cifrada('EV-1', 'ORIG-1', segredo, claro('ORIG-1', { conversation: 'x' }), { editor: '5511000000099@lid' });
    },
  },
  {
    nome: 'original em outra Conversa',
    causa: 'outra-conversa',
    motivo: 'secretEncryptedMessage',
    prepara: (receber, segredo) => {
      receber([original('ORIG-1', 'x', segredo, OUTRO_GRUPO)]);
      return cifrada('EV-1', 'ORIG-1', segredo, claro('ORIG-1', { conversation: 'x' }));
    },
  },
  {
    nome: 'forma sem texto reconhecivel',
    causa: 'sem-texto',
    motivo: 'secretEncryptedMessage',
    prepara: (receber, segredo) => {
      receber([original('ORIG-1', 'x', segredo)]);
      return cifrada('EV-1', 'ORIG-1', segredo, claro('ORIG-1', { stickerMessage: { mimetype: 'image/webp' } }));
    },
  },
  {
    nome: 'texto claro que nao e uma edicao',
    causa: 'forma-desconhecida',
    motivo: 'secretEncryptedMessage',
    prepara: (receber, segredo) => {
      receber([original('ORIG-1', 'x', segredo)]);
      return cifrada('EV-1', 'ORIG-1', segredo, { conversation: 'isto nao e protocolo' });
    },
  },
  {
    nome: 'instante implausivel (no futuro)',
    causa: 'instante-implausivel',
    motivo: 'secretEncryptedMessage',
    prepara: (receber, segredo) => {
      receber([original('ORIG-1', 'x', segredo)]);
      return cifrada('EV-1', 'ORIG-1', segredo, claro('ORIG-1', { conversation: 'x' }, AGORA + 3_600_000));
    },
  },
  {
    nome: 'sem decodificador (o portao nao foi entregue)',
    causa: 'sem-decodificador',
    motivo: 'secretEncryptedMessage',
    semDecodificador: true,
    prepara: (receber, segredo) => {
      receber([original('ORIG-1', 'x', segredo)]);
      return cifrada('EV-1', 'ORIG-1', segredo, claro('ORIG-1', { conversation: 'x' }));
    },
  },
  {
    nome: 'envelope cifrado incompleto (sem carga)',
    causa: 'envelope-incompleto',
    motivo: 'secretEncryptedMessage',
    prepara: (_r, segredo) => {
      const e = cifrada('EV-1', 'ORIG-1', segredo, claro('ORIG-1', { conversation: 'x' }));
      delete (e.message as { secretEncryptedMessage: Record<string, unknown> }).secretEncryptedMessage['encPayload'];
      return e;
    },
  },
  {
    nome: 'edicao aberta com a original ausente',
    causa: 'original-ausente',
    motivo: 'protocolMessage:MESSAGE_EDIT',
    prepara: () => aberta('EV-1', 'NAO-EXISTE', { conversation: 'x' }),
  },
  {
    nome: 'edicao aberta sem a mensagem editada',
    causa: 'envelope-incompleto',
    motivo: 'protocolMessage:MESSAGE_EDIT',
    prepara: (receber) => {
      receber([original('ORIG-1', 'x', null)]);
      const e = aberta('EV-1', 'ORIG-1', { conversation: 'x' });
      delete (e.message as { protocolMessage: Record<string, unknown> }).protocolMessage['editedMessage'];
      return e;
    },
  },
];

for (const caso of RECUSAS) {
  test(`${caso.nome}: nenhuma Edicao, nenhuma Mensagem, o evento segue descartado, contado e com a causa`, () => {
    const { c, receber, contagem } = cena(caso.semDecodificador !== true);
    try {
      const segredo = segredoSintetico();
      const evento = caso.prepara(receber, segredo);
      const mensagensAntes = contagem('mensagens');
      const r = receber([evento]);
      assert.equal(r.edicoes, 0);
      assert.equal(r.gravados, 0);
      assert.equal(contagem('edicoes'), 0);
      assert.equal(contagem('mensagens'), mensagensAntes, 'a edicao recusada nao pode criar Mensagem');
      assert.equal(r.descartados.length, 1);
      assert.equal(r.descartados[0]?.motivo, caso.motivo);
      assert.equal(r.descartados[0]?.causa, caso.causa);
      assert.equal(r.descartados[0]?.ruido, false, 'a edicao que nao decifra e guardada, nunca ruido');
      assert.equal(r.edicoesNaoGravadas[caso.causa], 1);
      assert.equal(r.ignorados[caso.motivo.split(':')[0] as string], 1);
    } finally {
      c.limpar();
    }
  });
}

test('o tipo cifrado que nao e edicao de mensagem segue ignorado e contado, sem tentar decifrar', () => {
  const { c, receber } = cena();
  try {
    const segredo = segredoSintetico();
    receber([original('ORIG-1', 'x', segredo)]);
    const r = receber([cifrada('EV-1', 'ORIG-1', segredo, claro('ORIG-1', { conversation: 'x' }), { tipo: 'EVENT_EDIT' })]);
    assert.equal(r.edicoes, 0);
    assert.deepEqual(r.edicoesNaoGravadas, {});
    assert.equal(r.descartados[0]?.motivo, 'secretEncryptedMessage');
    assert.equal(r.descartados[0]?.causa, undefined);
  } finally {
    c.limpar();
  }
});

test('uma edicao que nao decifra nao derruba o lote: as demais entram', () => {
  const { c, receber, contagem } = cena();
  try {
    const segredo = segredoSintetico();
    receber([original('ORIG-1', 'x', segredo), original('ORIG-2', 'y', segredo)]);
    const r = receber([
      cifrada('EV-1', 'ORIG-1', segredoSintetico(), claro('ORIG-1', { conversation: 'nao entra' })),
      cifrada('EV-2', 'ORIG-2', segredo, claro('ORIG-2', { conversation: 'entra' })),
    ]);
    assert.equal(r.edicoes, 1);
    assert.equal(contagem('edicoes'), 1);
    assert.equal(r.descartados.length, 1);
  } finally {
    c.limpar();
  }
});
