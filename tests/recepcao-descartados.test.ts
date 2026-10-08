// tests/recepcao-descartados.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { receberEvento, type MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { LID_DA_CONTA, mudancaDeEtiqueta } from './ajuda/etiqueta-ao-vivo.js';

const AGORA = 1_791_300_000_000;
const INSTANTE = Math.floor((AGORA - 60_000) / 1000);
const DIRETA = '5511000000000@s.whatsapp.net';
const GRUPO = '120363000000000001@g.us';

function evento(
  id: string,
  message: Record<string, unknown> | null,
  extra: Partial<MensagemRecebida> = {},
  remoteJid = DIRETA,
): MensagemRecebida {
  return {
    key: { remoteJid, id, fromMe: false },
    messageTimestamp: INSTANTE,
    message,
    ...extra,
  };
}

function receber(eventos: MensagemRecebida[]) {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular de Teste');
    return receberEvento(acervo, eventos, { agora: AGORA, configuracao: CFG_WHATSAPP });
  } finally {
    c.limpar();
  }
}

test('conteudo cifrado e feed de status sao descartados como RUIDO conhecido', () => {
  const r = receber([
    evento('C1', null, { messageStubType: 'CIPHERTEXT' }),
    evento('S1', { conversation: 'oi' }, {}, '5511000000000@status'),
  ]);
  assert.deepEqual(
    r.descartados.map((d) => [d.motivo, d.ruido]),
    [
      ['cifrada', true],
      ['status', true],
    ],
  );
});

test('distribuicao de chave SOZINHA e ruido; evento de protocolo e tipo inventado nao sao', () => {
  const r = receber([
    evento('K1', { senderKeyDistributionMessage: { groupId: 'x' } }),
    evento('P1', { protocolMessage: { type: 'REVOKE' } }),
    evento('T1', { tipoInventadoMessage: { qualquer: 1 } }),
  ]);
  assert.deepEqual(
    r.descartados.map((d) => [d.motivo, d.ruido]),
    [
      ['senderKeyDistributionMessage', true],
      ['protocolMessage:REVOKE', false],
      ['tipoInventadoMessage', false],
    ],
  );
  assert.deepEqual(
    r.descartados.map((d) => d.evento.key.id),
    ['K1', 'P1', 'T1'],
  );
});

test('protocolMessage leva o TIPO do protocolo: um balde so nao mede nada', () => {
  // `protocolMessage` esconde revogacao, material de chave de estado e historico.
  // Se tudo entrasse num rotulo, o contador (e o teto da guarda) nao diria o que se perde.
  const r = receber([
    evento('Q1', { protocolMessage: { type: 'REVOKE' } }),
    evento('Q2', { protocolMessage: { type: 'APP_STATE_SYNC_KEY_SHARE' } }),
    evento('Q3', { protocolMessage: { type: 5 } }),
    evento('Q4', { protocolMessage: {} }),
  ]);
  assert.deepEqual(
    r.descartados.map((d) => d.motivo),
    ['protocolMessage:REVOKE', 'protocolMessage:APP_STATE_SYNC_KEY_SHARE', 'protocolMessage:5', 'protocolMessage'],
  );
});

test('evento RECUSADO entra em descartados, com a causa e sem ser ruido', () => {
  const r = receber([evento('R1', { conversation: 'oi' }, { messageTimestamp: 0 })]);
  assert.equal(r.recusados.length, 1);
  assert.equal(r.descartados.length, 1);
  assert.equal(r.descartados[0]?.motivo, 'recusado');
  assert.equal(r.descartados[0]?.ruido, false);
  assert.ok((r.descartados[0]?.causa ?? '').length > 0, 'recusado sem causa');
});

test('as tres recusas da Etiqueta de Participacao sao descartes de evento', () => {
  const foraDeColetiva = mudancaDeEtiqueta({ id: 'E1', texto: 'x', grupo: DIRETA });
  const semAutor = mudancaDeEtiqueta({ id: 'E2', texto: 'x' });
  delete (semAutor.key as { participant?: string }).participant;
  const daConta = mudancaDeEtiqueta({ id: 'E3', texto: 'x', fromMe: true, autor: LID_DA_CONTA });
  const r = receber([foraDeColetiva, semAutor, daConta]);
  assert.deepEqual(
    r.descartados.map((d) => [d.motivo, d.ruido]),
    [
      ['etiqueta-fora-de-coletiva', false],
      ['etiqueta-sem-autor', false],
      ['etiqueta-da-conta-sem-endereco', false],
    ],
  );
});

test('parametro de stub sem endereco NAO e descarte de evento: o evento e Mensagem', () => {
  const r = receber([
    evento('G1', null, { messageStubType: 'GROUP_PARTICIPANT_ADD', messageStubParameters: ['0'] }, GRUPO),
  ]);
  assert.equal(r.descartados.length, 0);
  assert.equal(r.ignorados['parametro-sem-endereco'], 1);
  assert.equal(r.gravados, 1);
});

test('Mensagem comum nao e descartada', () => {
  const r = receber([evento('M1', { conversation: 'oi' })]);
  assert.equal(r.descartados.length, 0);
  assert.equal(r.gravados, 1);
});

test('descartados concorda com ignorados, tipo a tipo (so os dois rotulos fora de ignorados diferem)', () => {
  const r = receber([
    evento('C1', null, { messageStubType: 'CIPHERTEXT' }),
    evento('P1', { protocolMessage: { type: 'REVOKE' } }),
    evento('P2', { protocolMessage: { type: 'REVOKE' } }),
    evento('R1', { conversation: 'oi' }, { messageTimestamp: 0 }),
    evento('M1', { conversation: 'oi' }),
  ]);
  const porMotivo: Record<string, number> = {};
  // `ignorados` conta o TIPO; `descartados` leva o tipo do protocolo (`protocolMessage:REVOKE`).
  for (const d of r.descartados) {
    const tipo = d.motivo.split(':')[0] ?? d.motivo;
    porMotivo[tipo] = (porMotivo[tipo] ?? 0) + 1;
  }
  for (const [tipo, n] of Object.entries(r.ignorados)) {
    if (tipo === 'parametro-sem-endereco') continue;
    assert.equal(porMotivo[tipo], n, `ignorados e descartados divergem em ${tipo}`);
  }
  assert.equal(porMotivo['recusado'], 1);
});
