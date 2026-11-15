import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { emOperacao } from '../src/nucleo/trilha.js';
import { desfazerOperacao } from '../src/nucleo/desfazer.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { resolverRetroativamente } from '../src/nucleo/resolucao-retroativa.js';
import { criarPessoa } from '../src/nucleo/identidade.js';
import {
  registrarConversa,
  registrarIdentificador,
  registrarTransicao,
} from '../src/nucleo/escrita.js';
import {
  inventarioEmLote,
  listarIdentificadoresPorPrefixo,
  reapontarTransicoes,
  referenciasBaratas,
  removerIdentificadorSerializado,
} from '../src/nucleo/reapontar-transicoes.js';
import type { Acervo } from '../src/nucleo/acervo.js';

const SERIALIZADO =
  '{"id":"109876543210987@lid","phoneNumber":"5565991110001@s.whatsapp.net","admin":null}';
const DESTINO = '5565991110001@s.whatsapp.net';
const NATUREZA = {
  natureza: 'reapontar-identificadores-serializados',
  reversibilidade: 'por-efeito',
} as const;

function cena(acervo: Acervo) {
  const conversa = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: '120363000000000001@g.us',
    coletiva: true,
  });
  const serializado = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SERIALIZADO }).id;
  const destino = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: DESTINO }).id;
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
  t('E1', serializado, 'entrou', 1000);
  t('E2', serializado, 'saiu', 2000);
  t('E1', destino, 'entrou', 1000); // o MESMO evento ja gravado sob o destino: colide com a E1 do serializado
  return { conversa, serializado, destino };
}
const n = (acervo: Acervo, sql: string, ...a: unknown[]): number =>
  (acervo.db.prepare(sql).get(...a) as { n: number }).n;

test('reaponta o que nao colide, funde o que colide e conserva a soma', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const { serializado, destino } = cena(acervo);
    const antes = n(
      acervo,
      'SELECT COUNT(*) AS n FROM transicoes_de_participacao WHERE identificador_id = ?',
      serializado,
    );
    let r = { reapontadas: 0, fundidas: 0 };
    emOperacao(acervo, NATUREZA, (op) => {
      r = reapontarTransicoes(acervo, { de: serializado, para: destino }, op);
    });
    assert.deepEqual(r, { reapontadas: 1, fundidas: 1 });
    assert.equal(r.reapontadas + r.fundidas, antes);
    assert.equal(
      n(
        acervo,
        'SELECT COUNT(*) AS n FROM transicoes_de_participacao WHERE identificador_id = ?',
        serializado,
      ),
      0,
    );
    assert.equal(
      n(
        acervo,
        'SELECT COUNT(*) AS n FROM transicoes_de_participacao WHERE identificador_id = ?',
        destino,
      ),
      2,
    );
  } finally {
    c.limpar();
  }
});

test('a listagem por prefixo pagina por id e so traz a Fonte e o prefixo pedidos', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const { serializado } = cena(acervo);
    const outro = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '{"id":"208765432109876@lid"}',
    }).id;
    registrarIdentificador(acervo, { fonte: 'instagram', valor: '{"id":"x"}' });
    const todos = listarIdentificadoresPorPrefixo(acervo, 'whatsapp', '{', '', 10).map((i) => i.id);
    assert.deepEqual(todos, [serializado, outro].sort());
    const primeira = listarIdentificadoresPorPrefixo(acervo, 'whatsapp', '{', '', 1);
    assert.equal(primeira.length, 1);
    const segunda = listarIdentificadoresPorPrefixo(acervo, 'whatsapp', '{', primeira[0]!.id, 1);
    assert.deepEqual(
      segunda.map((i) => i.id),
      todos.slice(1),
    );
  } finally {
    c.limpar();
  }
});

test('o inventario em lote conta Transicoes e Chegadas e lista so o que a Operacao nao sabe mover', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const { serializado, conversa } = cena(acervo);
    const inv = inventarioEmLote(acervo, [serializado]).get(serializado)!;
    assert.equal(inv.transicoes, 2);
    assert.equal(
      inv.chegadas,
      2,
      'a Chegada de cada Transicao cita o membro: informacao, nunca recusa',
    );
    assert.deepEqual(inv.outras, {});
    acervo.db
      .prepare(
        "INSERT INTO participacoes (conversa_id, identificador_id, observada_em) VALUES (?, ?, '2026-09-01T00:00:00.000Z')",
      )
      .run(conversa, serializado);
    assert.deepEqual(
      Object.keys(inventarioEmLote(acervo, [serializado]).get(serializado)!.outras),
      ['participacoes'],
    );
    assert.deepEqual(referenciasBaratas(acervo, serializado), { participacoes: 1 });
  } finally {
    c.limpar();
  }
});

test('o inventario conta o desvinculo e a citacao, que a remocao nao varre sob o lock', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const { serializado, conversa } = cena(acervo);
    const pessoa = criarPessoa(acervo);
    acervo.db
      .prepare(
        'INSERT INTO desvinculos (id, pessoa_id, identificador_id, fonte, valor, procedencia, desvinculado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'dv-1',
        pessoa,
        serializado,
        'whatsapp',
        SERIALIZADO,
        'material',
        '2026-09-01T00:00:00.000Z',
      );
    acervo.db
      .prepare(
        "INSERT INTO mensagens (id, conversa_id, fonte, id_externo, ocorrida_em, citada_autor_id) VALUES ('m-1', ?, 'whatsapp', 'X1', 1000, ?)",
      )
      .run(conversa, serializado);
    const outras = inventarioEmLote(acervo, [serializado]).get(serializado)!.outras;
    assert.deepEqual(outras, { desvinculos: 1, 'mensagens.citada_autor': 1 });
    assert.ok(
      !('mensagens.citada_autor' in referenciasBaratas(acervo, serializado)),
      'a releitura sob o lock nao varre a citacao',
    );
  } finally {
    c.limpar();
  }
});

test('o Identificador serializado so sai quando nada que a Operacao nao move o referencia; a Chegada fica e e restaurada pelo desfazer', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const { serializado, destino } = cena(acervo);
    const chegadasAntes = n(
      acervo,
      'SELECT COUNT(*) AS n FROM chegadas WHERE autor_id = ?',
      serializado,
    );
    assert.equal(chegadasAntes, 2);
    const operacaoId = emOperacao(acervo, NATUREZA, (op) => {
      assert.equal(
        removerIdentificadorSerializado(acervo, serializado, op),
        'em-uso',
        'as Transicoes ainda pendem dele',
      );
      reapontarTransicoes(acervo, { de: serializado, para: destino }, op);
      assert.equal(
        removerIdentificadorSerializado(acervo, serializado, op),
        'removido',
        'a Chegada nao conta',
      );
      assert.equal(removerIdentificadorSerializado(acervo, serializado, op), 'ja-nao-existe');
      return op.id;
    });
    assert.equal(
      n(acervo, 'SELECT COUNT(*) AS n FROM identificadores WHERE id = ?', serializado),
      0,
    );
    assert.equal(
      n(acervo, 'SELECT COUNT(*) AS n FROM chegadas WHERE autor_id = ?', serializado),
      chegadasAntes,
      'a Chegada nao e reescrita',
    );
    const r = desfazerOperacao(acervo, operacaoId);
    assert.equal(r.recusados.length, 0, JSON.stringify(r.recusados));
    assert.equal(
      n(
        acervo,
        'SELECT COUNT(*) AS n FROM identificadores WHERE id = ? AND valor = ?',
        serializado,
        SERIALIZADO,
      ),
      1,
      'o mesmo id volta',
    );
    assert.equal(
      n(
        acervo,
        'SELECT COUNT(*) AS n FROM transicoes_de_participacao WHERE identificador_id = ?',
        serializado,
      ),
      2,
    );
  } finally {
    c.limpar();
  }
});

test('o desfazer devolve a fotografia inteira: Identificador, Transicoes fundidas e reapontadas', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const { serializado, destino } = cena(acervo);
    const fotografia = (): string =>
      JSON.stringify([
        acervo.db
          .prepare('SELECT id, fonte, valor, visto_em FROM identificadores ORDER BY id')
          .all(),
        acervo.db.prepare('SELECT * FROM transicoes_de_participacao ORDER BY id').all(),
      ]);
    const antes = fotografia();
    const operacaoId = emOperacao(acervo, NATUREZA, (op) => {
      reapontarTransicoes(acervo, { de: serializado, para: destino }, op);
      removerIdentificadorSerializado(acervo, serializado, op);
      return op.id;
    });
    assert.notEqual(fotografia(), antes);
    const r = desfazerOperacao(acervo, operacaoId);
    assert.equal(r.recusados.length, 0, JSON.stringify(r.recusados));
    assert.equal(r.desfeitos, 3);
    assert.equal(fotografia(), antes);
  } finally {
    c.limpar();
  }
});

test('o desfazer recusa o que mudou depois: a Transicao reapontada que ja saiu do destino fica onde esta', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const { serializado, destino } = cena(acervo);
    const operacaoId = emOperacao(acervo, NATUREZA, (op) => {
      reapontarTransicoes(acervo, { de: serializado, para: destino }, op);
      return op.id;
    });
    const outro = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '5565922220002@s.whatsapp.net',
    }).id;
    acervo.db
      .prepare("UPDATE transicoes_de_participacao SET identificador_id = ? WHERE id_externo = 'E2'")
      .run(outro);
    const r = desfazerOperacao(acervo, operacaoId);
    assert.equal(r.recusados.length, 1, JSON.stringify(r.recusados));
    assert.equal(
      n(
        acervo,
        "SELECT COUNT(*) AS n FROM transicoes_de_participacao WHERE id_externo = 'E2' AND identificador_id = ?",
        outro,
      ),
      1,
    );
    assert.equal(
      n(
        acervo,
        "SELECT COUNT(*) AS n FROM transicoes_de_participacao WHERE id_externo = 'E1' AND identificador_id = ?",
        serializado,
      ),
      1,
      'a fundida volta',
    );
  } finally {
    c.limpar();
  }
});

test('o desfazer da fusao recusa quando o evento ja voltou a ser gravado sob o Identificador de origem', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const { serializado, destino, conversa } = cena(acervo);
    const operacaoId = emOperacao(acervo, NATUREZA, (op) => {
      reapontarTransicoes(acervo, { de: serializado, para: destino }, op);
      return op.id;
    });
    registrarTransicao(acervo, {
      origemDaChegada: 'ao-vivo',
      conversaId: conversa,
      identificadorId: serializado,
      natureza: 'entrou',
      ocorridaEm: 1000,
      fonte: 'whatsapp',
      idExterno: 'E1',
      codigoDaFonte: '',
    });
    const r = desfazerOperacao(acervo, operacaoId);
    assert.equal(r.recusados.length, 1, JSON.stringify(r.recusados));
    assert.match(r.recusados[0]!.causa, /evento ja esta gravado/);
  } finally {
    c.limpar();
  }
});

test('a Transicao reapontada pela resolucao retroativa tambem volta pelo caso novo do desfazer (mesma tabela e campo)', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: '120363000000000001@g.us',
      coletiva: true,
    });
    const alternativo = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '109876543210987@lid',
    }).id;
    registrarTransicao(acervo, {
      origemDaChegada: 'importacao',
      conversaId: conversa,
      identificadorId: alternativo,
      natureza: 'entrou',
      ocorridaEm: 1000,
      fonte: 'whatsapp',
      idExterno: 'R1',
      codigoDaFonte: '',
    });
    // O canonico ja gravado: a retroativa nao o cria (criar relata uma referencia que o desfazer nao percorre, e nao e o
    // que este teste mede).
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: DESTINO });
    aprenderCorrespondencia(acervo, {
      fonte: 'whatsapp',
      alternativo: '109876543210987@lid',
      canonico: DESTINO,
    });
    const r = resolverRetroativamente(acervo, { comEfeito: true });
    assert.equal(r.linhasRepontadas['transicoes_de_participacao'], 1);
    const d = desfazerOperacao(acervo, r.operacaoId as string);
    assert.equal(d.recusados.length, 0, JSON.stringify(d.recusados));
    assert.equal(
      n(
        acervo,
        'SELECT COUNT(*) AS n FROM transicoes_de_participacao WHERE identificador_id = ?',
        alternativo,
      ),
      1,
    );
  } finally {
    c.limpar();
  }
});
