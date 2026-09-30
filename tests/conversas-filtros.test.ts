import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { listarConversas } from '../src/nucleo/consulta.js';

const CFG = { id: 'cfg-1', fonte: 'whatsapp' as const };
const CFG_IG = { id: 'cfg-ig', fonte: 'instagram' as const };

function conversa(
  acervo: ReturnType<ReturnType<typeof cenario>['novoInquilino']>['acervo'],
  opts: {
    idExterno: string;
    coletiva: boolean;
    assunto?: string;
    fonte?: 'whatsapp' | 'instagram';
  },
): string {
  return registrarConversa(acervo, {
    fonte: opts.fonte ?? 'whatsapp',
    idExterno: opts.idExterno,
    coletiva: opts.coletiva,
    ...(opts.coletiva
      ? {}
      : { configuracao: opts.fonte === 'instagram' ? CFG_IG : CFG }),
    ...(opts.coletiva && opts.assunto !== undefined
      ? { metadadosDeColetiva: { assunto: opts.assunto } }
      : {}),
  });
}

test('conversas --busca filtra assunto, literal: 100% não é curinga', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    conversa(acervo, { idExterno: '1@g.us', coletiva: true, assunto: 'Relatório Anual' });
    conversa(acervo, { idExterno: '2@g.us', coletiva: true, assunto: 'Custo 100% variável' });
    conversa(acervo, { idExterno: '3@g.us', coletiva: true, assunto: 'Outro assunto' });
    assert.equal(listarConversas(acervo, { busca: 'relat' }).length, 1);
    // Escape de curinga: o termo do usuário é LITERAL.
    assert.equal(listarConversas(acervo, { busca: '100%' }).length, 1);
    assert.equal(listarConversas(acervo, { busca: '1_0' }).length, 0);
  } finally {
    c.limpar();
  }
});

test('conversas --fonte e --coletiva combinam', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    conversa(acervo, { idExterno: 'a@s.whatsapp.net', coletiva: false });
    conversa(acervo, { idExterno: '1@g.us', coletiva: true });
    conversa(acervo, { idExterno: 'conversa:99', coletiva: false, fonte: 'instagram' });
    assert.equal(listarConversas(acervo, { fonte: 'whatsapp', coletiva: true }).length, 1);
    assert.equal(listarConversas(acervo, { fonte: 'instagram' }).length, 1);
  } finally {
    c.limpar();
  }
});

test('conversas --limite corta e não cria efeito colateral', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    for (const n of ['a', 'b', 'c', 'd', 'e']) {
      conversa(acervo, { idExterno: `${n}@s.whatsapp.net`, coletiva: false });
    }
    assert.equal(listarConversas(acervo, { limite: 2 }).length, 2);
    assert.equal(listarConversas(acervo, {}).length, 5);
  } finally {
    c.limpar();
  }
});

function msg(
  acervo: ReturnType<ReturnType<typeof cenario>['novoInquilino']>['acervo'],
  conversaId: string,
  idExterno: string,
  ocorridaEm: number,
): void {
  registrarMensagem(acervo, {
    conversaId,
    fonte: 'whatsapp',
    idExterno,
    conteudo: 'sintetico',
    ocorridaEm,
    agora: Date.now(),
    direcao: 'recebida',
  });
}

test('conversas --desde filtra por ULTIMA Mensagem, e ordena por recencia (#1092)', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const antiga = conversa(acervo, { idExterno: 'antiga@s.whatsapp.net', coletiva: false });
    const recente = conversa(acervo, { idExterno: 'recente@s.whatsapp.net', coletiva: false });
    const semMensagem = conversa(acervo, { idExterno: 'vazia@s.whatsapp.net', coletiva: false });
    void semMensagem;
    msg(acervo, antiga, 'm-antiga', Date.parse('2026-01-01T00:00:00Z'));
    msg(acervo, recente, 'm-recente', Date.parse('2026-09-01T00:00:00Z'));

    const r = listarConversas(acervo, { desde: Date.parse('2026-06-01T00:00:00Z') });
    assert.deepEqual(r.map((x) => x.id), [recente], 'antiga cai fora, vazia cai fora (sem Mensagem)');
  } finally {
    c.limpar();
  }
});

test('conversas --desde ordena por recencia DESC entre as que passam o filtro', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const a = conversa(acervo, { idExterno: 'a@s.whatsapp.net', coletiva: false });
    const b = conversa(acervo, { idExterno: 'b@s.whatsapp.net', coletiva: false });
    const cc = conversa(acervo, { idExterno: 'c@s.whatsapp.net', coletiva: false });
    // Registradas fora de ordem de recencia, de proposito: a ordenacao tem
    // de vir do INSTANTE da Mensagem, nunca da ordem de criacao da Conversa.
    msg(acervo, a, 'm-a', Date.parse('2026-08-10T00:00:00Z'));
    msg(acervo, b, 'm-b', Date.parse('2026-08-30T00:00:00Z'));
    msg(acervo, cc, 'm-c', Date.parse('2026-08-20T00:00:00Z'));

    const r = listarConversas(acervo, { desde: Date.parse('2026-08-01T00:00:00Z') });
    assert.deepEqual(r.map((x) => x.id), [b, cc, a]);
  } finally {
    c.limpar();
  }
});

test('conversas --desde com varias Mensagens usa a MAIS RECENTE de cada Conversa', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const alvo = conversa(acervo, { idExterno: 'alvo@s.whatsapp.net', coletiva: false });
    msg(acervo, alvo, 'm1', Date.parse('2026-01-01T00:00:00Z'));
    msg(acervo, alvo, 'm2', Date.parse('2026-08-15T00:00:00Z'));

    assert.equal(listarConversas(acervo, { desde: Date.parse('2026-08-01T00:00:00Z') }).length, 1);
    assert.equal(listarConversas(acervo, { desde: Date.parse('2026-08-20T00:00:00Z') }).length, 0);
  } finally {
    c.limpar();
  }
});

test('SEM --desde, a ordem continua por criacao — nao regride o default existente', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const a = conversa(acervo, { idExterno: 'a@s.whatsapp.net', coletiva: false });
    const b = conversa(acervo, { idExterno: 'b@s.whatsapp.net', coletiva: false });
    msg(acervo, b, 'm-b', Date.parse('2026-09-01T00:00:00Z'));
    msg(acervo, a, 'm-a', Date.parse('2026-01-01T00:00:00Z'));

    assert.deepEqual(listarConversas(acervo, {}).map((x) => x.id), [a, b]);
  } finally {
    c.limpar();
  }
});
