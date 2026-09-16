import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_INSTAGRAM, CFG_INSTAGRAM_SEGUNDA } from './ajuda/configuracao.js';
import { materialInstagramFalso } from './ajuda/material-instagram-falso.js';
import { importarMaterialDeInstagram } from '../src/adaptadores/instagram/importar.js';

const AGORA = Date.parse('2026-09-12T12:00:00Z');

/**
 * EXIGE FIXTURE CONSTRUÍDA, e a spec já disse por quê: os exports reais das
 * duas contas do Titular têm interseção VAZIA, então material real não
 * exercita o mecanismo — o teste passaria com a guarda removida.
 *
 * Aqui as duas contas falam com a MESMA contraparte, no MESMO número de
 * conversa. É o caso que o #825 construiu a separação para resolver, medido
 * então no WhatsApp: 89 Conversas diretas de duas contas colidiram num fio só.
 */
function conversaCom(titular: string) {
  return [
    {
      slug: 'contraparte',
      numero: '111',
      title: 'Contraparte',
      participants: ['Contraparte', titular],
      messages: [
        { sender_name: titular, timestamp_ms: 1_700_000_000_000, content: `ola de ${titular}` },
      ],
    },
  ];
}

test('a mesma Conversa direta em duas contas de Instagram nasce em DOIS fios', () => {
  const c = cenario();
  const a = materialInstagramFalso(conversaCom('Leia Organa'));
  const b = materialInstagramFalso(conversaCom('Han Solo'));
  try {
    const { acervo } = c.novoInquilino('Titular');
    importarMaterialDeInstagram(acervo, a.raiz, {
      agora: AGORA, titular: 'Leia Organa', configuracao: CFG_INSTAGRAM,
    });
    importarMaterialDeInstagram(acervo, b.raiz, {
      agora: AGORA, titular: 'Han Solo', configuracao: CFG_INSTAGRAM_SEGUNDA,
    });

    const fios = acervo.db
      .prepare(
        `SELECT configuracao_id FROM conversas
          WHERE fonte = 'instagram' AND coletiva = 0 AND id_externo = '111'
          ORDER BY configuracao_id`,
      )
      .all() as Array<{ configuracao_id: string }>;
    assert.deepEqual(
      fios.map((f) => f.configuracao_id),
      [CFG_INSTAGRAM.id, CFG_INSTAGRAM_SEGUNDA.id],
      'mesmo número de conversa, duas contas: dois fios',
    );
  } finally {
    a.limpar();
    b.limpar();
    c.limpar();
  }
});

test('nenhuma Conversa direta de uma conta absorve Mensagem da outra', () => {
  const c = cenario();
  const a = materialInstagramFalso(conversaCom('Leia Organa'));
  const b = materialInstagramFalso(conversaCom('Han Solo'));
  try {
    const { acervo } = c.novoInquilino('Titular');
    importarMaterialDeInstagram(acervo, a.raiz, {
      agora: AGORA, titular: 'Leia Organa', configuracao: CFG_INSTAGRAM,
    });
    importarMaterialDeInstagram(acervo, b.raiz, {
      agora: AGORA, titular: 'Han Solo', configuracao: CFG_INSTAGRAM_SEGUNDA,
    });

    const porFio = acervo.db
      .prepare(
        `SELECT c.configuracao_id, COUNT(m.id) AS n
           FROM conversas c LEFT JOIN mensagens m ON m.conversa_id = c.id
          WHERE c.fonte = 'instagram' AND c.coletiva = 0
          GROUP BY c.configuracao_id ORDER BY c.configuracao_id`,
      )
      .all() as Array<{ configuracao_id: string; n: number }>;
    // Uma Mensagem em cada. Se os fios tivessem colidido, seriam duas num só —
    // e o acervo diria que o Titular de uma conta falou na outra.
    assert.deepEqual(porFio, [
      { configuracao_id: CFG_INSTAGRAM.id, n: 1 },
      { configuracao_id: CFG_INSTAGRAM_SEGUNDA.id, n: 1 },
    ]);
  } finally {
    a.limpar();
    b.limpar();
    c.limpar();
  }
});
