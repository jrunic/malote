import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { deformar, materialInstagramFalso } from './ajuda/material-instagram-falso.js';
import { importarMaterial } from '../src/adaptadores/whatsapp/importar.js';
import { importarMaterialDeInstagram } from '../src/adaptadores/instagram/importar.js';
import { contarAcervo } from '../src/nucleo/consulta.js';
import { nomesDoIdentificador } from '../src/nucleo/identidade.js';
import { CFG_WHATSAPP, CFG_INSTAGRAM } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-08-27T12:00:00Z');

function identificadorPorValor(acervo: Acervo, valor: string): string {
  const l = acervo.db.prepare('SELECT id FROM identificadores WHERE valor = ?').get(valor) as
    | { id: string }
    | undefined;
  assert.ok(l, `o Identificador ${valor} precisa existir`);
  return l.id;
}

test('o nome do contato do WhatsApp vira nome do endereço, e não some', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const b = backupFalso({
      conversas: [
        { pk: 1, endereco: '5565911110000@s.whatsapp.net', nome: 'Han Solo', tipoDeSessao: 0 },
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

      const ident = identificadorPorValor(acervo, '5565911110000@s.whatsapp.net');
      const nomes = nomesDoIdentificador(acervo, ident);
      assert.equal(nomes.length, 1);
      assert.equal(nomes[0]?.nome, 'Han Solo');
      assert.equal(nomes[0]?.origem, 'whatsapp');
    } finally {
      b.limpar();
    }
  } finally {
    c.limpar();
  }
});

test('importar NÃO cria Pessoa nenhuma, mesmo nomeando endereços', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const b = backupFalso({
      conversas: [
        { pk: 1, endereco: '5565911110001@s.whatsapp.net', nome: 'Leia', tipoDeSessao: 0 },
        { pk: 2, endereco: '5565911110002@s.whatsapp.net', nome: 'Chewie', tipoDeSessao: 0 },
      ],
      mensagens: [],
    });
    try {
      importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP });
      assert.equal(contarAcervo(acervo).pessoas, 0);
    } finally {
      b.limpar();
    }
  } finally {
    c.limpar();
  }
});

test('reimportar o mesmo material não duplica o nome do endereço', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const b = backupFalso({
      conversas: [
        { pk: 1, endereco: '5565911110003@s.whatsapp.net', nome: 'Han Solo', tipoDeSessao: 0 },
      ],
      mensagens: [],
    });
    try {
      importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP });
      importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP });
      const ident = identificadorPorValor(acervo, '5565911110003@s.whatsapp.net');
      assert.equal(nomesDoIdentificador(acervo, ident).length, 1);
    } finally {
      b.limpar();
    }
  } finally {
    c.limpar();
  }
});

test('o título da Conversa direta do Instagram vira nome da contraparte', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const m = materialInstagramFalso([
      {
        slug: 'hansolo',
        numero: '1234',
        title: deformar('Han Solo'),
        participants: [deformar('Han Solo'), deformar('Titular')],
        messages: [
          {
            sender_name: deformar('Han Solo'),
            timestamp_ms: 1_623_751_200_000,
            content: deformar('nunca me diga as chances'),
          },
        ],
      },
    ]);
    try {
      importarMaterialDeInstagram(acervo, m.raiz, { agora: AGORA, configuracao: CFG_INSTAGRAM, titular: 'Titular' });

      // O idExterno e SO o numero depois do ultimo sublinhado — medido em
      // numeroDaConversa(), nao suposto: o nome do diretorio e
      // <slug>_<numero>, mas o identificador durável é o número.
      const ident = identificadorPorValor(acervo, 'conversa:1234');
      const nomes = nomesDoIdentificador(acervo, ident);
      assert.equal(nomes.length, 1);
      assert.equal(nomes[0]?.nome, 'Han Solo');
      assert.equal(nomes[0]?.origem, 'instagram');
    } finally {
      m.limpar();
    }
  } finally {
    c.limpar();
  }
});
