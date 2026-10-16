import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { lerContatosCompartilhados } from '../src/nucleo/contato-compartilhado.js';
import { listarOperacoesCruas } from '../src/nucleo/trilha.js';
import { extrairContatosCompartilhados } from '../src/adaptadores/whatsapp/extrair-contatos-compartilhados.js';

// #1206: `contato-compartilhado extrair` le tambem o cartao MULTIPLO do topo do evento, para a Mensagem que ja esta
// gravada e ainda nao tem cartao. Dados sinteticos, na forma medida na espiga de 14/10/2026.

const AGORA = Date.parse('2026-10-13T12:00:00Z');
const ROTULO = '‎3 contatos';
const ANA = 'BEGIN:VCARD\nVERSION:3.0\nFN:Ana Souza\nTEL;waid=5565999991234:+55 65 99999-1234\nEND:VCARD';
const BETO = 'BEGIN:VCARD\nVERSION:3.0\nFN:\nORG:Pizzaria do Ze;\nTEL:11999990000\nEND:VCARD';
const CARLA = 'BEGIN:VCARD\nVERSION:3.0\nFN:Carla Dias\nEMAIL:carla@exemplo.com\nEND:VCARD';
const SEM_NOME = 'BEGIN:VCARD\nVERSION:3.0\nFN:\nTEL:11988880000\nEND:VCARD';

function comAcervo(corpo: (acervo: Acervo, cv: string) => void): void {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const cv = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: '5565900000001@s.whatsapp.net',
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    corpo(acervo, cv);
  } finally {
    c.limpar();
  }
}

/** Mensagem ao vivo JA gravada, com o evento no bruto e SEM cartao (como as de antes desta tarefa, se existissem). */
function doAoVivo(acervo: Acervo, cv: string, idExterno: string, message: Record<string, unknown>): string {
  return registrarMensagem(acervo, {
    conversaId: cv,
    fonte: 'whatsapp',
    idExterno,
    ocorridaEm: Date.parse('2026-10-01T10:00:00Z'),
    agora: AGORA,
    direcao: 'enviada',
    bruto: JSON.stringify({ key: { id: idExterno }, message }),
  });
}

const multiplo = (...itens: Array<[string, string]>): Record<string, unknown> => ({
  contactsArrayMessage: { displayName: ROTULO, contacts: itens.map(([displayName, vcard]) => ({ displayName, vcard })) },
});

const contar = (acervo: Acervo): number =>
  (acervo.db.prepare('SELECT COUNT(*) AS n FROM contatos_compartilhados').get() as { n: number }).n;

test('o ensaio conta os cartoes do lote e NAO escreve; com efeito cria, em UMA Operacao, e a segunda passada nao faz nada', () => {
  comAcervo((acervo, cv) => {
    const id = doAoVivo(acervo, cv, 'x1', multiplo(['Ana Souza', ANA], ['Pizzaria', BETO], ['Carla Dias', CARLA]));
    const antes = listarOperacoesCruas(acervo).length;

    const ensaio = extrairContatosCompartilhados(acervo, { comEfeito: false });
    assert.equal(ensaio.gravou, false);
    assert.equal(ensaio.mensagensComCartao, 1);
    assert.equal(ensaio.cartoesACriar, 3);
    assert.equal(contar(acervo), 0, 'o ensaio escreveu');
    assert.equal(listarOperacoesCruas(acervo).length, antes, 'o ensaio abriu Operacao');

    const r = extrairContatosCompartilhados(acervo, { comEfeito: true });
    assert.equal(r.criados, 3);
    assert.deepEqual((lerContatosCompartilhados(acervo, [id]).get(id) ?? []).map((c) => c.nome), ['Ana Souza', 'Pizzaria do Ze', 'Carla Dias']);
    assert.equal(listarOperacoesCruas(acervo).length, antes + 1, 'uma Operacao para o lote');

    const de_novo = extrairContatosCompartilhados(acervo, { comEfeito: true });
    assert.equal(de_novo.mensagensComCartao, 0);
    assert.equal(contar(acervo), 3);
  });
});

test('o cartao multiplo CITADO dentro de outra Mensagem nao e extraido', () => {
  comAcervo((acervo, cv) => {
    doAoVivo(acervo, cv, 'q1', {
      extendedTextMessage: { text: 'respondendo', contextInfo: { quotedMessage: multiplo(['Ana Souza', ANA]) } },
    });
    const r = extrairContatosCompartilhados(acervo, { comEfeito: true });
    assert.equal(r.mensagensComCartao, 0);
    assert.equal(contar(acervo), 0);
  });
});

test('cartao ruim no meio e recusado e contado; o rotulo "N contatos" nunca e nome', () => {
  comAcervo((acervo, cv) => {
    doAoVivo(acervo, cv, 'r1', multiplo(['Ana Souza', ANA], ['', SEM_NOME], ['Lixo', 'isto nao e um cartao']));
    const r = extrairContatosCompartilhados(acervo, { comEfeito: true });
    assert.equal(r.criados, 1);
    assert.equal(r.recusados, 2);
    const nomes = acervo.db.prepare('SELECT nome FROM contatos_compartilhados').all() as Array<{ nome: string }>;
    assert.deepEqual(nomes.map((n) => n.nome), ['Ana Souza']);
  });
});

test('a Mensagem do cartao unico segue sendo extraida junto do multiplo', () => {
  comAcervo((acervo, cv) => {
    doAoVivo(acervo, cv, 'u1', { contactMessage: { displayName: 'Ana Souza', vcard: ANA } });
    doAoVivo(acervo, cv, 'm1', multiplo(['Pizzaria', BETO], ['Carla Dias', CARLA]));
    const r = extrairContatosCompartilhados(acervo, { comEfeito: true });
    assert.equal(r.mensagensComCartao, 2);
    assert.equal(r.criados, 3);
  });
});
