import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerPedidoDeEtiquetas, formatarEtiquetas } from '../src/cli/etiquetas.js';

test('os filtros entram no pedido, e --historico e --json sao bandeiras', () => {
  const r = lerPedidoDeEtiquetas(['etiquetas', '--conversa', 'c1', '--remetente', '5565911110001@s.whatsapp.net', '--historico', '--limite', '20']);
  assert.deepEqual(r, {
    ok: true,
    pedido: { conversa: 'c1', remetente: '5565911110001@s.whatsapp.net', historico: true, limite: 20 },
  });
});

test('flag sem valor e erro de uso, nunca ignorada em silencio (#1136)', () => {
  for (const args of [
    ['etiquetas', '--busca'],
    ['etiquetas', '--busca', '--json'],
    ['etiquetas', '--conversa'],
    ['etiquetas', '--remetente', '--historico'],
    ['etiquetas', '--limite'],
  ]) {
    const r = lerPedidoDeEtiquetas(args);
    assert.equal(r.ok, false, args.join(' '));
    if (!r.ok) assert.match(r.erro, /pede um valor/);
  }
});

test('historico exige conversa e remetente', () => {
  for (const args of [['etiquetas', '--historico'], ['etiquetas', '--historico', '--conversa', 'c1'], ['etiquetas', '--historico', '--remetente', 'x']]) {
    const r = lerPedidoDeEtiquetas(args);
    assert.equal(r.ok, false, args.join(' '));
    if (!r.ok) assert.match(r.erro, /--historico exige/);
  }
});

test('limite invalido e busca vazia sao erro de uso', () => {
  for (const args of [['etiquetas', '--limite', '0'], ['etiquetas', '--limite', 'abc'], ['etiquetas', '--limite', '1001'], ['etiquetas', '--busca', '']]) {
    assert.equal(lerPedidoDeEtiquetas(args).ok, false, args.join(' '));
  }
});

test('a saida em texto: uma linha por etiqueta, a removida marcada, e o historico do mais novo ao mais antigo', () => {
  const linhas = formatarEtiquetas([
    { conversaId: 'c1', identificadorId: 'i1', valor: '5565911110001@s.whatsapp.net', nome: 'Pessoa Exemplo', origemDoNome: 'whatsapp', texto: 'Torre A', em: Date.parse('2026-10-05T15:00:00Z') },
    { conversaId: 'c1', identificadorId: 'i1', valor: '5565911110001@s.whatsapp.net', nome: null, origemDoNome: null, texto: null, em: Date.parse('2026-10-05T14:00:00Z') },
  ]);
  assert.equal(linhas.length, 2);
  assert.match(linhas[0]!, /2026-10-05T15:00:00.000Z/);
  assert.match(linhas[0]!, /Pessoa Exemplo/);
  assert.match(linhas[0]!, /Torre A/);
  assert.match(linhas[1]!, /\(removida\)/);
});
