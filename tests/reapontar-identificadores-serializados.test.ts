import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import {
  registrarConversa,
  registrarIdentificador,
  registrarTransicao,
} from '../src/nucleo/escrita.js';
import { aprenderCorrespondencia, resolverEndereco } from '../src/nucleo/correspondencia.js';
import { desfazerOperacao } from '../src/nucleo/desfazer.js';
import { reapontarIdentificadoresSerializados } from '../src/adaptadores/whatsapp/reapontar-identificadores-serializados.js';
import type { Acervo } from '../src/nucleo/acervo.js';

const OPACO = '109876543210987@lid';
const NUMERO = '5565991110001@s.whatsapp.net'; // celular brasileiro: a outra forma (sem o 9) e `556591110001`
const objeto = (o: object): string => JSON.stringify(o);

function semear(acervo: Acervo) {
  const conversa = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: '120363000000000001@g.us',
    coletiva: true,
  });
  const id = (valor: string): string =>
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor }).id;
  const t = (
    idExterno: string,
    identificadorId: string,
    natureza: 'entrou' | 'saiu',
    quando: number,
  ): void => {
    registrarTransicao(acervo, {
      origemDaChegada: 'importacao',
      conversaId: conversa,
      identificadorId,
      natureza,
      ocorridaEm: quando,
      fonte: 'whatsapp',
      idExterno,
      codigoDaFonte: '',
    });
  };
  return { conversa, id, t };
}
const n = (acervo: Acervo, sql: string, ...a: unknown[]): number =>
  (acervo.db.prepare(sql).get(...a) as { n: number }).n;
const contagens = (acervo: Acervo): string =>
  JSON.stringify([
    n(acervo, 'SELECT COUNT(*) AS n FROM identificadores'),
    n(acervo, 'SELECT COUNT(*) AS n FROM correspondencias_de_endereco'),
    n(acervo, 'SELECT COUNT(*) AS n FROM operacoes'),
    n(acervo, 'SELECT COUNT(*) AS n FROM transicoes_de_participacao'),
  ]);

test('o ensaio NAO escreve (nem par do nono digito, nem Operacao) com celular brasileiro de forma real, e conta o que faria', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const s = semear(acervo);
    const ser = s.id(objeto({ id: OPACO, phoneNumber: NUMERO, admin: null }));
    s.t('E1', ser, 'entrou', 1000);
    const antes = contagens(acervo);
    const r = reapontarIdentificadoresSerializados(acervo, { comEfeito: false });
    assert.equal(r.serializados, 1);
    assert.equal(r.transicoesAReapontar, 1);
    assert.equal(r.paresAAprender, 2, 'o par do nono digito do telefone e o par do endereco opaco');
    assert.equal(r.identificadoresACriar, 1);
    assert.equal(r.chegadasQueCitam, 1);
    assert.equal(r.gravou, false);
    assert.equal(r.operacaoId, null);
    assert.equal(contagens(acervo), antes, 'o ensaio nao grava nada');
  } finally {
    c.limpar();
  }
});

test('o ensaio preve exatamente o que o efeito faz', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const s = semear(acervo);
    const ser = s.id(objeto({ id: OPACO, phoneNumber: NUMERO, admin: null }));
    const ser2 = s.id(objeto({ id: '208765432109876@lid', admin: null }));
    s.t('E1', ser, 'entrou', 1000);
    s.t('E2', ser2, 'entrou', 1000);
    const ensaio = reapontarIdentificadoresSerializados(acervo, { comEfeito: false });
    const efeito = reapontarIdentificadoresSerializados(acervo, { comEfeito: true });
    assert.equal(efeito.paresAprendidos, ensaio.paresAAprender);
    assert.equal(efeito.identificadoresCriados, ensaio.identificadoresACriar);
    assert.equal(
      efeito.transicoesReapontadas + efeito.transicoesFundidas,
      ensaio.transicoesAReapontar,
    );
    assert.equal(efeito.serializadosRemovidos, 2);
  } finally {
    c.limpar();
  }
});

test('o ensaio preve o efeito quando o mesmo id e o mesmo telefone se repetem em varios valores serializados (a forma real)', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const s = semear(acervo);
    // O mesmo participante serializado com `admin` diferente, um deles sem o telefone; e um segundo endereco opaco com o
    // MESMO telefone. Medido: 3.706 serializados para 237 pares a aprender e 68 destinos a criar.
    // Ids fixos, em ordem: o valor SEM telefone vem primeiro. Com ids sorteados a ordem variava e o teste passava ou nao.
    const fixo = (id: string, valor: string): string => {
      acervo.db
        .prepare(
          "INSERT INTO identificadores (id, fonte, valor, visto_em) VALUES (?, 'whatsapp', ?, '2026-09-08T00:00:00.000Z')",
        )
        .run(id, valor);
      return id;
    };
    const sem = fixo('id-1', objeto({ id: OPACO, admin: null }));
    const a = fixo('id-2', objeto({ id: OPACO, phoneNumber: NUMERO, admin: null }));
    const b = fixo('id-3', objeto({ id: OPACO, phoneNumber: NUMERO, admin: 'admin' }));
    const outro = fixo(
      'id-4',
      objeto({ id: '208765432109876@lid', phoneNumber: NUMERO, admin: null }),
    );
    s.t('E1', a, 'entrou', 1000);
    s.t('E2', b, 'saiu', 2000);
    s.t('E3', sem, 'entrou', 3000);
    s.t('E4', outro, 'entrou', 4000);
    const ensaio = reapontarIdentificadoresSerializados(acervo, { comEfeito: false });
    assert.equal(
      ensaio.paresAAprender,
      3,
      'o nono digito, e os dois enderecos opacos para o numero: cada par uma vez',
    );
    assert.equal(ensaio.identificadoresACriar, 1, 'so o numero');
    const efeito = reapontarIdentificadoresSerializados(acervo, { comEfeito: true });
    assert.equal(efeito.paresAprendidos, ensaio.paresAAprender);
    assert.equal(efeito.identificadoresCriados, ensaio.identificadoresACriar);
    assert.equal(efeito.serializadosRemovidos, 4);
    assert.equal(efeito.transicoesReapontadas, 4);
    const numero = n(acervo, 'SELECT COUNT(*) AS n FROM identificadores WHERE valor = ?', NUMERO);
    assert.equal(numero, 1);
    assert.equal(
      n(
        acervo,
        'SELECT COUNT(*) AS n FROM transicoes_de_participacao t JOIN identificadores i ON i.id = t.identificador_id WHERE i.valor = ?',
        NUMERO,
      ),
      4,
      'as quatro Transicoes, inclusive a do valor sem telefone, sob o numero',
    );
  } finally {
    c.limpar();
  }
});

test('com efeito: aprende os pares, cria o destino, reaponta, funde a colisao e remove o serializado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const s = semear(acervo);
    const ser = s.id(objeto({ id: OPACO, phoneNumber: NUMERO, admin: null }));
    const destinoExistente = s.id(NUMERO);
    s.t('E1', ser, 'entrou', 1000);
    s.t('E2', ser, 'saiu', 2000);
    s.t('E1', destinoExistente, 'entrou', 1000); // colide
    const r = reapontarIdentificadoresSerializados(acervo, { comEfeito: true });
    assert.equal(r.serializadosRemovidos, 1);
    assert.equal(r.transicoesReapontadas, 1);
    assert.equal(r.transicoesFundidas, 1);
    assert.equal(r.gravou, true);
    assert.equal(
      resolverEndereco(acervo, 'whatsapp', OPACO),
      NUMERO,
      'o destino e a forma gravada do numero',
    );
    assert.equal(
      n(acervo, "SELECT COUNT(*) AS n FROM identificadores WHERE substr(valor, 1, 1) = '{'"),
      0,
    );
    assert.equal(
      n(
        acervo,
        'SELECT COUNT(*) AS n FROM transicoes_de_participacao WHERE identificador_id = ?',
        destinoExistente,
      ),
      2,
    );
    assert.notEqual(r.operacaoId, null);
  } finally {
    c.limpar();
  }
});

test('sem phoneNumber e sem par, o destino e o proprio endereco opaco (os 50 casos medidos)', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const s = semear(acervo);
    const ser = s.id(objeto({ id: OPACO, admin: null }));
    s.t('E1', ser, 'entrou', 1000);
    const r = reapontarIdentificadoresSerializados(acervo, { comEfeito: true });
    assert.equal(r.paresAprendidos, 0);
    assert.equal(n(acervo, 'SELECT COUNT(*) AS n FROM identificadores WHERE valor = ?', OPACO), 1);
    assert.equal(
      n(
        acervo,
        'SELECT COUNT(*) AS n FROM transicoes_de_participacao t JOIN identificadores i ON i.id = t.identificador_id WHERE i.valor = ?',
        OPACO,
      ),
      1,
    );
  } finally {
    c.limpar();
  }
});

test('o Identificador que algo mais referencia nao e tocado: vira achado, com a tabela', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const s = semear(acervo);
    const ser = s.id(objeto({ id: OPACO, phoneNumber: NUMERO, admin: null }));
    s.t('E1', ser, 'entrou', 1000);
    acervo.db
      .prepare(
        "INSERT INTO participacoes (conversa_id, identificador_id, observada_em) VALUES (?, ?, '2026-09-01T00:00:00.000Z')",
      )
      .run(s.conversa, ser);
    const antes = contagens(acervo);
    const r = reapontarIdentificadoresSerializados(acervo, { comEfeito: true });
    assert.equal(r.referenciados.length, 1);
    assert.deepEqual(Object.keys(r.referenciados[0]!.outras), ['participacoes']);
    assert.equal(n(acervo, 'SELECT COUNT(*) AS n FROM identificadores WHERE id = ?', ser), 1);
    assert.equal(r.gravou, false);
    assert.equal(contagens(acervo), antes, 'nem par, nem Operacao');
  } finally {
    c.limpar();
  }
});

test('o par existente do id vence (so o par do nono digito do canonico se aprende, #1531)', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const s = semear(acervo);
    const ser = s.id(objeto({ id: OPACO, phoneNumber: NUMERO, admin: null }));
    aprenderCorrespondencia(acervo, {
      fonte: 'whatsapp',
      alternativo: OPACO,
      canonico: '5565992220002@s.whatsapp.net',
    });
    s.t('E1', ser, 'entrou', 1000);
    const r = reapontarIdentificadoresSerializados(acervo, { comEfeito: true });
    // O Identificador do canonico nasce aqui: sem o par do nono digito ele ficaria com uma forma so, sem par (#1531).
    assert.equal(r.paresAprendidos, 1);
    assert.equal(
      resolverEndereco(acervo, 'whatsapp', '556592220002@s.whatsapp.net'),
      '5565992220002@s.whatsapp.net',
    );
    assert.equal(resolverEndereco(acervo, 'whatsapp', OPACO), '5565992220002@s.whatsapp.net');
    assert.equal(
      n(
        acervo,
        "SELECT COUNT(*) AS n FROM identificadores WHERE valor = '5565992220002@s.whatsapp.net'",
      ),
      1,
    );
    assert.equal(
      n(acervo, 'SELECT COUNT(*) AS n FROM identificadores WHERE valor = ?', NUMERO),
      0,
      'o telefone do objeto nao vence o par',
    );
  } finally {
    c.limpar();
  }
});

test('o conflito de verdade (o id e canonico de outro par) vira achado, nada e tocado e nada lanca', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const s = semear(acervo);
    const ser = s.id(objeto({ id: OPACO, phoneNumber: NUMERO, admin: null }));
    aprenderCorrespondencia(acervo, {
      fonte: 'whatsapp',
      alternativo: '307654321098765@lid',
      canonico: OPACO,
    });
    s.t('E1', ser, 'entrou', 1000);
    const antes = contagens(acervo);
    const r = reapontarIdentificadoresSerializados(acervo, { comEfeito: true });
    assert.equal(r.conflitos.length, 1);
    assert.equal(r.conflitos[0]!.motivo, 'id-e-canonico-de-outro-par');
    assert.equal(r.gravou, false);
    assert.equal(contagens(acervo), antes);
  } finally {
    c.limpar();
  }
});

test('o telefone do objeto que ja e alternativa de um par vai ao canonico dele, e so o par do opaco se aprende', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const s = semear(acervo);
    const ser = s.id(objeto({ id: OPACO, phoneNumber: NUMERO, admin: null }));
    const CANONICO = '556591110001@s.whatsapp.net';
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: NUMERO, canonico: CANONICO });
    s.t('E1', ser, 'entrou', 1000);
    const ensaio = reapontarIdentificadoresSerializados(acervo, { comEfeito: false });
    assert.equal(ensaio.paresAAprender, 1);
    const r = reapontarIdentificadoresSerializados(acervo, { comEfeito: true });
    assert.equal(r.conflitos.length, 0);
    assert.equal(r.paresAprendidos, 1);
    assert.equal(resolverEndereco(acervo, 'whatsapp', OPACO), CANONICO);
    assert.equal(n(acervo, 'SELECT COUNT(*) AS n FROM identificadores WHERE valor = ?', NUMERO), 0);
  } finally {
    c.limpar();
  }
});

test('o objeto ilegivel e achado e nada e tocado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const s = semear(acervo);
    s.id('{"id":"nao e endereco"}');
    const antes = contagens(acervo);
    const r = reapontarIdentificadoresSerializados(acervo, { comEfeito: true });
    assert.equal(r.ilegiveis, 1);
    assert.equal(r.gravou, false);
    assert.equal(contagens(acervo), antes);
  } finally {
    c.limpar();
  }
});

test('o limite corta os legiveis depois da ordem, e a segunda passada leva o resto', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const s = semear(acervo);
    for (let i = 0; i < 3; i += 1)
      s.t(`E${i}`, s.id(objeto({ id: `20876543210987${i}@lid`, admin: null })), 'entrou', 1000);
    assert.throws(
      () => reapontarIdentificadoresSerializados(acervo, { comEfeito: false, limite: 0 }),
      RangeError,
    );
    const primeira = reapontarIdentificadoresSerializados(acervo, { comEfeito: true, limite: 2 });
    assert.equal(primeira.serializados, 3, 'conta todos os lidos');
    assert.equal(primeira.serializadosRemovidos, 2);
    const segunda = reapontarIdentificadoresSerializados(acervo, { comEfeito: true });
    assert.equal(segunda.serializadosRemovidos, 1);
  } finally {
    c.limpar();
  }
});

test('o desfazer da Operacao devolve a fotografia inteira (Transicoes, Identificadores e os pares)', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const s = semear(acervo);
    const ser = s.id(objeto({ id: OPACO, phoneNumber: NUMERO, admin: null }));
    const sem = s.id(objeto({ id: '208765432109876@lid', admin: null }));
    const destinoExistente = s.id(NUMERO);
    s.t('E1', ser, 'entrou', 1000);
    s.t('E2', ser, 'saiu', 2000);
    s.t('E1', destinoExistente, 'entrou', 1000);
    s.t('E3', sem, 'entrou', 3000);
    const foto = (): string =>
      JSON.stringify([
        acervo.db
          .prepare('SELECT id, fonte, valor, visto_em FROM identificadores ORDER BY id')
          .all(),
        acervo.db.prepare('SELECT * FROM transicoes_de_participacao ORDER BY id').all(),
        acervo.db
          .prepare(
            'SELECT fonte, alternativo, canonico FROM correspondencias_de_endereco ORDER BY alternativo',
          )
          .all(),
        acervo.db.prepare('SELECT seq, autor_id, alvo_id FROM chegadas ORDER BY seq').all(),
      ]);
    const antes = foto();
    const r = reapontarIdentificadoresSerializados(acervo, { comEfeito: true });
    assert.notEqual(foto(), antes);
    assert.equal(r.paresAprendidos, 2);
    assert.equal(r.identificadoresCriados, 1, 'o endereco opaco sem telefone');
    assert.equal(
      n(acervo, 'SELECT COUNT(*) AS n FROM correspondencias_de_endereco'),
      2,
      'os pares do nono digito e do opaco',
    );
    const d = desfazerOperacao(acervo, r.operacaoId!);
    assert.equal(d.recusados.length, 0, JSON.stringify(d.recusados));
    assert.equal(foto(), antes, 'com a Chegada presente e intocada');
  } finally {
    c.limpar();
  }
});

test('o lote parcial leva primeiro o valor com telefone, mesmo quando o sem telefone vem antes na ordem de id', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const s = semear(acervo);
    const fixo = (id: string, valor: string): string => {
      acervo.db
        .prepare(
          "INSERT INTO identificadores (id, fonte, valor, visto_em) VALUES (?, 'whatsapp', ?, '2026-09-08T00:00:00.000Z')",
        )
        .run(id, valor);
      return id;
    };
    const sem = fixo('id-1', objeto({ id: OPACO, admin: null }));
    const com = fixo('id-2', objeto({ id: OPACO, phoneNumber: NUMERO, admin: null }));
    s.t('E1', sem, 'entrou', 1000);
    s.t('E2', com, 'saiu', 2000);
    const primeira = reapontarIdentificadoresSerializados(acervo, { comEfeito: true, limite: 1 });
    assert.equal(primeira.serializadosRemovidos, 1);
    assert.equal(
      n(acervo, 'SELECT COUNT(*) AS n FROM identificadores WHERE id = ?', com),
      0,
      'o com telefone foi primeiro',
    );
    reapontarIdentificadoresSerializados(acervo, { comEfeito: true, limite: 1 });
    assert.equal(
      n(acervo, 'SELECT COUNT(*) AS n FROM identificadores WHERE valor = ?', OPACO),
      0,
      'nenhum Identificador do opaco nasceu',
    );
  } finally {
    c.limpar();
  }
});

// #1519 (decisao do Titular, 15/11/2026): o lote nao pode prender o ouvinte. Cada Identificador e UMA transacao, e entre dois
// itens o lock esta livre e ha uma pausa para o escritor concorrente ter vez (medido: sem a pausa, 10 de 182 escritas do ouvinte
// falharam por banco ocupado; com o indice e a pausa de 100 ms, 0 de 2.464 e a maior espera de 288 ms; com 20 ms a maior espera ainda
// chegou a 3,9 s, perto dos 5 s do produto).
function trio(acervo: Acervo) {
  const s = semear(acervo);
  for (let i = 0; i < 3; i += 1) {
    const ser = s.id(objeto({ id: `${100 + i}0000000000000@lid`, admin: null }));
    s.t(`P${i}`, ser, 'entrou', 1000 + i);
  }
}

test('entre dois itens o lock esta livre: uma escrita de OUTRA conexao nao falha por banco ocupado', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Padme');
    trio(acervo);
    const outra = abrirAcervo(join(c.raiz, 'acervos'), id as never);
    outra.db.pragma('busy_timeout = 0'); // se o lote segurasse o lock entre os itens, a escrita falharia na hora
    let escritas = 0;
    try {
      const r = reapontarIdentificadoresSerializados(acervo, {
        comEfeito: true,
        pausaEntreItensMs: 0,
        ganchoDeTeste: {
          entreItens: () => {
            outra.db.prepare("UPDATE identificadores SET visto_em = '2026-11-15T00:00:00.000Z' WHERE substr(valor, 1, 1) <> '{'").run();
            escritas += 1;
          },
        },
      });
      assert.equal(r.serializadosRemovidos, 3);
      assert.equal(escritas, 2, 'o gancho roda entre os itens: 2 vezes para 3 itens, nunca depois do ultimo');
    } finally {
      outra.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('ha uma pausa entre os itens (100 ms por padrao) e a opcao a troca', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    trio(acervo);
    const t0 = Date.now();
    reapontarIdentificadoresSerializados(acervo, { comEfeito: true });
    const gasto = Date.now() - t0;
    assert.ok(gasto >= 190, `2 pausas de 100 ms (padrao) davam pelo menos ~200 ms; levou ${gasto} ms`);
  } finally {
    c.limpar();
  }
  const c2 = cenario();
  try {
    const { acervo } = c2.novoInquilino('Padme');
    trio(acervo);
    const t0 = Date.now();
    reapontarIdentificadoresSerializados(acervo, { comEfeito: true, pausaEntreItensMs: 60 });
    const gasto = Date.now() - t0;
    assert.ok(gasto >= 118, `2 pausas de 60 ms davam pelo menos ~120 ms; levou ${gasto} ms`);
  } finally {
    c2.limpar();
  }
});

test('a pausa invalida (negativa, fracionaria ou NaN) e recusada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    for (const pausaEntreItensMs of [-1, 1.5, Number.NaN]) {
      assert.throws(() => reapontarIdentificadoresSerializados(acervo, { comEfeito: false, pausaEntreItensMs }), RangeError);
    }
  } finally {
    c.limpar();
  }
});
