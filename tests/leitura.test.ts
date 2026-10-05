import { test } from 'node:test';
import { readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { semearIdentidade } from './ajuda/identidade.js';
import { executarLeitura } from '../src/rede/leitura.js';
import type { PedidoDeLeitura } from '../src/rede/contrato-da-leitura.js';

function instalacao() {
  const c = cenario();
  const { id, acervo } = c.novoInquilino('Titular');
  const s = semearIdentidade(acervo);
  acervo.fechar();
  const pedido = (url: string, extra: Partial<PedidoDeLeitura> = {}): PedidoDeLeitura => ({
    metodo: 'GET',
    url,
    chaveId: 'k1',
    inquilinoId: id,
    dados: c.raiz,
    ...extra,
  });
  return { c, id, s, pedido };
}

test('executarLeitura roda a rota de verdade e devolve status, cabecalhos e corpo (#1132)', () => {
  const { c, pedido } = instalacao();
  try {
    const r = executarLeitura(pedido('/relatorio'));
    assert.equal(r.status, 200);
    assert.equal(r.cabecalhos['content-type'], 'application/json');
    assert.equal(typeof r.corpo, 'string');
    assert.equal(JSON.parse(r.corpo as string).relatorio.mensagens.total, 9);
  } finally {
    c.limpar();
  }
});

test('rota desconhecida e 404 de corpo vazio, como antes (#1132)', () => {
  const { c, pedido } = instalacao();
  try {
    const r = executarLeitura(pedido('/nao-existe'));
    assert.equal(r.status, 404);
    assert.equal(r.corpo, '');
  } finally {
    c.limpar();
  }
});

test('Acervo indisponivel e 503 de corpo vazio, sem lancar (#1115) (#1132)', () => {
  const { c, pedido } = instalacao();
  try {
    const r = executarLeitura(pedido('/relatorio', { inquilinoId: 'inquilino-sem-acervo' }));
    assert.equal(r.status, 503);
    assert.equal(r.corpo, '');
  } finally {
    c.limpar();
  }
});

test('a rota que le o Registro funciona com ele aberto somente-leitura (#1132)', () => {
  const { c, s, pedido } = instalacao();
  try {
    const r = executarLeitura(pedido(`/conversas/${s.grupo}/autores`));
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.corpo as string).autores.length, 3);
    assert.equal(executarLeitura(pedido('/configuracoes')).status, 200);
  } finally {
    c.limpar();
  }
});

test('as instrucoes de teste: dormir bloqueia a thread, lancar e lancar depois do cabecalho lancam (#1132)', () => {
  const { c, pedido } = instalacao();
  try {
    const t0 = Date.now();
    executarLeitura(pedido('/relatorio', { instrucao: { dormirMs: 300 } }));
    assert.ok(Date.now() - t0 >= 290, 'dormiu de verdade, bloqueando');
    assert.throws(() => executarLeitura(pedido('/relatorio', { instrucao: { lancar: 'boom' } })), /boom/);
    assert.throws(
      () => executarLeitura(pedido('/relatorio', { instrucao: { lancarDepoisDoCabecalho: 'tarde' } })),
      /tarde/,
    );
  } finally {
    c.limpar();
  }
});

test('o Acervo e fechado mesmo quando a rota lanca: nenhum descritor vaza (#1132)', () => {
  const { c, pedido } = instalacao();
  const descritores = (): number => readdirSync(process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd').length;
  try {
    const antes = descritores();
    for (let i = 0; i < 50; i += 1) {
      assert.throws(() => executarLeitura(pedido('/relatorio', { instrucao: { lancar: 'x' } })));
      assert.equal(executarLeitura(pedido('/relatorio')).status, 200);
    }
    // Medido: sem o `finally`, 300 leituras deixavam ~600 descritores abertos (2 por Acervo). Com ele, o numero nao anda.
    assert.ok(descritores() - antes <= 5, `vazaram ${descritores() - antes} descritores`);
  } finally {
    c.limpar();
  }
});
