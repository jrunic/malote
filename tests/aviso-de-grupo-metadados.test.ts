import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import {
  avisoDeCriacao, avisoDeTroca, eventoDeGrupo, GRUPO_DE_TESTE, LID_DA_CONTA, LID_DE_OUTRO_MEMBRO,
} from './ajuda/metadados-de-coletiva-ao-vivo.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { processarAvisoDeGrupo } from '../src/adaptadores/whatsapp/metadados-de-coletiva-ao-vivo.js';
import type { Acervo } from '../src/nucleo/acervo.js';

// #1160 fatia C: o aviso de metadados de grupo e a COBERTURA do evento de grupo. Chega 4 a 6 ms depois dele, sem
// instante, e nao pode sobrescrever o que o evento gravou; e grava sozinho quando o evento foi recusado ou nao veio.

const T_CRIACAO = 1_791_922_202;
const T_ASSUNTO_B = 1_791_922_324;
const AGORA = (T_ASSUNTO_B + 600) * 1000;
const OPCOES = { agora: AGORA, configuracao: CFG_WHATSAPP };

interface Linha {
  assunto: string | null;
  descricao: string | null;
  alterado_por: string | null;
  alterado_em: string | null;
}

function linhas(acervo: Acervo): Linha[] {
  return acervo.db
    .prepare('SELECT assunto, descricao, alterado_por, alterado_em FROM metadados_de_coletiva')
    .all() as Linha[];
}

function operacoes(acervo: Acervo): number {
  return (acervo.db.prepare('SELECT COUNT(*) AS n FROM operacoes').get() as { n: number }).n;
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

test('o aviso de criacao cria a Conversa coletiva com o assunto, a descricao, o autor e o instante do assunto', () => {
  comAcervo((acervo) => {
    const r = processarAvisoDeGrupo(acervo, 'groups.upsert', avisoDeCriacao({ assunto: 'Espiga 1160', descricao: 'Descricao 1', subjectTime: T_CRIACAO }), AGORA);
    assert.deepEqual([r.gravados, r.repetidos], [1, 0]);
    assert.deepEqual(linhas(acervo), [
      { assunto: 'Espiga 1160', descricao: 'Descricao 1', alterado_por: LID_DE_OUTRO_MEMBRO, alterado_em: iso(T_CRIACAO) },
    ]);
  });
});

test('o aviso de troca chegando DEPOIS do evento nao toca nada: o instante do evento fica', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [eventoDeGrupo({ id: 'E1', tipo: 'GROUP_CHANGE_SUBJECT', parametros: ['Espiga 1160 B'], ts: T_ASSUNTO_B, autor: LID_DA_CONTA })], OPCOES);
    const antes = linhas(acervo);
    const r = processarAvisoDeGrupo(acervo, 'groups.update', avisoDeTroca({ assunto: 'Espiga 1160 B', autor: LID_DA_CONTA }), AGORA);
    assert.deepEqual([r.gravados, r.repetidos], [0, 1]);
    assert.deepEqual(linhas(acervo), antes);
    assert.equal(linhas(acervo)[0]?.alterado_em, iso(T_ASSUNTO_B), 'o aviso sobrescreveu o instante do evento com o de chegada');
  });
});

test('COBERTURA: sem o evento, o aviso de troca grava o texto com o instante de chegada e o autor', () => {
  comAcervo((acervo) => {
    processarAvisoDeGrupo(acervo, 'groups.upsert', avisoDeCriacao({ assunto: 'Espiga 1160', subjectTime: T_CRIACAO }), AGORA);
    const r = processarAvisoDeGrupo(acervo, 'groups.update', avisoDeTroca({ assunto: 'Espiga 1160 C', autor: LID_DA_CONTA }), AGORA);
    assert.equal(r.gravados, 1);
    assert.deepEqual(linhas(acervo), [
      { assunto: 'Espiga 1160 C', descricao: null, alterado_por: LID_DA_CONTA, alterado_em: new Date(AGORA).toISOString() },
    ]);
  });
});

test('COBERTURA: evento recusado pela guarda de instante nao grava, e o aviso grava o texto', () => {
  comAcervo((acervo) => {
    const alemDoRelogio = AGORA / 1000 + 3600;
    const r = receberEvento(acervo, [eventoDeGrupo({ id: 'F1', tipo: 'GROUP_CHANGE_SUBJECT', parametros: ['Novo nome'], ts: alemDoRelogio })], OPCOES);
    assert.equal(r.recusados.length, 1);
    assert.deepEqual(linhas(acervo), []);
    processarAvisoDeGrupo(acervo, 'groups.update', avisoDeTroca({ assunto: 'Novo nome' }), AGORA);
    assert.equal(linhas(acervo)[0]?.assunto, 'Novo nome');
  });
});

test('o aviso so com um campo preserva o outro', () => {
  comAcervo((acervo) => {
    processarAvisoDeGrupo(acervo, 'groups.upsert', avisoDeCriacao({ assunto: 'Espiga 1160', descricao: 'Descricao 1', subjectTime: T_CRIACAO }), AGORA);
    processarAvisoDeGrupo(acervo, 'groups.update', avisoDeTroca({ assunto: 'Espiga 1160 B' }), AGORA);
    processarAvisoDeGrupo(acervo, 'groups.update', avisoDeTroca({ descricao: 'Descricao 2' }), AGORA + 1000);
    assert.equal(linhas(acervo)[0]?.assunto, 'Espiga 1160 B');
    assert.equal(linhas(acervo)[0]?.descricao, 'Descricao 2');
  });
});

test('o aviso da REMOCAO ({id, author}, sem a chave desc) NUNCA apaga a descricao', () => {
  comAcervo((acervo) => {
    processarAvisoDeGrupo(acervo, 'groups.upsert', avisoDeCriacao({ assunto: 'Espiga 1160', descricao: 'Descricao 1', subjectTime: T_CRIACAO }), AGORA);
    const antes = linhas(acervo);
    const r = processarAvisoDeGrupo(acervo, 'groups.update', avisoDeTroca({ autor: LID_DA_CONTA }), AGORA + 5000);
    assert.equal(r.semTexto, 1);
    assert.deepEqual(linhas(acervo), antes);
  });
});

test('aviso sem texto ou de endereco que nao e grupo nao abre Operacao nem cria Conversa', () => {
  comAcervo((acervo) => {
    const antes = operacoes(acervo);
    processarAvisoDeGrupo(acervo, 'groups.update', avisoDeTroca({}), AGORA);
    processarAvisoDeGrupo(acervo, 'groups.update', avisoDeTroca({ grupo: '5565900000000@s.whatsapp.net', assunto: 'x' }), AGORA);
    assert.equal(operacoes(acervo), antes);
    assert.equal((acervo.db.prepare('SELECT COUNT(*) AS n FROM conversas').get() as { n: number }).n, 0);
  });
});

test('aviso REPETIDO (o que chega depois de todo evento, com o mesmo texto) NAO abre Operacao nem toca a Conversa', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [eventoDeGrupo({ id: 'E1', tipo: 'GROUP_CHANGE_SUBJECT', parametros: ['Espiga 1160 B'], ts: T_ASSUNTO_B })], OPCOES);
    const antes = { operacoes: operacoes(acervo), bruto: acervo.db.prepare('SELECT bruto FROM conversas').all() };
    const r = processarAvisoDeGrupo(acervo, 'groups.update', avisoDeTroca({ assunto: 'Espiga 1160 B' }), AGORA);
    processarAvisoDeGrupo(acervo, 'groups.update', avisoDeTroca({ assunto: 'Espiga 1160 B' }), AGORA);
    assert.deepEqual([r.gravados, r.repetidos], [0, 1]);
    assert.equal(operacoes(acervo), antes.operacoes, 'o aviso repetido abriu Operacao');
    assert.deepEqual(acervo.db.prepare('SELECT bruto FROM conversas').all(), antes.bruto, 'o aviso repetido reescreveu o bruto da Conversa');
  });
});

test('o aviso que cria a Conversa guarda o registro CRU do grupo no bruto, com o que a projecao descartaria', () => {
  comAcervo((acervo) => {
    const dado = avisoDeCriacao({ assunto: 'Espiga 1160', subjectTime: T_CRIACAO });
    processarAvisoDeGrupo(acervo, 'groups.upsert', dado, AGORA);
    const { bruto } = acervo.db.prepare('SELECT bruto FROM conversas').get() as { bruto: string };
    assert.equal(bruto, JSON.stringify((dado as unknown[])[0]));
    assert.ok(JSON.parse(bruto).participants.length === 2, 'os participantes do grupo ficaram de fora do bruto');
  });
});

test('o aviso que MUDA o texto de uma Conversa que ja existe grava o texto e nao reescreve o bruto dela', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [eventoDeGrupo({ id: 'E1', tipo: 'GROUP_CHANGE_SUBJECT', parametros: ['Espiga 1160 B'], ts: T_ASSUNTO_B })], OPCOES);
    const antes = acervo.db.prepare('SELECT bruto FROM conversas').all();
    const r = processarAvisoDeGrupo(acervo, 'groups.update', avisoDeTroca({ assunto: 'Espiga 1160 C' }), AGORA);
    assert.equal(r.gravados, 1);
    assert.equal(linhas(acervo)[0]?.assunto, 'Espiga 1160 C');
    assert.deepEqual(acervo.db.prepare('SELECT bruto FROM conversas').all(), antes);
  });
});

test('o mesmo aviso reentregue deixa uma linha e o mesmo conteudo', () => {
  comAcervo((acervo) => {
    const dado = avisoDeCriacao({ assunto: 'Espiga 1160', descricao: 'Descricao 1', subjectTime: T_CRIACAO });
    processarAvisoDeGrupo(acervo, 'groups.upsert', dado, AGORA);
    const antes = linhas(acervo);
    const r = processarAvisoDeGrupo(acervo, 'groups.upsert', dado, AGORA + 60_000);
    assert.equal(r.gravados, 0);
    assert.deepEqual(linhas(acervo), antes);
    assert.equal((acervo.db.prepare('SELECT COUNT(*) AS n FROM conversas').get() as { n: number }).n, 1);
  });
});

test('o grupo de teste usado e o mesmo nos dois caminhos', () => {
  assert.match(GRUPO_DE_TESTE, /@g\.us$/);
});
