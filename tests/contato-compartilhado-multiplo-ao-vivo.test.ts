import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { reprocessarDescartados } from '../src/cli/guarda-de-descartes.js';
import { lerContatosCompartilhados } from '../src/nucleo/contato-compartilhado.js';
import { buscarMensagens } from '../src/nucleo/consulta.js';
import { idDeMensagemPorExterno } from '../src/nucleo/escrita.js';
import type { Acervo } from '../src/nucleo/acervo.js';

// #1206: o cartao multiplo (varios contatos num envio) passa a ser Mensagem e cada cartao vira um Contato
// Compartilhado. Forma medida na espiga de 14/10/2026: `{displayName, contacts: [{displayName, vcard}]}`, com o
// `displayName` externo "N contatos" precedido por uma marca de direcao invisivel. Dados sinteticos.

const AGORA = Date.parse('2026-10-13T12:00:00Z');
const ENDERECO = '5511900000001@s.whatsapp.net';
const ROTULO = '‎3 contatos';
const ANA = 'BEGIN:VCARD\nVERSION:3.0\nFN:Ana Souza\nTEL;waid=5565999991234:+55 65 99999-1234\nEND:VCARD';
const BETO = 'BEGIN:VCARD\nVERSION:3.0\nFN:\nORG:Pizzaria do Ze;\nTEL:11999990000\nEND:VCARD';
const CARLA = 'BEGIN:VCARD\nVERSION:3.0\nFN:Carla Dias\nEMAIL:carla@exemplo.com\nEND:VCARD';

function lista(...vcards: Array<[string, string]>): Record<string, unknown> {
  return { displayName: ROTULO, contacts: vcards.map(([displayName, vcard]) => ({ displayName, vcard })) };
}

function evento(id: string, message: Record<string, unknown>) {
  return {
    key: { remoteJid: ENDERECO, id, fromMe: true },
    messageTimestamp: Math.floor(Date.parse('2026-10-01T10:00:00Z') / 1000),
    message,
  };
}

const TRES = lista(['Ana Souza', ANA], ['Pizzaria', BETO], ['Carla Dias', CARLA]);

function cartoesDe(acervo: Acervo, idExterno: string) {
  const id = idDeMensagemPorExterno(acervo, { fonte: 'whatsapp', idExterno }) as string;
  return lerContatosCompartilhados(acervo, [id]).get(id) ?? [];
}

function contar(acervo: Acervo, tabela: string, onde = '1 = 1'): number {
  return (acervo.db.prepare(`SELECT COUNT(*) AS n FROM ${tabela} WHERE ${onde}`).get() as { n: number }).n;
}

function comAcervo(corpo: (acervo: Acervo) => void): void {
  const c = cenario();
  try {
    corpo(c.novoInquilino('Leia Organa').acervo);
  } finally {
    c.limpar();
  }
}

const opcoes = { origemDaChegada: 'ao-vivo' as const, agora: AGORA, configuracao: CFG_WHATSAPP };

test('o cartao multiplo vira UMA Mensagem sem texto, o Conteudo Bruto inteiro e um cartao por elemento', () => {
  comAcervo((acervo) => {
    const r = receberEvento(acervo, [evento('A1', { contactsArrayMessage: TRES })], opcoes);
    assert.equal(r.gravados, 1);
    assert.deepEqual(r.recusados, []);
    assert.equal(r.contatosCompartilhados, 3);
    assert.equal(r.ignorados['contactsArrayMessage'], undefined, 'o tipo nao e mais ignorado');
    assert.deepEqual(cartoesDe(acervo, 'A1').map((c) => c.nome), ['Ana Souza', 'Pizzaria do Ze', 'Carla Dias']);
    const m = acervo.db.prepare('SELECT conteudo, bruto FROM mensagens').get() as { conteudo: string | null; bruto: string };
    assert.equal(m.conteudo, null);
    assert.ok(m.bruto.includes('contactsArrayMessage') && m.bruto.includes('Pizzaria'), 'o bruto segue inteiro');
  });
});

test('o rotulo externo "N contatos" NUNCA e nome de cartao, nem ultimo recurso', () => {
  comAcervo((acervo) => {
    const semNome = 'BEGIN:VCARD\nVERSION:3.0\nFN:\nTEL:11988880000\nEND:VCARD';
    const r = receberEvento(acervo, [evento('R1', { contactsArrayMessage: lista(['Ana Souza', ANA], ['', semNome]) })], opcoes);
    assert.equal(r.contatosCompartilhados, 1);
    assert.equal(r.contatosCompartilhadosRecusados, 1, 'o cartao sem nome proprio e recusado, em vez de herdar o rotulo');
    const nomes = acervo.db.prepare('SELECT nome FROM contatos_compartilhados').all() as Array<{ nome: string }>;
    assert.ok(nomes.every((n) => !n.nome.includes('contatos')));
  });
});

test('o tipo e o assunto do evento mesmo com messageContextInfo e com senderKeyDistributionMessage junto', () => {
  comAcervo((acervo) => {
    const r = receberEvento(
      acervo,
      [
        evento('C1', { contactsArrayMessage: TRES, messageContextInfo: { deviceListMetadata: {} } }),
        evento('C2', { senderKeyDistributionMessage: { groupId: 'x' }, contactsArrayMessage: TRES }),
      ],
      opcoes,
    );
    assert.equal(r.gravados, 2);
    assert.equal(cartoesDe(acervo, 'C1').length, 3);
    assert.equal(cartoesDe(acervo, 'C2').length, 3);
  });
});

test('tudo na MESMA Operacao do evento: uma Operacao de receber-ao-vivo para a Mensagem e os tres cartoes', () => {
  comAcervo((acervo) => {
    const antes = contar(acervo, 'operacoes', "natureza = 'receber-ao-vivo'");
    receberEvento(acervo, [evento('O1', { contactsArrayMessage: TRES })], opcoes);
    assert.equal(contar(acervo, 'operacoes', "natureza = 'receber-ao-vivo'") - antes, 1);
    assert.equal(contar(acervo, 'operacoes', "natureza = 'registrar-contatos-compartilhados'"), 0);
  });
});

test('a reentrega do mesmo evento nao duplica Mensagem nem cartao', () => {
  comAcervo((acervo) => {
    const e = evento('E1', { contactsArrayMessage: TRES });
    receberEvento(acervo, [e], opcoes);
    const antes = acervo.db.prepare('SELECT id FROM contatos_compartilhados ORDER BY id').all();
    const r = receberEvento(acervo, [e], opcoes);
    assert.equal(r.contatosCompartilhados, 0);
    assert.deepEqual(acervo.db.prepare('SELECT id FROM contatos_compartilhados ORDER BY id').all(), antes);
    assert.equal(contar(acervo, 'mensagens'), 1);
  });
});

test('cartao ruim no meio da lista e recusado e contado, e os outros entram', () => {
  comAcervo((acervo) => {
    const r = receberEvento(
      acervo,
      [evento('M1', { contactsArrayMessage: lista(['Ana Souza', ANA], ['Lixo', 'isto nao e um cartao'], ['Carla Dias', CARLA]) })],
      opcoes,
    );
    assert.equal(r.contatosCompartilhados, 2);
    assert.equal(r.contatosCompartilhadosRecusados, 1);
    assert.deepEqual(cartoesDe(acervo, 'M1').map((c) => c.nome), ['Ana Souza', 'Carla Dias']);
  });
});

test('lista vazia ou ausente grava a Mensagem e nenhum cartao, sem erro', () => {
  comAcervo((acervo) => {
    const r = receberEvento(
      acervo,
      [evento('V1', { contactsArrayMessage: { displayName: ROTULO, contacts: [] } }), evento('V2', { contactsArrayMessage: { displayName: ROTULO } })],
      opcoes,
    );
    assert.equal(r.gravados, 2);
    assert.deepEqual(r.recusados, []);
    assert.equal(contar(acervo, 'contatos_compartilhados'), 0);
  });
});

test('o cartao multiplo CITADO dentro de outra Mensagem nao e cartao enviado', () => {
  comAcervo((acervo) => {
    const citacao = evento('Q1', {
      extendedTextMessage: { text: 'respondendo', contextInfo: { quotedMessage: { contactsArrayMessage: TRES } } },
    });
    const r = receberEvento(acervo, [citacao], opcoes);
    assert.equal(r.gravados, 1);
    assert.equal(r.contatosCompartilhados, 0);
    assert.equal(contar(acervo, 'contatos_compartilhados'), 0);
  });
});

test('a busca acha a Mensagem pelo nome de qualquer cartao do lote', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [evento('B1', { contactsArrayMessage: TRES })], opcoes);
    const id = idDeMensagemPorExterno(acervo, { fonte: 'whatsapp', idExterno: 'B1' });
    for (const termo of ['Ana', 'Carla', 'Pizzaria']) {
      assert.deepEqual(buscarMensagens(acervo, { texto: termo }).map((x) => x.id), [id], termo);
    }
  });
});

test('o evento que a recepcao JA descartou e guardou cru e gravado por reprocessar-descartados, e SO a linha dele sai do arquivo', () => {
  const c = cenario();
  const pasta = mkdtempSync(join(tmpdir(), 'malote-multiplo-'));
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const caminho = join(pasta, 'descartados.jsonl');
    const doCartao = JSON.stringify({
      em: '2026-10-12T20:00:00.000Z',
      motivo: 'contactsArrayMessage',
      evento: evento('D1', { contactsArrayMessage: TRES, messageContextInfo: {} }),
    });
    // Outro descartado, que continua descartado: a linha dele fica como estava.
    const continua = JSON.stringify({
      em: '2026-10-12T20:01:00.000Z',
      motivo: 'pollCreationMessage',
      evento: evento('D2', { pollCreationMessage: { name: 'enquete' } }),
    });
    writeFileSync(caminho, `${doCartao}\n${continua}\n`);
    const r = reprocessarDescartados(acervo, caminho, CFG_WHATSAPP, AGORA);
    assert.equal(r.gravados, 1);
    assert.equal(r.mantidos, 1);
    assert.equal(cartoesDe(acervo, 'D1').length, 3);
    assert.equal(readFileSync(caminho, 'utf8'), `${continua}\n`, 'sai a linha recuperada, fica a que continua descartada');
  } finally {
    rmSync(pasta, { recursive: true, force: true });
    c.limpar();
  }
});
