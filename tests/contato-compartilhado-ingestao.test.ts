import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { importarMaterial } from '../src/adaptadores/whatsapp/importar.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { SEPARADOR_DE_CARTOES, SEPARADOR_DE_NOMES } from '../src/adaptadores/whatsapp/contato-compartilhado.js';
import { lerContatosCompartilhados } from '../src/nucleo/contato-compartilhado.js';
import { idDeMensagemPorExterno } from '../src/nucleo/escrita.js';
import type { Acervo } from '../src/nucleo/acervo.js';

const AGORA = Date.parse('2026-10-13T12:00:00Z');
const EM_USO = '2021-06-15T10:00:00Z';
const ENDERECO = '5511900000001@s.whatsapp.net';

const ANA =
  'BEGIN:VCARD\nVERSION:3.0\nFN:Ana Souza\nORG:Eletrica Souza;\n' +
  'TEL;type=CELL;waid=5565999991234:+55 65 99999-1234\nEND:VCARD';
const BETO = 'BEGIN:VCARD\nVERSION:3.0\nFN:\nORG:Pizzaria do Ze;\nTEL:11999990000\nEND:VCARD';

function backupComContato(cartoes: string, nomes?: string, stanzaId = 'c1') {
  return backupFalso({
    conversas: [{ pk: 1, endereco: ENDERECO, nome: 'Leia', tipoDeSessao: 0 }],
    mensagens: [
      { stanzaId: 'm0', chatSessionPk: 1, texto: 'oi', dataCoreData: paraCoreData(EM_USO) },
      {
        stanzaId,
        chatSessionPk: 1,
        texto: null,
        dataCoreData: paraCoreData(EM_USO),
        tipo: 4,
        cartoes,
        ...(nomes === undefined ? {} : { nomesDosCartoes: nomes }),
      },
    ],
  });
}

function eventoComContato(id: string, contactMessage: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    key: { remoteJid: ENDERECO, id, fromMe: false },
    messageTimestamp: Math.floor(Date.parse('2026-10-01T10:00:00Z') / 1000),
    pushName: 'Leia Organa',
    message: { contactMessage, ...extra },
  };
}

function cartoesDe(acervo: Acervo, idExterno: string) {
  const id = idDeMensagemPorExterno(acervo, { fonte: 'whatsapp', idExterno }) as string;
  return lerContatosCompartilhados(acervo, [id]).get(id) ?? [];
}

function contar(acervo: Acervo, tabela: string): number {
  return (acervo.db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number }).n;
}

test('backup: o Anexo contact vira Contato Compartilhado da Mensagem, e o Anexo segue como estava', () => {
  const c = cenario();
  const b = backupComContato(ANA, 'Ana Souza');
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const r = importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });

    assert.equal(r.contatosCompartilhadosCriados, 1);
    assert.equal(r.contatosCompartilhadosRecusados, 0);
    const lidos = cartoesDe(acervo, 'c1');
    assert.equal(lidos[0]?.nome, 'Ana Souza');
    assert.equal(lidos[0]?.valores[0]?.digitos, '5565999991234');
    const anexo = acervo.db.prepare("SELECT presenca, bruto FROM anexos WHERE tipo = 'contact'").get() as {
      presenca: string;
      bruto: string;
    };
    assert.equal(anexo.presenca, 'nunca-obtido', 'o Anexo contact nao muda');
    assert.ok(anexo.bruto.includes('Ana Souza'), 'o bruto do Anexo segue inteiro');
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('backup: varios cartoes no mesmo Anexo, e o nome vazio cai na organizacao', () => {
  const c = cenario();
  const b = backupComContato([ANA, BETO].join(SEPARADOR_DE_CARTOES), ['Ana Souza', 'Pizzaria'].join(SEPARADOR_DE_NOMES));
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const r = importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });
    assert.equal(r.contatosCompartilhadosCriados, 2);
    assert.deepEqual(cartoesDe(acervo, 'c1').map((x) => x.nome), ['Ana Souza', 'Pizzaria do Ze']);
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('backup: reimportar nao cria nem altera nada', () => {
  const c = cenario();
  const b = backupComContato(ANA, 'Ana Souza');
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });
    const antes = acervo.db.prepare('SELECT id, nome FROM contatos_compartilhados').all();

    const r = importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });

    assert.equal(r.contatosCompartilhadosCriados, 0);
    assert.deepEqual(acervo.db.prepare('SELECT id, nome FROM contatos_compartilhados').all(), antes);
    assert.equal(contar(acervo, 'valores_de_contato_compartilhado'), 1);
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('backup: cartao ilegivel e recusado e contado, e a importacao segue', () => {
  const c = cenario();
  const b = backupComContato('isto nao e um cartao');
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const r = importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });
    assert.equal(r.contatosCompartilhadosCriados, 0);
    assert.equal(r.contatosCompartilhadosRecusados, 1);
    assert.equal(r.mensagensCriadas, 2, 'a Mensagem do cartao entra do mesmo jeito');
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('ao vivo: o contactMessage do topo do evento vira Contato Compartilhado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const r = receberEvento(acervo, [eventoComContato('V1', { displayName: 'Ana Souza', vcard: ANA })], {
      agora: AGORA,
      configuracao: CFG_WHATSAPP,
    });
    assert.equal(r.gravados, 1);
    assert.equal(r.contatosCompartilhados, 1);
    assert.equal(cartoesDe(acervo, 'V1')[0]?.nome, 'Ana Souza');
  } finally {
    c.limpar();
  }
});

test('ao vivo: o mesmo evento de novo (reentrega) nao cria nem altera cartao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const evento = eventoComContato('V1', { displayName: 'Ana Souza', vcard: ANA });
    receberEvento(acervo, [evento], { agora: AGORA, configuracao: CFG_WHATSAPP });
    const antes = acervo.db.prepare('SELECT id FROM contatos_compartilhados').all();
    const r = receberEvento(acervo, [evento], { agora: AGORA, configuracao: CFG_WHATSAPP });
    assert.equal(r.contatosCompartilhados, 0);
    assert.deepEqual(acervo.db.prepare('SELECT id FROM contatos_compartilhados').all(), antes);
  } finally {
    c.limpar();
  }
});

test('ao vivo: contactMessage dentro de uma citacao NAO e cartao enviado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const citacao = {
      key: { remoteJid: ENDERECO, id: 'Q1', fromMe: false },
      messageTimestamp: Math.floor(Date.parse('2026-10-01T10:00:00Z') / 1000),
      pushName: 'Leia Organa',
      message: {
        extendedTextMessage: {
          text: 'respondendo ao contato',
          contextInfo: { quotedMessage: { contactMessage: { displayName: 'Ana Souza', vcard: ANA } } },
        },
      },
    };
    const r = receberEvento(acervo, [citacao], { agora: AGORA, configuracao: CFG_WHATSAPP });
    assert.equal(r.gravados, 1, 'a resposta e uma Mensagem');
    assert.equal(r.contatosCompartilhados, 0);
    assert.equal(contar(acervo, 'contatos_compartilhados'), 0);
  } finally {
    c.limpar();
  }
});

test('ao vivo: cartao sem nome no vCard usa o nome de exibicao do evento; sem nenhum, recusa e conta', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const semNome = 'BEGIN:VCARD\nVERSION:3.0\nFN:\nTEL:11999990000\nEND:VCARD';
    const r1 = receberEvento(acervo, [eventoComContato('V1', { displayName: 'Nome do Evento', vcard: semNome })], {
      agora: AGORA,
      configuracao: CFG_WHATSAPP,
    });
    assert.equal(r1.contatosCompartilhados, 1);
    assert.equal(cartoesDe(acervo, 'V1')[0]?.nome, 'Nome do Evento');

    const r2 = receberEvento(acervo, [eventoComContato('V2', { vcard: semNome })], {
      agora: AGORA,
      configuracao: CFG_WHATSAPP,
    });
    assert.equal(r2.contatosCompartilhados, 0);
    assert.equal(r2.contatosCompartilhadosRecusados, 1);
    assert.equal(r2.gravados, 1, 'a Mensagem entra mesmo sem cartao aproveitavel');
  } finally {
    c.limpar();
  }
});

test('convergencia: a mesma Mensagem pelo ao vivo e pelo backup termina com UM cartao, nao dois', () => {
  const c = cenario();
  const b = backupComContato(ANA, 'Ana Souza', 'V1');
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    receberEvento(acervo, [eventoComContato('V1', { displayName: 'Ana Souza', vcard: ANA })], {
      agora: AGORA,
      configuracao: CFG_WHATSAPP,
    });
    assert.equal(contar(acervo, 'contatos_compartilhados'), 1);

    const r = importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });

    assert.equal(r.contatosCompartilhadosCriados, 0, 'conjunto igual ao gravado nao escreve');
    assert.equal(contar(acervo, 'contatos_compartilhados'), 1, 'N cartoes, e nao 2N');
    assert.equal(contar(acervo, 'valores_de_contato_compartilhado'), 1);
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('o Conteudo Bruto da Mensagem nao muda: o cartao e derivado, nunca editado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const evento = eventoComContato('V1', { displayName: 'Ana Souza', vcard: ANA });
    receberEvento(acervo, [evento], { agora: AGORA, configuracao: CFG_WHATSAPP });
    const bruto = (acervo.db.prepare('SELECT bruto FROM mensagens').get() as { bruto: string }).bruto;
    assert.equal(bruto, JSON.stringify(evento));
  } finally {
    c.limpar();
  }
});
