import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { anotarRetrato, lerUltimoRetrato, pareceRetrato } from '../src/cli/retrato.js';

function alvo(): string {
  return join(mkdtempSync(join(tmpdir(), 'retrato-')), 'retrato.json');
}

test('sem Retrato recebido, a resposta e AUSENTE — nao "nenhuma marcada"', () => {
  assert.equal(lerUltimoRetrato(join(tmpdir(), 'nao-existe-jamais', 'retrato.json')), null);
});

test('o instante e a contagem voltam inteiros', () => {
  const a = alvo();
  anotarRetrato(a, { em: '2026-09-13T02:00:00.000Z', itens: 2674 });
  assert.deepEqual(lerUltimoRetrato(a), { em: '2026-09-13T02:00:00.000Z', itens: 2674 });
});

test('arquivo corrompido le como ausente e NAO lanca', () => {
  const a = alvo();
  writeFileSync(a, '{ truncad');
  assert.equal(lerUltimoRetrato(a), null);
});

test('ausente sobrevive a serializacao como null, nunca como zero', () => {
  // O criterio 27 contrata que "nenhuma marcada" e "o retrato nao veio" sejam
  // respostas DISTINTAS. Quem as distingue e este campo atravessar o JSON como
  // null: `0` ou string vazia seriam lidos como instante.
  const json = JSON.parse(
    JSON.stringify({ ultimoRetrato: lerUltimoRetrato(join(tmpdir(), 'nada', 'r.json')) }),
  ) as { ultimoRetrato: unknown };
  assert.equal(json.ultimoRetrato, null);
});

/**
 * A regua do CONTADOR, e ela e provisoria de proposito.
 *
 * Medido em 13/09/2026 no log de producao: o unico Retrato trouxe 2.674 itens;
 * TODA atualizacao observada trouxe 1 ou 2 — inclusive duas que trazem a chave
 * de arquivamento e NAO sao Retrato. A chave sozinha nao discrimina.
 */
test('Retrato: traz a chave de estado E vem em lote', () => {
  assert.equal(pareceRetrato(['archived', 'id', 'pinned'], 2674), true);
});

test('atualizacao de UM item com a mesma chave NAO e Retrato', () => {
  // Os dois casos reais medidos no log, e os dois de um item so.
  assert.equal(pareceRetrato(['archived', 'conditional', 'id'], 1), false);
  assert.equal(pareceRetrato(['archived', 'id'], 1), false);
  // E o caso que vem: fixar uma Conversa no aparelho emite um evento de UM
  // item COM a chave de fixacao. Tomar isso por Retrato seria desmarcar todo
  // o resto.
  assert.equal(pareceRetrato(['id', 'pinned'], 1), false);
});

test('lote grande SEM chave de estado tambem nao e Retrato', () => {
  // O outro lado: a sincronizacao de rotina traz muitos itens sem dizer nada
  // sobre marca. Sem esta metade, o piso sozinho classificaria qualquer lote.
  assert.equal(pareceRetrato(['conversationTimestamp', 'id', 'messages'], 5000), false);
});
