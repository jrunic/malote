import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { buscarMensagens, termoParaFts5 } from '../src/nucleo/consulta.js';

const CFG = { id: 'cfg-1', fonte: 'whatsapp' as const };

function fixture(conteudos: string[]) {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const conversa = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: 'a@s.whatsapp.net',
    coletiva: false,
    configuracao: CFG,
  });
  conteudos.forEach((conteudo, i) => {
    registrarMensagem(acervo, {
      direcao: 'recebida',
      conversaId: conversa,
      fonte: 'whatsapp',
      idExterno: `m${i}`,
      ocorridaEm: Date.parse('2026-01-10T12:00:00Z') + i * 1000,
      agora: Date.parse('2026-01-11T00:00:00Z'),
      conteudo,
    });
  });
  return { acervo, limpar: c.limpar };
}

/**
 * O termo do usuario e TEXTO, nao uma consulta FTS5 (#1131): o produto promete `--texto <termo>`, e
 * nenhum documento, skill ou teste promete operador. Ele ia cru para `MATCH`, e uma sintaxe invalida
 * lancava excecao que derrubava o servidor inteiro.
 */
const TERMOS_HOSTIS = [
  'a.b',
  'a&b',
  '"aspas',
  'foo*',
  'AND',
  'OR',
  'NOT',
  '(',
  'x)',
  '-x',
  'a:b',
  '^x',
  'NEAR(a b)',
  'a b"c',
  '"',
  '""',
  '&',
  '.',
  'conteudo:x',
  '{a b}',
];

test('nenhum termo hostil lanca: o texto do usuario nunca e sintaxe de FTS5 (#1131)', () => {
  const { acervo, limpar } = fixture(['ver a.b hoje', 'rock and roll', 'a&b juntos']);
  try {
    for (const termo of TERMOS_HOSTIS) {
      assert.doesNotThrow(() => buscarMensagens(acervo, { texto: termo }), `termo: ${JSON.stringify(termo)}`);
    }
  } finally {
    limpar();
  }
});

test('o termo com pontuacao acha a Mensagem que o contem, e a palavra reservada vira palavra (#1131)', () => {
  const { acervo, limpar } = fixture(['ver a.b hoje', 'rock and roll', 'sem nada disso']);
  try {
    assert.deepEqual(buscarMensagens(acervo, { texto: 'a.b' }).map((m) => m.conteudo), ['ver a.b hoje']);
    assert.deepEqual(buscarMensagens(acervo, { texto: 'AND' }).map((m) => m.conteudo), ['rock and roll']);
    // O `*` nao e prefixo: `roc*` nao acha `rock` (antes achava, por acidente); `rock*` e a palavra `rock`.
    assert.deepEqual(buscarMensagens(acervo, { texto: 'roc*' }), []);
    assert.deepEqual(buscarMensagens(acervo, { texto: 'rock*' }).map((m) => m.conteudo), ['rock and roll']);
  } finally {
    limpar();
  }
});

test('varias palavras seguem sendo E, e acento e caixa seguem sendo ignorados, como antes (#1131)', () => {
  const { acervo, limpar } = fixture(['relatorio mensal pronto', 'relatorio anual', 'mensal sem r', 'Orçamento aprovado']);
  try {
    assert.deepEqual(buscarMensagens(acervo, { texto: 'relatorio mensal' }).map((m) => m.conteudo), ['relatorio mensal pronto']);
    assert.deepEqual(buscarMensagens(acervo, { texto: 'MENSAL relatorio' }).map((m) => m.conteudo), ['relatorio mensal pronto']);
    assert.equal(buscarMensagens(acervo, { texto: 'orcamento' }).length, 1);
    assert.equal(buscarMensagens(acervo, { texto: 'ORÇAMENTO' }).length, 1);
  } finally {
    limpar();
  }
});

test('texto so de espacos nao busca nada e nao lanca (#1131)', () => {
  const { acervo, limpar } = fixture(['qualquer coisa']);
  try {
    assert.deepEqual(buscarMensagens(acervo, { texto: '   ' }), []);
    assert.deepEqual(buscarMensagens(acervo, { texto: '' }), []);
  } finally {
    limpar();
  }
});

test('termoParaFts5 cita cada palavra e dobra a aspas; sem palavra, devolve null (#1131)', () => {
  assert.equal(termoParaFts5('relatorio mensal'), '"relatorio" "mensal"');
  assert.equal(termoParaFts5('  a.b  '), '"a.b"');
  assert.equal(termoParaFts5('x"y'), '"x""y"');
  assert.equal(termoParaFts5('AND'), '"AND"');
  assert.equal(termoParaFts5('   '), null);
  assert.equal(termoParaFts5(''), null);
});
