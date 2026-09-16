import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenarioDeRede } from './ajuda/rede.js';

test('requisicao SEM Chave nao le nada', async () => {
  const c = await cenarioDeRede();
  try {
    const r = await c.pedir('/conversas');
    assert.equal(r.status, 401);
    assert.equal(r.corpo, '');
  } finally {
    await c.parar();
  }
});

test('Chave invalida e Chave revogada respondem IGUAL a Chave ausente', async () => {
  const c = await cenarioDeRede();
  try {
    const revogada = c.emitir(c.inquilinoA);
    c.revogar(revogada.id);

    const semChave = await c.pedir('/conversas');
    const invalida = await c.pedir('/conversas', 'nao-e-uma-chave');
    const revogadaR = await c.pedir('/conversas', revogada.valor);

    // Distinguir vaza a existencia de Inquilinos alheios: quem esta de fora nao
    // pode separar "nao e seu" de "nao existe". A promessa e sobre o que a
    // resposta DIZ — corpo e codigo —, e nao sobre quanto tempo ela leva.
    assert.equal(invalida.status, semChave.status);
    assert.equal(revogadaR.status, semChave.status);
    assert.equal(invalida.corpo, semChave.corpo);
    assert.equal(revogadaR.corpo, semChave.corpo);
  } finally {
    await c.parar();
  }
});

test('a Chave de um Inquilino nao alcanca o dado de outro', async () => {
  const c = await cenarioDeRede();
  try {
    const chaveA = c.emitir(c.inquilinoA);
    const r = await c.pedir('/conversas', chaveA.valor);
    const corpo = JSON.parse(r.corpo) as { conversas: { id: string }[] };
    assert.ok(corpo.conversas.some((x) => x.id === c.conversaDeA));
    assert.ok(
      !corpo.conversas.some((x) => x.id === c.conversaDeB),
      'nada do Inquilino B aparece',
    );
  } finally {
    await c.parar();
  }
});

test('o Inquilino enviado pelo chamador e IGNORADO', async () => {
  // O criterio 1 nao e "a rota nao documenta o parametro" — e "ela nao o usa".
  // Um servidor que aceitasse o Inquilino do chamador teria a Chave como
  // decoracao.
  const c = await cenarioDeRede();
  try {
    const chaveA = c.emitir(c.inquilinoA);
    const r = await c.pedir(`/conversas?inquilino=${c.inquilinoB}`, chaveA.valor);
    const corpo = JSON.parse(r.corpo) as { conversas: { id: string }[] };
    assert.ok(!corpo.conversas.some((x) => x.id === c.conversaDeB));
    assert.ok(corpo.conversas.some((x) => x.id === c.conversaDeA));
  } finally {
    await c.parar();
  }
});

test('Chave de Operador NAO le conteudo de Acervo nenhum', async () => {
  // Ela administra; nao consulta. Aceita-la aqui daria a uma credencial de
  // administracao o alcance de TODOS os Inquilinos de uma vez.
  const c = await cenarioDeRede();
  try {
    const r = await c.pedir('/conversas', c.chaveDeOperador);
    assert.equal(r.status, 401);
  } finally {
    await c.parar();
  }
});
