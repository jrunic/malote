import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identificarPorValor } from '../src/nucleo/identificar.js';
import { PRECEDENCIA } from './ajuda/identidade.js';
import { formatarIdentificacao } from '../src/cli/identificar-texto.js';
import { listarEtiquetas, LIMITE_DE_ETIQUETAS } from '../src/nucleo/etiqueta-de-participacao.js';
import { cenario } from './ajuda/acervo.js';
import { umaColetiva, umMembro } from './ajuda/etiqueta.js';
import { registrarEtiqueta, registrarTransicao } from '../src/nucleo/escrita.js';
import { quemEstavaEm } from '../src/nucleo/presenca.js';
import { acrescentarEtiquetas } from '../src/nucleo/etiqueta-de-participacao.js';

const T0 = Date.parse('2026-10-05T15:00:00Z');

type Acervo = Parameters<typeof registrarEtiqueta>[0];

function entrou(acervo: Acervo, conversaId: string, identificadorId: string, instante: number, idExterno: string): void {
  registrarTransicao(acervo, {
    conversaId, identificadorId, natureza: 'entrou', ocorridaEm: instante,
    fonte: 'whatsapp', idExterno, codigoDaFonte: 'GROUP_PARTICIPANT_ADD',
  });
}

function etiqueta(acervo: Acervo, conversaId: string, identificadorId: string, texto: string, ocorridaEm: number, idExterno: string): void {
  registrarEtiqueta(acervo, { conversaId, identificadorId, texto, ocorridaEm, fonte: 'whatsapp', idExterno });
}

function cenarioDeGrupo() {
  const c = cenario();
  const { acervo } = c.novoInquilino('Padme');
  const conversa = umaColetiva(acervo);
  const a = umMembro(acervo, '5565911110001');
  const b = umMembro(acervo, '5565911110002');
  entrou(acervo, conversa, a, T0, 'ADD-A');
  entrou(acervo, conversa, b, T0 + 10_000, 'ADD-B');
  return { c, acervo, conversa, a, b };
}

test('participantes traz etiqueta e etiquetaEm; sem evento, os dois nulos (nunca observada)', () => {
  const { c, acervo, conversa, a, b } = cenarioDeGrupo();
  try {
    etiqueta(acervo, conversa, a, 'Torre A', T0 + 1000, 'EV1');
    const r = acrescentarEtiquetas(acervo, quemEstavaEm(acervo, { conversaId: conversa, em: T0 + 5000 }));
    const doA = r.presentes.find((p) => p.identificadorId === a);
    const doB = [...r.presentes, ...r.aindaNaoEntraram].find((p) => p.identificadorId === b);
    assert.equal(doA?.etiqueta, 'Torre A');
    assert.equal(doA?.etiquetaEm, T0 + 1000);
    assert.equal(doB?.etiqueta, null);
    assert.equal(doB?.etiquetaEm, null, 'sem evento e "nao observada", e se distingue de "removida"');
  } finally {
    c.limpar();
  }
});

test('a removida e etiqueta nula MAS com etiquetaEm: "sem etiqueta" difere de "nao observada"', () => {
  const { c, acervo, conversa, a } = cenarioDeGrupo();
  try {
    etiqueta(acervo, conversa, a, 'Torre A', T0 + 1000, 'EV1');
    etiqueta(acervo, conversa, a, '', T0 + 2000, 'EV2');
    const r = acrescentarEtiquetas(acervo, quemEstavaEm(acervo, { conversaId: conversa, em: T0 + 5000 }));
    const doA = r.presentes.find((p) => p.identificadorId === a);
    assert.equal(doA?.etiqueta, null);
    assert.equal(doA?.etiquetaEm, T0 + 2000);
  } finally {
    c.limpar();
  }
});

test('participantes --em traz a etiqueta vigente NA DATA, nao a de hoje', () => {
  const { c, acervo, conversa, a } = cenarioDeGrupo();
  try {
    etiqueta(acervo, conversa, a, 'antiga', T0 + 1000, 'EV1');
    etiqueta(acervo, conversa, a, 'nova', T0 + 8000, 'EV2');
    const naData = acrescentarEtiquetas(acervo, quemEstavaEm(acervo, { conversaId: conversa, em: T0 + 5000 }));
    assert.equal(naData.presentes.find((p) => p.identificadorId === a)?.etiqueta, 'antiga');
    const hoje = acrescentarEtiquetas(acervo, quemEstavaEm(acervo, { conversaId: conversa, em: T0 + 9000 }));
    assert.equal(hoje.presentes.find((p) => p.identificadorId === a)?.etiqueta, 'nova');
  } finally {
    c.limpar();
  }
});

test('o conjunto de membros e a regra de Alcance NAO mudam: quem so tem etiqueta nao entra na lista', () => {
  const { c, acervo, conversa } = cenarioDeGrupo();
  try {
    const so = umMembro(acervo, '5565911110003');
    etiqueta(acervo, conversa, so, 'so etiqueta', T0 + 1000, 'EV1');
    const sem = quemEstavaEm(acervo, { conversaId: conversa, em: T0 + 5000 });
    const com = acrescentarEtiquetas(acervo, sem);
    const ids = (r: typeof sem): string[] =>
      [...r.presentes, ...r.sairamAntes, ...r.aindaNaoEntraram, ...r.semInformacao].map((p) => p.identificadorId).sort();
    assert.deepEqual(ids(com), ids(sem));
    assert.equal(ids(com).includes(so), false);
    // Fora do Alcance a lista segue como hoje: todos em semInformacao, e AINDA com etiqueta.
    const fora = acrescentarEtiquetas(acervo, quemEstavaEm(acervo, { conversaId: conversa, em: T0 - 1 }));
    assert.equal(fora.presentes.length, 0);
    assert.equal(fora.semInformacao.length, 2);
  } finally {
    c.limpar();
  }
});

test('participantes faz UMA consulta de etiquetas por Conversa, nunca uma por membro', () => {
  const { c, acervo, conversa } = cenarioDeGrupo();
  try {
    for (let i = 0; i < 20; i += 1) {
      const m = umMembro(acervo, `55659111${String(20000 + i)}`);
      entrou(acervo, conversa, m, T0 + 100 + i, `ADD-${i}`);
      etiqueta(acervo, conversa, m, `t${i}`, T0 + 200 + i, `EV-${i}`);
    }
    const resposta = quemEstavaEm(acervo, { conversaId: conversa, em: T0 + 5000 });
    const original = acervo.preparar.bind(acervo);
    let pedidos = 0;
    acervo.preparar = ((sql: string) => {
      pedidos += 1;
      return original(sql);
    }) as typeof acervo.preparar;
    acrescentarEtiquetas(acervo, resposta);
    assert.equal(pedidos, 1, 'o enriquecimento tem de ser UMA consulta por Conversa');
  } finally {
    c.limpar();
  }
});

test('identificar: uma etiqueta vigente por Conversa onde houve evento, e a removida e nula', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const g1 = umaColetiva(acervo, '120363000000000001@g.us');
    const g2 = umaColetiva(acervo, '120363000000000002@g.us');
    const a = umMembro(acervo, '5565911110001');
    etiqueta(acervo, g1, a, 'v1', T0, 'EV1');
    etiqueta(acervo, g1, a, 'v2', T0 + 1000, 'EV2');
    etiqueta(acervo, g2, a, '', T0 + 2000, 'EV3');
    const r = identificarPorValor(acervo, { valor: '5565911110001@s.whatsapp.net' }, PRECEDENCIA);
    const doA = r.identificadores.find((i) => i.id === a);
    assert.equal(doA?.etiquetas.length, 2);
    assert.equal(doA?.etiquetas.find((e) => e.conversaId === g1)?.texto, 'v2');
    assert.equal(doA?.etiquetas.find((e) => e.conversaId === g2)?.texto, null, 'a removida e nula, com o instante da remocao');
    assert.equal(doA?.etiquetas.find((e) => e.conversaId === g2)?.em, T0 + 2000);
  } finally {
    c.limpar();
  }
});

test('identificar sem etiqueta devolve lista vazia, e o resto da resposta nao muda', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    umMembro(acervo, '5565911110001');
    const r = identificarPorValor(acervo, { valor: '5565911110001@s.whatsapp.net' }, PRECEDENCIA);
    assert.deepEqual(r.identificadores[0]?.etiquetas, []);
  } finally {
    c.limpar();
  }
});

test('identificar em texto: uma linha por etiqueta, a removida marcada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const g1 = umaColetiva(acervo, '120363000000000001@g.us');
    const g2 = umaColetiva(acervo, '120363000000000002@g.us');
    const a = umMembro(acervo, '5565911110001');
    etiqueta(acervo, g1, a, 'Torre A', T0, 'EV1');
    etiqueta(acervo, g2, a, 'x', T0, 'EV2');
    etiqueta(acervo, g2, a, '', T0 + 1000, 'EV3');
    const linhas = formatarIdentificacao(identificarPorValor(acervo, { valor: '5565911110001@s.whatsapp.net' }, PRECEDENCIA));
    assert.ok(linhas.some((l) => l.includes(`etiqueta em ${g1}: Torre A`)));
    assert.ok(linhas.some((l) => l.includes(`etiqueta em ${g2}: (removida)`)));
  } finally {
    c.limpar();
  }
});


function duasConversas() {
  const c = cenario();
  const { acervo } = c.novoInquilino('Padme');
  const g1 = umaColetiva(acervo, '120363000000000001@g.us');
  const g2 = umaColetiva(acervo, '120363000000000002@g.us');
  const a = umMembro(acervo, '5565911110001');
  const b = umMembro(acervo, '5565911110002');
  return { c, acervo, g1, g2, a, b };
}

test('sem filtro, so as correntes NAO vazias: a removida e a antiga nao aparecem', () => {
  const { c, acervo, g1, a, b } = duasConversas();
  try {
    etiqueta(acervo, g1, a, 'antiga', T0, 'EV1');
    etiqueta(acervo, g1, a, 'nova', T0 + 1000, 'EV2');
    etiqueta(acervo, g1, b, 'x', T0, 'EV3');
    etiqueta(acervo, g1, b, '', T0 + 500, 'EV4'); // removida
    const r = listarEtiquetas(acervo, {}, PRECEDENCIA);
    assert.deepEqual(r.map((e) => e.texto), ['nova']);
  } finally {
    c.limpar();
  }
});

test('a lista traz Conversa, Identificador (valor), nome corrente, texto e instante', () => {
  const { c, acervo, g1, a } = duasConversas();
  try {
    etiqueta(acervo, g1, a, 'Torre A', T0, 'EV1');
    const [e] = listarEtiquetas(acervo, {}, PRECEDENCIA);
    assert.equal(e?.conversaId, g1);
    assert.equal(e?.identificadorId, a);
    assert.equal(e?.valor, '5565911110001@s.whatsapp.net');
    assert.equal(e?.nome, null, 'sem Atribuicao de Nome, nome nulo');
    assert.equal(e?.texto, 'Torre A');
    assert.equal(e?.em, T0);
  } finally {
    c.limpar();
  }
});

test('filtros: por Conversa, por remetente (com a forma alternativa) e por texto', () => {
  const { c, acervo, g1, g2, a, b } = duasConversas();
  try {
    etiqueta(acervo, g1, a, 'Torre A', T0, 'EV1');
    etiqueta(acervo, g2, a, 'Torre B', T0, 'EV2');
    etiqueta(acervo, g1, b, 'Equipe', T0, 'EV3');
    assert.deepEqual(
      listarEtiquetas(acervo, { conversaId: g2 }, PRECEDENCIA).map((e) => e.texto),
      ['Torre B'],
    );
    assert.deepEqual(
      listarEtiquetas(acervo, { autorIds: [b] }, PRECEDENCIA).map((e) => e.texto),
      ['Equipe'],
    );
    assert.deepEqual(
      listarEtiquetas(acervo, { busca: 'torre' }, PRECEDENCIA).map((e) => e.texto).sort(),
      ['Torre A', 'Torre B'],
      'a caixa e ignorada so para ASCII',
    );
    assert.deepEqual(listarEtiquetas(acervo, { autorIds: [] }, PRECEDENCIA), [], 'autorIds vazio devolve NADA, nunca tudo');
  } finally {
    c.limpar();
  }
});

test('a busca e literal: % e _ nao sao curinga, e acento nao e normalizado', () => {
  const { c, acervo, g1, a, b } = duasConversas();
  try {
    etiqueta(acervo, g1, a, 'CRS 100%', T0, 'EV1');
    etiqueta(acervo, g1, b, 'CRS 1000', T0, 'EV2');
    assert.deepEqual(
      listarEtiquetas(acervo, { busca: '100%' }, PRECEDENCIA).map((e) => e.texto),
      ['CRS 100%'],
      'o % casou como curinga',
    );
    assert.equal(listarEtiquetas(acervo, { busca: 'CRS_' }, PRECEDENCIA).length, 0, 'o _ casou como curinga');
    etiqueta(acervo, g1, a, 'Médico', T0 + 1, 'EV3');
    assert.equal(listarEtiquetas(acervo, { busca: 'medico' }, PRECEDENCIA).length, 0, 'acento nao e normalizado');
  } finally {
    c.limpar();
  }
});

test('--historico: todos os eventos do membro naquela Conversa, a remocao como nula, do mais novo ao mais antigo', () => {
  const { c, acervo, g1, g2, a } = duasConversas();
  try {
    etiqueta(acervo, g1, a, 'v1', T0, 'EV1');
    etiqueta(acervo, g1, a, 'v2', T0 + 1000, 'EV2');
    etiqueta(acervo, g1, a, '', T0 + 2000, 'EV3');
    etiqueta(acervo, g2, a, 'outra conversa', T0, 'EV4');
    const h = listarEtiquetas(acervo, { conversaId: g1, autorIds: [a], historico: true }, PRECEDENCIA);
    assert.deepEqual(h.map((e) => e.texto), [null, 'v2', 'v1']);
    assert.throws(
      () => listarEtiquetas(acervo, { historico: true }, PRECEDENCIA),
      /conversa e remetente/i,
    );
  } finally {
    c.limpar();
  }
});

test('o limite padrao e o maximo valem, e limite invalido e recusado', () => {
  const { c, acervo, g1 } = duasConversas();
  try {
    for (let i = 0; i < 150; i += 1) {
      const m = umMembro(acervo, `55659111${String(30000 + i)}`);
      etiqueta(acervo, g1, m, `t${i}`, T0 + i, `EV-${i}`);
    }
    assert.equal(listarEtiquetas(acervo, {}, PRECEDENCIA).length, LIMITE_DE_ETIQUETAS.padrao);
    assert.equal(listarEtiquetas(acervo, { limite: 7 }, PRECEDENCIA).length, 7);
    assert.equal(listarEtiquetas(acervo, { limite: 150 }, PRECEDENCIA).length, 150);
    for (const ruim of [0, -1, 1.5, LIMITE_DE_ETIQUETAS.maximo + 1]) {
      assert.throws(() => listarEtiquetas(acervo, { limite: ruim }, PRECEDENCIA), /limite/i);
    }
  } finally {
    c.limpar();
  }
});
