import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { buscarMensagens } from '../src/nucleo/consulta.js';

const CFG = { id: 'cfg-1', fonte: 'whatsapp' as const };

function fixture() {
  const c = cenario();
  const { acervo } = c.novoInquilino('Ahsoka');
  const c1 = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: 'a@s.whatsapp.net',
    coletiva: false,
    configuracao: CFG,
  });
  const c2 = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: 'b@s.whatsapp.net',
    coletiva: false,
    configuracao: CFG,
  });
  registrarMensagem(acervo, {
      direcao: 'recebida',
    conversaId: c1,
    fonte: 'whatsapp',
    idExterno: 'm1',
    ocorridaEm: Date.parse('2026-01-10T12:00:00Z'),
    agora: Date.parse('2026-01-11T00:00:00Z'),
    conteudo: 'envie o relatorio mensal',
  });
  registrarMensagem(acervo, {
      direcao: 'recebida',
    conversaId: c2,
    fonte: 'whatsapp',
    idExterno: 'm2',
    ocorridaEm: Date.parse('2026-02-10T12:00:00Z'),
    agora: Date.parse('2026-02-11T00:00:00Z'),
    conteudo: 'relatorio de fevereiro anexado',
  });
  return { c, acervo, c1, c2 };
}

test('buscar filtra por Conversa', () => {
  const { c, acervo, c1 } = fixture();
  try {
    const r = buscarMensagens(acervo, { texto: 'relatorio', conversaId: c1 });
    assert.equal(r.length, 1);
    assert.match(r[0]!.conteudo!, /mensal/);
  } finally {
    c.limpar();
  }
});

test('buscar filtra por janela: desde/ate inclusivos, dia em UTC', () => {
  const { c, acervo } = fixture();
  try {
    const jan = Date.parse('2026-01-01T00:00:00Z');
    const fimJan = Date.parse('2026-01-31T23:59:59.999Z');
    assert.equal(buscarMensagens(acervo, { texto: 'relatorio', de: jan, ate: fimJan }).length, 1);
    assert.equal(buscarMensagens(acervo, { texto: 'relatorio', de: fimJan + 1 }).length, 1);
  } finally {
    c.limpar();
  }
});
