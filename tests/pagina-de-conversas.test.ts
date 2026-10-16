import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { listarConversas } from '../src/nucleo/consulta.js';
import {
  CursorDeConversasInvalidoError,
  LIMITE_PADRAO_DE_CONVERSAS,
  paginarConversas,
} from '../src/nucleo/pagina-de-conversas.js';
import { codificarCursorDeConversas, decodificarCursorDeConversas } from '../src/nucleo/cursor-de-conversas.js';
import type { Acervo } from '../src/nucleo/acervo.js';

// #1202: a listagem de Conversas pagina por cursor composto e opaco. Por criacao (padrao) o par e (instante, id); por
// atividade (`desde`) e (instante da ultima Mensagem, id). O instante sozinho nao pagina: varias Conversas nascem no
// MESMO instante (o backup grava em lote; 2.295 instantes compartilhados no Acervo do Titular).

const CFG = { id: 'cfg-1', fonte: 'whatsapp' as const };
const T0 = Date.parse('2026-06-01T12:00:00Z');

function conversa(acervo: Acervo, n: number, criadaEm: string, coletiva = false): string {
  const id = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: coletiva ? `g${n}@g.us` : `${n}@s.whatsapp.net`,
    coletiva,
    ...(coletiva ? {} : { configuracao: CFG }),
  });
  // O instante de criacao e do relogio; o teste o fixa para construir os empates.
  acervo.db.prepare('UPDATE conversas SET criada_em = ? WHERE id = ?').run(criadaEm, id);
  return id;
}

function mensagem(acervo: Acervo, conversaId: string, n: number, minutos: number): void {
  registrarMensagem(acervo, {
    conversaId,
    fonte: 'whatsapp',
    idExterno: `m${n}`,
    ocorridaEm: T0 + minutos * 60_000,
    agora: T0 + 24 * 3_600_000,
    direcao: 'recebida',
  });
}

function comAcervo(corpo: (acervo: Acervo) => void): void {
  const c = cenario();
  try {
    corpo(c.novoInquilino('Leia Organa').acervo);
  } finally {
    c.limpar();
  }
}

/** Percorre todas as paginas e devolve os ids, na ordem, falhando se o cursor repetir. */
function percorrer(acervo: Acervo, filtro: Parameters<typeof paginarConversas>[1], limite: number, marcadas?: ReadonlySet<string>) {
  const ids: string[] = [];
  let antes: string | undefined;
  for (let i = 0; i < 50; i += 1) {
    const p = paginarConversas(acervo, filtro, { limite, ...(antes !== undefined ? { antes } : {}), ...(marcadas !== undefined ? { marcadas } : {}) });
    ids.push(...p.conversas.map((c) => c.id));
    if (p.proximo === undefined) return ids;
    assert.notEqual(p.proximo, antes, 'o cursor nao avancou');
    antes = p.proximo;
  }
  throw new Error('nao terminou em 50 paginas');
}

test('o cursor e opaco, carrega a ordem, e o que nao decodifica ou tem a forma errada e indefinido', () => {
  const c = codificarCursorDeConversas({ ordem: 'criacao', valor: '2026-06-01T12:00:00.000Z', id: 'a' });
  assert.deepEqual(decodificarCursorDeConversas(c), { ordem: 'criacao', valor: '2026-06-01T12:00:00.000Z', id: 'a' });
  const d = codificarCursorDeConversas({ ordem: 'atividade', valor: 123, id: 'b' });
  assert.deepEqual(decodificarCursorDeConversas(d), { ordem: 'atividade', valor: 123, id: 'b' });
  for (const ruim of ['', 'nao-e-token', Buffer.from('[1,2]').toString('base64url'), Buffer.from('["criacao",5,"x"]').toString('base64url'), Buffer.from('["atividade","t","x"]').toString('base64url'), Buffer.from('["outra","t","x"]').toString('base64url')]) {
    assert.equal(decodificarCursorDeConversas(ruim), undefined, ruim);
  }
});

test('por CRIACAO: tres Conversas no mesmo instante, limite 2, virar a pagina: sem pular e sem repetir', () => {
  comAcervo((acervo) => {
    const mesmo = '2026-06-01T10:00:00.000Z';
    const ids = [1, 2, 3].map((n) => conversa(acervo, n, mesmo));
    const depois = conversa(acervo, 4, '2026-06-01T11:00:00.000Z');
    const antes = conversa(acervo, 0, '2026-06-01T09:00:00.000Z');
    const esperado = [antes, ...[...ids].sort(), depois];
    assert.deepEqual(percorrer(acervo, {}, 2), esperado);
    assert.deepEqual(percorrer(acervo, {}, 1), esperado);
    assert.deepEqual(percorrer(acervo, {}, 100), esperado);
  });
});

test('a primeira pagina so tem proximo quando HA mais; limite igual ao total nao tem', () => {
  comAcervo((acervo) => {
    [1, 2, 3].forEach((n) => conversa(acervo, n, `2026-06-01T10:0${n}:00.000Z`));
    assert.equal(paginarConversas(acervo, {}, { limite: 3 }).proximo, undefined);
    const p = paginarConversas(acervo, {}, { limite: 2 });
    assert.equal(p.conversas.length, 2);
    assert.ok(p.proximo !== undefined);
    assert.equal(paginarConversas(acervo, {}, { limite: 2, antes: p.proximo }).conversas.length, 1);
  });
});

test('percorrer todas as paginas devolve a lista que a consulta sem pagina devolve, com e sem filtro', () => {
  comAcervo((acervo) => {
    for (let n = 1; n <= 7; n += 1) conversa(acervo, n, `2026-06-01T10:0${n % 3}:00.000Z`, n % 2 === 0);
    const todas = listarConversas(acervo, {}).map((c) => c.id).sort();
    assert.deepEqual([...percorrer(acervo, {}, 3)].sort(), todas);
    const coletivas = listarConversas(acervo, { coletiva: true }).map((c) => c.id).sort();
    assert.deepEqual([...percorrer(acervo, { coletiva: true }, 2)].sort(), coletivas);
  });
});

test('por ATIVIDADE (desde): mais recente primeiro, empate pelo id, e as paginas fecham a lista', () => {
  comAcervo((acervo) => {
    const a = conversa(acervo, 1, '2026-06-01T10:00:00.000Z');
    const b = conversa(acervo, 2, '2026-06-01T10:01:00.000Z');
    const c2 = conversa(acervo, 3, '2026-06-01T10:02:00.000Z');
    const d = conversa(acervo, 4, '2026-06-01T10:03:00.000Z');
    mensagem(acervo, a, 1, 10);
    mensagem(acervo, b, 2, 30);
    mensagem(acervo, c2, 3, 30); // mesmo instante de b
    mensagem(acervo, d, 4, 20);
    const esperado = [...[b, c2].sort(), d, a];
    const filtro = { desde: T0 };
    assert.deepEqual(percorrer(acervo, filtro, 1), esperado);
    assert.deepEqual(percorrer(acervo, filtro, 2), esperado);
    assert.deepEqual(percorrer(acervo, filtro, 10), esperado);
  });
});

test('o cursor de uma ordem NAO serve a outra, e cursor invalido lanca, nunca vira primeira pagina', () => {
  comAcervo((acervo) => {
    const a = conversa(acervo, 1, '2026-06-01T10:00:00.000Z');
    conversa(acervo, 2, '2026-06-01T10:01:00.000Z');
    mensagem(acervo, a, 1, 10);
    const porCriacao = paginarConversas(acervo, {}, { limite: 1 }).proximo as string;
    assert.throws(() => paginarConversas(acervo, { desde: T0 }, { limite: 1, antes: porCriacao }), CursorDeConversasInvalidoError);
    const porAtividade = codificarCursorDeConversas({ ordem: 'atividade', valor: T0, id: 'x' });
    assert.throws(() => paginarConversas(acervo, {}, { limite: 1, antes: porAtividade }), CursorDeConversasInvalidoError);
    assert.throws(() => paginarConversas(acervo, {}, { limite: 1, antes: 'lixo' }), CursorDeConversasInvalidoError);
  });
});

test('com marcadas (fixada) a pagina vem DEPOIS do filtro: so as marcadas, sem pular e sem repetir', () => {
  comAcervo((acervo) => {
    const ids = [1, 2, 3, 4, 5, 6].map((n) => conversa(acervo, n, `2026-06-01T10:0${n % 2}:00.000Z`));
    const marcadas = new Set([ids[0]!, ids[2]!, ids[3]!, ids[5]!]);
    const esperado = listarConversas(acervo, {}).map((c) => c.id).filter((id) => marcadas.has(id));
    assert.deepEqual(percorrer(acervo, {}, 1, marcadas), esperado);
    assert.deepEqual(percorrer(acervo, {}, 3, marcadas), esperado);
  });
});

test('o limite padrao e 500, o mesmo da paginacao de Mensagens', () => {
  assert.equal(LIMITE_PADRAO_DE_CONVERSAS, 500);
});
