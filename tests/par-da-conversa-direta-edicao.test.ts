import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { receberEvento, type ChaveRecebida, type MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';

/**
 * A Edicao de uma Mensagem que ficou na Conversa por endereco opaco continua valendo depois do par (#1439, criterio 9): a
 * recepcao compara o endereco da Conversa da original RESOLVIDO com o do evento resolvido, nos dois lados. Antes, o lado
 * da original era o gravado (o opaco) e o do evento ja resolvia para o telefone: a edicao era recusada como `outra-conversa`.
 */

const AGORA = 1_791_300_000_000;
const T_ORIGINAL = Math.floor((AGORA - 600_000) / 1000);
const T_EDICAO = AGORA - 299_877;
const OPCOES = { origemDaChegada: 'ao-vivo' as const, agora: AGORA, configuracao: CFG_WHATSAPP };
const OPACO = '200000000000001@lid';
const OUTRO_OPACO = '200000000000002@lid';
const COM_NOVE = '5565988887777@s.whatsapp.net';

function comAcervo(corpo: (acervo: Acervo) => void): void {
  const c = cenario();
  try {
    corpo(c.novoInquilino('Teste').acervo);
  } finally {
    c.limpar();
  }
}

function recebida(id: string, chave: Partial<ChaveRecebida> = {}): MensagemRecebida {
  return {
    key: { remoteJid: OPACO, id, fromMe: false, ...chave },
    messageTimestamp: T_ORIGINAL,
    message: { conversation: 'texto original sintetico' },
  };
}

/** A edicao ABERTA (`protocolMessage`), que a recepcao le sem decodificador. */
function edicao(idEvento: string, alvoId: string, chave: Partial<ChaveRecebida> = {}): MensagemRecebida {
  const remoteJid = chave.remoteJid ?? OPACO;
  return {
    key: { remoteJid, id: idEvento, fromMe: false, ...chave },
    messageTimestamp: Math.floor(T_EDICAO / 1000),
    message: {
      protocolMessage: {
        type: 'MESSAGE_EDIT',
        key: { remoteJid, fromMe: false, id: alvoId },
        editedMessage: { conversation: 'texto corrigido sintetico' },
        timestampMs: T_EDICAO,
      },
    },
  };
}

const edicoes = (acervo: Acervo): number => (acervo.db.prepare('SELECT COUNT(*) AS n FROM edicoes').get() as { n: number }).n;

test('antes do par: a edicao da Mensagem da Conversa opaca grava', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [recebida('ORIG-1')], OPCOES);
    const r = receberEvento(acervo, [edicao('EV-1', 'ORIG-1')], OPCOES);

    assert.equal(r.edicoes, 1);
    assert.deepEqual(r.edicoesNaoGravadas, {});
  });
});

test('depois do par: a edicao de uma Mensagem antiga da Conversa opaca continua valendo', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [recebida('ORIG-1')], OPCOES);
    receberEvento(acervo, [recebida('M-PAR', { senderPn: COM_NOVE })], OPCOES);

    const r = receberEvento(acervo, [edicao('EV-1', 'ORIG-1')], OPCOES);

    assert.equal(r.edicoes, 1);
    assert.deepEqual(r.edicoesNaoGravadas, {}, 'a recusa outra-conversa nao cresce por causa do par');
    assert.equal(edicoes(acervo), 1);
  });
});

test('o proprio envelope da edicao que traz o campo ensina o par, e a edicao vale', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [recebida('ORIG-1')], OPCOES);

    const r = receberEvento(acervo, [edicao('EV-1', 'ORIG-1', { senderPn: COM_NOVE })], OPCOES);

    assert.equal(r.edicoes, 1);
    assert.deepEqual(r.edicoesNaoGravadas, {});
  });
});

test('a edicao que e de fato de outra Conversa continua recusada, com o par aprendido', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [recebida('ORIG-1', { remoteJid: OUTRO_OPACO })], OPCOES);
    receberEvento(acervo, [recebida('M-PAR', { senderPn: COM_NOVE })], OPCOES);

    const r = receberEvento(acervo, [edicao('EV-1', 'ORIG-1')], OPCOES);

    assert.equal(r.edicoes, 0);
    assert.deepEqual(r.edicoesNaoGravadas, { 'outra-conversa': 1 });
  });
});
