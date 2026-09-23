import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { materialInstagramFalso } from './ajuda/material-instagram-falso.js';
import { importarMaterialDeInstagram } from '../src/adaptadores/instagram/importar.js';
import { CFG_INSTAGRAM } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-09-23T12:00:00Z');
const TITULAR = 'Titular Sintetico';

test('importar material Instagram grava a Direcao pelo Nome do Titular na Fonte', () => {
  const c = cenario();
  const m = materialInstagramFalso([
    {
      slug: 'joanaprado',
      numero: '111111111111111',
      title: 'Joana Prado',
      participants: ['Joana Prado', TITULAR],
      messages: [
        { sender_name: TITULAR, timestamp_ms: 1_700_000_000_000, content: 'oi' },
        { sender_name: 'Joana Prado', timestamp_ms: 1_700_000_060_000, content: 'ola' },
      ],
    },
  ]);
  try {
    const { acervo } = c.novoInquilino('Titular Sintetico');
    importarMaterialDeInstagram(acervo, m.raiz, { agora: AGORA, configuracao: CFG_INSTAGRAM, titular: TITULAR });

    const linhas = acervo
      .preparar('SELECT direcao, COUNT(*) AS n FROM mensagens GROUP BY direcao ORDER BY direcao')
      .all() as { direcao: string; n: number }[];
    assert.deepEqual(linhas, [
      { direcao: 'enviada', n: 1 },
      { direcao: 'recebida', n: 1 },
    ]);
  } finally {
    m.limpar();
    c.limpar();
  }
});
