import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { cenarioDeRede } from './ajuda/rede.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarIdentificador, registrarMensagem } from '../src/nucleo/escrita.js';
import { buscarMensagens, lerMensagens } from '../src/nucleo/consulta.js';
import { criarExportador } from '../src/cli/exportar.js';

const AGORA = Date.parse('2026-10-21T13:00:00Z');
const OCORRIDA = Date.parse('2026-10-21T12:00:00Z');

function povoar(acervo: Acervo): { conversaId: string; citante: string; citada: string; autor: string; solta: string } {
  const conversaId = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '120363000000000001@g.us', coletiva: true });
  const autor = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511900000001@s.whatsapp.net' }).id;
  const citada = registrarMensagem(acervo, {
    origemDaChegada: 'importacao',
    conversaId, fonte: 'whatsapp', idExterno: 'ORIG', ocorridaEm: OCORRIDA, agora: AGORA, direcao: 'recebida', autorId: autor, conteudo: 'pergunta sintetica',
  });
  const citante = registrarMensagem(acervo, {
    origemDaChegada: 'importacao',
    conversaId, fonte: 'whatsapp', idExterno: 'RESP', ocorridaEm: OCORRIDA + 1000, agora: AGORA, direcao: 'recebida',
    conteudo: 'resposta sintetica palavraunica', citacao: { idExterno: 'ORIG' },
  });
  const solta = registrarMensagem(acervo, {
    origemDaChegada: 'importacao',
    conversaId, fonte: 'whatsapp', idExterno: 'SOLTA', ocorridaEm: OCORRIDA + 2000, agora: AGORA, direcao: 'recebida', conteudo: 'sem citacao',
  });
  return { conversaId, citante, citada, autor, solta };
}

test('lerMensagens traz a Citacao: objeto na que cita, nulo na que nao cita', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const p = povoar(acervo);
    const lidas = lerMensagens(acervo, { conversaId: p.conversaId });
    const porId = new Map(lidas.map((m) => [m.id, m]));
    assert.deepEqual(porId.get(p.citante)?.citacao, { id: p.citada, idExterno: 'ORIG', autorId: p.autor, direcao: 'recebida' });
    assert.equal(porId.get(p.solta)?.citacao, null);
    assert.equal(porId.get(p.citada)?.citacao, null);
  } finally {
    c.limpar();
  }
});

test('a citada fora do Acervo: id nulo, id externo e o que a Fonte deu', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversaId = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '120363000000000001@g.us', coletiva: true });
    const citante = registrarMensagem(acervo, {
      origemDaChegada: 'importacao',
      conversaId, fonte: 'whatsapp', idExterno: 'RESP', ocorridaEm: OCORRIDA, agora: AGORA, direcao: 'recebida',
      citacao: { idExterno: 'ANTIGA', direcao: 'enviada' },
    });
    const m = lerMensagens(acervo, { conversaId }).find((x) => x.id === citante);
    assert.deepEqual(m?.citacao, { id: null, idExterno: 'ANTIGA', autorId: null, direcao: 'enviada' });
  } finally {
    c.limpar();
  }
});

test('buscar devolve a mesma Citacao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const p = povoar(acervo);
    const achadas = buscarMensagens(acervo, { texto: 'palavraunica' });
    assert.equal(achadas.length, 1);
    assert.deepEqual(achadas[0]?.citacao, { id: p.citada, idExterno: 'ORIG', autorId: p.autor, direcao: 'recebida' });
  } finally {
    c.limpar();
  }
});

test('GET /conversas/<id>/mensagens traz o objeto citacao, e nulo na Mensagem sem citacao', async () => {
  const c = await cenarioDeRede();
  try {
    const acervo = abrirAcervo(join(c.raiz, 'acervos'), c.inquilinoA);
    let conversaId: string;
    let citante: string;
    try {
      const p = povoar(acervo);
      conversaId = p.conversaId;
      citante = p.citante;
    } finally {
      acervo.fechar();
    }
    const chave = c.emitir(c.inquilinoA);
    const r = await c.pedir(`/conversas/${conversaId}/mensagens`, chave.valor);
    assert.equal(r.status, 200);
    const corpo = JSON.parse(r.corpo) as { mensagens: Array<{ id: string; citacao: { idExterno: string; direcao: string | null } | null }> };
    const doCitante = corpo.mensagens.find((m) => m.id === citante);
    assert.equal(doCitante?.citacao?.idExterno, 'ORIG');
    assert.equal(doCitante?.citacao?.direcao, 'recebida');
    assert.ok(corpo.mensagens.filter((m) => m.id !== citante).every((m) => m.citacao === null), 'sem citacao e nulo, sempre presente');
  } finally {
    await c.parar();
  }
});

test('GET /buscar traz a mesma Citacao por rede', async () => {
  const c = await cenarioDeRede();
  try {
    const acervo = abrirAcervo(join(c.raiz, 'acervos'), c.inquilinoA);
    try {
      povoar(acervo);
    } finally {
      acervo.fechar();
    }
    const chave = c.emitir(c.inquilinoA);
    const r = await c.pedir('/buscar?texto=palavraunica', chave.valor);
    assert.equal(r.status, 200);
    const corpo = JSON.parse(r.corpo) as { mensagens: Array<{ citacao: { idExterno: string; direcao: string | null } | null }> };
    assert.equal(corpo.mensagens.length, 1);
    assert.equal(corpo.mensagens[0]?.citacao?.idExterno, 'ORIG');
    assert.equal(corpo.mensagens[0]?.citacao?.direcao, 'recebida');
  } finally {
    await c.parar();
  }
});

test('exportar em json traz a Citacao, e nulo na Mensagem que nao cita', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const p = povoar(acervo);
    const lidas = lerMensagens(acervo, { conversaId: p.conversaId });
    const linhas: string[] = [];
    const e = criarExportador({
      formato: 'json',
      conversaId: p.conversaId,
      filtros: {},
      exportadoEm: '2026-10-21T13:00:00.000Z',
      autores: [],
      escrever: (l) => linhas.push(l),
    });
    e.acrescentar(lidas);
    e.concluir();
    const json = JSON.parse(linhas.join('\n')) as { mensagens: Array<{ id: string; citacao: { id: string | null; idExterno: string } | null }> };
    const porId = new Map(json.mensagens.map((m) => [m.id, m]));
    assert.deepEqual(porId.get(p.citante)?.citacao, { id: p.citada, idExterno: 'ORIG', autorId: p.autor, direcao: 'recebida' });
    assert.equal(porId.get(p.solta)?.citacao, null);
  } finally {
    c.limpar();
  }
});
