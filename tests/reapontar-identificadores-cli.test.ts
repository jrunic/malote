import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { instalacaoComChave, instalacaoTemporaria, rodar } from './ajuda/instalacao.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import {
  registrarConversa,
  registrarIdentificador,
  registrarTransicao,
} from '../src/nucleo/escrita.js';

// #1519: `malote identidade reapontar-identificadores-serializados`. Ensaio por padrao; a escrita pede --com-efeito --confirmo.

const BASE = (inquilino: string): string[] => [
  'identidade',
  'reapontar-identificadores-serializados',
  '--inquilino',
  inquilino,
];
const SERIALIZADO = '{"id":"109876543210987@lid","admin":null}';
/** Nada de endereco nem do valor serializado na saida. */
const VAZAMENTO = /@lid|whatsapp\.net|109876543210987|admin/;

function instalacao(): { raiz: string; inquilino: string; limpar: () => void } {
  const { raiz, limpar } = instalacaoTemporaria();
  const { inquilino } = instalacaoComChave(raiz);
  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino as never);
  try {
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: '120363000000000001@g.us',
      coletiva: true,
    });
    const id = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SERIALIZADO }).id;
    registrarTransicao(acervo, {
      origemDaChegada: 'importacao',
      conversaId: conversa,
      identificadorId: id,
      natureza: 'entrou',
      ocorridaEm: 1000,
      fonte: 'whatsapp',
      idExterno: 'E1',
      codigoDaFonte: '',
    });
  } finally {
    acervo.fechar();
  }
  return { raiz, inquilino, limpar };
}

const contar = (raiz: string, inquilino: string): number => {
  const a = abrirAcervo(join(raiz, 'acervos'), inquilino as never);
  try {
    return (
      a.db
        .prepare("SELECT COUNT(*) AS n FROM identificadores WHERE substr(valor, 1, 1) = '{'")
        .get() as { n: number }
    ).n;
  } finally {
    a.fechar();
  }
};

test('o ensaio diz o que faria, em contagens, e nao escreve', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const r = rodar(raiz, BASE(inquilino));
    assert.equal(r.codigo, 0, r.saida);
    assert.match(
      r.saida,
      /^Ensaio: 1 Identificador\(es\) serializado\(s\); 1 Transicao\(oes\) a reapontar, 0 par\(es\) a aprender, 1 Identificador\(es\) a criar\.$/m,
    );
    assert.match(
      r.saida,
      /1 Chegada\(s\) citam os Identificadores do plano; a Operacao nao as toca\./,
    );
    assert.match(r.saida, /Nada foi escrito\. Repita com --com-efeito --confirmo\./);
    assert.match(r.saida, /A Operacao nao toca nas Chegadas\./);
    assert.doesNotMatch(r.saida, VAZAMENTO);
    assert.equal(contar(raiz, inquilino), 1);
  } finally {
    limpar();
  }
});

test('--com-efeito sem --confirmo recusa e nada e escrito', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const r = rodar(raiz, [...BASE(inquilino), '--com-efeito']);
    assert.notEqual(r.codigo, 0);
    assert.match(r.saida, /Repita o comando com --confirmo para executar\./);
    assert.equal(contar(raiz, inquilino), 1);
  } finally {
    limpar();
  }
});

test('com efeito reaponta e remove; a saida --json nao traz endereco, nome nem texto; o --limite invalido e erro de uso', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    assert.equal(
      rodar(raiz, [...BASE(inquilino), '--limite', '0']).codigo,
      2,
      '--limite invalido e erro de uso',
    );
    const r = rodar(raiz, [...BASE(inquilino), '--com-efeito', '--confirmo', '--json']);
    assert.equal(r.codigo, 0, r.saida);
    assert.doesNotMatch(r.saida, VAZAMENTO);
    const json = JSON.parse(r.saida) as {
      serializadosRemovidos: number;
      operacaoId: string | null;
      oQueODesfazerCobre: string;
    };
    assert.equal(json.serializadosRemovidos, 1);
    assert.notEqual(json.operacaoId, null);
    assert.match(json.oQueODesfazerCobre, /NAO devolve/);
    assert.equal(contar(raiz, inquilino), 0);
  } finally {
    limpar();
  }
});

test('com efeito, em texto, diz o que fez e como desfazer', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const r = rodar(raiz, [...BASE(inquilino), '--com-efeito', '--confirmo']);
    assert.equal(r.codigo, 0, r.saida);
    assert.match(
      r.saida,
      /^Reapontado: 1 Transicao\(oes\) reapontada\(s\), 0 fundida\(s\), 1 Identificador\(es\) removido\(s\)/m,
    );
    assert.match(
      r.saida,
      /Para desfazer: malote operacao desfazer \S+ --inquilino \S+ --chave <valor> --com-efeito --confirmo/,
    );
    assert.doesNotMatch(r.saida, VAZAMENTO);
  } finally {
    limpar();
  }
});

test('a ajuda lista o comando', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    assert.match(
      rodar(raiz, ['--ajuda']).saida,
      /identidade reapontar-identificadores-serializados --inquilino <id>/,
    );
  } finally {
    limpar();
  }
});
