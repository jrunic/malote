import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { cifrarEdicao, decodificadorDeTeste, segredoSintetico } from './ajuda/edicao-cifrada.js';
import { receberEvento, type MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { caminhoDaGuardaAnterior, reprocessarDescartados } from '../src/cli/guarda-de-descartes.js';

const AGORA = Date.parse('2026-10-18T12:00:00Z');
const T_ORIGINAL = Math.floor((AGORA - 3_600_000) / 1000);
const T_EDICAO = AGORA - 3_000_000;
const GRUPO = '120363000000000001@g.us';
const AUTOR = '5511000000009@lid';
const cfg = CFG_WHATSAPP;

function original(id: string, segredo: Buffer | null): MensagemRecebida {
  return {
    key: { remoteJid: GRUPO, id, fromMe: false, participant: AUTOR },
    messageTimestamp: T_ORIGINAL,
    message: {
      conversation: `texto de ${id}`,
      ...(segredo !== null ? { messageContextInfo: { messageSecret: segredo.toString('base64') } } : {}),
    },
  };
}

function edicaoCifrada(idEvento: string, alvoId: string, segredo: Buffer, texto: string): MensagemRecebida {
  const { encIv, encPayload } = cifrarEdicao({
    segredo,
    idOriginal: alvoId,
    editor: AUTOR,
    claro: { protocolMessage: { type: 'MESSAGE_EDIT', key: { id: alvoId }, editedMessage: { conversation: texto }, timestampMs: T_EDICAO } },
  });
  return {
    key: { remoteJid: GRUPO, id: idEvento, fromMe: false, participant: AUTOR },
    messageTimestamp: Math.floor(T_EDICAO / 1000),
    message: {
      secretEncryptedMessage: {
        targetMessageKey: { remoteJid: GRUPO, fromMe: false, id: alvoId },
        encPayload,
        encIv,
        secretEncType: 'MESSAGE_EDIT',
      },
    },
  };
}

function linha(evento: MensagemRecebida, motivo: string, causa?: string): string {
  return JSON.stringify({ em: '2026-10-17T00:00:00.000Z', motivo, ...(causa !== undefined ? { causa } : {}), evento });
}

function cena() {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular de Teste');
  const raiz = mkdtempSync(join(tmpdir(), 'malote-reproc-edicao-'));
  const caminho = join(raiz, 'descartados.jsonl');
  const n = (tabela: string): number => (acervo.db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number }).n;
  const receber = (e: MensagemRecebida[]) => receberEvento(acervo, e, { origemDaChegada: 'ao-vivo', agora: AGORA, configuracao: cfg, decodificar: decodificadorDeTeste });
  return { acervo, caminho, n, receber, limpar: () => { rmSync(raiz, { recursive: true, force: true }); c.limpar(); } };
}

const MOTIVO = 'secretEncryptedMessage';

test('o retroativo grava a edicao guardada, conta como gravada e tira a linha da guarda', () => {
  const g = cena();
  try {
    const segredo = segredoSintetico();
    g.receber([original('ORIG-1', segredo)]);
    writeFileSync(g.caminho, `${linha(edicaoCifrada('EV-1', 'ORIG-1', segredo, 'texto corrigido'), MOTIVO)}\n`);
    const r = reprocessarDescartados(g.acervo, g.caminho, cfg, AGORA, { decodificar: decodificadorDeTeste });
    assert.deepEqual(r, { lidos: 1, gravados: 1, mantidos: 0, retirados: 0, edicoes: 1 });
    assert.equal(g.n('edicoes'), 1);
    assert.equal(g.n('mensagens'), 1, 'a edicao nao pode criar Mensagem');
    assert.equal(existsSync(g.caminho), false, 'a linha gravada tem de sair da guarda (sem linhas, o arquivo some)');
  } finally {
    g.limpar();
  }
});

test('sem o decodificador a edicao cifrada fica guardada, intacta, e nada e gravado', () => {
  const g = cena();
  try {
    const segredo = segredoSintetico();
    g.receber([original('ORIG-1', segredo)]);
    const conteudo = `${linha(edicaoCifrada('EV-1', 'ORIG-1', segredo, 'texto corrigido'), MOTIVO)}\n`;
    writeFileSync(g.caminho, conteudo);
    const r = reprocessarDescartados(g.acervo, g.caminho, cfg, AGORA);
    assert.deepEqual(r, { lidos: 1, gravados: 0, mantidos: 1, retirados: 0, edicoes: 0 });
    assert.equal(g.n('edicoes'), 0);
    assert.equal(readFileSync(g.caminho, 'utf8'), conteudo);
  } finally {
    g.limpar();
  }
});

test('a edicao que ja esta no Acervo (gravada ao vivo) sai da guarda como gravada, nunca como ruido', () => {
  const g = cena();
  try {
    const segredo = segredoSintetico();
    g.receber([original('ORIG-1', segredo)]);
    const evento = edicaoCifrada('EV-1', 'ORIG-1', segredo, 'texto corrigido');
    assert.equal(g.receber([evento]).edicoes, 1);
    writeFileSync(g.caminho, `${linha(evento, MOTIVO)}\n`);
    const r = reprocessarDescartados(g.acervo, g.caminho, cfg, AGORA, { decodificar: decodificadorDeTeste });
    assert.deepEqual(r, { lidos: 1, gravados: 1, mantidos: 0, retirados: 0, edicoes: 0 });
    assert.equal(g.n('edicoes'), 1, 'a reentrega duplicou a Edicao');
    assert.equal(existsSync(g.caminho), false);
  } finally {
    g.limpar();
  }
});

test('lote misto: edicao que entra, sem segredo, sem original, ruido e outro descartado; lidos = gravados + mantidos + retirados', () => {
  const g = cena();
  try {
    const segredo = segredoSintetico();
    g.receber([original('ORIG-1', segredo), original('ORIG-SEM-SEGREDO', null)]);
    const ruido: MensagemRecebida = {
      key: { remoteJid: GRUPO, id: 'RUIDO-1', fromMe: false, participant: AUTOR },
      messageTimestamp: T_ORIGINAL,
      message: { protocolMessage: { type: 'APP_STATE_SYNC_KEY_SHARE' } },
    };
    const outro: MensagemRecebida = {
      key: { remoteJid: GRUPO, id: 'OUTRO-1', fromMe: false, participant: AUTOR },
      messageTimestamp: T_ORIGINAL,
      message: { tipoNuncaVistoMessage: { x: 1 } },
    };
    const entra = edicaoCifrada('EV-1', 'ORIG-1', segredo, 'entra');
    const semSegredo = edicaoCifrada('EV-2', 'ORIG-SEM-SEGREDO', segredo, 'nao entra');
    const semOriginal = edicaoCifrada('EV-3', 'NAO-EXISTE', segredo, 'nao entra');
    writeFileSync(
      g.caminho,
      [
        linha(entra, MOTIVO),
        linha(semSegredo, MOTIVO, 'sem-segredo'),
        linha(semOriginal, MOTIVO, 'original-ausente'),
        linha(ruido, 'protocolMessage:APP_STATE_SYNC_KEY_SHARE'),
        linha(outro, 'tipoNuncaVisto'),
      ].join('\n') + '\n',
    );
    const r = reprocessarDescartados(g.acervo, g.caminho, cfg, AGORA, { decodificar: decodificadorDeTeste });
    assert.deepEqual(r, { lidos: 5, gravados: 1, mantidos: 3, retirados: 1, edicoes: 1 });
    assert.equal(r.lidos, r.gravados + r.mantidos + r.retirados);
    const restantes = readFileSync(g.caminho, 'utf8').trim().split('\n').map((l) => (JSON.parse(l) as { evento: MensagemRecebida }).evento.key.id);
    assert.deepEqual(restantes, ['EV-2', 'EV-3', 'OUTRO-1']);
  } finally {
    g.limpar();
  }
});

test('a segunda rodada nao acha mais nada a gravar', () => {
  const g = cena();
  try {
    const segredo = segredoSintetico();
    g.receber([original('ORIG-1', segredo)]);
    writeFileSync(g.caminho, `${linha(edicaoCifrada('EV-1', 'ORIG-1', segredo, 'texto corrigido'), MOTIVO)}\n`);
    reprocessarDescartados(g.acervo, g.caminho, cfg, AGORA, { decodificar: decodificadorDeTeste });
    const r2 = reprocessarDescartados(g.acervo, g.caminho, cfg, AGORA, { decodificar: decodificadorDeTeste });
    assert.deepEqual(r2, { lidos: 0, gravados: 0, mantidos: 0, retirados: 0, edicoes: 0 });
  } finally {
    g.limpar();
  }
});

test('o arquivo anterior da guarda (rotacionado) tambem e reprocessado', () => {
  const g = cena();
  try {
    const segredo = segredoSintetico();
    g.receber([original('ORIG-1', segredo)]);
    writeFileSync(caminhoDaGuardaAnterior(g.caminho), `${linha(edicaoCifrada('EV-1', 'ORIG-1', segredo, 'do anterior'), MOTIVO)}\n`);
    const r = reprocessarDescartados(g.acervo, g.caminho, cfg, AGORA, { decodificar: decodificadorDeTeste });
    assert.equal(r.edicoes, 1);
    assert.equal(existsSync(caminhoDaGuardaAnterior(g.caminho)), false);
  } finally {
    g.limpar();
  }
});
