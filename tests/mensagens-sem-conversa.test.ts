import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cenarioDeRede } from './ajuda/rede.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { CFG_INSTAGRAM } from './ajuda/configuracao.js';

test('GET /mensagens atravessa mais de uma Conversa e mais de uma Fonte, sem --conversa', async () => {
  const c = await cenarioDeRede();
  try {
    // c.conversaDeA (WhatsApp) e a mensagem do povoamento padrao ja existem.
    // Acrescenta uma segunda Conversa, de Instagram, no MESMO Inquilino A.
    const acervo = abrirAcervo(join(c.raiz, 'acervos'), c.inquilinoA);
    try {
      const conversaInsta = registrarConversa(acervo, {
        fonte: 'instagram',
        idExterno: 'conversa-ig-externo',
        coletiva: false,
        configuracao: CFG_INSTAGRAM,
      });
      registrarMensagem(acervo, {
        conversaId: conversaInsta,
        fonte: 'instagram',
        idExterno: 'msg-ig-1',
        ocorridaEm: Date.parse('2026-06-02T12:00:00Z'),
        agora: Date.now(),
        direcao: 'recebida',
        conteudo: 'do instagram',
      });
    } finally {
      acervo.fechar();
    }

    const chave = c.emitir(c.inquilinoA);
    const r = await c.pedir('/mensagens', chave.valor);
    assert.equal(r.status, 200);
    const corpo = JSON.parse(r.corpo) as { mensagens: { conversaId: string; fonte: string }[] };
    const fontes = new Set(corpo.mensagens.map((m) => m.fonte));
    const conversas = new Set(corpo.mensagens.map((m) => m.conversaId));
    assert.ok(fontes.has('whatsapp') && fontes.has('instagram'), 'mais de uma Fonte na mesma chamada');
    assert.equal(conversas.size, 2, 'mais de uma Conversa na mesma chamada');
  } finally {
    await c.parar();
  }
});

test('GET /mensagens nunca atravessa Inquilino', async () => {
  const c = await cenarioDeRede();
  try {
    const chaveA = c.emitir(c.inquilinoA);
    const r = await c.pedir('/mensagens', chaveA.valor);
    assert.equal(r.status, 200);
    const corpo = JSON.parse(r.corpo) as { mensagens: { conteudo: string | null }[] };
    assert.ok(corpo.mensagens.every((m) => m.conteudo !== 'mensagem de Titular B'));
  } finally {
    await c.parar();
  }
});

test('GET /mensagens?direcao=recebida filtra', async () => {
  const c = await cenarioDeRede();
  try {
    const acervo = abrirAcervo(join(c.raiz, 'acervos'), c.inquilinoA);
    try {
      registrarMensagem(acervo, {
        conversaId: c.conversaDeA,
        fonte: 'whatsapp',
        idExterno: 'msg-enviada',
        ocorridaEm: Date.parse('2026-06-03T12:00:00Z'),
        agora: Date.now(),
        direcao: 'enviada',
      });
    } finally {
      acervo.fechar();
    }
    const chave = c.emitir(c.inquilinoA);
    const r = await c.pedir('/mensagens?direcao=recebida', chave.valor);
    const corpo = JSON.parse(r.corpo) as { mensagens: { conversaId: string }[] };
    // A do povoamento padrao e 'recebida' (ajuda/rede.ts); a nova e 'enviada'
    // e nao deve aparecer.
    assert.equal(corpo.mensagens.length, 1);
  } finally {
    await c.parar();
  }
});

test('GET /mensagens sem ordem explicita vem por recencia, e o cursor pagina sem pular nem repetir', async () => {
  const c = await cenarioDeRede();
  try {
    const acervo = abrirAcervo(join(c.raiz, 'acervos'), c.inquilinoA);
    const INSTANTE = 1789506000000;
    try {
      for (const externo of ['msg-x', 'msg-y', 'msg-z']) {
        registrarMensagem(acervo, {
          conversaId: c.conversaDeA,
          fonte: 'whatsapp',
          idExterno: externo,
          ocorridaEm: INSTANTE,
          agora: Date.now(),
          direcao: 'recebida',
        });
      }
    } finally {
      acervo.fechar();
    }
    const chave = c.emitir(c.inquilinoA);
    const p1 = await c.pedir('/mensagens?limite=2', chave.valor);
    const corpo1 = JSON.parse(p1.corpo) as { mensagens: { id: string }[]; proximo?: string };
    assert.equal(corpo1.mensagens.length, 2);
    assert.ok(corpo1.proximo !== undefined);

    const p2 = await c.pedir(`/mensagens?limite=2&antes=${encodeURIComponent(corpo1.proximo!)}`, chave.valor);
    const corpo2 = JSON.parse(p2.corpo) as { mensagens: { id: string }[] };
    const todosOsIds = [...corpo1.mensagens, ...corpo2.mensagens].map((m) => m.id);
    // 4 no total (1 do povoamento padrao + 3 novas), sem pular nem repetir.
    assert.equal(new Set(todosOsIds).size, 4);
  } finally {
    await c.parar();
  }
});

test('GET /conversas/<id>/mensagens tambem aceita direcao', async () => {
  const c = await cenarioDeRede();
  try {
    const acervo = abrirAcervo(join(c.raiz, 'acervos'), c.inquilinoA);
    try {
      registrarMensagem(acervo, {
        conversaId: c.conversaDeA,
        fonte: 'whatsapp',
        idExterno: 'msg-enviada-na-conversa',
        ocorridaEm: Date.parse('2026-06-04T12:00:00Z'),
        agora: Date.now(),
        direcao: 'enviada',
      });
    } finally {
      acervo.fechar();
    }
    const chave = c.emitir(c.inquilinoA);
    const r = await c.pedir(`/conversas/${c.conversaDeA}/mensagens?direcao=recebida`, chave.valor);
    const corpo = JSON.parse(r.corpo) as { mensagens: { id: string }[] };
    // So a do povoamento padrao (recebida) — a nova (enviada) fica de fora.
    assert.equal(corpo.mensagens.length, 1);
  } finally {
    await c.parar();
  }
});

test('GET /conversas/<id>/mensagens?ordem=recentes SEM antes devolve a mais recente, nao a mais antiga', async () => {
  const c = await cenarioDeRede();
  try {
    const acervo = abrirAcervo(join(c.raiz, 'acervos'), c.inquilinoA);
    try {
      // A do povoamento padrao (ajuda/rede.ts) e de 2026-06-01. Uma bem mais
      // antiga e uma bem mais recente, para o oraculo nao depender de ordem
      // de insercao nem de id.
      registrarMensagem(acervo, {
        conversaId: c.conversaDeA,
        fonte: 'whatsapp',
        idExterno: 'msg-antiga',
        conteudo: 'a mais antiga',
        ocorridaEm: Date.parse('2020-01-01T00:00:00Z'),
        agora: Date.now(),
        direcao: 'recebida',
      });
      registrarMensagem(acervo, {
        conversaId: c.conversaDeA,
        fonte: 'whatsapp',
        idExterno: 'msg-recente',
        conteudo: 'a mais recente',
        ocorridaEm: Date.parse('2026-09-01T00:00:00Z'),
        agora: Date.now(),
        direcao: 'recebida',
      });
    } finally {
      acervo.fechar();
    }
    const chave = c.emitir(c.inquilinoA);
    // Primeira pagina — SEM --antes, exatamente o caso que a paginacao real
    // usa na primeira chamada.
    const r = await c.pedir(`/conversas/${c.conversaDeA}/mensagens?ordem=recentes&limite=1`, chave.valor);
    const corpo = JSON.parse(r.corpo) as { mensagens: { conteudo: string | null }[] };
    assert.equal(corpo.mensagens.length, 1);
    assert.equal(corpo.mensagens[0]?.conteudo, 'a mais recente');
  } finally {
    await c.parar();
  }
});
