import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { receberEvento, type MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-09-08T12:00:00Z');

function texto(id: string, remoteJid: string): MensagemRecebida {
  return {
    key: { remoteJid, id, fromMe: false, participant: '5511000000001@s.whatsapp.net' },
    messageTimestamp: Math.floor(AGORA / 1000),
    message: { conversation: 'sintetica' },
  } as MensagemRecebida;
}

/**
 * Medido em 08/09/2026 contra o Acervo real, com 1.429.620 Mensagens:
 *
 *   1.054 Conversas de broadcast/status marcadas COLETIVA — vieram da importacao
 *      11 marcadas DIRETA — vieram do ouvinte ao vivo
 *
 * Os dois caminhos decidiam por criterios que nao coincidem: a importacao por
 * `ZSESSIONTYPE != 0` (material.ts) e a recepcao por `endsWith('@g.us')`. Feed
 * de status e lista de transmissao nao sao conversa entre duas pessoas, e o
 * criterio 11a da spec do #825 ja decidiu que status e coletiva compartilhada
 * entre as contas do Inquilino.
 *
 * Enquanto o lookup ignorava a natureza isso era inofensivo por acidente. Com a
 * chave por natureza do #825, o mesmo endereco viraria DUAS Conversas — e a
 * guarda que o impede BLOQUEIA a importacao da segunda conta, que e como o
 * defeito apareceu.
 */
test('feed de status chega ao vivo como COLETIVA, igual ao que a importacao grava', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    receberEvento(acervo, [texto('S1', 'status@broadcast')], {
      agora: AGORA,
      configuracao: CFG_WHATSAPP,
    });
    const conversa = acervo
      .preparar('SELECT coletiva, configuracao_id FROM conversas WHERE id_externo = ?')
      .get('status@broadcast') as { coletiva: number; configuracao_id: string | null };
    assert.equal(conversa.coletiva, 1, 'status@broadcast tem de nascer coletiva');
    assert.equal(conversa.configuracao_id, null, 'coletiva nao carrega Configuracao');
  } finally {
    c.limpar();
  }
});

test('lista de transmissao tambem — o sufixo e @broadcast, e nao so o feed agregado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    receberEvento(acervo, [texto('B1', '1681043162@broadcast')], {
      agora: AGORA,
      configuracao: CFG_WHATSAPP,
    });
    const conversa = acervo
      .preparar('SELECT coletiva FROM conversas WHERE id_externo = ?')
      .get('1681043162@broadcast') as { coletiva: number };
    assert.equal(conversa.coletiva, 1);
  } finally {
    c.limpar();
  }
});

test('endereco de status na forma <numero>@status — a que a importacao ja traz', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    receberEvento(acervo, [texto('S2', '556599344486@status')], {
      agora: AGORA,
      configuracao: CFG_WHATSAPP,
    });
    const conversa = acervo
      .preparar('SELECT coletiva FROM conversas WHERE id_externo = ?')
      .get('556599344486@status') as { coletiva: number };
    assert.equal(conversa.coletiva, 1);
  } finally {
    c.limpar();
  }
});

test('conversa direta comum NAO e afetada — a guarda nova nao pode alargar demais', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    receberEvento(acervo, [texto('D1', '5511000000002@s.whatsapp.net')], {
      agora: AGORA,
      configuracao: CFG_WHATSAPP,
    });
    const conversa = acervo
      .preparar('SELECT coletiva, configuracao_id FROM conversas WHERE id_externo = ?')
      .get('5511000000002@s.whatsapp.net') as { coletiva: number; configuracao_id: string | null };
    assert.equal(conversa.coletiva, 0);
    assert.equal(conversa.configuracao_id, CFG_WHATSAPP.id);
  } finally {
    c.limpar();
  }
});
