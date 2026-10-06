import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { umaColetiva, umMembro } from './ajuda/etiqueta.js';
import { registrarConversa, registrarEtiqueta } from '../src/nucleo/escrita.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const T0 = Date.parse('2026-10-05T15:00:00Z');

function evento(conversaId: string, identificadorId: string, texto: string, ocorridaEm: number, idExterno: string) {
  return { conversaId, identificadorId, texto, ocorridaEm, fonte: 'whatsapp' as const, idExterno };
}

test('a porta devolve true quando a linha NASCEU e false quando o evento ja existia', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversa = umaColetiva(acervo);
    const membro = umMembro(acervo);
    assert.equal(registrarEtiqueta(acervo, evento(conversa, membro, 'Torre A', T0, 'EV1')), true);
    assert.equal(registrarEtiqueta(acervo, evento(conversa, membro, 'Torre A', T0, 'EV1')), false);
    const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM etiquetas_de_participacao').get() as { n: number };
    assert.equal(n.n, 1, 'repetir o evento tem de deixar UMA linha');
  } finally {
    c.limpar();
  }
});

test('texto vazio e uma etiqueta valida: e a remocao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversa = umaColetiva(acervo);
    const membro = umMembro(acervo);
    assert.equal(registrarEtiqueta(acervo, evento(conversa, membro, '', T0, 'EV1')), true);
    const linha = acervo.db.prepare('SELECT texto FROM etiquetas_de_participacao').get() as { texto: string };
    assert.equal(linha.texto, '');
  } finally {
    c.limpar();
  }
});

test('a porta recusa etiqueta em Conversa DIRETA — o agregado e de Conversa coletiva', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const direta = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: '5565911110009@s.whatsapp.net',
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    const membro = umMembro(acervo);
    assert.throws(
      () => registrarEtiqueta(acervo, evento(direta, membro, 'x', T0, 'EV1')),
      /Conversa coletiva/,
    );
    const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM etiquetas_de_participacao').get() as { n: number };
    assert.equal(n.n, 0);
  } finally {
    c.limpar();
  }
});

test('a porta recusa instante que nao e positivo — o instante e o que a Fonte declarou, nunca derivado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversa = umaColetiva(acervo);
    const membro = umMembro(acervo);
    for (const ruim of [0, -1, Number.NaN]) {
      assert.throws(() => registrarEtiqueta(acervo, evento(conversa, membro, 'x', ruim, `EV${ruim}`)), /instante/i);
    }
  } finally {
    c.limpar();
  }
});
