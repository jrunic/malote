import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONDICAO_DE_AUTORES, lerMensagens } from '../src/nucleo/consulta.js';
import { identificadoresDoRemetente } from '../src/nucleo/remetente.js';
import { acervoDeIdentidade, BRUNO_LID } from './ajuda/identidade.js';

test('autorIds filtra por Identificador autor, em todas as Conversas ou numa so (#1129)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    assert.equal(lerMensagens(acervo, { autorIds: [s.bruno] }).length, 4);
    assert.equal(lerMensagens(acervo, { autorIds: [s.bruno], conversaId: s.grupo }).length, 1);
    assert.equal(lerMensagens(acervo, { autorIds: [s.bruno, s.dani] }).length, 6);
  } finally {
    limpar();
  }
});

test('autorIds vazio devolve NADA, nunca tudo: remetente desconhecido nao some o filtro (#1129)', () => {
  const { acervo, limpar } = acervoDeIdentidade();
  try {
    assert.equal(lerMensagens(acervo, {}).length, 9, 'sem filtro a fixture produz as nove Mensagens');
    assert.deepEqual(lerMensagens(acervo, { autorIds: [] }), []);
  } finally {
    limpar();
  }
});

test('o valor alternativo, so como correspondencia, acha as Mensagens do canonico (#1129)', () => {
  const { acervo, limpar } = acervoDeIdentidade();
  try {
    const autorIds = identificadoresDoRemetente(acervo, { valor: BRUNO_LID });
    assert.equal(lerMensagens(acervo, { autorIds }).length, 4);
  } finally {
    limpar();
  }
});

test('Pessoa e remetente juntos se intersectam (#1129)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    assert.equal(lerMensagens(acervo, { pessoaId: s.pessoaDeAna, autorIds: [s.ana] }).length, 3);
    assert.equal(lerMensagens(acervo, { pessoaId: s.pessoaDeAna, autorIds: [s.bruno] }).length, 0);
  } finally {
    limpar();
  }
});

test('sem autorIds o conjunto e a ordem sao os de sempre, contra uma consulta INDEPENDENTE (#1129)', () => {
  const { acervo, limpar } = acervoDeIdentidade();
  try {
    // O oraculo e SQL escrito aqui, nao `lerMensagens` contra `lerMensagens`. Byte a byte contra um
    // arquivo de linha de base nao e possivel: os ids da fixture sao UUIDs sorteados a cada rodada.
    const esperado = (
      acervo.preparar('SELECT id FROM mensagens ORDER BY ocorrida_em, id').all() as Array<{ id: string }>
    ).map((l) => l.id);
    assert.equal(esperado.length, 9);
    assert.deepEqual(lerMensagens(acervo, { ordem: 'cronologica' }).map((m) => m.id), esperado);
    assert.deepEqual(lerMensagens(acervo, {}).map((m) => m.id), esperado);
  } finally {
    limpar();
  }
});

test('o filtro por autores parte do indice de autor, nao varre as Mensagens (#1129)', () => {
  const { acervo, limpar } = acervoDeIdentidade();
  try {
    const plano = (
      acervo
        .preparar(`EXPLAIN QUERY PLAN SELECT m.id FROM mensagens m WHERE ${CONDICAO_DE_AUTORES}`)
        .all('[]') as Array<{ detail: string }>
    )
      .map((l) => l.detail)
      .join(' | ');
    assert.match(plano, /idx_mensagens_autor/, plano);
    assert.doesNotMatch(plano, /SCAN m\b/, `a rota global roda sobre 1,6 milhao de Mensagens: ${plano}`);
  } finally {
    limpar();
  }
});
