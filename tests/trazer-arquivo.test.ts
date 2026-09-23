import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import {
  DestinoInacessivelError,
  gravarArquivoDeAnexo,
} from '../src/nucleo/arquivo-de-anexo.js';
import { registrarAnexo, registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { materialInstagramFalso } from './ajuda/material-instagram-falso.js';
import { importarMaterial } from '../src/adaptadores/whatsapp/importar.js';
import { importarMaterialDeInstagram } from '../src/adaptadores/instagram/importar.js';
import { trazerArquivos } from '../src/adaptadores/whatsapp/trazer.js';
import { CFG_WHATSAPP, CFG_INSTAGRAM } from './ajuda/configuracao.js';

/** Um Anexo pendente, com a Mensagem e a Conversa que ele exige. */
function umAnexo(acervo: Acervo): string {
  const conversaId = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: 'c1',
    coletiva: false, configuracao: CFG_WHATSAPP,
  });
  const mensagemId = registrarMensagem(acervo, {
      direcao: 'recebida',
    conversaId,
    fonte: 'whatsapp',
    idExterno: 'm1',
    ocorridaEm: Date.parse('2026-01-10T12:00:00.000Z'),
    agora: Date.now(),
  });
  return registrarAnexo(acervo, {
    mensagemId,
    tipo: 'image',
    presenca: 'nunca-obtido',
    tamanho: 5,
  });
}

test('gravar transita a Presença e põe o arquivo sob o Destino', () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  try {
    const { id, acervo } = c.novoInquilino('Leia Organa');
    const anexoId = umAnexo(acervo);

    const caminho = gravarArquivoDeAnexo(acervo, {
      anexoId,
      destino: d.raiz,
      bytes: Buffer.from('abcde'),
    });

    const linha = acervo.db
      .prepare('SELECT presenca, caminho, tamanho, impressao FROM anexos WHERE id = ?')
      .get(anexoId) as {
      presenca: string;
      caminho: string;
      tamanho: number;
      impressao: string;
    };
    assert.equal(linha.presenca, 'presente');
    assert.equal(linha.tamanho, 5, 'o tamanho é conferido contra o arquivo gravado');
    assert.match(linha.impressao, /^[0-9a-f]{64}$/, 'a impressão do arquivo é gravada');
    assert.equal(linha.caminho, caminho);
    assert.ok(existsSync(join(d.raiz, caminho)), 'o arquivo está no disco');
    assert.equal(readFileSync(join(d.raiz, caminho), 'utf8'), 'abcde');
    assert.ok(caminho.startsWith(`${id}/`), 'sob a subárvore do Inquilino');
  } finally {
    d.limpar();
    c.limpar();
  }
});

test('gravar com Destino inacessível recusa e não transita a Presença', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const anexoId = umAnexo(acervo);
    assert.throws(
      () =>
        gravarArquivoDeAnexo(acervo, {
          anexoId,
          destino: '/caminho/que/nao/existe/em/lugar/nenhum',
          bytes: Buffer.from('abcde'),
        }),
      DestinoInacessivelError,
    );
    const linha = acervo.db
      .prepare('SELECT presenca FROM anexos WHERE id = ?')
      .get(anexoId) as { presenca: string };
    assert.equal(linha.presenca, 'nunca-obtido', 'falha de escrita não vira estado do Acervo');
  } finally {
    c.limpar();
  }
});

test('o Inquilino do caminho vem do Acervo, e dois Inquilinos não se cruzam', () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  try {
    const leia = c.novoInquilino('Leia Organa');
    const han = c.novoInquilino('Han Solo');
    // A MESMA raiz de Destino para os dois — que o schema permite.
    const emLeia = gravarArquivoDeAnexo(leia.acervo, {
      anexoId: umAnexo(leia.acervo),
      destino: d.raiz,
      bytes: Buffer.from('de leia'),
    });
    const emHan = gravarArquivoDeAnexo(han.acervo, {
      anexoId: umAnexo(han.acervo),
      destino: d.raiz,
      bytes: Buffer.from('de han'),
    });
    assert.ok(emLeia.startsWith(`${leia.id}/`));
    assert.ok(emHan.startsWith(`${han.id}/`));
    assert.notEqual(emLeia.split('/')[0], emHan.split('/')[0], 'subárvores distintas');
  } finally {
    d.limpar();
    c.limpar();
  }
});

test('trazer copia o que existe, conta o que falta e é retomável', () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'a@s.whatsapp.net', nome: 'Ana', tipoDeSessao: 0 }],
    mensagens: [
      {
        stanzaId: 'a1',
        chatSessionPk: 1,
        texto: null,
        dataCoreData: paraCoreData('2026-01-10T12:00:00.000Z'),
        caminhoDeMidia: 'Media/a/1/tem.jpg',
        conteudoDeMidia: 'bytes-reais',
      },
      {
        stanzaId: 'a2',
        chatSessionPk: 1,
        texto: null,
        dataCoreData: paraCoreData('2026-01-10T12:01:00.000Z'),
        caminhoDeMidia: 'Media/a/2/nao-tem.jpg',
      },
    ],
  });
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: Date.now(), configuracao: CFG_WHATSAPP });

    const r = trazerArquivos(acervo, b.raiz, { destino: d.raiz });
    assert.equal(r.copiados, 1);
    assert.equal(r.ausentesDoMaterial, 1, 'o que o material declara e não entrega é contado');
    assert.equal(r.falhas, 0);

    const porEstado = Object.fromEntries(
      (
        acervo.db
          .prepare('SELECT presenca, COUNT(*) AS n FROM anexos GROUP BY presenca')
          .all() as Array<{ presenca: string; n: number }>
      ).map((p) => [p.presenca, p.n]),
    );
    assert.equal(porEstado['presente'], 1);
    assert.equal(porEstado['nunca-obtido'], 1, 'ausente do material NÃO vira descartado');

    // Reexecutar nao copia nada: a Presenca e o cursor, sem estado proprio.
    const r2 = trazerArquivos(acervo, b.raiz, { destino: d.raiz });
    assert.equal(r2.copiados, 0);
    assert.equal(r2.ausentesDoMaterial, 1);
  } finally {
    b.limpar();
    d.limpar();
    c.limpar();
  }
});

test('trazer de uma Fonte não toca nos Anexos de outra', () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'a@s.whatsapp.net', nome: 'Ana', tipoDeSessao: 0 }],
    mensagens: [
      {
        stanzaId: 'a1',
        chatSessionPk: 1,
        texto: null,
        dataCoreData: paraCoreData('2026-01-10T12:00:00.000Z'),
        caminhoDeMidia: 'Media/a/1/tem.jpg',
        conteudoDeMidia: 'bytes-reais',
      },
    ],
  });
  const ig = materialInstagramFalso([
    {
      slug: 'joanaprado',
      numero: '111111111111111',
      title: 'Joana Prado',
      participants: ['Joana Prado', 'Titular Sintetico'],
      messages: [
        {
          sender_name: 'Joana Prado',
          timestamp_ms: 1_700_000_000_000,
          content: 'com foto',
          photos: [{ uri: 'messages/inbox/joana/photos/x.jpg' }],
        },
      ],
    },
  ]);
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: Date.now(), configuracao: CFG_WHATSAPP });
    importarMaterialDeInstagram(acervo, ig.raiz, {
      agora: Date.now(), configuracao: CFG_INSTAGRAM,
      titular: 'Titular Sintetico',
    });

    const anexosDeInstagram = (
      acervo.db
        .prepare(
          `SELECT COUNT(*) AS n FROM anexos a JOIN mensagens m ON m.id = a.mensagem_id
            WHERE m.fonte = 'instagram'`,
        )
        .get() as { n: number }
    ).n;
    assert.ok(anexosDeInstagram > 0, 'o teste precisa de Anexo da outra Fonte para discriminar');

    const r = trazerArquivos(acervo, b.raiz, { destino: d.raiz });
    assert.equal(r.copiados, 1);
    assert.equal(
      r.ausentesDoMaterial,
      0,
      'os Anexos de Instagram NÃO podem ser contados como ausentes deste material',
    );
  } finally {
    ig.limpar();
    b.limpar();
    d.limpar();
    c.limpar();
  }
});

test('nenhum caminho gravado contém dado que veio da Fonte', () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  const b = backupFalso({
    conversas: [
      { pk: 1, endereco: '5511987654321@s.whatsapp.net', nome: 'Ana Bezerra', tipoDeSessao: 0 },
    ],
    mensagens: [
      {
        stanzaId: 'a1',
        chatSessionPk: 1,
        texto: null,
        dataCoreData: paraCoreData('2026-01-10T12:00:00.000Z'),
        caminhoDeMidia: 'Media/5511987654321@s.whatsapp.net/f/foto-da-ana.jpg',
        conteudoDeMidia: 'bytes',
      },
    ],
  });
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: Date.now(), configuracao: CFG_WHATSAPP });
    trazerArquivos(acervo, b.raiz, { destino: d.raiz });

    // Os proibidos saem do ACERVO, nao de uma lista escolhida a mao: lista
    // feita a mao passa verde justamente no caso que ninguem imaginou.
    const proibidos = [
      ...(
        acervo.db.prepare('SELECT valor FROM identificadores').all() as Array<{ valor: string }>
      ).map((x) => x.valor),
      ...(
        acervo.db
          .prepare('SELECT assunto FROM metadados_de_coletiva WHERE assunto IS NOT NULL')
          .all() as Array<{ assunto: string }>
      ).map((x) => x.assunto),
      ...(
        acervo.db.prepare('SELECT nome FROM atribuicoes_de_nome').all() as Array<{ nome: string }>
      ).map((x) => x.nome),
    ].filter(
      // Ruido, nao sinal: o nome do arquivo tem 32 digitos hex, e qualquer
      // cadeia curta que seja hex pura casa por acaso.
      (v) => v.length >= 5 && !/^[0-9a-f]+$/i.test(v),
    );
    const caminhos = (
      acervo.db.prepare('SELECT caminho FROM anexos WHERE caminho IS NOT NULL').all() as Array<{
        caminho: string;
      }>
    ).map((x) => x.caminho);

    assert.ok(caminhos.length > 0, 'sem caminho gravado, a varredura não prova nada');
    assert.ok(proibidos.length > 0, 'sem valores proibidos, a varredura não prova nada');
    for (const caminho of caminhos) {
      for (const proibido of proibidos) {
        assert.ok(
          !caminho.toLowerCase().includes(proibido.toLowerCase()),
          `o caminho ${caminho} carrega "${proibido}", que veio da Fonte`,
        );
      }
    }
  } finally {
    b.limpar();
    d.limpar();
    c.limpar();
  }
});
