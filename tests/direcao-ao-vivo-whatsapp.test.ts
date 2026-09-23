import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { mensagemDireta, mensagemEnviada } from './ajuda/evento-ao-vivo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const QUANDO = Math.floor(Date.UTC(2026, 8, 23) / 1000);
const OPCOES = { agora: Date.UTC(2026, 8, 23, 12), configuracao: CFG_WHATSAPP };

test('recepcao ao vivo do WhatsApp grava a Direcao a partir de key.fromMe', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    receberEvento(
      acervo,
      [mensagemEnviada('AAAA0000ENVIADA', QUANDO), mensagemDireta('AAAA0000RECEBIDA', QUANDO + 1)],
      OPCOES,
    );
    const linhas = acervo
      .preparar('SELECT id_externo, direcao FROM mensagens ORDER BY id_externo')
      .all() as { id_externo: string; direcao: string }[];
    assert.deepEqual(linhas, [
      { id_externo: 'AAAA0000ENVIADA', direcao: 'enviada' },
      { id_externo: 'AAAA0000RECEBIDA', direcao: 'recebida' },
    ]);
  } finally {
    c.limpar();
  }
});
