import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subirCenaDeIdentidade } from './ajuda/identidade.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (corpo: string): any => JSON.parse(corpo);

/**
 * #1131: `GET /buscar` com sintaxe invalida de FTS5 lancava dentro do manipulador, e excecao ali derruba o
 * PROCESSO para todos os Inquilinos. O servidor de producao caiu duas vezes assim (`near "&"`, `near "."`).
 */
const TERMOS = ['a.b', 'a&b', '"aspas', 'foo*', 'AND', '(', '-x', 'a:b', 'NEAR(a b)', '&', '.'];

test('GET /buscar com termo hostil responde 200 e o servidor segue de pe (#1131)', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    for (const termo of TERMOS) {
      const r = await cena.pedir(`/buscar?texto=${encodeURIComponent(termo)}`, cena.chave.valor);
      assert.equal(r.status, 200, `termo ${JSON.stringify(termo)}: ${r.corpo}`);
      assert.ok(Array.isArray(j(r.corpo).mensagens));
    }
    const depois = await cena.pedir('/relatorio', cena.chave.valor);
    assert.equal(depois.status, 200, 'o servidor continua respondendo depois de todos');
  } finally {
    cena.encerrar();
  }
});

test('o termo literal acha a Mensagem que o contem, por rede (#1131)', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    // a fixture de identidade tem textos "texto N": a palavra literal e achada, e o resto nao
    const achou = j((await cena.pedir('/buscar?texto=texto', cena.chave.valor)).corpo).mensagens;
    assert.equal(achou.length, 9);
    const nada = j((await cena.pedir(`/buscar?texto=${encodeURIComponent('tex*')}`, cena.chave.valor)).corpo).mensagens;
    assert.deepEqual(nada, [], 'o asterisco nao e prefixo: tex* nao acha texto');
  } finally {
    cena.encerrar();
  }
});

test('REDE DE SEGURANCA: excecao em qualquer rota vira 500 de corpo vazio e o processo segue (#1131)', async () => {
  let chamadas = 0;
  const cena = await subirCenaDeIdentidade({
    ganchoDeTeste: {
      antesDeResponder: () => {
        chamadas += 1;
        if (chamadas === 1) throw new Error('falha inesperada de uma rota qualquer, com um segredo no texto');
      },
    },
  });
  try {
    const falha = await cena.pedir('/relatorio', cena.chave.valor);
    assert.equal(falha.status, 500);
    assert.equal(falha.corpo, '', 'o corpo nao diz nada do que aconteceu por dentro');
    const depois = await cena.pedir('/relatorio', cena.chave.valor);
    assert.equal(depois.status, 200, 'o proximo pedido e atendido: o processo nao morreu');
  } finally {
    cena.encerrar();
  }
});

test('REDE DE SEGURANCA: excecao DEPOIS de a rota ja ter escrito o cabecalho nao derruba o processo (#1131)', async () => {
  let chamadas = 0;
  const cena = await subirCenaDeIdentidade({
    ganchoDeTeste: {
      antesDeResponder: (res) => {
        chamadas += 1;
        if (chamadas === 1) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.write('{"parcial":');
          throw new Error('falha depois do cabecalho');
        }
      },
    },
  });
  try {
    await cena.pedir('/relatorio', cena.chave.valor).catch(() => undefined);
    const depois = await cena.pedir('/relatorio', cena.chave.valor);
    assert.equal(depois.status, 200, 'sem a guarda de cabecalho, o writeHead do catch lancaria e mataria o processo');
  } finally {
    cena.encerrar();
  }
});
