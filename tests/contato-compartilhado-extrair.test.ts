import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_INSTAGRAM, CFG_WHATSAPP } from './ajuda/configuracao.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import { registrarAnexo, registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { lerContatosCompartilhados, registrarContatosCompartilhados } from '../src/nucleo/contato-compartilhado.js';
import { listarOperacoesCruas } from '../src/nucleo/trilha.js';
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
function doAoVivo(acervo: Acervo, cv: string, idExterno: string, message: Record<string, unknown>): string {
  return mensagem(acervo, cv, idExterno, JSON.stringify({ key: { id: idExterno }, message }));
}

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

test('o ensaio conta o que criaria e NAO escreve nada', () => {
  comAcervo((acervo, cv) => {
    doBackup(acervo, cv, 'b1', ANA);
    doAoVivo(acervo, cv, 'v1', { contactMessage: { displayName: 'Beto', vcard: BETO } });
    const operacoesAntes = listarOperacoesCruas(acervo).length;

    const r = extrairContatosCompartilhados(acervo, { comEfeito: false });

    assert.equal(r.gravou, false);
    assert.equal(r.mensagensComCartao, 2);
    assert.equal(r.cartoesACriar, 2);
    assert.equal(r.criados, 0);
    assert.equal(contar(acervo), 0, 'o ensaio escreveu');
    assert.equal(listarOperacoesCruas(acervo).length, operacoesAntes, 'o ensaio abriu Operacao');
  });
});

test('com efeito, cria os cartoes das duas origens, e a segunda passada nao cria nada', () => {
  comAcervo((acervo, cv) => {
    const b = doBackup(acervo, cv, 'b1', [ANA, BETO].join(SEPARADOR_DE_CARTOES));
    const v = doAoVivo(acervo, cv, 'v1', { contactMessage: { displayName: 'Beto', vcard: BETO } });

    const r = extrairContatosCompartilhados(acervo, { comEfeito: true });

    assert.equal(r.gravou, true);
    assert.equal(r.criados, 3);
    assert.deepEqual((lerContatosCompartilhados(acervo, [b]).get(b) ?? []).map((c) => c.nome), ['Ana Souza', 'Pizzaria do Ze']);
    // FN vazio e ORG presente: a organizacao vem ANTES do nome de exibicao do evento (ordem da spec).
    assert.equal(lerContatosCompartilhados(acervo, [v]).get(v)?.[0]?.nome, 'Pizzaria do Ze');

    const operacoes = listarOperacoesCruas(acervo).length;
    const de_novo = extrairContatosCompartilhados(acervo, { comEfeito: true });
    assert.equal(de_novo.mensagensComCartao, 0);
    assert.equal(de_novo.criados, 0);
    assert.equal(contar(acervo), 3);
    assert.equal(listarOperacoesCruas(acervo).length, operacoes, 'sem trabalho, nao abre Operacao');
  });
});

test('a Mensagem que esta nos dois caminhos e extraida UMA vez', () => {
  comAcervo((acervo, cv) => {
    // Nomes DIFERENTES nos dois lados, para a prova dizer quem vence: o backup.
    const aoVivo = ANA.replace('FN:Ana Souza', 'FN:Ana Do Evento');
    const id = mensagem(acervo, cv, 'x1', JSON.stringify({ message: { contactMessage: { displayName: 'Ana', vcard: aoVivo } } }));
    registrarAnexo(acervo, {
      mensagemId: id,
      tipo: 'contact',
      presenca: 'nunca-obtido',
      bruto: JSON.stringify({ ZVCARDSTRING: ANA, ZVCARDNAME: 'Ana Souza' }),
    });

    const r = extrairContatosCompartilhados(acervo, { comEfeito: true });

    assert.equal(r.mensagensComCartao, 1);
    assert.equal(r.criados, 1, 'N cartoes, e nao 2N');
    assert.equal(contar(acervo), 1);
    assert.equal(lerContatosCompartilhados(acervo, [id]).get(id)?.[0]?.nome, 'Ana Souza', 'o backup vence o ao vivo');
  });
});

test('Mensagem que ja tem cartao nao e tocada', () => {
  comAcervo((acervo, cv) => {
    const id = doBackup(acervo, cv, 'b1', ANA);
    registrarContatosCompartilhados(acervo, id, [
      { nome: 'Gravado antes', organizacao: null, nomeComercial: null, valores: [] },
    ]);
    const r = extrairContatosCompartilhados(acervo, { comEfeito: true });
    assert.equal(r.mensagensComCartao, 0);
    assert.equal(lerContatosCompartilhados(acervo, [id]).get(id)?.[0]?.nome, 'Gravado antes');
  });
});

test('contactMessage dentro de citacao nao e extraido', () => {
  comAcervo((acervo, cv) => {
    doAoVivo(acervo, cv, 'q1', {
      extendedTextMessage: {
        text: 'respondendo',
        contextInfo: { quotedMessage: { contactMessage: { displayName: 'Ana', vcard: ANA } } },
      },
    });
    const r = extrairContatosCompartilhados(acervo, { comEfeito: true });
    assert.equal(r.mensagensComCartao, 0);
    assert.equal(contar(acervo), 0);
  });
});

test('Mensagem de OUTRA Fonte com a mesma chave no bruto nao e extraida', () => {
  comAcervo((acervo) => {
    const cv = registrarConversa(acervo, {
      fonte: 'instagram',
      idExterno: 'ig-1',
      coletiva: false,
      configuracao: CFG_INSTAGRAM,
    });
    registrarMensagem(acervo, {
      conversaId: cv,
      fonte: 'instagram',
      idExterno: 'ig-m1',
      ocorridaEm: Date.parse('2026-10-01T10:00:00Z'),
      agora: AGORA,
      direcao: 'recebida',
      bruto: JSON.stringify({ message: { contactMessage: { displayName: 'Ana', vcard: ANA } } }),
    });
    const r = extrairContatosCompartilhados(acervo, { comEfeito: true });
    assert.equal(r.mensagensComCartao, 0, 'o formato do cartao e do WhatsApp');
    assert.equal(contar(acervo), 0);
  });
});

test('cartao ilegivel e contado como recusado e nao abre Operacao', () => {
  comAcervo((acervo, cv) => {
    doBackup(acervo, cv, 'b1', 'isto nao e um cartao');
    const operacoes = listarOperacoesCruas(acervo).length;
    const r = extrairContatosCompartilhados(acervo, { comEfeito: true });
    assert.equal(r.recusados, 1);
    assert.equal(r.criados, 0);
    assert.equal(r.gravou, false);
    assert.equal(listarOperacoesCruas(acervo).length, operacoes);
  });
});

test('o bruto da Mensagem e do Anexo nao muda', () => {
  comAcervo((acervo, cv) => {
    doBackup(acervo, cv, 'b1', ANA);
    const antes = JSON.stringify([
      acervo.db.prepare('SELECT bruto FROM mensagens').all(),
      acervo.db.prepare('SELECT bruto FROM anexos').all(),
    ]);
    extrairContatosCompartilhados(acervo, { comEfeito: true });
    const depois = JSON.stringify([
      acervo.db.prepare('SELECT bruto FROM mensagens').all(),
      acervo.db.prepare('SELECT bruto FROM anexos').all(),
    ]);
    assert.equal(depois, antes);
  });
});
