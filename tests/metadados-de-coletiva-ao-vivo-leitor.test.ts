import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerAvisoDeGrupo, lerMudancaDeMetadados } from '../src/adaptadores/whatsapp/metadados-de-coletiva-ao-vivo.js';
import {
  avisoDeCriacao, avisoDeTroca, eventoDeGrupo, GRUPO_DE_TESTE, LID_DA_CONTA, LID_DE_OUTRO_MEMBRO,
} from './ajuda/metadados-de-coletiva-ao-vivo.js';

// #1160 fatia C: a leitura do evento de grupo e do aviso de metadados, nas formas MEDIDAS pela espiga.

test('o evento de troca de assunto, por NOME e por NUMERO, le o texto, o instante e o autor', () => {
  for (const tipo of ['GROUP_CHANGE_SUBJECT', 21]) {
    const r = lerMudancaDeMetadados(eventoDeGrupo({ id: 'E1', tipo, parametros: ['Espiga 1160 B'], ts: 1_791_922_324, autor: LID_DA_CONTA }));
    assert.deepEqual(r, {
      natureza: 'assunto', acao: 'gravar', texto: 'Espiga 1160 B', instante: 1_791_922_324_000,
      grupo: GRUPO_DE_TESTE, autor: LID_DA_CONTA,
    });
  }
});

test('o evento de troca de descricao le o texto novo; o de criacao le o assunto', () => {
  const d = lerMudancaDeMetadados(eventoDeGrupo({ id: 'E2', tipo: 'GROUP_CHANGE_DESCRIPTION', parametros: ['Descricao dois'] }));
  assert.equal(d?.natureza, 'descricao');
  assert.equal(d?.acao, 'gravar');
  assert.equal(d?.texto, 'Descricao dois');
  for (const tipo of ['GROUP_CREATE', 20]) {
    const c = lerMudancaDeMetadados(eventoDeGrupo({ id: 'E3', tipo, parametros: ['Espiga 1160'] }));
    assert.equal(c?.natureza, 'criacao');
    assert.equal(c?.texto, 'Espiga 1160');
  }
});

test('descricao com parametros NULOS e a remocao; as outras formas vazias sao contadas e nao interpretadas', () => {
  const tipo = 'GROUP_CHANGE_DESCRIPTION';
  assert.equal(lerMudancaDeMetadados(eventoDeGrupo({ id: 'R1', tipo, parametros: null }))?.acao, 'remover');
  assert.equal(lerMudancaDeMetadados(eventoDeGrupo({ id: 'R2', tipo, parametros: [] }))?.acao, 'forma-vazia');
  assert.equal(lerMudancaDeMetadados(eventoDeGrupo({ id: 'R3', tipo, parametros: [''] }))?.acao, 'forma-vazia');
  // Parametro AUSENTE (campo omitido) nao foi medido: nao e remocao.
  assert.equal(lerMudancaDeMetadados(eventoDeGrupo({ id: 'R4', tipo }))?.acao, 'forma-vazia');
});

test('assunto vazio ou nulo NUNCA e remocao: so a descricao se remove', () => {
  assert.equal(lerMudancaDeMetadados(eventoDeGrupo({ id: 'S1', tipo: 'GROUP_CHANGE_SUBJECT', parametros: null }))?.acao, 'forma-vazia');
  assert.equal(lerMudancaDeMetadados(eventoDeGrupo({ id: 'S2', tipo: 'GROUP_CHANGE_SUBJECT', parametros: [''] }))?.acao, 'forma-vazia');
});

test('messageTimestamp como TEXTO (forma medida) e lido', () => {
  const r = lerMudancaDeMetadados(eventoDeGrupo({ id: 'T1', tipo: 'GROUP_CHANGE_SUBJECT', parametros: ['X'], ts: '1791922324' }));
  assert.equal(r?.instante, 1_791_922_324_000);
});

test('outros tipos de evento administrativo nao sao metadados', () => {
  assert.equal(lerMudancaDeMetadados(eventoDeGrupo({ id: 'O1', tipo: 'GROUP_PARTICIPANT_ADD', parametros: ['x@lid'] })), null);
  assert.equal(lerMudancaDeMetadados(eventoDeGrupo({ id: 'O2', tipo: 27, parametros: ['x@lid'] })), null);
  assert.equal(lerMudancaDeMetadados({ key: { remoteJid: GRUPO_DE_TESTE, id: 'O3', fromMe: false }, messageTimestamp: 1, message: { conversation: 'oi' } }), null);
});

test('aviso de criacao: assunto, descricao quando vem, instante do assunto e autor', () => {
  const dado = avisoDeCriacao({ assunto: 'Espiga 1160', descricao: 'Descricao um', subjectTime: 1_791_922_202 });
  const r = lerAvisoDeGrupo('groups.upsert', dado);
  assert.deepEqual(r.avisos, [
    {
      grupo: GRUPO_DE_TESTE, assunto: 'Espiga 1160', descricao: 'Descricao um', autor: LID_DE_OUTRO_MEMBRO,
      instante: 1_791_922_202_000, bruto: JSON.stringify((dado as unknown[])[0]),
    },
  ]);
});

test('aviso de troca: so o campo que veio, o autor e NENHUM instante', () => {
  const dado = avisoDeTroca({ assunto: 'Espiga 1160 B' });
  const r = lerAvisoDeGrupo('groups.update', dado);
  assert.deepEqual(r.avisos, [
    { grupo: GRUPO_DE_TESTE, assunto: 'Espiga 1160 B', autor: LID_DE_OUTRO_MEMBRO, bruto: JSON.stringify((dado as unknown[])[0]) },
  ]);
  assert.equal(r.avisos[0] !== undefined && 'instante' in r.avisos[0], false);
});

test('aviso sem texto (e o aviso da REMOCAO) e contado e nao vira gravacao', () => {
  const r = lerAvisoDeGrupo('groups.update', avisoDeTroca({}));
  assert.deepEqual(r.avisos, []);
  assert.equal(r.semTexto, 1);
});

test('aviso de grupo que nao e @g.us e ignorado e contado', () => {
  const r = lerAvisoDeGrupo('groups.update', avisoDeTroca({ grupo: '5565900000000@s.whatsapp.net', assunto: 'x' }));
  assert.deepEqual(r.avisos, []);
  assert.equal(r.foraDeGrupo, 1);
});

test('dado que nao e lista de objetos com id nao derruba: devolve vazio', () => {
  for (const dado of [null, undefined, 'x', 7, [null], [{}], [{ id: 5 }]]) {
    const r = lerAvisoDeGrupo('groups.update', dado);
    assert.deepEqual(r.avisos, []);
  }
});
