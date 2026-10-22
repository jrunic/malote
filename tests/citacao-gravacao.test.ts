import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarIdentificador, registrarMensagem } from '../src/nucleo/escrita.js';
import type { Direcao } from '../src/nucleo/tipos.js';

const OCORRIDA = Date.parse('2026-10-14T10:00:00Z');
const AGORA = Date.parse('2026-10-18T10:00:00Z');

interface LinhaDeCitacao {
  citada_id: string | null;
  citada_id_externo: string | null;
  citada_autor_id: string | null;
  citada_direcao: string | null;
}

function conversa(acervo: Acervo, idExterno = '120363000000000001@g.us'): string {
  return registrarConversa(acervo, { fonte: 'whatsapp', idExterno, coletiva: true });
}

function mensagem(
  acervo: Acervo,
  conversaId: string,
  idExterno: string,
  extra: { direcao?: Direcao; autorId?: string; citacao?: { idExterno: string; autorId?: string; direcao?: Direcao }; fonte?: 'whatsapp' | 'instagram' } = {},
): string {
  return registrarMensagem(acervo, {
    conversaId,
    fonte: extra.fonte ?? 'whatsapp',
    idExterno,
    ocorridaEm: OCORRIDA,
    agora: AGORA,
    direcao: extra.direcao ?? 'recebida',
    ...(extra.autorId !== undefined ? { autorId: extra.autorId } : {}),
    ...(extra.citacao !== undefined ? { citacao: extra.citacao } : {}),
  });
}

function citacaoDe(acervo: Acervo, id: string): LinhaDeCitacao {
  return acervo.db
    .prepare('SELECT citada_id, citada_id_externo, citada_autor_id, citada_direcao FROM mensagens WHERE id = ?')
    .get(id) as LinhaDeCitacao;
}

test('Mensagem sem Citacao fica com os quatro campos nulos', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const id = mensagem(acervo, conversa(acervo), 'M1');
    assert.deepEqual(citacaoDe(acervo, id), { citada_id: null, citada_id_externo: null, citada_autor_id: null, citada_direcao: null });
  } finally {
    c.limpar();
  }
});

test('a citada fora do Acervo fica so pelo id externo, com o autor e a direcao que a Fonte deu', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const autor = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511900000001@s.whatsapp.net' }).id;
    const id = mensagem(acervo, conversa(acervo), 'M2', { citacao: { idExterno: 'ORIGINAL', autorId: autor, direcao: 'recebida' } });
    assert.deepEqual(citacaoDe(acervo, id), {
      citada_id: null,
      citada_id_externo: 'ORIGINAL',
      citada_autor_id: autor,
      citada_direcao: 'recebida',
    });
  } finally {
    c.limpar();
  }
});

test('a citada ja no Acervo, na mesma Conversa, e vinculada e o autor e a direcao dela valem sobre os da Fonte', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const cv = conversa(acervo);
    const autorReal = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511900000001@s.whatsapp.net' }).id;
    const outro = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511900000002@s.whatsapp.net' }).id;
    const citada = mensagem(acervo, cv, 'ORIGINAL', { autorId: autorReal, direcao: 'recebida' });
    const id = mensagem(acervo, cv, 'RESPOSTA', { citacao: { idExterno: 'ORIGINAL', autorId: outro, direcao: 'enviada' } });
    assert.deepEqual(citacaoDe(acervo, id), {
      citada_id: citada,
      citada_id_externo: 'ORIGINAL',
      citada_autor_id: autorReal,
      citada_direcao: 'recebida',
    });
  } finally {
    c.limpar();
  }
});

test('a citada enviada pela propria conta fica sem autor e com a direcao enviada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const cv = conversa(acervo);
    const citada = mensagem(acervo, cv, 'MINHA', { direcao: 'enviada' });
    const id = mensagem(acervo, cv, 'RESPOSTA', { citacao: { idExterno: 'MINHA' } });
    assert.deepEqual(citacaoDe(acervo, id), { citada_id: citada, citada_id_externo: 'MINHA', citada_autor_id: null, citada_direcao: 'enviada' });
  } finally {
    c.limpar();
  }
});

test('citada em OUTRA Conversa, ou de outra Fonte, nao e vinculada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const a = conversa(acervo, '120363000000000001@g.us');
    const b = conversa(acervo, '120363000000000002@g.us');
    mensagem(acervo, b, 'ORIGINAL');
    const id = mensagem(acervo, a, 'RESPOSTA', { citacao: { idExterno: 'ORIGINAL', direcao: 'recebida' } });
    assert.equal(citacaoDe(acervo, id).citada_id, null);
    assert.equal(citacaoDe(acervo, id).citada_id_externo, 'ORIGINAL');

    const ig = registrarConversa(acervo, { fonte: 'instagram', idExterno: 'ig-1', coletiva: false, configuracao: { id: 'cfg-ig', fonte: 'instagram' } });
    mensagem(acervo, ig, 'ORIGINAL-IG', { fonte: 'instagram' });
    const id2 = mensagem(acervo, ig, 'RESPOSTA-IG', { fonte: 'instagram', citacao: { idExterno: 'ORIGINAL-IG' } });
    assert.notEqual(citacaoDe(acervo, id2).citada_id, null, 'na mesma Fonte e Conversa vincula');
    const id3 = mensagem(acervo, a, 'RESPOSTA-3', { citacao: { idExterno: 'ORIGINAL-IG' } });
    assert.equal(citacaoDe(acervo, id3).citada_id, null);
  } finally {
    c.limpar();
  }
});

test('a citada que chega DEPOIS completa o vinculo, o autor e a direcao da citante, so na mesma Conversa e uma vez', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const a = conversa(acervo, '120363000000000001@g.us');
    const b = conversa(acervo, '120363000000000002@g.us');
    const autor = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511900000001@s.whatsapp.net' }).id;
    const tentativaDaFonte = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511900000002@s.whatsapp.net' }).id;
    const naMesma = mensagem(acervo, a, 'R1', { citacao: { idExterno: 'ORIGINAL', autorId: tentativaDaFonte, direcao: 'enviada' } });
    const emOutra = mensagem(acervo, b, 'R2', { citacao: { idExterno: 'ORIGINAL', autorId: tentativaDaFonte, direcao: 'enviada' } });

    const citada = mensagem(acervo, a, 'ORIGINAL', { autorId: autor, direcao: 'recebida' });
    assert.deepEqual(citacaoDe(acervo, naMesma), {
      citada_id: citada,
      citada_id_externo: 'ORIGINAL',
      citada_autor_id: autor,
      citada_direcao: 'recebida',
    });
    assert.equal(citacaoDe(acervo, emOutra).citada_id, null, 'a citante de outra Conversa nao e tocada');
    assert.equal(citacaoDe(acervo, emOutra).citada_autor_id, tentativaDaFonte);

    // Repetir o registro da citada (idempotente) nao muda nada.
    assert.equal(mensagem(acervo, a, 'ORIGINAL', { autorId: autor, direcao: 'recebida' }), citada);
    assert.equal(citacaoDe(acervo, naMesma).citada_id, citada);
  } finally {
    c.limpar();
  }
});
