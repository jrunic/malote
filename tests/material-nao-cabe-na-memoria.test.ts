import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { backupFalso, paraCoreData, type MensagemFalsa } from './ajuda/material-falso.js';

const AQUI = dirname(fileURLToPath(import.meta.url));

/**
 * Ler o material NÃO pode custar memória proporcional ao tamanho dele.
 *
 * Medido em 06/09/2026 contra o material real: 1,23 milhão de Mensagens
 * exigiam 2,7 GB de heap só para serem lidas, porque a leitura devolvia array.
 * Num host de 7,4 GB isso não sobra espaço para mais nada, e numa instalação
 * menor não roda — e o produto é instalado por terceiros.
 *
 * O teste roda num FILHO com o teto de heap fixado. Teste funcional não serve
 * aqui: ele passa igual com array e com iterador, porque os dois devolvem as
 * mesmas Mensagens. O que separa as duas formas é o teto.
 */
test('ler material grande cabe num teto de heap que o array estouraria', () => {
  const N = 5000;
  const TETO_MB = 64;
  const RECHEIO = 'x'.repeat(16_000);

  const mensagens: MensagemFalsa[] = [];
  for (let i = 0; i < N; i += 1) {
    mensagens.push({
      stanzaId: `M${i}`,
      chatSessionPk: 1,
      texto: `${i}-${RECHEIO}`,
      dataCoreData: paraCoreData('2026-01-01T00:00:00Z') + i,
    });
  }
  const backup = backupFalso({
    conversas: [
      { pk: 1, endereco: '5500000000000@s.whatsapp.net', nome: 'Conversa', tipoDeSessao: 0 },
    ],
    mensagens,
  });

  try {
    const filho = spawnSync(
      process.execPath,
      [
        `--max-old-space-size=${TETO_MB}`,
        '--import',
        'tsx',
        join(AQUI, 'ajuda', 'ler-material-filho.ts'),
        backup.raiz,
      ],
      { encoding: 'utf8' },
    );

    assert.equal(
      filho.status,
      0,
      `a leitura nao coube em ${TETO_MB} MB — saiu ${filho.status}. ` +
        `Materializar o material inteiro custa ~${Math.round((N * 33) / 1024)} MB aqui. ` +
        `stderr: ${(filho.stderr ?? '').slice(-400)}`,
    );

    // Contar o que saiu separa verde de VAZIO: um filho que lesse zero Mensagem
    // também sairia 0, e o teste passaria sem ter exercitado nada.
    const saida = JSON.parse(filho.stdout.trim()) as { mensagens: number };
    assert.equal(saida.mensagens, N, 'o filho nao leu todas as Mensagens');
  } finally {
    backup.limpar();
  }
});
