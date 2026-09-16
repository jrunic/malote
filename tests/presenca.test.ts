import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import {
  registrarConversa,
  registrarIdentificador,
  registrarParticipacao,
  registrarTransicao,
} from '../src/nucleo/escrita.js';
import {
  alcanceDaConversa,
  quemEstavaEm,
  type RespostaDePresenca,
} from '../src/nucleo/presenca.js';

const T1 = 1_600_000_000_000;
const T2 = 1_650_000_000_000;

/**
 * Conversa coletiva com N membros no retrato.
 *
 * `ativa` reproduz o que a Fonte declara: `true` ativo, `false` inativo, e
 * `undefined` sem declaração — os três casos existem no material real.
 */
function grupoCom(acervo: Acervo, membros: Array<{ endereco: string; ativa?: boolean }>) {
  const conversaId = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: 'grupo-1@g.us',
    coletiva: true,
  });
  const ids = membros.map((m) => {
    const { id } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: m.endereco });
    registrarParticipacao(acervo, {
      conversaId,
      identificadorId: id,
      observadaEm: '2026-08-30T00:00:00.000Z',
      ...(m.ativa === undefined ? {} : { ativaNaFonte: m.ativa }),
    });
    return id;
  });
  return { conversaId, ids };
}

/** Uma Transição, com o mínimo de cerimônia. */
function tr(
  acervo: Acervo,
  conversaId: string,
  identificadorId: string,
  natureza: 'entrou' | 'saiu',
  ocorridaEm: number,
  idExterno: string,
): void {
  registrarTransicao(acervo, {
    conversaId,
    identificadorId,
    natureza,
    ocorridaEm,
    fonte: 'whatsapp',
    idExterno,
    codigoDaFonte: natureza === 'entrou' ? '15' : '7',
  });
}

test('Conversa sem evento algum NÃO tem alcance', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { conversaId } = grupoCom(acervo, [{ endereco: '5565911111', ativa: true }]);
    assert.equal(alcanceDaConversa(acervo, conversaId), null);
  } finally {
    c.limpar();
  }
});

test('o alcance vai do primeiro ao último evento DECLARADO', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    const { conversaId, ids } = grupoCom(acervo, [
      { endereco: '5565911111', ativa: true },
      { endereco: '5565922222', ativa: true },
    ]);
    registrarTransicao(acervo, {
      conversaId,
      identificadorId: ids[0] as string,
      natureza: 'saiu',
      ocorridaEm: T2,
      fonte: 'whatsapp',
      idExterno: 's-2',
      codigoDaFonte: '7',
    });
    registrarTransicao(acervo, {
      conversaId,
      identificadorId: ids[1] as string,
      natureza: 'saiu',
      ocorridaEm: T1,
      fonte: 'whatsapp',
      idExterno: 's-1',
      codigoDaFonte: '3',
    });

    assert.deepEqual(alcanceDaConversa(acervo, conversaId), { de: T1, ate: T2 });
  } finally {
    c.limpar();
  }
});

test('a rota e o ULTIMO evento ate a data — e readicao sai de graca', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Chewbacca');
    const { conversaId, ids } = grupoCom(acervo, [{ endereco: '5565911111', ativa: true }]);
    // entrou em T1, saiu em T1+d, entrou de novo em T2.
    const meio = T1 + (T2 - T1) / 2;
    tr(acervo, conversaId, ids[0] as string, 'entrou', T1, 'e-1');
    tr(acervo, conversaId, ids[0] as string, 'saiu', meio, 's-1');
    tr(acervo, conversaId, ids[0] as string, 'entrou', T2, 'e-2');

    // Entre a entrada e a saida: presente.
    const antes = quemEstavaEm(acervo, { conversaId, em: T1 + 1 });
    assert.equal(antes.presentes.length, 1, JSON.stringify(antes));
    assert.equal(antes.presentes[0]?.entrouEm, T1);

    // Entre a saida e a reentrada: saiu antes.
    const entre = quemEstavaEm(acervo, { conversaId, em: meio + 1 });
    assert.equal(entre.sairamAntes.length, 1, JSON.stringify(entre));
    assert.equal(entre.sairamAntes[0]?.saiuEm, meio);

    // Depois da reentrada: presente de novo.
    const depois = quemEstavaEm(acervo, { conversaId, em: T2 });
    assert.equal(depois.presentes.length, 1, JSON.stringify(depois));
    assert.equal(depois.presentes[0]?.entrouEm, T2);
  } finally {
    c.limpar();
  }
});

test('os quatro grupos, um membro em cada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('R2-D2');
    const meio = (T1 + T2) / 2;
    const { conversaId, ids } = grupoCom(acervo, [
      { endereco: '5565911111', ativa: true },
      { endereco: '5565922222', ativa: true },
      { endereco: '5565933333', ativa: false },
      { endereco: '5565944444', ativa: false },
    ]);
    // 0: entrou antes da data -> presente.
    tr(acervo, conversaId, ids[0] as string, 'entrou', T1, 'e-0');
    // 1: sem evento ate a data, mas SAIU depois -> estava (ninguem sai de onde nao esta).
    tr(acervo, conversaId, ids[1] as string, 'saiu', T2, 's-1');
    // 2: entrou DEPOIS da data -> ainda nao entrou.
    tr(acervo, conversaId, ids[2] as string, 'entrou', T2, 'e-2');
    // 3: nenhum evento em direcao nenhuma -> sem informacao.

    const r = quemEstavaEm(acervo, { conversaId, em: meio });

    assert.equal(r.dentroDoAlcance, true);
    assert.deepEqual(r.presentes.map((x) => x.identificadorId).sort(), [ids[0], ids[1]].sort());
    assert.deepEqual(r.aindaNaoEntraram.map((x) => x.identificadorId), [ids[2]]);
    assert.deepEqual(
      r.semInformacao.map((x) => x.identificadorId),
      [ids[3]],
      'sem evento em direcao nenhuma: o retrato de hoje NAO responde por uma data passada',
    );
    assert.equal(r.sairamAntes.length, 0);
  } finally {
    c.limpar();
  }
});

test('Conversa SEM alcance responde que nao tem, e nao devolve o roster', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Lando');
    const { conversaId } = grupoCom(acervo, [
      { endereco: '5565911111', ativa: true },
      { endereco: '5565922222', ativa: true },
    ]);
    const r = quemEstavaEm(acervo, { conversaId, em: T1 });
    assert.equal(r.alcance, null);
    assert.equal(r.presentes.length, 0, 'o roster NAO vira historico');
    assert.equal(r.sairamAntes.length, 0);
    assert.equal(r.aindaNaoEntraram.length, 0);
    assert.equal(r.semInformacao.length, 2);
  } finally {
    c.limpar();
  }
});

test('data FORA do alcance responde sem informacao para todos, nas duas direcoes', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { conversaId, ids } = grupoCom(acervo, [
      { endereco: '5565911111', ativa: true },
      { endereco: '5565922222', ativa: true },
    ]);
    tr(acervo, conversaId, ids[0] as string, 'entrou', T1, 'e-1');
    tr(acervo, conversaId, ids[1] as string, 'saiu', T2, 's-2');

    for (const [rotulo, quando] of [
      ['antes', T1 - 1],
      ['depois', T2 + 1],
    ] as const) {
      const r = quemEstavaEm(acervo, { conversaId, em: quando });
      assert.equal(r.dentroDoAlcance, false, rotulo);
      assert.equal(r.presentes.length, 0, rotulo);
      assert.equal(r.sairamAntes.length, 0, rotulo);
      assert.equal(r.aindaNaoEntraram.length, 0, rotulo);
      assert.equal(r.semInformacao.length, 2, rotulo);
      assert.deepEqual(r.alcance, { de: T1, ate: T2 });
    }
  } finally {
    c.limpar();
  }
});

test('quem so aparece em Transicao, e nao no retrato, entra na resposta', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    const { conversaId } = grupoCom(acervo, [{ endereco: '5565911111', ativa: true }]);
    const { id: fantasma } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '5565999999',
    });
    tr(acervo, conversaId, fantasma, 'saiu', T1, 's-9');

    const r = quemEstavaEm(acervo, { conversaId, em: T1 });
    const todos = [
      ...r.presentes,
      ...r.sairamAntes,
      ...r.aindaNaoEntraram,
      ...r.semInformacao,
    ].map((x) => x.identificadorId);
    assert.ok(todos.includes(fantasma), 'so o retrato deixaria de fora quem ja saiu');
  } finally {
    c.limpar();
  }
});

test('a ressalva vai nas DUAS direcoes e sobrevive a serializacao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { conversaId, ids } = grupoCom(acervo, [{ endereco: '5565911111', ativa: true }]);
    tr(acervo, conversaId, ids[0] as string, 'entrou', T1, 'e-1');
    const r = quemEstavaEm(acervo, { conversaId, em: T1 });

    assert.match(r.ressalva.soDentroDoAlcance, /fora dele nada e afirmavel/i);
    assert.match(r.ressalva.semInformacaoNaoEAusencia, /nao quer dizer ausente/i);

    const doJson = JSON.parse(JSON.stringify(r)) as RespostaDePresenca;
    assert.deepEqual(doJson.ressalva, r.ressalva, 'a ressalva sobrevive ao --json');
  } finally {
    c.limpar();
  }
});

test('consultar presenca grava ZERO Operacoes na trilha', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { conversaId, ids } = grupoCom(acervo, [
      { endereco: '5565911111', ativa: true },
      { endereco: '5565922222', ativa: false },
    ]);
    tr(acervo, conversaId, ids[1] as string, 'saiu', T1, 's-1');

    const contar = () =>
      (acervo.db.prepare('SELECT COUNT(*) n FROM operacoes').get() as { n: number }).n;

    const antes = contar();
    const r = quemEstavaEm(acervo, { conversaId, em: T1 });

    // O cenario CHEGOU a consulta: ela devolveu gente. Sem esta assercao, o
    // teste compararia zero com zero e passaria mesmo sem consultar nada.
    assert.ok(
      r.presentes.length + r.sairamAntes.length + r.aindaNaoEntraram.length +
        r.semInformacao.length > 0,
      `a consulta nao devolveu ninguem: ${JSON.stringify(r)}`,
    );
    assert.equal(contar(), antes, 'consultar nao acrescenta Operacao nenhuma a trilha');
  } finally {
    c.limpar();
  }
});
