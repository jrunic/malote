import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { materialInstagramFalso } from './ajuda/material-instagram-falso.js';
import { importarMaterial } from '../src/adaptadores/whatsapp/importar.js';
import { importarMaterialDeInstagram } from '../src/adaptadores/instagram/importar.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { CFG_WHATSAPP, CFG_INSTAGRAM } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-08-31T12:00:00Z');

/** O bruto de UMA linha da tabela, como texto. Null quando a coluna nao foi gravada. */
function brutoDe(acervo: Acervo, tabela: string): string | null {
  const l = acervo.db.prepare(`SELECT bruto FROM ${tabela} LIMIT 1`).get() as
    | { bruto: string | null }
    | undefined;
  return l?.bruto ?? null;
}

/**
 * Material de WhatsApp com as quatro testemunhas NAO MODELADAS preenchidas.
 *
 * A assercao e sobre campo que o nucleo nao modela DE PROPOSITO: se o teste
 * medisse um campo modelado, ele passaria com o bruto vazio, porque a coluna
 * propria ja carregaria o valor. So o campo nao modelado distingue "preservou o
 * registro original" de "gravou o que ja sabia gravar".
 */
function materialComTestemunhas(): ReturnType<typeof backupFalso> {
  return backupFalso({
    conversas: [
      {
        pk: 1,
        endereco: '5565911110000-grupo@g.us',
        nome: 'Alianca Rebelde',
        tipoDeSessao: 1,
        arquivada: true, // ZARCHIVED — nao modelado
      },
    ],
    membros: [
      { pk: 1, endereco: '5565911110001@s.whatsapp.net', conversaPk: 1, administrador: true },
    ],
    mensagens: [
      {
        stanzaId: 'msg-1',
        chatSessionPk: 1,
        texto: 'ola',
        dataCoreData: paraCoreData('2026-01-10T10:00:00Z'),
        grupoMembroPk: 1,
        nomeTransmitido: 'Leia Organa', // ZPUSHNAME — nao modelado
        caminhoDeMidia: 'Media/foto.jpg',
        tamanhoDeMidia: 4096,
        conteudoDeMidia: 'bytes',
        latitude: -15.7942, // ZLATITUDE — nao modelado
      },
    ],
  });
}

test('WhatsApp: o bruto da Mensagem carrega campo que o nucleo NAO modela', () => {
  const c = cenario();
  const b = materialComTestemunhas();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP });

    const bruto = brutoDe(acervo, 'mensagens');
    assert.notEqual(bruto, null, 'a Mensagem tem de preservar o registro original');
    assert.match(bruto ?? '', /Leia Organa/, 'ZPUSHNAME sobreviveu a ida e volta');
    assert.match(bruto ?? '', /ZPUSHNAME/, 'o nome da coluna da Fonte tambem, senao nao se sabe o que e');
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('WhatsApp: o bruto da Conversa carrega campo que o nucleo NAO modela', () => {
  const c = cenario();
  const b = materialComTestemunhas();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP });
    assert.match(brutoDe(acervo, 'conversas') ?? '', /ZARCHIVED/);
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('WhatsApp: o bruto da Participacao carrega campo que o nucleo NAO modela', () => {
  const c = cenario();
  const b = materialComTestemunhas();
  try {
    const { acervo } = c.novoInquilino('Chewbacca');
    importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP });
    assert.match(brutoDe(acervo, 'participacoes') ?? '', /ZISADMIN/);
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('WhatsApp: o bruto do Anexo carrega LOCALIZACAO, que hoje some inteira', () => {
  const c = cenario();
  const b = materialComTestemunhas();
  try {
    const { acervo } = c.novoInquilino('Lando');
    importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP });
    // ZLATITUDE nao e metadado: mensagem de localizacao E o conteudo, e o
    // nucleo nao a modela. Sem o bruto ela desaparece sem deixar rastro.
    assert.match(brutoDe(acervo, 'anexos') ?? '', /ZLATITUDE/);
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('Instagram preserva o bruto nos MESMOS agregados — a simetria nao se inverte', () => {
  const c = cenario();
  const m = materialInstagramFalso([
    {
      slug: 'leiaorgana',
      numero: '111111111111111',
      title: 'Leia Organa',
      participants: ['Leia Organa', 'Titular Sintetico'],
      messages: [
        { sender_name: 'Leia Organa', timestamp_ms: 1_700_000_000_000, content: 'ola' },
      ],
    },
  ]);
  try {
    const { acervo } = c.novoInquilino('Titular');
    importarMaterialDeInstagram(acervo, m.raiz, { agora: AGORA, configuracao: CFG_INSTAGRAM, titular: 'Titular Sintetico' });
    assert.notEqual(brutoDe(acervo, 'mensagens'), null, 'Mensagem (ja fazia)');
    assert.notEqual(brutoDe(acervo, 'conversas'), null, 'Conversa');

    // O bruto da Conversa NAO repete as mensagens: cada Mensagem ja carrega o
    // proprio, e duplicar o vetor aqui dobraria o Acervo.
    assert.doesNotMatch(brutoDe(acervo, 'conversas') ?? '', /sender_name/);

    // A Participacao fica sem bruto NESTA Fonte, e isso e medido, nao omissao:
    // o export do Instagram oferece apenas `{ name }` por participante, e o
    // nome ja e modelado como Atribuicao de Nome. Nao ha registro original a
    // preservar. No WhatsApp ha linha de roster, e la o bruto e gravado.
    assert.equal(brutoDe(acervo, 'participacoes'), null);
  } finally {
    m.limpar();
    c.limpar();
  }
});
