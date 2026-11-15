import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarIdentificador, registrarTransicao } from '../src/nucleo/escrita.js';
import { quemEstavaEm } from '../src/nucleo/presenca.js';

// #1518: `participantes` na maior Conversa (3.666 membros) gastava ~4 s porque cada membro disparava duas consultas sobre as
// Transicoes. A presenca sai de UMA leitura das Transicoes da Conversa, agrupada em memoria: o numero de consultas nao cresce com
// o numero de membros.

function grupoComMembros(acervo: Acervo, membros: number): { conversaId: string; ids: string[] } {
  const conversaId = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: `grupo-${membros}@g.us`, coletiva: true });
  const ids: string[] = [];
  for (let i = 0; i < membros; i += 1) {
    const { id } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: `${5565900000000 + i}@s.whatsapp.net` });
    ids.push(id);
    registrarTransicao(acervo, {
      origemDaChegada: 'importacao',
      conversaId,
      identificadorId: id,
      natureza: 'entrou',
      ocorridaEm: 1_700_000_000_000 + i,
      fonte: 'whatsapp',
      idExterno: `T${membros}-${i}`,
      codigoDaFonte: '',
    });
  }
  return { conversaId, ids };
}

/** Quantas vezes se EXECUTA uma consulta sobre as Transicoes durante `fn` (o `preparar` guarda o statement; quem conta e a execucao). */
function execucoesSobreTransicoes(acervo: Acervo, fn: () => void): number {
  let execucoes = 0;
  const original = acervo.preparar.bind(acervo);
  acervo.preparar = ((sql: string) => {
    const st = original(sql);
    if (!/FROM transicoes_de_participacao/.test(sql)) return st;
    const envolver = <K extends 'get' | 'all'>(metodo: K): void => {
      const feito = st[metodo].bind(st) as (...a: unknown[]) => unknown;
      (st as unknown as Record<string, unknown>)[metodo] = (...a: unknown[]): unknown => {
        execucoes += 1;
        return feito(...a);
      };
    };
    envolver('get');
    envolver('all');
    return st;
  }) as typeof acervo.preparar;
  try {
    fn();
  } finally {
    acervo.preparar = original;
  }
  return execucoes;
}

test('a presenca le as Transicoes da Conversa de uma vez: o mesmo numero de consultas para 3 e para 30 membros', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const pequeno = grupoComMembros(acervo, 3);
    const grande = grupoComMembros(acervo, 30);
    const em = 1_700_000_000_000 + 2; // dentro do Alcance dos dois grupos
    const de3 = execucoesSobreTransicoes(acervo, () => {
      const r = quemEstavaEm(acervo, { conversaId: pequeno.conversaId, em });
      assert.equal(r.presentes.length, 3);
    });
    const de30 = execucoesSobreTransicoes(acervo, () => {
      const r = quemEstavaEm(acervo, { conversaId: grande.conversaId, em: 1_700_000_000_000 + 29 });
      assert.equal(r.presentes.length, 30);
    });
    assert.ok(de3 > 0, 'a presenca consulta as Transicoes');
    assert.equal(de30, de3, `3 membros: ${de3} consultas; 30 membros: ${de30}`);
  } finally {
    c.limpar();
  }
});
