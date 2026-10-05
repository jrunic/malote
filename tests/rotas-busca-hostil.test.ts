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

test('REDE DE SEGURANCA: excecao em qualquer rota vira 500 de corpo vazio e o processo segue (#1131) (#1132)', async () => {
  let chamadas = 0;
  const cena = await subirCenaDeIdentidade({
    ganchoDeTeste: {
      // desde o ciclo 32 o GET roda no worker: a falha e uma instrucao serializavel, nao uma funcao sobre o `res`
      instrucaoDoTrabalhador: () => {
        chamadas += 1;
        return chamadas === 1 ? { lancar: 'falha inesperada de uma rota qualquer, com um segredo no texto' } : undefined;
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

test('REDE DE SEGURANCA: excecao DEPOIS de a rota ja ter escrito o cabecalho vira 500, nunca resposta pela metade (#1131) (#1132)', async () => {
  let chamadas = 0;
  const cena = await subirCenaDeIdentidade({
    ganchoDeTeste: {
      instrucaoDoTrabalhador: () => {
        chamadas += 1;
        return chamadas === 1 ? { lancarDepoisDoCabecalho: 'falha depois do cabecalho' } : undefined;
      },
    },
  });
  try {
    const falha = await cena.pedir('/relatorio', cena.chave.valor);
    assert.equal(falha.status, 500, 'o cabecalho escrito no worker nao sai: a resposta e a do erro');
    assert.equal(falha.corpo, '');
    const depois = await cena.pedir('/relatorio', cena.chave.valor);
    assert.equal(depois.status, 200);
  } finally {
    cena.encerrar();
  }
});

test('REDE DE SEGURANCA da thread principal: excecao num POST vira 500 e o proximo GET e atendido (#1131) (#1132)', async () => {
  let chamadas = 0;
  const cena = await subirCenaDeIdentidade({
    ganchoDeTeste: {
      antesDeResponder: () => {
        chamadas += 1;
        if (chamadas === 1) throw new Error('falha inesperada num POST');
      },
    },
  });
  try {
    const r = await fetch(`${cena.url}/qualquer`, { method: 'POST', headers: { authorization: `Bearer ${cena.chave.valor}` } });
    assert.equal(r.status, 500);
    assert.equal(await r.text(), '');
    assert.equal((await cena.pedir('/relatorio', cena.chave.valor)).status, 200);
  } finally {
    cena.encerrar();
  }
});
