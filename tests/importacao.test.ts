import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { importarMaterial } from '../src/adaptadores/whatsapp/importar.js';
import { contarAcervo, listarConversas, lerMensagens } from '../src/nucleo/consulta.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-08-26T12:00:00Z');
const EM_USO = '2021-06-15T10:00:00Z';

/** Backup com duas conversas, uma coletiva, e quatro mensagens. */
function backupComum() {
  return backupFalso({
    conversas: [
      { pk: 1, endereco: '5511900000001@s.whatsapp.net', nome: 'Leia', tipoDeSessao: 0 },
      { pk: 2, endereco: '120363000000000000@g.us', nome: 'Conselho', tipoDeSessao: 1 },
    ],
    membros: [{ pk: 7, endereco: '5511900000002@s.whatsapp.net', conversaPk: 2 }],
    mensagens: [
      { stanzaId: 'm1', chatSessionPk: 1, texto: 'relatorio de bordo', dataCoreData: paraCoreData(EM_USO) },
      { stanzaId: 'm2', chatSessionPk: 1, texto: 'mando hoje', dataCoreData: paraCoreData(EM_USO), daPropriaPessoa: true },
      { stanzaId: 'm3', chatSessionPk: 2, texto: 'no grupo', dataCoreData: paraCoreData(EM_USO), grupoMembroPk: 7 },
      { stanzaId: 'm4', chatSessionPk: 2, texto: null, dataCoreData: paraCoreData(EM_USO), tipo: 2, caminhoDeMidia: 'Media/v/VID_1.mp4' },
    ],
  });
}

test('importar traz conversas, mensagens e anexos para o Acervo', () => {
  const c = cenario();
  const b = backupComum();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const relatorio = importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });

    assert.equal(relatorio.conversasCriadas, 2);
    assert.equal(relatorio.mensagensCriadas, 4);
    assert.equal(relatorio.anexosCriados, 1);

    const n = contarAcervo(acervo);
    assert.equal(n.conversas, 2);
    assert.equal(n.mensagens, 4);
    assert.equal(n.anexos, 1);

    const coletiva = listarConversas(acervo, { coletiva: true });
    assert.equal(coletiva.length, 1);
    assert.equal(coletiva[0]?.assunto, 'Conselho');
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('reimportar o mesmo material não duplica nada', () => {
  const c = cenario();
  const b = backupComum();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const primeira = importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });
    const antes = contarAcervo(acervo);

    const segunda = importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });
    const depois = contarAcervo(acervo);

    assert.deepEqual(depois, antes, 'as contagens tem de ser identicas apos reimportar');
    assert.equal(segunda.mensagensCriadas, 0);
    assert.equal(segunda.mensagensJaExistentes, primeira.mensagensCriadas);
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('mensagem sem instante na origem é rejeitada e contada por motivo', () => {
  const c = cenario();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'x@s.whatsapp.net', nome: null, tipoDeSessao: 0 }],
    mensagens: [
      { stanzaId: 'boa', chatSessionPk: 1, texto: 'com data', dataCoreData: paraCoreData(EM_USO) },
      { stanzaId: 'ruim', chatSessionPk: 1, texto: 'sem data', dataCoreData: null },
    ],
  });
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const relatorio = importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });

    assert.equal(relatorio.mensagensCriadas, 1);
    assert.equal(relatorio.mensagensRejeitadas, 1);

    // Contabilizada POR MOTIVO: "rejeitada" sem causa não diz o que fazer.
    const motivos = Object.entries(relatorio.rejeicoesPorMotivo);
    assert.equal(motivos.length, 1);
    assert.match(motivos[0]?.[0] ?? '', /instante/);
    assert.equal(motivos[0]?.[1], 1);

    assert.equal(contarAcervo(acervo).mensagens, 1, 'a rejeitada nao entra no Acervo');
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('nenhuma mensagem some sem registro: criadas + já existentes + rejeitadas = lidas', () => {
  const c = cenario();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'x@s.whatsapp.net', nome: null, tipoDeSessao: 0 }],
    mensagens: [
      { stanzaId: 'a', chatSessionPk: 1, texto: '1', dataCoreData: paraCoreData(EM_USO) },
      { stanzaId: 'b', chatSessionPk: 1, texto: '2', dataCoreData: null },
      { stanzaId: 'c', chatSessionPk: 1, texto: '3', dataCoreData: paraCoreData(EM_USO) },
    ],
  });
  try {
    const { acervo } = c.novoInquilino('Leia Organa');

    // A soma tem de fechar nas DUAS importações: só na primeira, o ramo de
    // "ja existente" nunca é exercitado.
    //
    // O que este teste NÃO pega, medido em 26/08/2026: defeito que RECLASSIFICA
    // — contar uma já existente como criada mantém o total, e a soma fecha
    // igual. Quem pega isso é `reimportar o mesmo material não duplica nada`,
    // que assere `mensagensCriadas === 0` na segunda. Os dois medem invariantes
    // diferentes, e nenhum cobre o do outro.
    for (const [vez, relatorio] of [
      ['primeira', importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true })],
      ['segunda', importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true })],
    ] as const) {
      assert.equal(
        relatorio.mensagensCriadas + relatorio.mensagensJaExistentes + relatorio.mensagensRejeitadas,
        relatorio.mensagensLidas,
        `${vez} importacao: a soma nao fecha — mensagem que some sem contar e mensagem perdida`,
      );
    }
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('interrupção NO MEIO DE UM LOTE e reexecução chegam ao mesmo estado final', () => {
  const c = cenario();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'x@s.whatsapp.net', nome: null, tipoDeSessao: 0 }],
    mensagens: Array.from({ length: 10 }, (_, i) => ({
      stanzaId: `m${i}`,
      chatSessionPk: 1,
      texto: `mensagem ${i}`,
      dataCoreData: paraCoreData(EM_USO),
    })),
  });
  try {
    const { acervo } = c.novoInquilino('Leia Organa');

    // A falha é injetada no item 4 de 10, DENTRO do lote — nunca numa
    // fronteira de transação, que é onde qualquer implementação passa.
    assert.throws(
      () => importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, falharNoItem: 4 }),
      /falha injetada/,
    );

    const parcial = contarAcervo(acervo).mensagens;
    assert.ok(parcial > 0 && parcial < 10, `esperava importação parcial, obtive ${parcial}`);

    // Reexecuta do zero: o que já entrou não duplica, o que faltava entra.
    importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });
    assert.equal(contarAcervo(acervo).mensagens, 10);

    const ids = lerMensagens(acervo, {}).map((m) => m.conteudo);
    assert.equal(new Set(ids).size, 10, 'nenhuma duplicada');
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('o caminho gravado do Anexo é o do núcleo, sem dado da origem', () => {
  const c = cenario();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'x@s.whatsapp.net', nome: 'Leia Organa', tipoDeSessao: 0 }],
    mensagens: [
      {
        stanzaId: 'm1',
        chatSessionPk: 1,
        texto: null,
        dataCoreData: paraCoreData(EM_USO),
        tipo: 1,
        caminhoDeMidia: 'Media/leia.organa/IMG_5511900000001.jpg',
      },
    ],
  });
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });

    const [mensagem] = lerMensagens(acervo, {});
    const anexo = mensagem?.anexos[0];
    assert.ok(anexo, 'o teste precisa de um Anexo para inspecionar');

    // A importação do ciclo 1 não copia arquivo: o Anexo nasce nunca-obtido e
    // por isso SEM caminho — caminho aponta para arquivo que existe, e os dois
    // estados sem arquivo (nunca-obtido e descartado) não têm nenhum.
    assert.equal(anexo.presenca, 'nunca-obtido');
    assert.equal(anexo.caminho, null);

    // O que o adaptador não pode fazer é levar dado da origem para o Acervo.
    // O caminho da origem carrega apelido e número; nada disso atravessa.
    const tudoQueEntrou = JSON.stringify(anexo).toLowerCase();
    for (const proibido of ['leia', 'organa', '5511900000001', 'img_', 'media/']) {
      assert.ok(!tudoQueEntrou.includes(proibido), `vazou "${proibido}": ${tudoQueEntrou}`);
    }
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('anexo cujo arquivo não veio no material nasce como nunca-obtido', () => {
  const c = cenario();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'x@s.whatsapp.net', nome: null, tipoDeSessao: 0 }],
    mensagens: [
      { stanzaId: 'm1', chatSessionPk: 1, texto: null, dataCoreData: paraCoreData(EM_USO), tipo: 2 },
    ],
  });
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });
    const [mensagem] = lerMensagens(acervo, {});
    assert.equal(mensagem?.anexos[0]?.presenca, 'nunca-obtido');
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('a importação grava o tamanho e o caminho que o material declara, sem tocar em arquivo', () => {
  const c = cenario();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'a@s.whatsapp.net', nome: 'Ana', tipoDeSessao: 0 }],
    mensagens: [
      {
        stanzaId: 'a1',
        chatSessionPk: 1,
        texto: null,
        dataCoreData: paraCoreData('2026-01-10T12:00:00.000Z'),
        caminhoDeMidia: 'Media/a/1/foto.jpg',
        tamanhoDeMidia: 123_456,
      },
    ],
  });
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: Date.now(), configuracao: CFG_WHATSAPP, reprocessar: true });
    const anexo = acervo.db
      .prepare('SELECT tamanho, presenca, nome_original FROM anexos')
      .get() as { tamanho: number | null; presenca: string; nome_original: string | null };
    assert.equal(anexo.tamanho, 123_456, 'o tamanho declarado pelo material entra no Descritor');
    assert.equal(anexo.presenca, 'nunca-obtido', 'e nenhum arquivo foi tocado');
    assert.equal(
      anexo.nome_original,
      null,
      'o caminho da origem NAO entra no Acervo: ele carrega apelido e numero, ' +
        'e a guarda do ciclo 1 existe justamente para isso. A operacao de trazer ' +
        'reencontra o arquivo pela Referencia Externa da Mensagem.',
    );
  } finally {
    b.limpar();
    c.limpar();
  }
});
