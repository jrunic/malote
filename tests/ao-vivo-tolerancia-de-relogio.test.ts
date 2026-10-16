import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { paraDrenar } from './ajuda/drenagem.js';
import { receberEvento, type MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { drenar } from '../src/cli/ouvir.js';
import { derramar } from '../src/cli/derrame.js';
import { reprocessarDescartados } from '../src/cli/guarda-de-descartes.js';
import type { Acervo } from '../src/nucleo/acervo.js';

// #1204: a recepcao ao vivo tolera um instante ate 5 s a frente do relogio local. O instante gravado e o DECLARADO.
// A tolerancia vive em `receberEvento`, ponto comum aos tres chamadores (o lote do ouvinte, a drenagem do derrame e o
// reprocessamento dos descartados), e os tres a recebem.

const DIRETA = '5511900000001@s.whatsapp.net';
// O caso MEDIDO pela espiga: o evento chegou em 20:12:03.835 com o instante em 20:12:04.000 (165 ms a frente).
const AGORA = Date.parse('2026-10-13T20:12:03.835Z');
// Alinhado ao segundo cheio, para a borda de 5 s ser exata (o instante da Fonte tem resolucao de segundo).
const AGORA_REDONDO = Date.parse('2026-10-13T20:12:00.000Z');

function texto(id: string, segundos: number): MensagemRecebida {
  return { key: { remoteJid: DIRETA, id, fromMe: false }, messageTimestamp: segundos, message: { conversation: 'oi' } };
}

function ocorridas(acervo: Acervo): number[] {
  return (acervo.db.prepare('SELECT ocorrida_em FROM mensagens').all() as Array<{ ocorrida_em: number }>).map((l) => l.ocorrida_em);
}

function contar(acervo: Acervo, tabela: string): number {
  return (acervo.db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number }).n;
}

function comAcervo(corpo: (acervo: Acervo) => void): void {
  const c = cenario();
  try {
    corpo(c.novoInquilino('Leia Organa').acervo);
  } finally {
    c.limpar();
  }
}

test('o caso medido (165 ms a frente) entra, e o instante gravado e EXATAMENTE o declarado', () => {
  comAcervo((acervo) => {
    const declarado = Math.floor(AGORA / 1000) + 1;
    const r = receberEvento(acervo, [texto('M1', declarado)], { agora: AGORA, configuracao: CFG_WHATSAPP });
    assert.deepEqual(r.recusados, []);
    assert.deepEqual(ocorridas(acervo), [declarado * 1000], 'o instante gravado nao e o declarado (foi ajustado ao relogio?)');
  });
});

test('a borda de 5 s e inclusiva; 6 s e recusado e a Operacao inteira se desfaz', () => {
  comAcervo((acervo) => {
    const naBorda = receberEvento(acervo, [texto('B1', AGORA_REDONDO / 1000 + 5)], { agora: AGORA_REDONDO, configuracao: CFG_WHATSAPP });
    assert.deepEqual(naBorda.recusados, []);
    assert.equal(contar(acervo, 'mensagens'), 1);

    const operacoesAntes = contar(acervo, 'operacoes');
    const alem = receberEvento(acervo, [texto('B2', AGORA_REDONDO / 1000 + 6)], { agora: AGORA_REDONDO, configuracao: CFG_WHATSAPP });
    assert.equal(alem.recusados.length, 1);
    assert.match(alem.recusados[0]?.causa ?? '', /instante no futuro/);
    assert.equal(contar(acervo, 'mensagens'), 1, 'a recusada entrou');
    assert.equal(contar(acervo, 'operacoes'), operacoesAntes, 'a Operacao do evento recusado nao se desfez');
  });
});

test('o limite INFERIOR nao muda: zero e anterior ao inicio da Fonte continuam recusados ao vivo', () => {
  comAcervo((acervo) => {
    const r = receberEvento(acervo, [texto('Z1', 0), texto('Z2', 1_200_000_000)], { agora: AGORA, configuracao: CFG_WHATSAPP });
    assert.equal(r.recusados.length, 2);
    assert.equal(contar(acervo, 'mensagens'), 0);
  });
});

test('a DRENAGEM do derrame recebe a tolerancia', async () => {
  const c = await paraDrenar();
  try {
    const declarado = Math.floor(AGORA / 1000) + 1;
    derramar(c.caminho, [texto('D1', declarado)]);
    drenar(c.acervo, c.caminho, c.cfg, () => AGORA, () => undefined);
    assert.deepEqual(ocorridas(c.acervo), [declarado * 1000]);
  } finally {
    c.limpar();
  }
});

test('o REPROCESSAMENTO dos descartados recebe a tolerancia', () => {
  const c = cenario();
  const pasta = mkdtempSync(join(tmpdir(), 'malote-tolerancia-'));
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const caminho = join(pasta, 'descartados.jsonl');
    const evento = texto('G1', Math.floor(AGORA / 1000) + 3); // 3 s a frente do relogio do reprocesso
    writeFileSync(caminho, JSON.stringify({ em: '2026-10-13T20:12:03.000Z', motivo: 'recusado', causa: 'instante no futuro', evento }) + '\n');
    const r = reprocessarDescartados(acervo, caminho, CFG_WHATSAPP, AGORA);
    assert.equal(r.gravados, 1);
    assert.equal(contar(acervo, 'mensagens'), 1);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
    c.limpar();
  }
});
