import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { umaColetiva, umMembro } from './ajuda/etiqueta.js';
import { registrarConversa, registrarEtiqueta } from '../src/nucleo/escrita.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { etiquetasDosIdentificadores, etiquetasVigentesDaConversa } from '../src/nucleo/etiqueta-de-participacao.js';

const T0 = Date.parse('2026-10-05T15:00:00Z');

function evento(conversaId: string, identificadorId: string, texto: string, ocorridaEm: number, idExterno: string) {
  return { conversaId, identificadorId, texto, ocorridaEm, fonte: 'whatsapp' as const, idExterno };
}

test('a porta devolve true quando a linha NASCEU e false quando o evento ja existia', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversa = umaColetiva(acervo);
    const membro = umMembro(acervo);
    assert.equal(registrarEtiqueta(acervo, evento(conversa, membro, 'Torre A', T0, 'EV1')), true);
    assert.equal(registrarEtiqueta(acervo, evento(conversa, membro, 'Torre A', T0, 'EV1')), false);
    const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM etiquetas_de_participacao').get() as { n: number };
    assert.equal(n.n, 1, 'repetir o evento tem de deixar UMA linha');
  } finally {
    c.limpar();
  }
});

test('texto vazio e uma etiqueta valida: e a remocao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversa = umaColetiva(acervo);
    const membro = umMembro(acervo);
    assert.equal(registrarEtiqueta(acervo, evento(conversa, membro, '', T0, 'EV1')), true);
    const linha = acervo.db.prepare('SELECT texto FROM etiquetas_de_participacao').get() as { texto: string };
    assert.equal(linha.texto, '');
  } finally {
    c.limpar();
  }
});

test('a porta recusa etiqueta em Conversa DIRETA — o agregado e de Conversa coletiva', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const direta = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: '5565911110009@s.whatsapp.net',
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    const membro = umMembro(acervo);
    assert.throws(
      () => registrarEtiqueta(acervo, evento(direta, membro, 'x', T0, 'EV1')),
      /Conversa coletiva/,
    );
    const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM etiquetas_de_participacao').get() as { n: number };
    assert.equal(n.n, 0);
  } finally {
    c.limpar();
  }
});

test('a porta recusa instante que nao e positivo — o instante e o que a Fonte declarou, nunca derivado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversa = umaColetiva(acervo);
    const membro = umMembro(acervo);
    for (const ruim of [0, -1, Number.NaN]) {
      assert.throws(() => registrarEtiqueta(acervo, evento(conversa, membro, 'x', ruim, `EV${ruim}`)), /instante/i);
    }
  } finally {
    c.limpar();
  }
});


test('a corrente e a do MAIOR instante, mesmo entregue fora de ordem', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversa = umaColetiva(acervo);
    const membro = umMembro(acervo);
    // Entregues na ordem B, C, A: a de MAIOR instante (B) chega PRIMEIRO. Com ela por ultimo,
    // "o ultimo inserido" coincidiria com "o de maior instante" e o mutante rowid sobreviveria.
    registrarEtiqueta(acervo, evento(conversa, membro, 'B', T0 + 5000, 'EV2'));
    registrarEtiqueta(acervo, evento(conversa, membro, 'C', T0 + 2000, 'EV3'));
    registrarEtiqueta(acervo, evento(conversa, membro, 'A', T0, 'EV1'));
    const v = etiquetasVigentesDaConversa(acervo, conversa).get(membro);
    assert.equal(v?.texto, 'B');
    assert.equal(v?.em, T0 + 5000);
  } finally {
    c.limpar();
  }
});

test('instantes iguais desempatam pela identidade do evento, de forma deterministica', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversa = umaColetiva(acervo);
    const membro = umMembro(acervo);
    // Maior identidade vence; a ordem de insercao nao decide. Os DOIS membros
    // do mesmo teste invertem a ordem de insercao: um deles coincidiria com
    // "o ultimo inserido" e o mutante M3 (sem `id_externo` no desempate)
    // sobreviveria.
    const outro = umMembro(acervo, '5565911110002');
    registrarEtiqueta(acervo, evento(conversa, membro, 'primeira', T0, 'EV-A'));
    registrarEtiqueta(acervo, evento(conversa, membro, 'segunda', T0, 'EV-B'));
    registrarEtiqueta(acervo, evento(conversa, outro, 'segunda', T0, 'EV-B2'));
    registrarEtiqueta(acervo, evento(conversa, outro, 'primeira', T0, 'EV-A2'));
    const mapa = etiquetasVigentesDaConversa(acervo, conversa);
    assert.equal(mapa.get(membro)?.texto, 'segunda', 'EV-B vence EV-A, inserido depois');
    assert.equal(mapa.get(outro)?.texto, 'segunda', 'EV-B2 vence EV-A2, mesmo inserido ANTES');
  } finally {
    c.limpar();
  }
});

test('remover deixa a vigente AUSENTE (nula), e o instante da remocao e o de etiquetaEm', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversa = umaColetiva(acervo);
    const membro = umMembro(acervo);
    registrarEtiqueta(acervo, evento(conversa, membro, 'Torre A', T0, 'EV1'));
    registrarEtiqueta(acervo, evento(conversa, membro, '', T0 + 9000, 'EV2'));
    const v = etiquetasVigentesDaConversa(acervo, conversa).get(membro);
    assert.equal(v?.texto, null, 'a etiqueta removida e NULA na leitura, nao a cadeia vazia');
    assert.equal(v?.em, T0 + 9000);
    // O historico guarda a anterior: duas linhas.
    const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM etiquetas_de_participacao').get() as { n: number };
    assert.equal(n.n, 2);
  } finally {
    c.limpar();
  }
});

test('por data: o evento no instante exato VALE, e o posterior nao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversa = umaColetiva(acervo);
    const membro = umMembro(acervo);
    registrarEtiqueta(acervo, evento(conversa, membro, 'antes', T0, 'EV1'));
    registrarEtiqueta(acervo, evento(conversa, membro, 'depois', T0 + 1000, 'EV2'));
    assert.equal(etiquetasVigentesDaConversa(acervo, conversa, T0).get(membro)?.texto, 'antes');
    assert.equal(etiquetasVigentesDaConversa(acervo, conversa, T0 + 999).get(membro)?.texto, 'antes');
    assert.equal(etiquetasVigentesDaConversa(acervo, conversa, T0 + 1000).get(membro)?.texto, 'depois');
    // Antes do primeiro evento: nunca observada, e portanto sem entrada no mapa.
    assert.equal(etiquetasVigentesDaConversa(acervo, conversa, T0 - 1).has(membro), false);
  } finally {
    c.limpar();
  }
});

test('as etiquetas de uma Conversa nao aparecem em outra', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const a = umaColetiva(acervo, '120363000000000001@g.us');
    const b = umaColetiva(acervo, '120363000000000002@g.us');
    const membro = umMembro(acervo);
    registrarEtiqueta(acervo, evento(a, membro, 'so em A', T0, 'EV1'));
    assert.equal(etiquetasVigentesDaConversa(acervo, b).size, 0);
  } finally {
    c.limpar();
  }
});

test('a leitura devolve 30 membros numa chamada so — uma consulta por Conversa, nunca uma por membro', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversa = umaColetiva(acervo);
    for (let i = 0; i < 30; i += 1) {
      const m = umMembro(acervo, `55659111${String(10000 + i)}`);
      registrarEtiqueta(acervo, evento(conversa, m, `t${i}`, T0 + i, `EV${i}`));
    }
    // Prova ESTRUTURAL: conta quantas vezes a leitura pede statement ao Acervo.
    // `preparar` e a unica porta de SQL (a varredura canonica garante), entao
    // uma leitura por membro apareceria como 30 pedidos.
    const original = acervo.preparar.bind(acervo);
    let pedidos = 0;
    acervo.preparar = ((sql: string) => {
      pedidos += 1;
      return original(sql);
    }) as typeof acervo.preparar;
    const mapa = etiquetasVigentesDaConversa(acervo, conversa);
    assert.equal(mapa.size, 30);
    assert.equal(pedidos, 1, 'a leitura de uma Conversa tem de ser UMA consulta');
  } finally {
    c.limpar();
  }
});


test('por Identificador: uma etiqueta vigente por Conversa onde houve evento, em uma consulta', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const a = umaColetiva(acervo, '120363000000000001@g.us');
    const b = umaColetiva(acervo, '120363000000000002@g.us');
    const x = umMembro(acervo, '5565911110001');
    const y = umMembro(acervo, '5565911110002');
    registrarEtiqueta(acervo, evento(a, x, 'v1', T0, 'EV1'));
    registrarEtiqueta(acervo, evento(a, x, 'v2', T0 + 1000, 'EV2'));
    registrarEtiqueta(acervo, evento(b, x, '', T0 + 2000, 'EV3'));
    registrarEtiqueta(acervo, evento(a, y, 'so y', T0, 'EV4'));

    const mapa = etiquetasDosIdentificadores(acervo, [x, y]);
    const doX = mapa.get(x) ?? [];
    assert.equal(doX.length, 2, 'uma por Conversa');
    const emA = doX.find((e) => e.conversaId === a);
    const emB = doX.find((e) => e.conversaId === b);
    assert.equal(emA?.texto, 'v2');
    assert.equal(emB?.texto, null, 'a removida aparece como nula, com o instante da remocao');
    assert.equal(emB?.em, T0 + 2000);
    assert.equal((mapa.get(y) ?? []).length, 1);
    assert.deepEqual(etiquetasDosIdentificadores(acervo, []).size, 0);
  } finally {
    c.limpar();
  }
});
