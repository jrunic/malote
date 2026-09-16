import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nomeRepeteOEndereco } from '../src/nucleo/nome-do-endereco.js';

test('o mesmo numero em formatos diferentes e reconhecido', () => {
  assert.equal(nomeRepeteOEndereco('+55 11 99999-0008', '5511999990008@s.whatsapp.net'), true);
});

test('o mesmo numero embrulhado em marca invisivel tambem e reconhecido', () => {
  const embrulhado = '\u202A+55\u00A011 99999\u20110008\u202C';
  assert.notEqual(embrulhado, '+55 11 99999-0008');
  assert.equal(nomeRepeteOEndereco(embrulhado, '5511999990008@s.whatsapp.net'), true);
});

test('nome humano nao e recusado', () => {
  assert.equal(nomeRepeteOEndereco('Ana Prado', '5511999990008@s.whatsapp.net'), false);
});

test('numero de OUTRA pessoa no nome nao e recusado', () => {
  assert.equal(nomeRepeteOEndereco('+55 11 98888-7777', '5511999990008@s.whatsapp.net'), false);
});

test('sequencia curta de digitos nao dispara a regra', () => {
  assert.equal(nomeRepeteOEndereco('Turma 2024', '5511999990008@s.whatsapp.net'), false);
});

test('nome vazio nao dispara a regra', () => {
  assert.equal(nomeRepeteOEndereco('', '5511999990008@s.whatsapp.net'), false);
});

// --- a recusa no importador: CONTADA, e sem gravar nome ---

import { cenario } from './ajuda/acervo.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { importarMaterial } from '../src/adaptadores/whatsapp/importar.js';
import { nomesDoIdentificador } from '../src/nucleo/identidade.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-09-12T12:00:00Z');

test('nome que repete o endereco e recusado e CONTADO, nunca em silencio', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const b = backupFalso({
      conversas: [
        // A Fonte preencheu o campo de nome com o proprio numero — o caso de
        // 1.271 linhas do Acervo real.
        {
          pk: 1,
          endereco: '5565911110000@s.whatsapp.net',
          nome: '+55 65 91111-0000',
          tipoDeSessao: 0,
        },
        // Controle: nome humano na mesma passagem, para provar que a regra nao
        // recusa em bloco.
        { pk: 2, endereco: '5565922220000@s.whatsapp.net', nome: 'Han Solo', tipoDeSessao: 0 },
      ],
      mensagens: [
        { stanzaId: 'm1', chatSessionPk: 1, texto: 'ola', dataCoreData: paraCoreData('2021-06-15T10:00:00Z') },
        { stanzaId: 'm2', chatSessionPk: 2, texto: 'oi', dataCoreData: paraCoreData('2021-06-15T10:01:00Z') },
      ],
    });
    try {
      const r = importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP });

      assert.equal(r.nomesQueRepetemOEndereco, 1, 'a recusa e contada');

      const recusado = acervo.db
        .prepare('SELECT id FROM identificadores WHERE valor = ?')
        .get('5565911110000@s.whatsapp.net') as { id: string } | undefined;
      assert.ok(recusado);
      assert.equal(nomesDoIdentificador(acervo, recusado.id).length, 0, 'e nenhum nome gravado');

      const humano = acervo.db
        .prepare('SELECT id FROM identificadores WHERE valor = ?')
        .get('5565922220000@s.whatsapp.net') as { id: string } | undefined;
      assert.ok(humano);
      assert.equal(nomesDoIdentificador(acervo, humano.id)[0]?.nome, 'Han Solo');
    } finally {
      b.limpar();
    }
  } finally {
    c.limpar();
  }
});
