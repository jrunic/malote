import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NumeradorDeMidia,
  dataNoFuso,
  diaValido,
  fimDoDiaNoFuso,
  inicioDoDiaNoFuso,
  nomeDaConversaNoRotulo,
  nomeParaRotulo,
  ordemNoRotulo,
  rotuloDeMidia,
} from '../src/nucleo/rotulo-de-midia.js';

test('o nome vira minusculas, sem acento, com sequencias de nao-alfanumericos num unico hifen e sem hifen nas bordas', () => {
  assert.equal(nomeParaRotulo('  Familia  Ferreira — Ação!! '), 'familia-ferreira-acao');
  assert.equal(nomeParaRotulo('***'), '');
  assert.equal(nomeParaRotulo('João & Maria (2024)'), 'joao-maria-2024');
});

test('o nome corta em 60 caracteres e nao deixa hifen na borda do corte', () => {
  const longo = `${'a'.repeat(59)} ${'b'.repeat(30)}`;
  const slug = nomeParaRotulo(longo);
  assert.equal(slug.length, 59, 'o corte caiu no hifen: ele sai');
  assert.equal(slug, 'a'.repeat(59));
  assert.equal(nomeParaRotulo('x'.repeat(80)).length, 60);
});

test('sem nome: os digitos do telefone; sem telefone, sem-nome- e 6 caracteres do id; o endereco opaco nunca aparece', () => {
  const base = { nome: null, assunto: null, telefone: null, conversaId: 'c0ffee12-aaaa-bbbb-cccc-000000000000' };
  assert.equal(nomeDaConversaNoRotulo({ ...base, nome: 'Ana Lima' }), 'ana-lima');
  assert.equal(nomeDaConversaNoRotulo({ ...base, assunto: 'Grupo do Time', nome: 'ignorado' }), 'grupo-do-time');
  assert.equal(nomeDaConversaNoRotulo({ ...base, telefone: '5565999990000' }), '5565999990000');
  assert.equal(nomeDaConversaNoRotulo(base), 'sem-nome-c0ffee');
  assert.equal(nomeDaConversaNoRotulo({ ...base, nome: '😀😀', telefone: '5511900000000' }), '5511900000000', 'nome que nao deixa letra cai no telefone');
  assert.equal(nomeDaConversaNoRotulo({ ...base, telefone: '123@lid' }), 'sem-nome-c0ffee', 'so digitos valem como telefone');
});

test('a data e a do fuso: 23h em Cuiaba ja e o dia seguinte em UTC', () => {
  const instante = Date.parse('2026-09-02T02:30:00Z'); // 22:30 de 01/09 em Cuiaba (UTC-4)
  assert.equal(dataNoFuso(instante, 'America/Cuiaba'), '20260901');
  assert.equal(dataNoFuso(instante, 'UTC'), '20260902');
});

test('o dia comeca e termina no fuso: inicio e fim de 20260901 em Cuiaba', () => {
  assert.equal(new Date(inicioDoDiaNoFuso('20260901', 'America/Cuiaba')).toISOString(), '2026-09-01T04:00:00.000Z');
  assert.equal(new Date(fimDoDiaNoFuso('20260901', 'America/Cuiaba')).toISOString(), '2026-09-02T03:59:59.999Z');
  assert.equal(new Date(inicioDoDiaNoFuso('20260901', 'UTC')).toISOString(), '2026-09-01T00:00:00.000Z');
  assert.throws(() => inicioDoDiaNoFuso('2026-09-01', 'UTC'), /AAAAMMDD/);
});

test('NN e a ordem da midia no dia, com 3 digitos no minimo, e recomeca quando o dia muda no fuso', () => {
  const n = new NumeradorDeMidia('America/Cuiaba');
  const a = n.proximo(Date.parse('2026-09-01T15:00:00Z'));
  const b = n.proximo(Date.parse('2026-09-01T16:00:00Z'));
  const c = n.proximo(Date.parse('2026-09-02T02:00:00Z')); // ainda 01/09 em Cuiaba (22h)
  const d = n.proximo(Date.parse('2026-09-02T09:00:00Z')); // 02/09 em Cuiaba
  assert.deepEqual([a, b, c, d].map((x) => `${x.data}/${x.nn}`), ['20260901/1', '20260901/2', '20260901/3', '20260902/1']);
  assert.equal(rotuloDeMidia(a.data, a.nn, 'ana-lima'), '20260901-001-ana-lima');
  assert.equal(ordemNoRotulo(999), '999');
  assert.equal(ordemNoRotulo(1234), '1234');
});

test('no dia em que o horario de verao comecava as 00:00 a meia-noite nao existe: o dia comeca na primeira hora que existe, e o anterior termina um milissegundo antes', () => {
  // Cuiaba e Sao Paulo tiveram horario de verao ate 2018 (em 04/11/2018 os relogios pularam de 00:00 para 01:00), e Lisboa
  // pula as 01:00. Em todos, o dia `D` comeca no PRIMEIRO instante que e D no fuso, e `D-1` termina logo antes.
  for (const [fuso, dia, anterior] of [
    ['America/Cuiaba', '20181104', '20181103'],
    ['America/Sao_Paulo', '20181104', '20181103'],
    ['America/Cuiaba', '20101017', '20101016'],
    ['Europe/Lisbon', '20260329', '20260328'],
    ['America/Cuiaba', '20260901', '20260831'],
  ] as const) {
    const inicio = inicioDoDiaNoFuso(dia, fuso);
    assert.equal(dataNoFuso(inicio, fuso), dia, `${fuso} ${dia}: o inicio e do proprio dia`);
    assert.equal(dataNoFuso(inicio - 1, fuso), anterior, `${fuso} ${dia}: o milissegundo anterior e do dia anterior`);
    const fim = fimDoDiaNoFuso(dia, fuso);
    assert.equal(dataNoFuso(fim, fuso), dia, `${fuso} ${dia}: o fim e do proprio dia`);
    assert.notEqual(dataNoFuso(fim + 1, fuso), dia, `${fuso} ${dia}: o milissegundo seguinte ja e outro dia`);
  }
});

test('dia que nao existe no calendario e recusado, em vez de normalizado em silencio', () => {
  assert.equal(diaValido('20260901'), true);
  assert.equal(diaValido('20240229'), true, 'ano bissexto');
  for (const ruim of ['20261340', '20260230', '20230229', '20260001', '2026-09-01', '', 'hoje']) assert.equal(diaValido(ruim), false, ruim);
  assert.throws(() => inicioDoDiaNoFuso('20261340', 'UTC'), /Dia invalido/);
});
