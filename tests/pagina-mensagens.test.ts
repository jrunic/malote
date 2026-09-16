import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { lerMensagens } from '../src/nucleo/consulta.js';
import type { FiltroDeMensagem } from '../src/nucleo/consulta.js';

const CFG = { id: 'cfg-1', fonte: 'whatsapp' as const };

/** Três mensagens no MESMO instante — o oráculo da revisão do ciclo 21. */
function tresNoMesmoInstante() {
  const c = cenario();
  const { acervo } = c.novoInquilino('Ahsoka');
  const conversaId = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: 'a@s.whatsapp.net',
    coletiva: false,
    configuracao: CFG,
  });
  const INSTANTE = 1789506000000;
  const ids = ['msg-a', 'msg-b', 'msg-c'].map((externo) =>
    registrarMensagem(acervo, {
      conversaId,
      fonte: 'whatsapp',
      idExterno: externo,
      ocorridaEm: INSTANTE,
      agora: INSTANTE + 1000,
      conteudo: `texto ${externo}`,
    }),
  );
  return { c, acervo, conversaId, INSTANTE, ids };
}

test('pagina com instantes iguais: limite 2 não pula nem repete a terceira', () => {
  const { c, acervo, conversaId, INSTANTE } = tresNoMesmoInstante();
  try {
    const p1 = lerMensagens(acervo, {
      conversaId,
      ordem: 'recentes',
      limite: 2,
    } satisfies FiltroDeMensagem);
    assert.equal(p1.length, 2);

    // Página 2: cursor composto da ÚLTIMA mensagem devolvida.
    const ultima = p1[p1.length - 1]!;
    const p2 = lerMensagens(acervo, {
      conversaId,
      ordem: 'recentes',
      limite: 2,
      cursor: { ocorridaEm: ultima.ocorridaEm, id: ultima.id },
    } satisfies FiltroDeMensagem);
    assert.equal(p2.length, 1);
    // As três apareceram exatamente uma vez, sem perda nem repetição.
    const todas = [...p1, ...p2].map((m) => m.id).sort();
    assert.deepEqual(new Set(todas).size, 3);
    // Cronológica com cursor também é exata.
    const cron = lerMensagens(acervo, {
      conversaId,
      ordem: 'cronologica',
      limite: 2,
      cursor: { ocorridaEm: INSTANTE, id: p2[0]!.id },
    } satisfies FiltroDeMensagem);
    assert.equal(cron.length, 2);
  } finally {
    c.limpar();
  }
});
