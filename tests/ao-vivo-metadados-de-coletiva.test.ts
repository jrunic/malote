import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { eventoDeGrupo, GRUPO_DE_TESTE, LID_DA_CONTA, LID_DE_OUTRO_MEMBRO } from './ajuda/metadados-de-coletiva-ao-vivo.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';
import type { Acervo } from '../src/nucleo/acervo.js';

// #1160 fatia C: o evento de grupo grava Metadados de Coletiva NA MESMA Operacao da Mensagem sem texto.
// Instantes da espiga de 13/10/2026 (UTC): criacao 20:10:02, descricao 20:10:11, assunto B 20:12:04.

const T_CRIACAO = 1_791_922_202;
const T_DESCRICAO = 1_791_922_211;
const T_ASSUNTO_B = 1_791_922_324;
const AGORA = (T_ASSUNTO_B + 600) * 1000;
const OPCOES = { origemDaChegada: 'ao-vivo' as const, agora: AGORA, configuracao: CFG_WHATSAPP };

interface Linha {
  assunto: string | null;
  descricao: string | null;
  alterado_por: string | null;
  alterado_em: string | null;
}

function n(acervo: Acervo, tabela: string): number {
  return (acervo.db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number }).n;
}

function linhas(acervo: Acervo): Linha[] {
  return acervo.db
    .prepare('SELECT assunto, descricao, alterado_por, alterado_em FROM metadados_de_coletiva')
    .all() as Linha[];
}

function iso(segundos: number): string {
  return new Date(segundos * 1000).toISOString();
}

function comAcervo(corpo: (acervo: Acervo) => void): void {
  const c = cenario();
  try {
    corpo(c.novoInquilino('Leia Organa').acervo);
  } finally {
    c.limpar();
  }
}

test('a criacao do grupo cria a Conversa coletiva com o assunto, o autor e o instante do evento', () => {
  comAcervo((acervo) => {
    const r = receberEvento(acervo, [eventoDeGrupo({ id: 'C1', tipo: 'GROUP_CREATE', parametros: ['Espiga 1160'], ts: T_CRIACAO })], OPCOES);
    assert.equal(r.metadadosDeColetiva, 1);
    assert.deepEqual(r.recusados, []);
    assert.deepEqual(linhas(acervo), [
      { assunto: 'Espiga 1160', descricao: null, alterado_por: LID_DE_OUTRO_MEMBRO, alterado_em: iso(T_CRIACAO) },
    ]);
    assert.equal(n(acervo, 'conversas'), 1);
  });
});

test('o ramo e ADITIVO: a Mensagem sem texto com o evento original continua sendo gravada', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [eventoDeGrupo({ id: 'C1', tipo: 'GROUP_CREATE', parametros: ['Espiga 1160'], ts: T_CRIACAO })], OPCOES);
    assert.equal(n(acervo, 'mensagens'), 1, 'o evento original deixou de ser guardado como Mensagem');
  });
});

test('troca de assunto, troca de descricao e remocao, em sequencia, deixam o estado final certo', () => {
  comAcervo((acervo) => {
    const eventos = [
      eventoDeGrupo({ id: 'E1', tipo: 'GROUP_CREATE', parametros: ['Espiga 1160'], ts: T_CRIACAO }),
      eventoDeGrupo({ id: 'E2', tipo: 'GROUP_CHANGE_DESCRIPTION', parametros: ['Descricao 1'], ts: T_DESCRICAO }),
      eventoDeGrupo({ id: 'E3', tipo: 'GROUP_CHANGE_SUBJECT', parametros: ['Espiga 1160 B'], ts: T_ASSUNTO_B, autor: LID_DA_CONTA }),
    ];
    const r = receberEvento(acervo, eventos, OPCOES);
    assert.equal(r.metadadosDeColetiva, 3);
    assert.deepEqual(linhas(acervo), [
      { assunto: 'Espiga 1160 B', descricao: 'Descricao 1', alterado_por: LID_DA_CONTA, alterado_em: iso(T_ASSUNTO_B) },
    ]);
    receberEvento(acervo, [eventoDeGrupo({ id: 'E4', tipo: 'GROUP_CHANGE_DESCRIPTION', parametros: null, ts: T_ASSUNTO_B + 10, autor: LID_DA_CONTA })], OPCOES);
    assert.deepEqual(linhas(acervo), [
      { assunto: 'Espiga 1160 B', descricao: null, alterado_por: LID_DA_CONTA, alterado_em: iso(T_ASSUNTO_B + 10) },
    ]);
  });
});

test('o autor e o que o evento declara: fromMe falso com o LID da propria conta grava o LID, nao o descarta', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [eventoDeGrupo({ id: 'A1', tipo: 'GROUP_CHANGE_SUBJECT', parametros: ['X'], ts: T_ASSUNTO_B, autor: LID_DA_CONTA })], OPCOES);
    assert.equal(linhas(acervo)[0]?.alterado_por, LID_DA_CONTA);
  });
});

test('reentregar o mesmo lote nao muda nenhuma contagem nem a linha', () => {
  comAcervo((acervo) => {
    const lote = [
      eventoDeGrupo({ id: 'R1', tipo: 'GROUP_CREATE', parametros: ['Espiga 1160'], ts: T_CRIACAO }),
      eventoDeGrupo({ id: 'R2', tipo: 'GROUP_CHANGE_DESCRIPTION', parametros: ['Descricao 1'], ts: T_DESCRICAO }),
    ];
    receberEvento(acervo, lote, OPCOES);
    const antes = { m: n(acervo, 'mensagens'), c: n(acervo, 'conversas'), l: linhas(acervo) };
    const r = receberEvento(acervo, lote, OPCOES);
    assert.equal(n(acervo, 'mensagens'), antes.m);
    assert.equal(n(acervo, 'conversas'), antes.c);
    assert.deepEqual(linhas(acervo), antes.l);
    assert.equal(r.metadadosDeColetiva, 0, 'a reentrega nao grava de novo');
    assert.equal(r.metadadosRepetidos, 2, 'os dois eventos ja estavam gravados');
  });
});

test('evento mais velho que o gravado, chegando depois, nao desfaz o mais novo', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [eventoDeGrupo({ id: 'O1', tipo: 'GROUP_CHANGE_SUBJECT', parametros: ['Novo'], ts: T_ASSUNTO_B })], OPCOES);
    receberEvento(acervo, [eventoDeGrupo({ id: 'O2', tipo: 'GROUP_CHANGE_SUBJECT', parametros: ['Velho'], ts: T_CRIACAO })], OPCOES);
    assert.equal(linhas(acervo)[0]?.assunto, 'Novo');
  });
});

test('evento de grupo sobre endereco de Conversa direta nao grava metadados e e contado', () => {
  comAcervo((acervo) => {
    const e = eventoDeGrupo({ id: 'D1', tipo: 'GROUP_CHANGE_SUBJECT', parametros: ['X'], ts: T_ASSUNTO_B, grupo: '5565900000000@s.whatsapp.net' });
    const r = receberEvento(acervo, [e], OPCOES);
    assert.equal(r.metadadosDeColetiva, 0);
    assert.equal(r.metadadosIgnorados['fora-de-grupo'], 1);
    assert.equal(n(acervo, 'metadados_de_coletiva'), 0);
  });
});

test('forma vazia ([], [""], campo ausente) e contada e nao interpretada: nada e apagado', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [eventoDeGrupo({ id: 'V0', tipo: 'GROUP_CHANGE_DESCRIPTION', parametros: ['Descricao 1'], ts: T_DESCRICAO })], OPCOES);
    const r = receberEvento(
      acervo,
      [
        eventoDeGrupo({ id: 'V1', tipo: 'GROUP_CHANGE_DESCRIPTION', parametros: [], ts: T_ASSUNTO_B }),
        eventoDeGrupo({ id: 'V2', tipo: 'GROUP_CHANGE_DESCRIPTION', parametros: [''], ts: T_ASSUNTO_B + 1 }),
        eventoDeGrupo({ id: 'V3', tipo: 'GROUP_CHANGE_DESCRIPTION', ts: T_ASSUNTO_B + 2 }),
      ],
      OPCOES,
    );
    assert.equal(r.metadadosIgnorados['forma-vazia'], 3);
    assert.equal(linhas(acervo)[0]?.descricao, 'Descricao 1');
  });
});

test('evento de grupo recusado pela guarda de instante desfaz a Operacao INTEIRA: nem metadados, nem Conversa', () => {
  comAcervo((acervo) => {
    const alemDoRelogio = AGORA / 1000 + 3600;
    const r = receberEvento(acervo, [eventoDeGrupo({ id: 'F1', tipo: 'GROUP_CREATE', parametros: ['Futuro'], ts: alemDoRelogio })], OPCOES);
    assert.equal(r.recusados.length, 1);
    assert.equal(r.metadadosDeColetiva, 0);
    assert.equal(n(acervo, 'metadados_de_coletiva'), 0);
    assert.equal(n(acervo, 'conversas'), 0, 'a Conversa nasceu fora da Operacao do evento');
  });
});

test('Mensagem comum em grupo nao grava metadados', () => {
  comAcervo((acervo) => {
    const r = receberEvento(
      acervo,
      [{ key: { remoteJid: GRUPO_DE_TESTE, id: 'M1', fromMe: false, participant: LID_DE_OUTRO_MEMBRO }, messageTimestamp: T_CRIACAO, message: { conversation: 'oi' } }],
      OPCOES,
    );
    assert.equal(r.metadadosDeColetiva, 0);
    assert.equal(n(acervo, 'metadados_de_coletiva'), 0);
  });
});
