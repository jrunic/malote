import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subirCenaDeIdentidade } from './ajuda/identidade.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (corpo: string): any => JSON.parse(corpo);

/**
 * #1131, a varredura que a pergunta "o que teria prevenido isso?" pediu: `limite=abc` virava `LIMIT NaN` e
 * `limite=0` lancava `Cannot read properties of undefined` — as duas derrubavam o servidor antes da rede de
 * seguranca. Entrada invalida e erro de USO: `400`, e nao `500`.
 */
test('limite que nao e inteiro maior que zero e 400 em toda rota que o aceita (#1131)', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const rotas = [
      '/conversas',
      '/mensagens',
      `/conversas/${cena.s.grupo}/mensagens`,
      '/buscar?texto=texto',
    ];
    for (const rota of rotas) {
      const sep = rota.includes('?') ? '&' : '?';
      for (const limite of ['abc', '0', '-1', '1.5', '', '1e9x']) {
        const r = await cena.pedir(`${rota}${sep}limite=${encodeURIComponent(limite)}`, cena.chave.valor);
        assert.equal(r.status, 400, `${rota} limite=${JSON.stringify(limite)} devolveu ${r.status}`);
        assert.match(j(r.corpo).erro, /limite/);
      }
    }
  } finally {
    cena.encerrar();
  }
});

test('limite valido segue funcionando e paginando (#1131)', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const dois = j((await cena.pedir('/mensagens?limite=2&ordem=cronologica', cena.chave.valor)).corpo);
    assert.equal(dois.mensagens.length, 2);
    assert.ok(dois.proximo, 'pagina cheia traz o proximo');
    assert.equal(j((await cena.pedir('/conversas?limite=1', cena.chave.valor)).corpo).conversas.length, 1);
    assert.equal(j((await cena.pedir('/buscar?texto=texto&limite=3', cena.chave.valor)).corpo).mensagens.length, 3);
  } finally {
    cena.encerrar();
  }
});
