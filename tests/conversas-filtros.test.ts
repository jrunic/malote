import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarConversa } from '../src/nucleo/escrita.js';
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
