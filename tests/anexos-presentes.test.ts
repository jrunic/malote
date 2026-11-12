import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { gravarArquivoDeAnexo } from '../src/nucleo/arquivo-de-anexo.js';
import { marcarConcluida, marcarPendente } from '../src/nucleo/transcricao.js';
import {
  SQL_ANEXOS_PRESENTES,
  listarAnexosDescartados,
  listarAnexosPresentes,
  resumoDePresentes,
} from '../src/nucleo/anexos-presentes.js';
import { descartarAnexo } from '../src/nucleo/escrita.js';

/** Depois do inicio da Fonte: a Mensagem recusa instante anterior a ele. */
const INSTANTE = Date.UTC(2023, 10, 14);

test('lista os Anexos presentes por cursor, com caminho, tamanho e Impressao de Anexo', () => {
  const c = cenario();
  try {
    const { acervo } = c.inquilinoComArquivos();
    const todos = listarAnexosPresentes(acervo, { limite: 10 });
    assert.equal(todos.length, 3);
    for (const a of todos) {
      assert.match(a.impressao, /^[0-9a-f]{64}$/);
      assert.ok(a.tamanho > 0);
      assert.ok(a.caminho.split('/').length === 5);
    }
    assert.deepEqual(
      todos.map((a) => a.id),
      [...todos.map((a) => a.id)].sort(),
      'em ordem de identificador',
    );

    const primeira = listarAnexosPresentes(acervo, { limite: 2 });
    const segunda = listarAnexosPresentes(acervo, { depoisDoId: primeira[1]?.id as string, limite: 2 });
    assert.equal(primeira.length, 2);
    assert.equal(segunda.length, 1);
    assert.deepEqual(
      [...primeira, ...segunda].map((a) => a.id),
      todos.map((a) => a.id),
      'as paginas juntas dao a lista inteira, sem repetir nem pular',
    );
  } finally {
    c.limpar();
  }
});

test('nao lista o Anexo que nunca foi obtido nem o descartado', () => {
  const c = cenario();
  try {
    const { acervo } = c.inquilinoComArquivos();
    const naoObtido = c.registrarAnexo(acervo, { tipo: 'image', ocorridaEm: INSTANTE + 5 });
    const presentes = listarAnexosPresentes(acervo, { limite: 10 });
    assert.ok(!presentes.some((a) => a.id === naoObtido));

    const aDescartar = presentes[0]?.id as string;
    descartarAnexo(acervo, aDescartar, { politica: 'teste' });
    const depois = listarAnexosPresentes(acervo, { limite: 10 });
    assert.ok(!depois.some((a) => a.id === aDescartar));
    assert.deepEqual(
      listarAnexosDescartados(acervo, { limite: 10 }).map((a) => a.id),
      [aDescartar],
    );
  } finally {
    c.limpar();
  }
});

test('o audio com transcricao por fazer e marcado, e o transcrito nao', () => {
  const c = cenario();
  try {
    const { acervo, destino } = c.inquilinoComArquivos();
    const novo = (conteudo: string): string => {
      const id = c.registrarAnexo(acervo, { tipo: 'audio', ocorridaEm: INSTANTE + 10 });
      gravarArquivoDeAnexo(acervo, {
        origemDaChegada: 'importacao',
        anexoId: id,
        destino,
        bytes: Buffer.from(conteudo),
      });
      return id;
    };
    const semLinha = novo('audio-sem-linha');
    const pendente = novo('audio-pendente');
    const concluido = novo('audio-concluido');
    marcarPendente(acervo, pendente);
    marcarPendente(acervo, concluido);
    marcarConcluida(acervo, concluido, 'texto', 'motor', 'modelo');

    const porId = new Map(listarAnexosPresentes(acervo, { limite: 20 }).map((a) => [a.id, a]));
    assert.equal(porId.get(semLinha)?.transcricaoPorFazer, true);
    assert.equal(porId.get(pendente)?.transcricaoPorFazer, true);
    assert.equal(porId.get(concluido)?.transcricaoPorFazer, false);
    // Imagem e video nunca sao "por fazer", mesmo sem linha de Transcricao.
    for (const a of porId.values()) {
      if (a.tipo !== 'audio') assert.equal(a.transcricaoPorFazer, false);
    }
  } finally {
    c.limpar();
  }
});

test('o resumo conta so os presentes com arquivo', () => {
  const c = cenario();
  try {
    const { acervo } = c.inquilinoComArquivos();
    c.registrarAnexo(acervo, { tipo: 'image', ocorridaEm: INSTANTE + 5 });
    const r = resumoDePresentes(acervo);
    assert.equal(r.anexos, 3);
    assert.ok(r.bytes > 0);
  } finally {
    c.limpar();
  }
});

test('o limite e validado', () => {
  const c = cenario();
  try {
    const { acervo } = c.inquilinoComArquivos();
    for (const ruim of [0, -1, 1.5, 5_001]) {
      assert.throws(() => listarAnexosPresentes(acervo, { limite: ruim }), RangeError);
    }
  } finally {
    c.limpar();
  }
});

test('o plano da consulta anda pela chave primaria e nao pelo indice de Presenca', () => {
  const c = cenario();
  try {
    const { acervo } = c.inquilinoComArquivos();
    const plano = acervo.db
      .prepare(`EXPLAIN QUERY PLAN ${SQL_ANEXOS_PRESENTES}`)
      .all('', 10) as Array<{ detail: string }>;
    const texto = plano.map((p) => p.detail).join('\n');
    assert.ok(!texto.includes('idx_anexos_presenca'), texto);
    assert.ok(!texto.includes('USE TEMP B-TREE FOR ORDER BY'), `ordenou fora do indice:\n${texto}`);
  } finally {
    c.limpar();
  }
});
