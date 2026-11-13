import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenarioDeRede } from './ajuda/rede.js';
import { comCenario, consultorDe } from './ajuda/indice-de-midia.js';

test('a pagina traz o que o rotulo precisa e as Localizacoes do Servico, e nunca o texto da Mensagem', async () => {
  await comCenario(
    { consultarLocalizacoes: consultorDe((ids) => ({ tipo: 'localizacoes', porAnexo: Object.fromEntries(ids.slice(0, 2).map((id) => [id, { idNoRemoto: `drive${id.slice(0, 12)}`, copiaLocalRemovida: true }])) })) },
    async (c, ids) => {
      const r = await c.pedir(`/conversas/${c.conversaDeA}/indice-de-midia`, c.emitir(c.inquilinoA).valor);
      assert.equal(r.status, 200);
      assert.ok(!r.corpo.includes('TEXTO-SECRETO'));
      const p = JSON.parse(r.corpo) as { conversa: { telefone: string | null }; fuso: string; destinoRemoto: boolean; servico: string; itens: Array<{ anexoId: string; localizacao: { idNoRemoto: string } | null }> };
      assert.equal(p.fuso, 'America/Cuiaba');
      assert.equal(p.destinoRemoto, true);
      assert.equal(p.servico, 'ok');
      assert.equal(p.conversa.telefone, '5565900000001');
      assert.equal(p.itens.length, 4);
      assert.deepEqual(p.itens.map((i) => i.anexoId), ids);
      assert.equal(p.itens.filter((i) => i.localizacao !== null).length, 2);
    },
  );
});

test('o Servico fora do ar, ocupado, sem resposta ou ausente nao derruba a pagina: sai com localizacao nula e o motivo em `servico`', async () => {
  const casos: Array<[Parameters<typeof cenarioDeRede>[0], string]> = [
    [{ consultarLocalizacoes: consultorDe(() => ({ tipo: 'servico-fora' })) }, 'fora'],
    [{ consultarLocalizacoes: consultorDe(() => ({ tipo: 'ocupado' })) }, 'ocupado'],
    [{ consultarLocalizacoes: consultorDe(() => ({ tipo: 'inacessivel', motivo: 'x' })) }, 'inacessivel'],
    [{}, 'indisponivel'],
  ];
  for (const [opcoes, esperado] of casos) {
    await comCenario(opcoes, async (c) => {
      const p = JSON.parse((await c.pedir(`/conversas/${c.conversaDeA}/indice-de-midia`, c.emitir(c.inquilinoA).valor)).corpo) as { servico: string; itens: Array<{ localizacao: unknown }> };
      assert.equal(p.servico, esperado);
      assert.ok(p.itens.every((i) => i.localizacao === null));
    });
  }
});

test('o consultor que nao responde estoura no prazo do servidor e a pagina sai com `servico: inacessivel`', async () => {
  let sinal: AbortSignal | undefined;
  await comCenario(
    { prazoMs: 1_500, consultarLocalizacoes: (p) => { sinal = p.sinal; return new Promise(() => undefined); } },
    async (c) => {
      const chave = c.emitir(c.inquilinoA).valor;
      await c.pedir('/relatorio', chave); // aquece o worker
      const inicio = Date.now();
      const p = JSON.parse((await c.pedir(`/conversas/${c.conversaDeA}/indice-de-midia`, chave)).corpo) as { servico: string };
      assert.equal(p.servico, 'inacessivel');
      assert.ok(Date.now() - inicio < 5_000);
      assert.equal(sinal?.aborted, true);
    },
  );
});

test('sem Destino Remoto a pagina sai sem `servico` e o Servico nem e consultado; parametros ruins sao 400; Conversa de outro Inquilino e 404', async () => {
  let consultas = 0;
  await comCenario(
    { consultarLocalizacoes: consultorDe(() => { consultas += 1; return { tipo: 'localizacoes', porAnexo: {} }; }) },
    async (c) => {
      const chave = c.emitir(c.inquilinoA).valor;
      const p = JSON.parse((await c.pedir(`/conversas/${c.conversaDeA}/indice-de-midia`, chave)).corpo) as { destinoRemoto: boolean; servico?: string };
      assert.equal(p.destinoRemoto, false);
      assert.equal(p.servico, undefined);
      assert.equal(consultas, 0);
      for (const q of ['limite=0', 'limite=501', 'limite=abc', 'proximo=lixo', 'de=2026-09-01', 'ate=hoje', 'de=20261340', 'ate=20260230']) {
        assert.equal((await c.pedir(`/conversas/${c.conversaDeA}/indice-de-midia?${q}`, chave)).status, 400, q);
      }
      assert.equal((await c.pedir(`/conversas/${c.conversaDeB}/indice-de-midia`, chave)).status, 404, 'a Conversa de B nao e da Chave de A');
    },
    false,
  );
});

test('o periodo e por dia no fuso do Inquilino e a pagina pagina por cursor sem repetir', async () => {
  await comCenario({ consultarLocalizacoes: consultorDe(() => ({ tipo: 'localizacoes', porAnexo: {} })) }, async (c, ids) => {
    const chave = c.emitir(c.inquilinoA).valor;
    const dia1 = JSON.parse((await c.pedir(`/conversas/${c.conversaDeA}/indice-de-midia?de=20260901&ate=20260901`, chave)).corpo) as { itens: Array<{ anexoId: string }> };
    assert.deepEqual(dia1.itens.map((i) => i.anexoId), ids.slice(0, 3), 'as 22h de 01/09 em Cuiaba ainda sao o dia 01');
    const dia2 = JSON.parse((await c.pedir(`/conversas/${c.conversaDeA}/indice-de-midia?de=20260902`, chave)).corpo) as { itens: Array<{ anexoId: string }> };
    assert.deepEqual(dia2.itens.map((i) => i.anexoId), ids.slice(3), '`de` exclui o dia anterior');
    const lidos: string[] = [];
    let proximo: string | undefined;
    for (let i = 0; i < 6; i += 1) {
      const p = JSON.parse((await c.pedir(`/conversas/${c.conversaDeA}/indice-de-midia?limite=3${proximo ? `&proximo=${proximo}` : ''}`, chave)).corpo) as { itens: Array<{ anexoId: string }>; proximo?: string };
      lidos.push(...p.itens.map((x) => x.anexoId));
      proximo = p.proximo;
      if (proximo === undefined) break;
    }
    assert.deepEqual(lidos, ids);
  });
});

