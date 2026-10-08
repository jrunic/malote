// tests/reprocessar-descartados.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import type { MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { statSync } from 'node:fs';
import { TEL_DE_OUTRO, mudancaDeEtiqueta } from './ajuda/etiqueta-ao-vivo.js';
import { caminhoDaGuardaAnterior, reprocessarDescartados } from '../src/cli/guarda-de-descartes.js';

const AGORA = Date.parse('2026-10-07T12:00:00Z');
const INSTANTE = Math.floor((AGORA - 3_600_000) / 1000);
const DIRETA = '5511000000000@s.whatsapp.net';

const DOCUMENTO = { mimetype: 'text/csv', fileName: 'relatorio.csv', fileLength: '1024' };

function documentoComLegenda(id: string): MensagemRecebida {
  return {
    key: { remoteJid: DIRETA, id, fromMe: false },
    messageTimestamp: INSTANTE,
    message: { documentWithCaptionMessage: { message: { documentMessage: { ...DOCUMENTO, caption: 'Bom dia, segue' } } } },
  };
}

function aindaDescartado(id: string): MensagemRecebida {
  return { key: { remoteJid: DIRETA, id, fromMe: false }, messageTimestamp: INSTANTE, message: { tipoNuncaVistoMessage: { x: 1 } } };
}

function linha(evento: MensagemRecebida, motivo: string): string {
  return JSON.stringify({ em: '2026-09-01T00:00:00.000Z', motivo, evento });
}

function cenarioDaGuarda() {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular de Teste');
  const raiz = mkdtempSync(join(tmpdir(), 'malote-reproc-'));
  const caminho = join(raiz, 'descartados.jsonl');
  const n = (tabela: string): number =>
    (acervo.db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number }).n;
  return {
    acervo, caminho, n,
    limpar: () => { rmSync(raiz, { recursive: true, force: true }); c.limpar(); },
  };
}

const cfg = CFG_WHATSAPP;

test('ponta a ponta: o documento com legenda guardado ANTES da correcao vira Mensagem e Anexo, e sai da guarda', () => {
  const g = cenarioDaGuarda();
  try {
    writeFileSync(g.caminho, `${linha(documentoComLegenda('DOC1'), 'documentWithCaptionMessage')}\n`);
    const r = reprocessarDescartados(g.acervo, g.caminho, cfg, AGORA);
    assert.deepEqual(r, { lidos: 1, gravados: 1, mantidos: 0 });
    assert.equal(g.n('mensagens'), 1);
    assert.equal(g.n('anexos'), 1);
    assert.equal(existsSync(g.caminho), false, 'a guarda esvaziada deveria sumir');
  } finally {
    g.limpar();
  }
});

test('o que continua descartado FICA, na linha original, e a guarda NAO e realimentada', () => {
  const g = cenarioDaGuarda();
  try {
    const original = `${linha(aindaDescartado('X1'), 'tipoNuncaVistoMessage')}\n`;
    writeFileSync(g.caminho, original);
    const r = reprocessarDescartados(g.acervo, g.caminho, cfg, AGORA);
    assert.deepEqual(r, { lidos: 1, gravados: 0, mantidos: 1 });
    assert.equal(readFileSync(g.caminho, 'utf8'), original, 'a guarda mudou: foi realimentada ou reescrita');
    assert.equal(g.n('mensagens'), 0);
  } finally {
    g.limpar();
  }
});

test('mistura: sai o que passou, fica o que nao, e o anterior tambem e processado', () => {
  const g = cenarioDaGuarda();
  try {
    const anterior = caminhoDaGuardaAnterior(g.caminho);
    writeFileSync(anterior, `${linha(documentoComLegenda('A1'), 'documentWithCaptionMessage')}\n`);
    writeFileSync(
      g.caminho,
      `${linha(aindaDescartado('B1'), 'tipoNuncaVistoMessage')}\n${linha(documentoComLegenda('B2'), 'documentWithCaptionMessage')}\n`,
    );
    const r = reprocessarDescartados(g.acervo, g.caminho, cfg, AGORA);
    assert.deepEqual(r, { lidos: 3, gravados: 2, mantidos: 1 });
    assert.equal(g.n('mensagens'), 2);
    assert.equal(existsSync(anterior), false);
    const restantes = readFileSync(g.caminho, 'utf8').split('\n').filter((l) => l !== '');
    assert.equal(restantes.length, 1);
    assert.equal((JSON.parse(restantes[0]!) as { evento: MensagemRecebida }).evento.key.id, 'B1');
  } finally {
    g.limpar();
  }
});

test('rodar duas vezes seguidas NAO cria linha nova no Acervo', () => {
  const g = cenarioDaGuarda();
  try {
    const conteudo = `${linha(documentoComLegenda('DOC1'), 'documentWithCaptionMessage')}\n`;
    writeFileSync(g.caminho, conteudo);
    reprocessarDescartados(g.acervo, g.caminho, cfg, AGORA);
    const depois = { m: g.n('mensagens'), a: g.n('anexos') };
    writeFileSync(g.caminho, conteudo); // o mesmo evento de volta, como depois de uma morte no meio
    reprocessarDescartados(g.acervo, g.caminho, cfg, AGORA);
    assert.deepEqual({ m: g.n('mensagens'), a: g.n('anexos') }, depois);
  } finally {
    g.limpar();
  }
});

test('ORDEM: o Acervo e gravado ANTES de a guarda ser reescrita (morte no meio)', () => {
  const g = cenarioDaGuarda();
  try {
    const conteudo = `${linha(documentoComLegenda('DOC1'), 'documentWithCaptionMessage')}\n`;
    writeFileSync(g.caminho, conteudo);
    assert.throws(
      () => reprocessarDescartados(g.acervo, g.caminho, cfg, AGORA, () => { throw new Error('morreu antes de reescrever'); }),
      /morreu antes de reescrever/,
    );
    assert.equal(g.n('mensagens'), 1, 'o Acervo tem de ter recebido antes da reescrita');
    assert.equal(g.n('anexos'), 1);
    assert.equal(readFileSync(g.caminho, 'utf8'), conteudo, 'a guarda tem de estar intacta');
    // A rodada seguinte descarta a repeticao pela unicidade e esvazia a guarda.
    const r = reprocessarDescartados(g.acervo, g.caminho, cfg, AGORA);
    assert.equal(r.gravados, 1);
    assert.equal(g.n('mensagens'), 1);
    assert.equal(g.n('anexos'), 1, 'a repeticao duplicou o Anexo: a #1186 nao esta na base?');
    assert.equal(existsSync(g.caminho), false);
  } finally {
    g.limpar();
  }
});

test('linha ilegivel ou sem evento e MANTIDA, nunca descartada', () => {
  const g = cenarioDaGuarda();
  try {
    const lixo = '{"em":"2026-09-01T00:00:00.000Z","motivo":"x","evento":';
    const semEvento = JSON.stringify({ motivo: 'y' });
    writeFileSync(g.caminho, `${lixo}\n${semEvento}\n`);
    const r = reprocessarDescartados(g.acervo, g.caminho, cfg, AGORA);
    assert.deepEqual(r, { lidos: 2, gravados: 0, mantidos: 2 });
    assert.equal(readFileSync(g.caminho, 'utf8'), `${lixo}\n${semEvento}\n`);
  } finally {
    g.limpar();
  }
});

test('o descartado que mora so no ANTERIOR nao e copiado para o atual (nao realimenta)', () => {
  const g = cenarioDaGuarda();
  try {
    const anterior = caminhoDaGuardaAnterior(g.caminho);
    const original = `${linha(aindaDescartado('P1'), 'tipoNuncaVistoMessage')}\n`;
    writeFileSync(anterior, original);
    reprocessarDescartados(g.acervo, g.caminho, cfg, AGORA);
    assert.equal(existsSync(g.caminho), false, 'o atual ganhou copia do que so estava no anterior');
    assert.equal(readFileSync(anterior, 'utf8'), original);
  } finally {
    g.limpar();
  }
});

test('Etiqueta guardada sai da guarda: ela grava SEM Mensagem (gravados = 0)', () => {
  const g = cenarioDaGuarda();
  try {
    const etiqueta = mudancaDeEtiqueta({ id: 'ET1', texto: 'x', autorPn: TEL_DE_OUTRO });
    writeFileSync(g.caminho, `${linha(etiqueta, 'etiqueta-sem-autor')}\n`);
    const r = reprocessarDescartados(g.acervo, g.caminho, cfg, AGORA);
    assert.deepEqual(r, { lidos: 1, gravados: 1, mantidos: 0 });
    assert.equal(g.n('etiquetas_de_participacao'), 1);
    assert.equal(existsSync(g.caminho), false);
  } finally {
    g.limpar();
  }
});

test('a guarda reescrita pelo reprocessar continua 0600 (conversa em claro)', () => {
  const g = cenarioDaGuarda();
  try {
    writeFileSync(
      g.caminho,
      `${linha(aindaDescartado('K1'), 'tipoNuncaVistoMessage')}\n${linha(documentoComLegenda('K2'), 'documentWithCaptionMessage')}\n`,
      { mode: 0o644 },
    );
    reprocessarDescartados(g.acervo, g.caminho, cfg, AGORA);
    assert.equal(statSync(g.caminho).mode & 0o777, 0o600);
  } finally {
    g.limpar();
  }
});

test('sem guarda nao ha o que fazer', () => {
  const g = cenarioDaGuarda();
  try {
    assert.deepEqual(reprocessarDescartados(g.acervo, g.caminho, cfg, AGORA), { lidos: 0, gravados: 0, mantidos: 0 });
  } finally {
    g.limpar();
  }
});
