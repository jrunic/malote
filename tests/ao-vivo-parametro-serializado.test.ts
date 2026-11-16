import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { receberEvento, type MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { contagemDosDescartes } from '../src/cli/descartes.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-09-02T12:00:00Z');
const GRUPO = '120363000000000001@g.us';
const stub = (id: string, tipo: string, parametros: string[]): MensagemRecebida => ({
  key: { remoteJid: GRUPO, id, fromMe: false, participant: '111@lid' },
  messageTimestamp: Math.floor(AGORA / 1000),
  messageStubType: tipo,
  messageStubParameters: parametros,
});
const contar = (acervo: Acervo, sql: string): number =>
  (acervo.db.prepare(sql).get() as { n: number }).n;
const SERIALIZADOS = "SELECT COUNT(*) AS n FROM identificadores WHERE substr(valor, 1, 1) = '{'";

test('o parametro serializado grava a Transicao sob o endereco do objeto, resolvido pelo par, e nenhum Identificador serializado nasce', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    aprenderCorrespondencia(acervo, {
      fonte: 'whatsapp',
      alternativo: '109876543210987@lid',
      canonico: '5565911110001@s.whatsapp.net',
    });
    const objeto =
      '{"id":"109876543210987@lid","phoneNumber":"5565911110001@s.whatsapp.net","admin":null}';
    const r = receberEvento(acervo, [stub('PS1', 'GROUP_PARTICIPANT_ADD', [objeto])], {
      origemDaChegada: 'ao-vivo',
      agora: AGORA,
      configuracao: CFG_WHATSAPP,
    });
    assert.equal(r.transicoes, 1);
    assert.equal(contar(acervo, SERIALIZADOS), 0);
    const dono = acervo.db
      .prepare(
        'SELECT i.valor FROM transicoes_de_participacao t JOIN identificadores i ON i.id = t.identificador_id',
      )
      .get() as { valor: string };
    assert.equal(dono.valor, '5565911110001@s.whatsapp.net');
  } finally {
    c.limpar();
  }
});

test('o parametro serializado sem par grava sob o endereco opaco do objeto', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const r = receberEvento(
      acervo,
      [stub('PS3', 'GROUP_PARTICIPANT_LEAVE', ['{"id":"109876543210987@lid","admin":null}'])],
      { origemDaChegada: 'ao-vivo', agora: AGORA, configuracao: CFG_WHATSAPP },
    );
    assert.equal(r.transicoes, 1);
    assert.equal(contar(acervo, SERIALIZADOS), 0);
    const dono = acervo.db
      .prepare(
        'SELECT i.valor FROM transicoes_de_participacao t JOIN identificadores i ON i.id = t.identificador_id',
      )
      .get() as { valor: string };
    assert.equal(dono.valor, '109876543210987@lid');
  } finally {
    c.limpar();
  }
});

test('o parametro ilegivel e contado e nada e gravado; o laco segue para os outros parametros', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const r = receberEvento(
      acervo,
      [
        stub('PS2', 'GROUP_PARTICIPANT_ADD', [
          '{"id":"nao e endereco"}',
          '0',
          '109876543210987@lid',
        ]),
      ],
      { origemDaChegada: 'ao-vivo', agora: AGORA, configuracao: CFG_WHATSAPP },
    );
    assert.equal(r.transicoes, 1, 'o terceiro parametro valido grava');
    assert.equal(r.ignorados['parametro-sem-endereco'], 2, 'o objeto ilegivel e o 0 comum');
    assert.equal(r.ignorados['parametro-serializado-ilegivel'], 1, 'so o objeto ilegivel');
    assert.equal(contar(acervo, SERIALIZADOS), 0);
    const serie = contagemDosDescartes(r);
    assert.equal(serie['parametro-sem-endereco'], 2);
    assert.equal(serie['parametro-serializado-ilegivel'], 1, 'a chave chega ao ouvinte estado');
  } finally {
    c.limpar();
  }
});

test('o autor que nao e endereco nao vira Identificador: a Mensagem grava sem autor e o recusado e contado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const m: MensagemRecebida = {
      key: { remoteJid: GRUPO, id: 'PS4', fromMe: false, participant: 'a b@lid' },
      messageTimestamp: Math.floor(AGORA / 1000),
      message: { conversation: 'oi' },
    };
    const r = receberEvento(acervo, [m], {
      origemDaChegada: 'ao-vivo',
      agora: AGORA,
      configuracao: CFG_WHATSAPP,
    });
    assert.equal(r.gravados, 1, 'a Mensagem nunca se perde');
    assert.equal(r.ignorados['endereco-invalido'], 1);
    assert.equal(
      contar(acervo, "SELECT COUNT(*) AS n FROM identificadores WHERE valor = 'a b@lid'"),
      0,
    );
    assert.equal(contar(acervo, 'SELECT COUNT(*) AS n FROM mensagens WHERE autor_id IS NULL'), 1);
    assert.equal(
      contagemDosDescartes(r)['endereco-invalido'],
      1,
      'a chave chega ao ouvinte estado',
    );
  } finally {
    c.limpar();
  }
});
