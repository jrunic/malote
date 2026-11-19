// tests/decifra-captura.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agruparCausa, extrairFalha, tipoDaConversa, type FalhaCapturada } from '../src/adaptadores/whatsapp/falha-de-decifra.js';
import { observarLogger } from '../src/adaptadores/whatsapp/pendentes-na-conexao.js';
import { conectar } from '../src/adaptadores/whatsapp/conexao.js';

const GRUPO = '120363000000000001@g.us';
const OPACO = '100000000000001@lid';
const TEL = '5511900000001@s.whatsapp.net';

test('tipo da conversa pelo sufixo do endereco', () => {
  assert.equal(tipoDaConversa(GRUPO), 'grupo');
  assert.equal(tipoDaConversa(OPACO), 'direta-opaca');
  assert.equal(tipoDaConversa(TEL), 'direta-telefone');
  assert.equal(tipoDaConversa('status@broadcast'), 'status-e-outros');
  assert.equal(tipoDaConversa('1203@newsletter'), 'status-e-outros');
});

test('a causa e agrupada num conjunto fechado; o numero do contador antigo nao vira causa nova', () => {
  assert.equal(agruparCausa('Key used already or never filled'), 'reentrega');
  assert.equal(agruparCausa('No session found to decrypt message'), 'sem-sessao');
  assert.equal(agruparCausa('No matching sessions found for message'), 'sem-sessao-compativel');
  assert.equal(agruparCausa('Invalid PreKey ID'), 'prechave-invalida');
  assert.equal(agruparCausa('Received message with old counter: 7, 9'), 'contador-antigo');
  assert.equal(agruparCausa('Received message with old counter: 12, 40'), 'contador-antigo');
  assert.equal(agruparCausa('algo novo 123'), 'outra');
});

test('extrairFalha le so a chave e o erro; a direcao vem de fromMe; linha sem chave nao registra', () => {
  const f = extrairFalha([
    { key: { id: 'ID1', remoteJid: GRUPO, participant: OPACO, fromMe: false }, err: { message: 'No session found to decrypt message', stack: 'x'.repeat(999) }, extra: 'texto da mensagem' },
    'failed to decrypt message',
  ]);
  assert.deepEqual(f, { id: 'ID1', conversa: GRUPO, autor: OPACO, direcao: 'recebida', tipo: 'grupo', causa: 'sem-sessao' });
  const meu = extrairFalha([{ key: { id: 'ID2', remoteJid: OPACO, fromMe: true }, err: { message: 'Key used already or never filled' } }, 'failed to decrypt message']);
  assert.equal(meu?.direcao, 'enviada');
  assert.equal(meu?.autor, undefined);
  assert.equal(extrairFalha([{ err: { message: 'x' } }, 'failed to decrypt message']), undefined);
  assert.equal(extrairFalha(['failed to decrypt message']), undefined);
  assert.equal(extrairFalha([null, 'x']), undefined);
});

test('a causa "outra" leva o texto sem digitos e truncado a 60; as demais nao levam texto', () => {
  const f = extrairFalha([{ key: { id: 'I', remoteJid: TEL }, err: { message: 'erro estranho 4242 ' + 'z'.repeat(200) } }, 'x']);
  assert.equal(f?.causa, 'outra');
  assert.equal(f?.textoDaCausa?.length, 60);
  assert.doesNotMatch(f?.textoDaCausa ?? '', /\d/);
  assert.equal('textoDaCausa' in (extrairFalha([{ key: { id: 'I', remoteJid: TEL }, err: { message: 'Invalid PreKey ID' } }, 'x']) ?? {}), false);
});

function logger() {
  const linhas: unknown[][] = [];
  const base = { error: (...a: unknown[]) => void linhas.push(a), info: () => undefined, child: () => base };
  return { base, linhas };
}

test('o logger embrulhado entrega o registro estreito ao gancho detalhado e continua contando e logando', () => {
  const { base, linhas } = logger();
  let contou = 0;
  const recebidas: FalhaCapturada[] = [];
  const log = observarLogger(base, { aoFalhaDeDecifra: () => (contou += 1), aoFalhaDeDecifraDetalhada: (f) => recebidas.push(f) }) as typeof base;
  log.error({ key: { id: 'ID1', remoteJid: OPACO, fromMe: true }, err: { message: 'Key used already or never filled' } }, 'failed to decrypt message');
  assert.equal(contou, 1);
  assert.equal(recebidas.length, 1);
  assert.equal(linhas.length, 1, 'a linha continua passando para o logger da biblioteca');
  log.error({ key: { id: 'X', remoteJid: OPACO } }, 'outra linha qualquer');
  assert.equal(recebidas.length, 1);
});

test('o gancho detalhado que lanca nunca custa o log nem o contador', () => {
  const { base, linhas } = logger();
  let contou = 0;
  const log = observarLogger(base, {
    aoFalhaDeDecifra: () => (contou += 1),
    aoFalhaDeDecifraDetalhada: () => {
      throw new Error('boom');
    },
  }) as typeof base;
  assert.doesNotThrow(() => log.error({ key: { id: 'I', remoteJid: OPACO } }, 'failed to decrypt message'));
  assert.equal(linhas.length, 1);
  assert.equal(contou, 1);
});

test('o gancho detalhado so recebe o registro estreito: nada do resto da linha', () => {
  const { base } = logger();
  const recebidas: unknown[] = [];
  const log = observarLogger(base, { aoFalhaDeDecifraDetalhada: (f) => recebidas.push(f) }) as typeof base;
  log.error(
    { key: { id: 'I', remoteJid: GRUPO, participant: OPACO }, err: { message: 'No session found to decrypt message', stack: 'PILHA' }, texto: 'SEGREDO' },
    'failed to decrypt message',
  );
  assert.doesNotMatch(JSON.stringify(recebidas), /PILHA|SEGREDO/);
});

// --- a opcao da conexao

function biblioteca() {
  const configs: Array<{ logger?: unknown }> = [];
  const base = logger().base;
  const lib = {
    default: (config: { logger?: unknown }) => {
      configs.push(config);
      return { ev: { on: (): void => undefined }, requestPairingCode: () => Promise.resolve('12345678'), sendMessage: () => Promise.resolve({ key: { id: 'X' } }) };
    },
    DEFAULT_CONNECTION_CONFIG: { logger: base },
    proto: { Message: { fromObject: (o: unknown) => o } },
    useMultiFileAuthState: () => Promise.resolve({ state: { creds: 'sintetico' }, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401, connectionClosed: 428, connectionLost: 408 },
  };
  return { configs, lib };
}
async function comPasta<T>(f: (pasta: string) => Promise<T>): Promise<T> {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-conexao-decifra-'));
  try {
    return await f(pasta);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}
const base = (pasta: string, lib: unknown) => ({
  pastaDoVinculo: pasta,
  registrar: (): void => undefined,
  aoTerminar: (): void => undefined,
  carregarBiblioteca: () => Promise.resolve(lib),
  aoReceber: (): void => undefined,
});

test('com aoFalhaDeDecifra o socket ganha o logger embrulhado, e a falha chega ao gancho pela conexao', () =>
  comPasta(async (pasta) => {
    const { configs, lib } = biblioteca();
    const recebidas: FalhaCapturada[] = [];
    const conexao = await conectar({ ...base(pasta, lib), aoFalhaDeDecifra: (f) => recebidas.push(f) });
    const log = configs[0]!.logger as { error: (...a: unknown[]) => void };
    assert.notEqual(log, undefined);
    log.error({ key: { id: 'I1', remoteJid: GRUPO }, err: { message: 'No session found to decrypt message' } }, 'failed to decrypt message');
    assert.equal(recebidas.length, 1);
    assert.equal(recebidas[0]?.causa, 'sem-sessao');
    conexao.parar();
  }));

test('SEM aoFalhaDeDecifra o socket continua sem logger proprio', () =>
  comPasta(async (pasta) => {
    const { configs, lib } = biblioteca();
    const conexao = await conectar(base(pasta, lib));
    assert.equal(configs[0]!.logger, undefined);
    conexao.parar();
  }));
