import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { receberEvento, type MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';
import type { Acervo } from '../src/nucleo/acervo.js';

// #1204: o relatorio conta as Mensagens GRAVADAS so por causa da janela. Sem a contagem a janela nao se ajusta com
// dado de campo (o Acervo nao guarda a hora de chegada).

const DIRETA = '5511900000001@s.whatsapp.net';
const AGORA = Date.parse('2026-10-13T20:12:03.835Z');
const OPCOES = { agora: AGORA, configuracao: CFG_WHATSAPP };

function texto(id: string, segundos: number): MensagemRecebida {
  return { key: { remoteJid: DIRETA, id, fromMe: false }, messageTimestamp: segundos, message: { conversation: 'oi' } };
}

function comAcervo(corpo: (acervo: Acervo) => void): void {
  const c = cenario();
  try {
    corpo(c.novoInquilino('Leia Organa').acervo);
  } finally {
    c.limpar();
  }
}

test('a Mensagem gravada so por causa da janela e contada', () => {
  comAcervo((acervo) => {
    const r = receberEvento(acervo, [texto('M1', Math.floor(AGORA / 1000) + 1)], OPCOES);
    assert.equal(r.mensagensPelaJanela, 1);
  });
});

test('a Mensagem no passado, ou no instante exato do relogio, nao conta', () => {
  comAcervo((acervo) => {
    const r = receberEvento(
      acervo,
      [texto('P1', Math.floor(AGORA / 1000) - 60), texto('P2', Math.floor(AGORA / 1000))],
      OPCOES,
    );
    assert.equal(r.gravados, 2);
    assert.equal(r.mensagensPelaJanela, 0);
  });
});

test('a Mensagem REPETIDA passa pela guarda e encontra a que existe: nao e contada de novo', () => {
  comAcervo((acervo) => {
    const e = texto('R1', Math.floor(AGORA / 1000) + 1);
    receberEvento(acervo, [e], OPCOES);
    const segunda = receberEvento(acervo, [e], OPCOES);
    assert.equal(segunda.mensagensPelaJanela, 0, 'a reentrega foi contada como se a janela a tivesse gravado');
  });
});

test('a recusada alem da janela nao e contada', () => {
  comAcervo((acervo) => {
    const r = receberEvento(acervo, [texto('F1', Math.floor(AGORA / 1000) + 60)], OPCOES);
    assert.equal(r.recusados.length, 1);
    assert.equal(r.mensagensPelaJanela, 0);
  });
});
