import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-09-12T12:00:00Z');
const OPCOES = { agora: AGORA, configuracao: CFG_WHATSAPP };

const GRUPO = '120363000000000001@g.us';
const OPACO = '109876543210987@lid';
const OUTRO_OPACO = '109876543210988@lid';
const CANONICO = '5565911110001@s.whatsapp.net';

function texto(chave: Record<string, unknown>, id: string) {
  return {
    key: { id, fromMe: false, ...chave },
    messageTimestamp: Math.floor(AGORA / 1000),
    message: { conversation: 'oi' },
  } as never;
}

/**
 * A VIGILANCIA da #775, e o desenho dela mudou pela medicao de abertura.
 *
 * A tarefa nasceu do risco de a fonte da correspondencia SECAR sem aviso. Medido
 * em 12/09/2026 no Acervo de producao, lendo pela chave e nao pela vizinhanca de
 * texto, a proporcao de eventos em forma opaca que vieram com o par, em Conversa
 * coletiva: 80,6% em abril, 76,9% em junho, 84,3% em agosto, 95,2% em setembro.
 * Ela SUBIU. O risco continua estrutural — por isso o contador existe —, mas o
 * detector nao pode nascer supondo a direcao.
 *
 * Duas consequencias no que estes testes guardam:
 *  - SAO DOIS campos companheiros e a tarefa nomeia um: `participantPn` na
 *    coletiva e `senderPn` na direta. As populacoes ficam SEPARADAS, porque as
 *    linhas de base diferem em 3x e juntar reproduz exatamente a cegueira contra
 *    a qual a tarefa foi escrita.
 *  - O produto CONTA e EXPOE; quem alarma e a frota. Mesma fronteira do timer da
 *    varredura e do watchdog de silencio.
 */

test('coletiva: conta opacas e quantas delas trouxeram o par', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const r = receberEvento(
      acervo,
      [
        texto({ remoteJid: GRUPO, participant: OPACO, participantPn: CANONICO }, 'a'),
        texto({ remoteJid: GRUPO, participant: OUTRO_OPACO }, 'b'),
      ],
      OPCOES,
    );
    assert.equal(r.correspondencia.coletivaOpaca, 2);
    assert.equal(r.correspondencia.coletivaComPar, 1);
  } finally {
    c.limpar();
  }
});

test('direta: conta pelo OUTRO campo, e nunca soma com a coletiva', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const r = receberEvento(
      acervo,
      [
        texto({ remoteJid: OPACO, senderPn: CANONICO }, 'c'),
        texto({ remoteJid: OUTRO_OPACO }, 'd'),
        texto({ remoteJid: GRUPO, participant: OPACO, participantPn: CANONICO }, 'e'),
      ],
      OPCOES,
    );
    assert.equal(r.correspondencia.diretaOpaca, 2, 'duas diretas em forma opaca');
    assert.equal(r.correspondencia.diretaComPar, 1, 'uma delas com senderPn');

    // A coletiva do mesmo lote NAO entra na conta da direta. Se entrasse, a
    // taxa da direta seria diluida pela da coletiva — que e 3x maior — e o
    // detector ficaria cego para o que ele existe para ver.
    assert.equal(r.correspondencia.coletivaOpaca, 1);
    assert.equal(r.correspondencia.coletivaComPar, 1);
  } finally {
    c.limpar();
  }
});

test('endereco em forma canonica nao entra na conta: nao ha correspondencia a aprender', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const r = receberEvento(
      acervo,
      [
        texto({ remoteJid: CANONICO }, 'f'),
        texto({ remoteJid: GRUPO, participant: CANONICO }, 'g'),
      ],
      OPCOES,
    );
    assert.deepEqual(r.correspondencia, {
      coletivaOpaca: 0,
      coletivaComPar: 0,
      diretaOpaca: 0,
      diretaComPar: 0,
    });
  } finally {
    c.limpar();
  }
});
