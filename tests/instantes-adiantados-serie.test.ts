import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lerDescartes, registrarDescartes } from '../src/cli/descartes.js';
import type { RelatoDeRecepcao } from '../src/adaptadores/whatsapp/ao-vivo.js';

// #1204: a serie diaria das Mensagens gravadas pela janela de relogio. Serie PROPRIA, no formato e com as garantias
// da dos descartes: aquela mede o que a recepcao NAO grava, e misturar o que ela grava a faria mentir.

const AGORA = Date.parse('2026-10-16T12:00:00Z');
const DIA = '2026-10-16';

function relato(mensagensPelaJanela: number): RelatoDeRecepcao {
  return { descartados: [], ignorados: {}, mensagensPelaJanela } as unknown as RelatoDeRecepcao;
}

function comPasta(corpo: (pasta: string) => void): void {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-adiantadas-'));
  try {
    corpo(pasta);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

test('o lote soma ao balde do dia, na serie propria', () => {
  comPasta((pasta) => {
    const caminhos = { descartes: join(pasta, 'd.json'), guarda: join(pasta, 'g.jsonl'), adiantadas: join(pasta, 'a.json') };
    registrarDescartes(caminhos, relato(2), AGORA, () => undefined);
    registrarDescartes(caminhos, relato(1), AGORA, () => undefined);
    assert.deepEqual(lerDescartes(caminhos.adiantadas), { [DIA]: { mensagens: 3 } });
    assert.deepEqual(lerDescartes(caminhos.descartes), {}, 'a serie dos descartes nao pode receber o que a recepcao GRAVA');
  });
});

test('lote sem Mensagem pela janela nao anota nada (zero visto nao e dia anotado)', () => {
  comPasta((pasta) => {
    const caminhos = { descartes: join(pasta, 'd.json'), guarda: join(pasta, 'g.jsonl'), adiantadas: join(pasta, 'a.json') };
    registrarDescartes(caminhos, relato(0), AGORA, () => undefined);
    assert.deepEqual(lerDescartes(caminhos.adiantadas), {});
  });
});

test('sem o caminho da serie (chamador antigo), nada e anotado e nada quebra', () => {
  comPasta((pasta) => {
    const caminhos = { descartes: join(pasta, 'd.json'), guarda: join(pasta, 'g.jsonl') };
    assert.doesNotThrow(() => registrarDescartes(caminhos, relato(2), AGORA, () => undefined));
  });
});

test('falha ao gravar a serie NAO propaga: a Mensagem do lote ja foi gravada, e o aviso nao leva caminho', () => {
  comPasta((pasta) => {
    const avisos: string[] = [];
    // O pai do caminho e um ARQUIVO: gravar nele falha (ENOTDIR), e criar a pasta nao resolveria.
    writeFileSync(join(pasta, 'arquivo'), 'x');
    const caminhos = { descartes: join(pasta, 'd.json'), guarda: join(pasta, 'g.jsonl'), adiantadas: join(pasta, 'arquivo', 'a.json') };
    assert.doesNotThrow(() => registrarDescartes(caminhos, relato(1), AGORA, (t) => avisos.push(t)));
    assert.ok(avisos.some((a) => a.includes('instantes a frente')), `sem aviso da falha: ${avisos.join(' | ')}`);
    assert.equal(avisos.join('\n').includes(pasta), false, 'o aviso vazou o caminho');
  });
});
