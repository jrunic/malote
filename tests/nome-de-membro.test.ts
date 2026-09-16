import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { lerMaterial } from '../src/adaptadores/whatsapp/material.js';

function coletivaDo(raiz: string) {
  const m = lerMaterial(raiz);
  const c = m.conversas.find((x) => x.coletiva);
  assert.ok(c, 'a coletiva precisa existir');
  return c;
}

test('o nome do membro de coletiva chega no participante', () => {
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: '5565911110000@g.us', nome: 'Grupo', tipoDeSessao: 1 }],
    membros: [{ pk: 10, endereco: '5565922220000@s.whatsapp.net', conversaPk: 1, nome: 'Ana' }],
    mensagens: [
      {
        stanzaId: 'm1',
        chatSessionPk: 1,
        texto: 'ola',
        dataCoreData: paraCoreData('2021-06-15T10:00:00Z'),
      },
    ],
  });
  try {
    assert.equal(coletivaDo(b.raiz).participantesConhecidos[0]?.nome, 'Ana');
  } finally {
    b.limpar();
  }
});

test('o nome COMPLETO prevalece sobre o primeiro nome', () => {
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: '5565911110001@g.us', nome: 'Grupo', tipoDeSessao: 1 }],
    membros: [
      {
        pk: 10,
        endereco: '5565922220001@s.whatsapp.net',
        conversaPk: 1,
        nome: 'Ana',
        nomeCompleto: 'Ana Prado',
      },
    ],
    mensagens: [
      {
        stanzaId: 'm1',
        chatSessionPk: 1,
        texto: 'ola',
        dataCoreData: paraCoreData('2021-06-15T10:00:00Z'),
      },
    ],
  });
  try {
    assert.equal(coletivaDo(b.raiz).participantesConhecidos[0]?.nome, 'Ana Prado');
  } finally {
    b.limpar();
  }
});

test('nome completo VAZIO cai para o primeiro nome — o material real grava assim', () => {
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: '5565911110005@g.us', nome: 'Grupo', tipoDeSessao: 1 }],
    membros: [
      {
        pk: 10,
        endereco: '5565922220005@s.whatsapp.net',
        conversaPk: 1,
        nome: 'Ana',
        // STRING VAZIA, e nao ausente. Medido no material de 05/09: a coluna do
        // nome completo vem preenchida com '' na maioria das linhas, e `??` so
        // cai para o segundo quando o primeiro e nulo — com '' ele devolve ''.
        nomeCompleto: '',
      },
    ],
    mensagens: [
      {
        stanzaId: 'm1',
        chatSessionPk: 1,
        texto: 'ola',
        dataCoreData: paraCoreData('2021-06-15T10:00:00Z'),
      },
    ],
  });
  try {
    assert.equal(coletivaDo(b.raiz).participantesConhecidos[0]?.nome, 'Ana');
  } finally {
    b.limpar();
  }
});

test('membro sem nenhum dos dois campos nao inventa nome', () => {
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: '5565911110002@g.us', nome: 'Grupo', tipoDeSessao: 1 }],
    membros: [{ pk: 10, endereco: '5565922220002@s.whatsapp.net', conversaPk: 1 }],
    mensagens: [
      {
        stanzaId: 'm1',
        chatSessionPk: 1,
        texto: 'ola',
        dataCoreData: paraCoreData('2021-06-15T10:00:00Z'),
      },
    ],
  });
  try {
    assert.equal(coletivaDo(b.raiz).participantesConhecidos[0]?.nome, undefined);
  } finally {
    b.limpar();
  }
});

// --- o importador grava a Atribuicao do membro ---

import { cenario } from './ajuda/acervo.js';
import { importarMaterial } from '../src/adaptadores/whatsapp/importar.js';
import { nomesDoIdentificador } from '../src/nucleo/identidade.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import type { Acervo } from '../src/nucleo/acervo.js';

const AGORA = Date.parse('2026-09-13T12:00:00Z');

function identPorValor(acervo: Acervo, valor: string): string {
  const l = acervo.db.prepare('SELECT id FROM identificadores WHERE valor = ?').get(valor) as
    | { id: string }
    | undefined;
  assert.ok(l, `o Identificador ${valor} precisa existir`);
  return l.id;
}

test('o nome do membro vira Atribuicao no Identificador dele, com autoridade titular', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const b = backupFalso({
      conversas: [{ pk: 1, endereco: '5565911110003@g.us', nome: 'Grupo', tipoDeSessao: 1 }],
      membros: [
        { pk: 10, endereco: '5565922220003@s.whatsapp.net', conversaPk: 1, nome: 'Ana Prado' },
      ],
      mensagens: [
        {
          stanzaId: 'm1',
          chatSessionPk: 1,
          texto: 'ola',
          dataCoreData: paraCoreData('2021-06-15T10:00:00Z'),
        },
      ],
    });
    try {
      importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP });
      const nomes = nomesDoIdentificador(
        acervo,
        identPorValor(acervo, '5565922220003@s.whatsapp.net'),
      );
      assert.equal(nomes.length, 1);
      assert.equal(nomes[0]?.nome, 'Ana Prado');
      assert.equal(nomes[0]?.autoridade, 'titular');
    } finally {
      b.limpar();
    }
  } finally {
    c.limpar();
  }
});

test('nome de membro que repete o proprio endereco tambem e recusado e contado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const b = backupFalso({
      conversas: [{ pk: 1, endereco: '5565911110004@g.us', nome: 'Grupo', tipoDeSessao: 1 }],
      membros: [
        {
          pk: 10,
          endereco: '5565922220004@s.whatsapp.net',
          conversaPk: 1,
          nome: '+55 65 92222-0004',
        },
      ],
      mensagens: [
        {
          stanzaId: 'm1',
          chatSessionPk: 1,
          texto: 'ola',
          dataCoreData: paraCoreData('2021-06-15T10:00:00Z'),
        },
      ],
    });
    try {
      const r = importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP });
      assert.equal(r.nomesQueRepetemOEndereco, 1);
      assert.equal(
        nomesDoIdentificador(acervo, identPorValor(acervo, '5565922220004@s.whatsapp.net'))
          .length,
        0,
      );
    } finally {
      b.limpar();
    }
  } finally {
    c.limpar();
  }
});
