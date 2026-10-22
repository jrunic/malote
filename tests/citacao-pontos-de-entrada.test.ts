import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { paraDrenar } from './ajuda/drenagem.js';
import { GRUPO, LID_DA_CONTA, JID_DA_CONTA } from './ajuda/etiqueta-ao-vivo.js';
import { drenar } from '../src/cli/ouvir.js';
import { derramar } from '../src/cli/derrame.js';
import { reprocessarDescartados } from '../src/cli/guarda-de-descartes.js';
import { declararEnderecosDaConta } from '../src/nucleo/endereco-da-conta.js';
import type { Acervo } from '../src/nucleo/acervo.js';

// A recepcao tem quatro pontos de entrada de evento (ouvinte, drenagem do derrame, reprocessar do derrame e
// reprocessar dos descartados). Os que o teste de `receberEvento` nao alcanca: o endereco da conta chega ate la.

const AGORA = Date.UTC(2026, 9, 21, 13);
const QUANDO = Math.floor(Date.UTC(2026, 9, 21, 12) / 1000);

function respostaDaMinhaMensagem(id: string): unknown {
  return {
    key: { remoteJid: GRUPO, id, fromMe: false, participant: '109876543210999@lid' },
    messageTimestamp: QUANDO,
    message: { extendedTextMessage: { text: 'sim', contextInfo: { stanzaId: 'ANTIGA-MINHA', participant: LID_DA_CONTA } } },
  };
}

function direcaoDaCitada(acervo: Acervo, idExterno: string): string | null {
  return (acervo.preparar('SELECT citada_direcao AS d FROM mensagens WHERE id_externo = ?').get(idExterno) as { d: string | null }).d;
}

test('a drenagem do derrame passa o endereco da conta: a citada dela sai enviada', async () => {
  const c = await paraDrenar();
  try {
    declararEnderecosDaConta(c.acervo, { fonte: 'whatsapp', canonico: JID_DA_CONTA, alternativo: LID_DA_CONTA });
    derramar(c.caminho, [respostaDaMinhaMensagem('D1')]);
    drenar(c.acervo, c.caminho, c.cfg, () => AGORA, () => undefined, undefined, undefined, undefined, JID_DA_CONTA);
    assert.equal(direcaoDaCitada(c.acervo, 'D1'), 'enviada');
  } finally {
    c.limpar();
  }
});

test('o reprocessar dos descartados passa o endereco da conta', () => {
  const c = cenario();
  const pasta = mkdtempSync(join(tmpdir(), 'citacao-guarda-'));
  try {
    const { acervo } = c.novoInquilino('Padme');
    declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID_DA_CONTA, alternativo: LID_DA_CONTA });
    const caminho = join(pasta, 'descartados.jsonl');
    // Um evento que a recepcao descarta hoje e passa a gravar: a guarda do tipo que o reprocessar recupera.
    const evento = { ...(respostaDaMinhaMensagem('G1') as Record<string, unknown>) };
    writeFileSync(caminho, `${JSON.stringify({ em: '2026-10-21T12:00:00.000Z', motivo: 'extendedTextMessage', evento })}\n`);
    const r = reprocessarDescartados(acervo, caminho, CFG_WHATSAPP, AGORA, { enderecoDaConta: JID_DA_CONTA });
    assert.equal(r.gravados, 1);
    assert.equal(direcaoDaCitada(acervo, 'G1'), 'enviada');
  } finally {
    rmSync(pasta, { recursive: true, force: true });
    c.limpar();
  }
});
