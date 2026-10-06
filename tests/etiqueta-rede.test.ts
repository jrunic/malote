import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cenarioDeRede } from './ajuda/rede.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarEtiqueta, registrarIdentificador } from '../src/nucleo/escrita.js';
import { executarConsultaRede } from '../src/cli/index.js';

const T0 = Date.parse('2026-10-05T15:00:00Z');

function semear(raiz: string, inquilino: string, texto: string): { conversa: string } {
  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
  try {
    const conversa = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '120363000000000001@g.us', coletiva: true });
    const m = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565911110001@s.whatsapp.net' }).id;
    registrarEtiqueta(acervo, { conversaId: conversa, identificadorId: m, texto, ocorridaEm: T0, fonte: 'whatsapp', idExterno: 'EV1' });
    return { conversa };
  } finally {
    acervo.fechar();
  }
}

test('GET /etiquetas lista as do Inquilino da chave, e um Inquilino NAO ve a etiqueta de outro', async () => {
  const c = await cenarioDeRede();
  try {
    semear(c.raiz, c.inquilinoA, 'texto-de-A');
    semear(c.raiz, c.inquilinoB, 'texto-de-B');
    const chaveA = c.emitir(c.inquilinoA);
    const r = await c.pedir('/etiquetas', chaveA.valor);
    assert.equal(r.status, 200);
    const textos = (JSON.parse(r.corpo) as { etiquetas: Array<{ texto: string }> }).etiquetas.map((e) => e.texto);
    assert.deepEqual(textos, ['texto-de-A']);
    assert.equal(r.corpo.includes('texto-de-B'), false);
    // O Inquilino enviado pelo chamador e IGNORADO.
    const alvo = await c.pedir(`/etiquetas?inquilino=${c.inquilinoB}`, chaveA.valor);
    assert.equal(alvo.corpo.includes('texto-de-B'), false);
    // Sem chave: a mesma recusa de sempre.
    const sem = await c.pedir('/etiquetas');
    assert.equal(sem.status, 401);
    assert.equal(sem.corpo, '');
  } finally {
    await c.parar();
  }
});

test('GET /etiquetas: filtros, 404 so por Conversa inexistente, 400 por uso errado', async () => {
  const c = await cenarioDeRede();
  try {
    const { conversa } = semear(c.raiz, c.inquilinoA, 'Torre A');
    const chave = c.emitir(c.inquilinoA).valor;
    assert.equal((await c.pedir(`/etiquetas?conversa=${conversa}&busca=torre`, chave)).status, 200);
    const nada = await c.pedir('/etiquetas?busca=nada+disso', chave);
    assert.equal(nada.status, 200, 'filtro que nao casa e lista vazia, nao 404');
    assert.deepEqual((JSON.parse(nada.corpo) as { etiquetas: unknown[] }).etiquetas, []);
    assert.equal((await c.pedir('/etiquetas?conversa=nao-existe', chave)).status, 404);
    for (const ruim of ['limite=0', 'limite=abc', 'limite=1001', 'busca=', 'remetente=', 'historico=1']) {
      assert.equal((await c.pedir(`/etiquetas?${ruim}`, chave)).status, 400, ruim);
    }
    const historico = await c.pedir(
      `/etiquetas?conversa=${conversa}&remetente=5565911110001@s.whatsapp.net&historico=1`,
      chave,
    );
    assert.equal(historico.status, 200);
  } finally {
    await c.parar();
  }
});

test('GET /conversas/<id>/participantes traz etiqueta e etiquetaEm por rede', async () => {
  const c = await cenarioDeRede();
  try {
    const { conversa } = semear(c.raiz, c.inquilinoA, 'Torre A');
    const acervo = abrirAcervo(join(c.raiz, 'acervos'), c.inquilinoA);
    try {
      const m = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565911110001@s.whatsapp.net' }).id;
      // O membro precisa constar na presenca: uma Transicao de entrada o poe no universo.
      const { registrarTransicao } = await import('../src/nucleo/escrita.js');
      registrarTransicao(acervo, {
        conversaId: conversa, identificadorId: m, natureza: 'entrou', ocorridaEm: T0 - 1000,
        fonte: 'whatsapp', idExterno: 'ADD1', codigoDaFonte: 'GROUP_PARTICIPANT_ADD',
      });
    } finally {
      acervo.fechar();
    }
    const chave = c.emitir(c.inquilinoA).valor;
    const r = await c.pedir(`/conversas/${conversa}/participantes`, chave);
    assert.equal(r.status, 200);
    const corpo = JSON.parse(r.corpo) as { presenca: { semInformacao: Array<{ etiqueta: string | null; etiquetaEm: number | null }> } };
    const todos = [...corpo.presenca.semInformacao];
    assert.ok(todos.some((p) => p.etiqueta === 'Torre A' && p.etiquetaEm === T0), JSON.stringify(corpo.presenca));
  } finally {
    await c.parar();
  }
});

test('o cliente de rede: etiquetas por HTTP, flag sem valor sai 2 sem pedir nada, e --inquilino e recusado', async () => {
  const c = await cenarioDeRede();
  try {
    const { conversa } = semear(c.raiz, c.inquilinoA, 'Torre A');
    // Uma segunda etiqueta, de outro membro, que a busca por "torre" tem de EXCLUIR: sem ela, o
    // filtro nao enviado pelo cliente passaria despercebido (a lista inteira ja seria so a Torre A).
    const acervo = abrirAcervo(join(c.raiz, 'acervos'), c.inquilinoA);
    try {
      const outro = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565911110002@s.whatsapp.net' }).id;
      registrarEtiqueta(acervo, { conversaId: conversa, identificadorId: outro, texto: 'Outra', ocorridaEm: T0, fonte: 'whatsapp', idExterno: 'EV2' });
    } finally {
      acervo.fechar();
    }
    const chave = c.emitir(c.inquilinoA).valor;
    const servidor = `http://${c.endereco}:${c.porta}`;
    const saidas: string[] = [];
    const rede = (): { servidor: string; chave: string; escrever: (t: string) => void } => ({
      servidor, chave, escrever: (t) => saidas.push(t),
    });
    assert.equal(await executarConsultaRede(['etiquetas', '--busca', 'torre'], rede()), 0);
    assert.match(saidas.join('\n'), /Torre A/);
    assert.equal(saidas.join('\n').includes('Outra'), false, 'a busca nao chegou ao servidor');

    saidas.length = 0;
    assert.equal(await executarConsultaRede(['etiquetas', '--busca'], rede()), 2);
    assert.equal(await executarConsultaRede(['etiquetas', '--historico'], rede()), 2);
    assert.equal(await executarConsultaRede(['etiquetas', '--inquilino', c.inquilinoA], rede()), 2);
  } finally {
    await c.parar();
  }
});
