// tests/guarda-de-descartes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { EventoDescartado, MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';
import {
  TETO_PADRAO_DA_GUARDA,
  caminhoDaGuardaAnterior,
  estadoDaGuarda,
  guardarDescartes,
  tetoDaGuarda,
} from '../src/cli/guarda-de-descartes.js';

const AGORA = Date.parse('2026-10-07T12:00:00Z');

function pasta(): { caminho: string; limpar: () => void } {
  const raiz = mkdtempSync(join(tmpdir(), 'malote-guarda-'));
  return {
    caminho: join(raiz, 'ouvinte', 'c', 'descartados.jsonl'),
    limpar: () => rmSync(raiz, { recursive: true, force: true }),
  };
}

function descarte(id: string, motivo = 'protocolMessage', ruido = false, causa?: string): EventoDescartado {
  const evento: MensagemRecebida = {
    key: { remoteJid: '5511000000000@s.whatsapp.net', id, fromMe: false },
    messageTimestamp: 1_791_299_000,
    message: { [motivo]: { dado: 'TEXTO-SINTETICO' } },
  };
  return { motivo, ruido, evento, ...(causa !== undefined ? { causa } : {}) };
}

function linhasDe(caminho: string): { em: string; motivo: string; causa?: string; evento: MensagemRecebida }[] {
  return readFileSync(caminho, 'utf8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as never);
}

test('o teto: padrao, variavel valida e variavel invalida', () => {
  assert.equal(tetoDaGuarda({}), TETO_PADRAO_DA_GUARDA);
  assert.equal(tetoDaGuarda({ MALOTE_TETO_DA_GUARDA_BYTES: '1000' }), 1000);
  for (const ruim of ['abc', '0', '-5', '1.5', '']) {
    assert.equal(tetoDaGuarda({ MALOTE_TETO_DA_GUARDA_BYTES: ruim }), TETO_PADRAO_DA_GUARDA, ruim);
  }
});

test('grava uma linha por evento, com instante, motivo, causa e o evento cru', () => {
  const p = pasta();
  try {
    const n = guardarDescartes(
      p.caminho,
      [descarte('A1'), descarte('A2', 'recusado', false, 'instante no futuro')],
      AGORA,
      TETO_PADRAO_DA_GUARDA,
    );
    assert.equal(n, 2);
    const linhas = linhasDe(p.caminho);
    assert.equal(linhas.length, 2);
    assert.equal(linhas[0]?.em, '2026-10-07T12:00:00.000Z');
    assert.equal(linhas[0]?.motivo, 'protocolMessage');
    assert.equal(linhas[0]?.causa, undefined);
    assert.equal(linhas[0]?.evento.key.id, 'A1');
    assert.equal(linhas[1]?.causa, 'instante no futuro');
  } finally {
    p.limpar();
  }
});

test('RUIDO conhecido nao e guardado, e so ruido nao cria nem a pasta', () => {
  const p = pasta();
  try {
    const n = guardarDescartes(
      p.caminho,
      [descarte('R1', 'cifrada', true), descarte('R2', 'status', true)],
      AGORA,
      TETO_PADRAO_DA_GUARDA,
    );
    assert.equal(n, 0);
    assert.equal(existsSync(dirname(p.caminho)), false, 'criou a pasta sem ter o que guardar');
  } finally {
    p.limpar();
  }
});

test('um tipo NUNCA visto e guardado (a politica e por exclusao)', () => {
  const p = pasta();
  try {
    guardarDescartes(p.caminho, [descarte('N1', 'tipoNuncaVistoMessage')], AGORA, TETO_PADRAO_DA_GUARDA);
    assert.equal(linhasDe(p.caminho)[0]?.motivo, 'tipoNuncaVistoMessage');
  } finally {
    p.limpar();
  }
});

test('o arquivo nasce com modo 0600', () => {
  const p = pasta();
  try {
    guardarDescartes(p.caminho, [descarte('M1')], AGORA, TETO_PADRAO_DA_GUARDA);
    assert.equal(statSync(p.caminho).mode & 0o777, 0o600);
  } finally {
    p.limpar();
  }
});

test('rotaciona no teto, mantem so o atual e o anterior, e o disco tem limite', () => {
  const p = pasta();
  try {
    const teto = 700;
    let maiorLinha = 0;
    for (let i = 0; i < 12; i += 1) {
      guardarDescartes(p.caminho, [descarte(`E${i}`)], AGORA, teto);
      maiorLinha = Math.max(maiorLinha, readFileSync(p.caminho, 'utf8').split('\n').filter((l) => l !== '').pop()!.length + 1);
    }
    const anterior = caminhoDaGuardaAnterior(p.caminho);
    assert.ok(existsSync(anterior), 'nunca rotacionou');
    for (const arquivo of [p.caminho, anterior]) {
      assert.ok(statSync(arquivo).size < teto + maiorLinha, `${arquivo} passou do teto mais uma linha`);
    }
    const ids = [...linhasDe(anterior), ...linhasDe(p.caminho)].map((l) => l.evento.key.id);
    assert.ok(ids.length < 12, 'nada foi descartado pela rotacao');
    assert.equal(ids[ids.length - 1], 'E11', 'o evento mais recente tem de estar guardado');
  } finally {
    p.limpar();
  }
});

test('o teto vale POR LINHA: um lote grande tambem rotaciona', () => {
  const p = pasta();
  try {
    const teto = 700;
    guardarDescartes(p.caminho, Array.from({ length: 12 }, (_, i) => descarte(`L${i}`)), AGORA, teto);
    const anterior = caminhoDaGuardaAnterior(p.caminho);
    assert.ok(existsSync(anterior), 'o lote inteiro foi para um arquivo so');
    const brutas = (a: string): string[] => readFileSync(a, 'utf8').split('\n').filter((l) => l !== '');
    const maiorLinha = Math.max(...[...brutas(anterior), ...brutas(p.caminho)].map((l) => l.length + 1));
    for (const arquivo of [p.caminho, anterior]) {
      assert.ok(statSync(arquivo).size < teto + maiorLinha, `${arquivo} passou do teto mais uma linha`);
    }
  } finally {
    p.limpar();
  }
});

test('rotaciona EXATAMENTE quando o arquivo atinge o teto (>=, e nao >)', () => {
  const p = pasta();
  try {
    guardarDescartes(p.caminho, [descarte('T1')], AGORA, TETO_PADRAO_DA_GUARDA);
    const tamanho = statSync(p.caminho).size;
    guardarDescartes(p.caminho, [descarte('T2')], AGORA, tamanho);
    assert.ok(existsSync(caminhoDaGuardaAnterior(p.caminho)), 'nao rotacionou no teto exato');
    assert.deepEqual(linhasDe(p.caminho).map((l) => l.evento.key.id), ['T2']);
  } finally {
    p.limpar();
  }
});

test('estadoDaGuarda conta os eventos e os bytes dos dois arquivos', () => {
  const p = pasta();
  try {
    assert.deepEqual(estadoDaGuarda(p.caminho), { eventos: 0, bytes: 0 });
    for (let i = 0; i < 8; i += 1) guardarDescartes(p.caminho, [descarte(`S${i}`)], AGORA, 700);
    const esperado = [caminhoDaGuardaAnterior(p.caminho), p.caminho]
      .filter((a) => existsSync(a))
      .map((a) => ({ n: linhasDe(a).length, b: statSync(a).size }));
    assert.deepEqual(estadoDaGuarda(p.caminho), {
      eventos: esperado.reduce((s, x) => s + x.n, 0),
      bytes: esperado.reduce((s, x) => s + x.b, 0),
    });
  } finally {
    p.limpar();
  }
});
