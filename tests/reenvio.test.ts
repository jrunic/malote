// tests/reenvio.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarMemoriaDoEnvio } from '../src/adaptadores/whatsapp/memoria-do-envio.js';
import {
  causaSemConteudo,
  criarRespostaAoPedido,
  type EventoDeReenvio,
  type GanchoDoReenvio,
  type ProtoDoReenvio,
} from '../src/adaptadores/whatsapp/reenvio.js';

const CONTATO = '5511900000001@s.whatsapp.net';
const OPACO = '100000000000001@lid';
const T0 = 1_800_000_000_000;

/** `fromObject` falso: marca o que reconstituiu, para o teste ver de onde veio a resposta. */
const PROTO: ProtoDoReenvio = { Message: { fromObject: (o) => ({ reconstituida: o }) } };

function ecoLocal(id: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    key: { remoteJid: CONTATO, fromMe: true, id },
    message: { extendedTextMessage: { text: 'sintetico' } },
    messageTimestamp: String(Math.floor(T0 / 1000) - 120),
    status: 'PENDING',
    ...extra,
  });
}

interface Montagem {
  responder: (chave: { remoteJid?: string; id?: string } | undefined) => Promise<unknown>;
  eventos: EventoDeReenvio[];
  lidos: string[];
  linhas: string[];
  memoria: ReturnType<typeof criarMemoriaDoEnvio>;
  andar: (ms: number) => void;
}

function montar(
  acervo: (ref: string) => string | undefined = () => undefined,
  extra: { proto?: ProtoDoReenvio; aoEvento?: GanchoDoReenvio['aoEvento']; registrar?: (l: string) => void } = {},
): Montagem {
  let t = T0;
  const agora = (): number => t;
  const eventos: EventoDeReenvio[] = [];
  const lidos: string[] = [];
  const linhas: string[] = [];
  const memoria = criarMemoriaDoEnvio({ agora });
  const responder = criarRespostaAoPedido({
    memoria,
    proto: extra.proto ?? PROTO,
    agora,
    registrar: extra.registrar ?? ((l) => linhas.push(l)),
    gancho: {
      lerDoAcervo: (ref) => {
        lidos.push(ref);
        return acervo(ref);
      },
      aoEvento: extra.aoEvento ?? ((e) => eventos.push(e)),
    },
  });
  return { responder, eventos, lidos, linhas, memoria, andar: (ms) => (t += ms) };
}

test('memoria primeiro: devolve o MESMO objeto guardado e o Acervo nao e tocado', async () => {
  const m = montar(() => ecoLocal('ID-1'));
  const mensagem = { conversation: 'montada pela biblioteca' };
  m.memoria.guardar('ID-1', mensagem, CONTATO);
  m.andar(42_000);
  assert.equal(await m.responder({ remoteJid: CONTATO, id: 'ID-1' }), mensagem);
  assert.deepEqual(m.lidos, [], 'nenhuma leitura do Acervo');
  assert.deepEqual(m.eventos, [
    { tipo: 'pedido', resultado: 'achada-na-memoria', idadeSegundos: 42, enderecoDoRecibo: 'igual' },
  ]);
});

test('memoria: o endereco do recibo diferente do do envio so e CONTADO, e a mensagem e devolvida assim mesmo', async () => {
  const m = montar();
  const mensagem = { conversation: 'x' };
  m.memoria.guardar('ID-1', mensagem, CONTATO);
  assert.equal(await m.responder({ remoteJid: OPACO, id: 'ID-1' }), mensagem);
  assert.equal(await m.responder({ id: 'ID-1' }), mensagem);
  assert.deepEqual(
    m.eventos.map((e) => (e.tipo === 'pedido' ? e.enderecoDoRecibo : e.tipo)),
    ['diferente', 'desconhecido'],
  );
});

test('Acervo depois da memoria: o eco local e reconstituido, com idade e endereco do registro', async () => {
  const m = montar((ref) => (ref === 'ID-2' ? ecoLocal('ID-2') : undefined));
  const r = await m.responder({ remoteJid: CONTATO, id: 'ID-2' });
  assert.deepEqual(r, { reconstituida: { extendedTextMessage: { text: 'sintetico' } } });
  assert.deepEqual(m.lidos, ['ID-2']);
  assert.deepEqual(m.eventos, [
    { tipo: 'pedido', resultado: 'achada-no-acervo', idadeSegundos: 120, enderecoDoRecibo: 'igual' },
  ]);
  await m.responder({ remoteJid: OPACO, id: 'ID-2' });
  assert.equal((m.eventos[1] as { enderecoDoRecibo: string }).enderecoDoRecibo, 'diferente');
});

test('Acervo: instante numerico tambem vale, e instante ausente deixa a idade indisponivel', async () => {
  const m = montar((ref) =>
    ref === 'N' ? ecoLocal('N', { messageTimestamp: Math.floor(T0 / 1000) - 5 }) : ecoLocal('S', { messageTimestamp: undefined }),
  );
  await m.responder({ remoteJid: CONTATO, id: 'N' });
  await m.responder({ remoteJid: CONTATO, id: 'S' });
  assert.deepEqual(
    m.eventos.map((e) => (e.tipo === 'pedido' ? e.idadeSegundos : null)),
    [5, undefined],
  );
});

test('a idade nunca e negativa: o instante do eco a frente do relogio do ouvinte da idade 0', async () => {
  const m = montar((ref) => ecoLocal(ref, { messageTimestamp: String(Math.floor(T0 / 1000) + 4) }));
  await m.responder({ remoteJid: CONTATO, id: 'ADIANTADA' });
  assert.equal((m.eventos[0] as { idadeSegundos: number | undefined }).idadeSegundos, 0);
});

test('o sufixo de aparelho no endereco do recibo nao conta como diferenca, na memoria e no Acervo', async () => {
  const m = montar((ref) => ecoLocal(ref));
  m.memoria.guardar('ID-1', { conversation: 'x' }, CONTATO);
  await m.responder({ remoteJid: '5511900000001:2@s.whatsapp.net', id: 'ID-1' });
  await m.responder({ remoteJid: '5511900000001:7@s.whatsapp.net', id: 'ID-2' });
  await m.responder({ remoteJid: '5511900000002:2@s.whatsapp.net', id: 'ID-1' });
  // So o aparelho sai: o mesmo numero em outro dominio (endereco opaco) continua diferente.
  await m.responder({ remoteJid: '5511900000001@lid', id: 'ID-1' });
  assert.deepEqual(
    m.eventos.map((e) => (e.tipo === 'pedido' ? [e.resultado, e.enderecoDoRecibo] : e.tipo)),
    [
      ['achada-na-memoria', 'igual'],
      ['achada-no-acervo', 'igual'],
      ['achada-na-memoria', 'diferente'],
      ['achada-na-memoria', 'diferente'],
    ],
  );
});

test('memoria vencida cai para o Acervo', async () => {
  const m = montar((ref) => ecoLocal(ref));
  m.memoria.guardar('ID-1', { conversation: 'x' }, CONTATO);
  m.andar(3_600_001);
  const r = await m.responder({ remoteJid: CONTATO, id: 'ID-1' });
  assert.deepEqual(m.lidos, ['ID-1']);
  assert.equal((m.eventos[0] as { resultado: string }).resultado, 'achada-no-acervo');
  assert.notEqual(r, undefined);
});

test('nenhuma fonte tem: indisponivel e nao-achada', async () => {
  const m = montar();
  assert.equal(await m.responder({ remoteJid: CONTATO, id: 'NAO-ENVIADA' }), undefined);
  assert.deepEqual(m.eventos, [
    { tipo: 'pedido', resultado: 'nao-achada', idadeSegundos: undefined, enderecoDoRecibo: 'desconhecido' },
  ]);
});

test('registro de OUTRA FORMA com o mesmo identificador: indisponivel e conta nao-achada, nunca erro', async () => {
  const recebida = JSON.stringify({ key: { remoteJid: CONTATO, fromMe: false, id: 'R' }, message: { conversation: 'x' } });
  const backup = JSON.stringify({ Z_PK: 7, ZTEXT: 'x', ZISFROMME: 1 });
  const m = montar((ref) => (ref === 'R' ? recebida : backup));
  assert.equal(await m.responder({ remoteJid: CONTATO, id: 'R' }), undefined);
  assert.equal(await m.responder({ remoteJid: CONTATO, id: 'B' }), undefined);
  assert.deepEqual(
    m.eventos.map((e) => (e.tipo === 'pedido' ? e.resultado : e.tipo)),
    ['nao-achada', 'nao-achada'],
  );
  assert.deepEqual(m.linhas, []);
});

test('chave sem identificador: nao-achada, sem ler o Acervo', async () => {
  const m = montar(() => ecoLocal('X'));
  assert.equal(await m.responder({ remoteJid: CONTATO }), undefined);
  assert.equal(await m.responder({ remoteJid: CONTATO, id: '' }), undefined);
  assert.equal(await m.responder(undefined), undefined);
  assert.deepEqual(m.lidos, []);
  assert.equal(m.eventos.length, 3);
  assert.ok(m.eventos.every((e) => e.tipo === 'pedido' && e.resultado === 'nao-achada'));
});

test('erro ao ler o Acervo: resolve undefined (NUNCA rejeita), conta erro e registra a causa sem conteudo', async () => {
  const ocupado = Object.assign(new Error('database is locked'), { name: 'SqliteError', code: 'SQLITE_BUSY' });
  const m = montar(() => {
    throw ocupado;
  });
  assert.equal(await m.responder({ remoteJid: CONTATO, id: 'ID-1' }), undefined);
  assert.deepEqual(m.eventos, [
    { tipo: 'pedido', resultado: 'erro', idadeSegundos: undefined, enderecoDoRecibo: 'desconhecido' },
  ]);
  assert.deepEqual(m.linhas, ['[reenvio] falhou ao responder o pedido de reenvio (acervo: SqliteError SQLITE_BUSY)']);
});

test('registro corrompido: erro, e a linha de log nao traz o trecho do registro', async () => {
  const m = montar(() => '{"key":{"fromMe":true},"message":{"conversation":"SEGREDO-DA-CONVERSA"');
  assert.equal(await m.responder({ remoteJid: CONTATO, id: 'ID-1' }), undefined);
  assert.equal((m.eventos[0] as { resultado: string }).resultado, 'erro');
  assert.equal(m.linhas.length, 1);
  assert.match(m.linhas[0]!, /\(reconstituicao: SyntaxError\)$/);
  assert.doesNotMatch(m.linhas.join('\n'), /SEGREDO|ID-1|whatsapp\.net/);
});

test('fromObject que lanca: erro, sem excecao para a biblioteca', async () => {
  const m = montar(() => ecoLocal('ID-1'), {
    proto: {
      Message: {
        fromObject: () => {
          throw new TypeError('campo invalido');
        },
      },
    },
  });
  assert.equal(await m.responder({ remoteJid: CONTATO, id: 'ID-1' }), undefined);
  assert.equal((m.eventos[0] as { resultado: string }).resultado, 'erro');
});

test('o gancho que lanca e o registro que lanca nunca custam a resposta', async () => {
  const mensagem = { conversation: 'x' };
  const m = montar(
    () => {
      throw new Error('x');
    },
    {
      aoEvento: () => {
        throw new Error('disco cheio');
      },
      registrar: () => {
        throw new Error('log fechado');
      },
    },
  );
  m.memoria.guardar('ID-1', mensagem, CONTATO);
  assert.equal(await m.responder({ remoteJid: CONTATO, id: 'ID-1' }), mensagem);
  assert.equal(await m.responder({ remoteJid: CONTATO, id: 'ID-2' }), undefined);
});

test('a unidade e o identificador: um recibo com dois (a biblioteca chama duas vezes) conta dois pedidos', async () => {
  const m = montar();
  m.memoria.guardar('A', { conversation: 'a' }, CONTATO);
  const chave = { remoteJid: CONTATO };
  const r = await Promise.all(['A', 'B'].map((id) => m.responder({ ...chave, id })));
  assert.deepEqual(r, [{ conversation: 'a' }, undefined]);
  assert.deepEqual(
    m.eventos.map((e) => (e.tipo === 'pedido' ? e.resultado : e.tipo)),
    ['achada-na-memoria', 'nao-achada'],
  );
});

test('causaSemConteudo: classe e codigo, e nunca a mensagem do erro', () => {
  assert.equal(causaSemConteudo(new SyntaxError('Unexpected token "conteudo"')), 'SyntaxError');
  assert.equal(causaSemConteudo(Object.assign(new Error('x'), { code: 'SQLITE_BUSY' })), 'Error SQLITE_BUSY');
  assert.equal(causaSemConteudo('texto'), 'string');
});
