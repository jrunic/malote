import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarAnexo, registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { buscarMensagens, buscarMensagensComCorte } from '../src/nucleo/consulta.js';

const CFG = { id: 'cfg-1', fonte: 'whatsapp' as const };
const dia = (n: number): number => Date.parse(`2026-03-${String(n).padStart(2, '0')}T12:00:00Z`);

/** `n` Mensagens com a palavra `relatorio`, uma por dia (dia 1 a n), na mesma Conversa. */
function fixture(n: number) {
  const c = cenario();
  const { acervo } = c.novoInquilino('Ahsoka');
  const conversa = registrarConversa(acervo, {
    fonte: 'whatsapp', idExterno: 'a@s.whatsapp.net', coletiva: false, configuracao: CFG,
  });
  const ids: string[] = [];
  for (let i = 1; i <= n; i += 1) {
    ids.push(
      registrarMensagem(acervo, {
        direcao: 'recebida', conversaId: conversa, fonte: 'whatsapp', idExterno: `m${i}`,
        ocorridaEm: dia(i), agora: dia(i) + 1000, conteudo: `relatorio ${i}`,
      }),
    );
  }
  return { c, acervo, conversa, ids };
}

/** Uma Mensagem sem o termo no texto, com o termo na TRANSCRICAO do audio. */
function comTranscricao(acervo: ReturnType<typeof fixture>['acervo'], conversa: string, idExterno: string, quando: number): string {
  const m = registrarMensagem(acervo, {
    direcao: 'recebida', conversaId: conversa, fonte: 'whatsapp', idExterno,
    ocorridaEm: quando, agora: quando + 1000, conteudo: 'audio sem o termo',
  });
  const anexo = registrarAnexo(acervo, { mensagemId: m, tipo: 'audio', presenca: 'presente', caminho: `/x/${idExterno}.opus` });
  acervo
    .preparar(`INSERT INTO transcricoes (anexo_id, estado, texto) VALUES (?, 'concluida', 'mandei o relatorio por audio')`)
    .run(anexo);
  return m;
}

test('o padrao e MAIS RECENTES primeiro', () => {
  const { c, acervo, ids } = fixture(5);
  try {
    const r = buscarMensagensComCorte(acervo, { texto: 'relatorio' });
    assert.deepEqual(r.mensagens.map((m) => m.id), [...ids].reverse());
  } finally {
    c.limpar();
  }
});

test('--ordem cronologica devolve a mais antiga primeiro', () => {
  const { c, acervo, ids } = fixture(5);
  try {
    const r = buscarMensagensComCorte(acervo, { texto: 'relatorio', ordem: 'cronologica' });
    assert.deepEqual(r.mensagens.map((m) => m.id), ids);
  } finally {
    c.limpar();
  }
});

test('recentes com limite devolve as N MAIS RECENTES, e nao as N mais antigas invertidas', () => {
  const { c, acervo, ids } = fixture(5);
  try {
    const r = buscarMensagensComCorte(acervo, { texto: 'relatorio', limite: 2 });
    assert.deepEqual(r.mensagens.map((m) => m.id), [ids[4], ids[3]]);
    const antigas = buscarMensagensComCorte(acervo, { texto: 'relatorio', limite: 2, ordem: 'cronologica' });
    assert.deepEqual(antigas.mensagens.map((m) => m.id), [ids[0], ids[1]]);
  } finally {
    c.limpar();
  }
});

test('truncado: verdadeiro so quando ha MAIS resultados que o limite', () => {
  const { c, acervo } = fixture(5);
  try {
    assert.equal(buscarMensagensComCorte(acervo, { texto: 'relatorio', limite: 4 }).truncado, true);
    assert.equal(buscarMensagensComCorte(acervo, { texto: 'relatorio', limite: 5 }).truncado, false, 'exatamente o limite nao e corte');
    assert.equal(buscarMensagensComCorte(acervo, { texto: 'relatorio', limite: 6 }).truncado, false);
    assert.equal(buscarMensagensComCorte(acervo, { texto: 'inexistente' }).truncado, false);
    assert.deepEqual(buscarMensagensComCorte(acervo, { texto: '   ' }), { mensagens: [], truncado: false });
  } finally {
    c.limpar();
  }
});

test('conteudo e transcricao: o corte e da UNIAO, nas duas ordens', () => {
  const { c, acervo, conversa, ids } = fixture(3); // conteudo: dias 1 a 3
  try {
    const t4 = comTranscricao(acervo, conversa, 'a4', dia(4));
    const t5 = comTranscricao(acervo, conversa, 'a5', dia(5));
    const t6 = comTranscricao(acervo, conversa, 'a6', dia(6));
    // recentes, limite 4: as tres transcricoes (dias 6, 5, 4) e a de conteudo mais nova (dia 3)
    const r = buscarMensagensComCorte(acervo, { texto: 'relatorio', limite: 4 });
    assert.deepEqual(r.mensagens.map((m) => m.id), [t6, t5, t4, ids[2]]);
    assert.equal(r.truncado, true, 'seis resultados, limite 4');
    // cronologica, limite 4: as tres de conteudo e a transcricao mais antiga
    const antigas = buscarMensagensComCorte(acervo, { texto: 'relatorio', limite: 4, ordem: 'cronologica' });
    assert.deepEqual(antigas.mensagens.map((m) => m.id), [ids[0], ids[1], ids[2], t4]);
    assert.equal(antigas.truncado, true);
    // limite 6: nada cortado
    assert.equal(buscarMensagensComCorte(acervo, { texto: 'relatorio', limite: 6 }).truncado, false);
  } finally {
    c.limpar();
  }
});

test('a mesma Mensagem que casa no conteudo E na transcricao conta uma vez so', () => {
  const { c, acervo, ids } = fixture(2);
  try {
    const anexo = registrarAnexo(acervo, { mensagemId: ids[0] as string, tipo: 'audio', presenca: 'presente', caminho: '/x/dup.opus' });
    acervo
      .preparar(`INSERT INTO transcricoes (anexo_id, estado, texto) VALUES (?, 'concluida', 'relatorio de novo')`)
      .run(anexo);
    const r = buscarMensagensComCorte(acervo, { texto: 'relatorio', limite: 2 });
    assert.equal(r.mensagens.length, 2);
    assert.equal(r.truncado, false, 'dois resultados distintos, limite 2');
    assert.equal(r.mensagens.find((m) => m.id === ids[0])?.origemDaCorrespondencia, 'conteudo', 'o conteudo vence');
  } finally {
    c.limpar();
  }
});

test('so transcricao: as N mais recentes, e o corte se ve mesmo sem nenhum resultado de conteudo', () => {
  const { c, acervo, conversa } = fixture(0); // nenhuma Mensagem de conteudo casa
  try {
    const t1 = comTranscricao(acervo, conversa, 'a1', dia(1));
    const t2 = comTranscricao(acervo, conversa, 'a2', dia(2));
    const t3 = comTranscricao(acervo, conversa, 'a3', dia(3));
    const t4 = comTranscricao(acervo, conversa, 'a4', dia(4));
    const recentes = buscarMensagensComCorte(acervo, { texto: 'relatorio', limite: 2 });
    assert.deepEqual(recentes.mensagens.map((m) => m.id), [t4, t3], 'as duas MAIS RECENTES, nao as mais antigas');
    assert.equal(recentes.truncado, true, 'quatro resultados, limite 2');
    const antigas = buscarMensagensComCorte(acervo, { texto: 'relatorio', limite: 2, ordem: 'cronologica' });
    assert.deepEqual(antigas.mensagens.map((m) => m.id), [t1, t2]);
    assert.equal(antigas.truncado, true);
    assert.equal(buscarMensagensComCorte(acervo, { texto: 'relatorio', limite: 4 }).truncado, false);
  } finally {
    c.limpar();
  }
});

test('buscarMensagens segue devolvendo a lista, na mesma ordem padrao', () => {
  const { c, acervo, ids } = fixture(3);
  try {
    assert.deepEqual(buscarMensagens(acervo, { texto: 'relatorio' }).map((m) => m.id), [...ids].reverse());
  } finally {
    c.limpar();
  }
});
