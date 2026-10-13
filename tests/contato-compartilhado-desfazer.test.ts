import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import { registrarAnexo, registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { desfazerOperacao } from '../src/nucleo/desfazer.js';
import { listarOperacoesCruas, linhasDaOperacao } from '../src/nucleo/trilha.js';
import { extrairContatosCompartilhados } from '../src/adaptadores/whatsapp/extrair-contatos-compartilhados.js';
import { SEPARADOR_DE_CARTOES } from '../src/adaptadores/whatsapp/contato-compartilhado.js';

const AGORA = Date.parse('2026-10-13T12:00:00Z');
const ANA = 'BEGIN:VCARD\nVERSION:3.0\nFN:Ana Souza\nTEL;waid=5565999991234:+55 65 99999-1234\nEND:VCARD';
const BETO = 'BEGIN:VCARD\nVERSION:3.0\nFN:\nORG:Pizzaria do Ze;\nTEL:11999990000\nEND:VCARD';

function conversa(acervo: Acervo): string {
  return registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: '5565900000001@s.whatsapp.net',
    coletiva: false,
    configuracao: CFG_WHATSAPP,
  });
}

function mensagem(acervo: Acervo, cv: string, idExterno: string, bruto: string): string {
  return registrarMensagem(acervo, {
    conversaId: cv,
    fonte: 'whatsapp',
    idExterno,
    ocorridaEm: Date.parse('2026-10-01T10:00:00Z'),
    agora: AGORA,
    direcao: 'recebida',
    bruto,
  });
}

/** Mensagem do BACKUP: o cartao esta no bruto do Anexo `contact`, e a Mensagem nao tem cartao gravado. */
function doBackup(acervo: Acervo, cv: string, idExterno: string, cartoes: string, nomes = ''): string {
  const id = mensagem(acervo, cv, idExterno, '{}');
  registrarAnexo(acervo, {
    mensagemId: id,
    tipo: 'contact',
    presenca: 'nunca-obtido',
    bruto: JSON.stringify({ ZVCARDSTRING: cartoes, ZVCARDNAME: nomes }),
  });
  return id;
}

/** Mensagem do AO VIVO: o cartao esta no bruto do evento, e a Mensagem nao tem cartao gravado. */
function comAcervo(corpo: (acervo: Acervo, cv: string) => void): void {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    corpo(acervo, conversa(acervo));
  } finally {
    c.limpar();
  }
}

const contar = (acervo: Acervo): number =>
  (acervo.db.prepare('SELECT COUNT(*) AS n FROM contatos_compartilhados').get() as { n: number }).n;

test('o preenchimento grava UMA Operacao com um efeito por cartao, e desfazer remove os cartoes', () => {
  comAcervo((acervo, cv) => {
    doBackup(acervo, cv, 'b1', [ANA, BETO].join(SEPARADOR_DE_CARTOES));
    extrairContatosCompartilhados(acervo, { comEfeito: true });

    const operacao = listarOperacoesCruas(acervo).find((o) => o.natureza === 'extrair-contatos-compartilhados');
    assert.ok(operacao, 'a Operacao nao foi gravada');
    assert.equal(operacao.reversibilidade, 'por-efeito');
    assert.equal(linhasDaOperacao(acervo, operacao.id).length, 2, 'um efeito por cartao criado');

    const r = desfazerOperacao(acervo, operacao.id);

    assert.equal(r.desfeitos, 2);
    assert.deepEqual(r.recusados, []);
    assert.equal(contar(acervo), 0);
    assert.equal((acervo.db.prepare('SELECT COUNT(*) AS n FROM valores_de_contato_compartilhado').get() as { n: number }).n, 0);
    const naBusca = acervo.db
      .prepare("SELECT COUNT(*) AS n FROM contatos_compartilhados_texto WHERE contatos_compartilhados_texto MATCH 'Souza'")
      .get() as { n: number };
    assert.equal(naBusca.n, 0, 'a linha da busca tem de sair junto');
  });
});
