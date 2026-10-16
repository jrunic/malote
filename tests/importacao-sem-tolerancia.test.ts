import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { materialInstagramFalso } from './ajuda/material-instagram-falso.js';
import { importarMaterial } from '../src/adaptadores/whatsapp/importar.js';
import { importarMaterialDeInstagram } from '../src/adaptadores/instagram/importar.js';
import { contarAcervo } from '../src/nucleo/consulta.js';
import { CFG_INSTAGRAM, CFG_WHATSAPP } from './ajuda/configuracao.js';

// #1204: a tolerancia de relogio e SO da recepcao ao vivo. Na importacao o futuro e dado ruim (#606): 1 s a frente,
// que a janela de 5 s aceitaria, continua recusado.

const AGORA = Date.parse('2026-08-26T12:00:00Z');
const TITULAR = 'Titular Sintetico';

test('a importacao do WhatsApp recusa instante 1 s a frente do relogio, como sempre', () => {
  const c = cenario();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'x@s.whatsapp.net', nome: null, tipoDeSessao: 0 }],
    mensagens: [{ stanzaId: 'futura', chatSessionPk: 1, texto: 'a frente', dataCoreData: paraCoreData(new Date(AGORA + 1_000).toISOString()) }],
  });
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const r = importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });
    assert.equal(r.mensagensRejeitadas, 1);
    assert.deepEqual(Object.keys(r.rejeicoesPorMotivo), ['instante no futuro']);
    assert.equal(contarAcervo(acervo).mensagens, 0);
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('a importacao do Instagram recusa instante 1 s a frente do relogio, como sempre', () => {
  const c = cenario();
  const m = materialInstagramFalso([
    {
      slug: 'joanaprado',
      numero: '111111111111111',
      title: 'Joana Prado',
      participants: ['Joana Prado', TITULAR],
      messages: [{ sender_name: 'Joana Prado', timestamp_ms: AGORA + 1_000, content: 'a frente' }],
    },
  ]);
  try {
    const { acervo } = c.novoInquilino(TITULAR);
    const r = importarMaterialDeInstagram(acervo, m.raiz, { agora: AGORA, configuracao: CFG_INSTAGRAM, titular: TITULAR });
    assert.equal(r.mensagensRejeitadas, 1);
    assert.deepEqual(Object.keys(r.rejeicoesPorMotivo), ['instante no futuro']);
    assert.equal(contarAcervo(acervo).mensagens, 0);
  } finally {
    m.limpar();
    c.limpar();
  }
});
