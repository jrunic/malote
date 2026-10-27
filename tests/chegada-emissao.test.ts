import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cenario } from './ajuda/acervo.js';
import { mensagemColetivaComPar, mensagemDireta } from './ajuda/evento-ao-vivo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';
import {
  registrarAnexo,
  registrarConversa,
  registrarEtiqueta,
  registrarIdentificador,
  registrarMensagem,
  registrarTransicao,
} from '../src/nucleo/escrita.js';
import { registrarEdicao } from '../src/nucleo/edicao.js';
import { gravarArquivoDeAnexo, gravarArquivoDeAnexoDeCaminho } from '../src/nucleo/arquivo-de-anexo.js';
import { lerChegadas, pontoDePartida, type ChegadaLida } from '../src/nucleo/chegada.js';

const AGORA = Date.UTC(2026, 9, 26, 12);
const OCORRIDA = AGORA - 60_000;

function chegadasDesde(acervo: Acervo, marcador: string): ChegadaLida[] {
  return lerChegadas(acervo, { depois: marcador }).chegadas;
}

function contar(acervo: Acervo, tabela: string): number {
  return (acervo.db.prepare(`SELECT COUNT(*) AS n FROM "${tabela}"`).get() as { n: number }).n;
}

/** Faz toda gravacao futura de Chegada falhar: o que a spec chama de erro injetado entre o fato e a Chegada. */
function quebrarAsChegadas(acervo: Acervo): void {
  acervo.db.exec(
    "CREATE TRIGGER chegadas_quebrada BEFORE INSERT ON chegadas BEGIN SELECT RAISE(ABORT, 'falha injetada'); END",
  );
}

function umaColetiva(acervo: Acervo, n = 1): string {
  return registrarConversa(acervo, { fonte: 'whatsapp', idExterno: `12036300000000000${String(n)}@g.us`, coletiva: true });
}

function umIdentificador(acervo: Acervo, n = 1): string {
  return registrarIdentificador(acervo, { fonte: 'whatsapp', valor: `556591111000${String(n)}@s.whatsapp.net` }).id;
}

function entradaDeMensagem(conversaId: string, autorId: string, idExterno = 'M1') {
  return {
    conversaId,
    fonte: 'whatsapp' as const,
    idExterno,
    autorId,
    conteudo: 'oi',
    ocorridaEm: OCORRIDA,
    agora: AGORA,
    direcao: 'recebida' as const,
    origemDaChegada: 'ao-vivo' as const,
  };
}

test('registrar uma Mensagem grava exatamente uma Chegada com os campos do fato, e a reentrega nao grava outra', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversaId = umaColetiva(acervo);
    const autor = umIdentificador(acervo);
    const inicio = pontoDePartida(acervo);
    const antes = Date.now();
    const id = registrarMensagem(acervo, entradaDeMensagem(conversaId, autor));
    const depois = Date.now();

    const lidas = chegadasDesde(acervo, inicio);
    assert.equal(lidas.length, 1);
    const ch = lidas[0]!;
    assert.ok(ch.criadoEm >= antes && ch.criadoEm <= depois, 'o instante de gravacao e o da gravacao');
    assert.deepEqual(
      { ...ch, seq: 0, criadoEm: 0 },
      {
        seq: 0,
        tipo: 'mensagem',
        origem: 'ao-vivo',
        criadoEm: 0,
        ocorridaEm: OCORRIDA,
        conversaId,
        mensagemId: id,
        autorId: autor,
        direcao: 'recebida',
        alvoId: id,
      },
    );

    assert.equal(registrarMensagem(acervo, entradaDeMensagem(conversaId, autor)), id, 'a reentrega devolve o mesmo id');
    assert.equal(chegadasDesde(acervo, inicio).length, 1, 'a reentrega nao grava Chegada');
  } finally {
    c.limpar();
  }
});

test('a Chegada de uma Mensagem sem autor nao inventa autor', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversaId = umaColetiva(acervo);
    const inicio = pontoDePartida(acervo);
    registrarMensagem(acervo, {
      conversaId,
      fonte: 'whatsapp',
      idExterno: 'M-SEM-AUTOR',
      conteudo: 'oi',
      ocorridaEm: OCORRIDA,
      agora: AGORA,
      direcao: 'recebida',
      origemDaChegada: 'ao-vivo',
    });
    const ch = chegadasDesde(acervo, inicio)[0]!;
    assert.equal(ch.autorId, null);
  } finally {
    c.limpar();
  }
});

test('a origem declarada pelo chamador e a que a Chegada leva', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversaId = umaColetiva(acervo);
    const inicio = pontoDePartida(acervo);
    registrarMensagem(acervo, { ...entradaDeMensagem(conversaId, umIdentificador(acervo, 2), 'M-AO-VIVO'), origemDaChegada: 'ao-vivo' });
    registrarMensagem(acervo, { ...entradaDeMensagem(conversaId, umIdentificador(acervo, 2), 'M-IMPORTADA'), origemDaChegada: 'importacao' });
    registrarMensagem(acervo, { ...entradaDeMensagem(conversaId, umIdentificador(acervo, 2), 'M-REPROCESSADA'), origemDaChegada: 'reprocesso' });
    assert.deepEqual(
      chegadasDesde(acervo, inicio).map((x) => x.origem),
      ['ao-vivo', 'importacao', 'reprocesso'],
    );
  } finally {
    c.limpar();
  }
});

test('ATOMICIDADE da Mensagem: se a Chegada falha, a Mensagem nao fica; se a Mensagem e recusada, nao ha Chegada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversaId = umaColetiva(acervo);
    const chegadasAntes = contar(acervo, 'chegadas');

    // Fato recusado (Conversa que nao existe): nenhuma Chegada.
    assert.throws(() => registrarMensagem(acervo, entradaDeMensagem('conversa-inexistente', umIdentificador(acervo, 2))));
    assert.equal(contar(acervo, 'mensagens'), 0);
    assert.equal(contar(acervo, 'chegadas'), chegadasAntes);

    // Chegada recusada: nenhuma Mensagem.
    quebrarAsChegadas(acervo);
    assert.throws(() => registrarMensagem(acervo, entradaDeMensagem(conversaId, umIdentificador(acervo, 2))), /falha injetada/);
    assert.equal(contar(acervo, 'mensagens'), 0, 'a Mensagem ficou sem Chegada');
    assert.equal(contar(acervo, 'chegadas'), chegadasAntes);
  } finally {
    c.limpar();
  }
});

test('a Edicao grava uma Chegada com a Conversa, o autor e a direcao da Mensagem editada; a reentrega nao grava outra', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversaId = umaColetiva(acervo);
    const autor = umIdentificador(acervo);
    const mensagemId = registrarMensagem(acervo, entradaDeMensagem(conversaId, autor));
    const inicio = pontoDePartida(acervo);
    const edicao = {
      origemDaChegada: 'reprocesso' as const,
      mensagemId,
      fonte: 'whatsapp' as const,
      idExterno: 'EV1',
      texto: 'texto novo',
      editadaEm: AGORA - 30_000,
      origem: 'aberta' as const,
      bruto: '{}',
      agora: AGORA,
    };
    assert.equal(registrarEdicao(acervo, edicao).gravou, true);
    const edicaoId = (acervo.db.prepare('SELECT id FROM edicoes').get() as { id: string }).id;

    const lidas = chegadasDesde(acervo, inicio);
    assert.equal(lidas.length, 1);
    assert.deepEqual(
      { ...lidas[0]!, seq: 0, criadoEm: 0 },
      {
        seq: 0,
        tipo: 'edicao',
        origem: 'reprocesso',
        criadoEm: 0,
        ocorridaEm: AGORA - 30_000,
        conversaId,
        mensagemId,
        autorId: autor,
        direcao: 'recebida',
        alvoId: edicaoId,
      },
    );

    assert.equal(registrarEdicao(acervo, edicao).gravou, false);
    assert.equal(chegadasDesde(acervo, inicio).length, 1, 'a reentrega da Edicao nao grava Chegada');
  } finally {
    c.limpar();
  }
});

test('ATOMICIDADE da Edicao: se a Chegada falha, a Edicao nao fica', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversaId = umaColetiva(acervo);
    const mensagemId = registrarMensagem(acervo, entradaDeMensagem(conversaId, umIdentificador(acervo, 2)));
    quebrarAsChegadas(acervo);
    assert.throws(
      () =>
        registrarEdicao(acervo, {
          origemDaChegada: 'ao-vivo',
          mensagemId,
          fonte: 'whatsapp',
          idExterno: 'EV1',
          texto: 'novo',
          editadaEm: AGORA - 30_000,
          origem: 'aberta',
          bruto: '{}',
          agora: AGORA,
        }),
      /falha injetada/,
    );
    assert.equal(contar(acervo, 'edicoes'), 0);
  } finally {
    c.limpar();
  }
});

test('o Anexo so e Chegada quando nasce com o arquivo presente; o nunca-obtido vira Chegada quando o arquivo chega', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const destino = join(c.raiz, 'destino');
    mkdirSync(destino, { recursive: true });
    const conversaId = umaColetiva(acervo);
    const autor = umIdentificador(acervo);
    const mensagemId = registrarMensagem(acervo, entradaDeMensagem(conversaId, autor));
    const inicio = pontoDePartida(acervo);

    // Nasce nunca-obtido: nenhuma Chegada.
    const pendente = registrarAnexo(acervo, { origemDaChegada: 'ao-vivo', mensagemId, tipo: 'image', presenca: 'nunca-obtido' });
    assert.equal(chegadasDesde(acervo, inicio).length, 0);

    // O arquivo chega: uma Chegada, com a origem de quem gravou o arquivo.
    gravarArquivoDeAnexo(acervo, { origemDaChegada: 'reprocesso', anexoId: pendente, destino, bytes: Buffer.from('abc') });
    let lidas = chegadasDesde(acervo, inicio);
    assert.equal(lidas.length, 1);
    assert.deepEqual(
      { ...lidas[0]!, seq: 0, criadoEm: 0 },
      {
        seq: 0,
        tipo: 'anexo-disponivel',
        origem: 'reprocesso',
        criadoEm: 0,
        ocorridaEm: OCORRIDA,
        conversaId,
        mensagemId,
        autorId: autor,
        direcao: 'recebida',
        alvoId: pendente,
      },
    );

    // Gravar de novo o que ja esta presente nao e fato novo.
    gravarArquivoDeAnexo(acervo, { origemDaChegada: 'reprocesso', anexoId: pendente, destino, bytes: Buffer.from('abc') });
    assert.equal(chegadasDesde(acervo, inicio).length, 1);

    // Descartado e baixado de novo: o arquivo voltou a existir.
    acervo.db.prepare("UPDATE anexos SET presenca = 'descartado', caminho = NULL WHERE id = ?").run(pendente);
    gravarArquivoDeAnexo(acervo, { origemDaChegada: 'reprocesso', anexoId: pendente, destino, bytes: Buffer.from('abc') });
    assert.equal(chegadasDesde(acervo, inicio).length, 2);

    // Nasce ja presente: uma Chegada.
    const presente = registrarAnexo(acervo, { origemDaChegada: 'importacao', mensagemId, tipo: 'image', presenca: 'presente' });
    lidas = chegadasDesde(acervo, inicio);
    assert.equal(lidas.length, 3);
    assert.equal(lidas[2]!.alvoId, presente);
    assert.equal(lidas[2]!.origem, 'importacao');
  } finally {
    c.limpar();
  }
});

test('o arquivo trazido por caminho tambem e Chegada, uma vez', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const destino = join(c.raiz, 'destino');
    mkdirSync(destino, { recursive: true });
    const origem = join(c.raiz, 'arquivo-de-fora.bin');
    writeFileSync(origem, 'conteudo');
    const conversaId = umaColetiva(acervo);
    const mensagemId = registrarMensagem(acervo, entradaDeMensagem(conversaId, umIdentificador(acervo, 2)));
    const anexoId = registrarAnexo(acervo, { origemDaChegada: 'importacao', mensagemId, tipo: 'document', presenca: 'nunca-obtido' });
    const inicio = pontoDePartida(acervo);

    gravarArquivoDeAnexoDeCaminho(acervo, { origemDaChegada: 'importacao', anexoId, destino, origem });
    const lidas = chegadasDesde(acervo, inicio);
    assert.equal(lidas.length, 1);
    assert.equal(lidas[0]!.tipo, 'anexo-disponivel');
    assert.equal(lidas[0]!.alvoId, anexoId);
  } finally {
    c.limpar();
  }
});

test('ATOMICIDADE do Anexo: se a Chegada falha, o Anexo continua nunca-obtido', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const destino = join(c.raiz, 'destino');
    mkdirSync(destino, { recursive: true });
    const conversaId = umaColetiva(acervo);
    const mensagemId = registrarMensagem(acervo, entradaDeMensagem(conversaId, umIdentificador(acervo, 2)));
    const anexoId = registrarAnexo(acervo, { origemDaChegada: 'ao-vivo', mensagemId, tipo: 'image', presenca: 'nunca-obtido' });
    quebrarAsChegadas(acervo);

    assert.throws(
      () => gravarArquivoDeAnexo(acervo, { origemDaChegada: 'ao-vivo', anexoId, destino, bytes: Buffer.from('abc') }),
      /falha injetada/,
    );
    const linha = acervo.db.prepare('SELECT presenca FROM anexos WHERE id = ?').get(anexoId) as { presenca: string };
    assert.equal(linha.presenca, 'nunca-obtido');

    assert.throws(
      () => registrarAnexo(acervo, { origemDaChegada: 'ao-vivo', mensagemId, tipo: 'image', presenca: 'presente' }),
      /falha injetada/,
    );
    assert.equal(contar(acervo, 'anexos'), 1, 'o Anexo presente ficou sem Chegada');
  } finally {
    c.limpar();
  }
});

test('a Transicao de Participacao e a Etiqueta gravam uma Chegada cada, com o Identificador como autor; a reentrega nao grava outra', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversaId = umaColetiva(acervo);
    const membro = umIdentificador(acervo);
    const inicio = pontoDePartida(acervo);

    const transicao = {
      origemDaChegada: 'ao-vivo' as const,
      conversaId,
      identificadorId: membro,
      natureza: 'entrou' as const,
      ocorridaEm: OCORRIDA,
      fonte: 'whatsapp' as const,
      idExterno: 'S1',
      codigoDaFonte: '1',
    };
    assert.equal(registrarTransicao(acervo, transicao), true);
    assert.equal(registrarTransicao(acervo, transicao), false);

    const etiqueta = {
      origemDaChegada: 'ao-vivo' as const,
      conversaId,
      identificadorId: membro,
      texto: 'Torre A',
      ocorridaEm: OCORRIDA + 1_000,
      fonte: 'whatsapp' as const,
      idExterno: 'E1',
    };
    assert.equal(registrarEtiqueta(acervo, etiqueta), true);
    assert.equal(registrarEtiqueta(acervo, etiqueta), false);

    const lidas = chegadasDesde(acervo, inicio);
    assert.equal(lidas.length, 2, 'a reentrega nao grava Chegada');
    const idDaTransicao = (acervo.db.prepare('SELECT id FROM transicoes_de_participacao').get() as { id: string }).id;
    const idDaEtiqueta = (acervo.db.prepare('SELECT id FROM etiquetas_de_participacao').get() as { id: string }).id;
    assert.deepEqual(
      lidas.map((x) => ({ ...x, seq: 0, criadoEm: 0 })),
      [
        {
          seq: 0,
          tipo: 'transicao-de-participacao',
          origem: 'ao-vivo',
          criadoEm: 0,
          ocorridaEm: OCORRIDA,
          conversaId,
          mensagemId: null,
          autorId: membro,
          direcao: null,
          alvoId: idDaTransicao,
        },
        {
          seq: 0,
          tipo: 'etiqueta',
          origem: 'ao-vivo',
          criadoEm: 0,
          ocorridaEm: OCORRIDA + 1_000,
          conversaId,
          mensagemId: null,
          autorId: membro,
          direcao: null,
          alvoId: idDaEtiqueta,
        },
      ],
    );
  } finally {
    c.limpar();
  }
});

test('ATOMICIDADE da Transicao e da Etiqueta: se a Chegada falha, o fato nao fica', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversaId = umaColetiva(acervo);
    const membro = umIdentificador(acervo);
    quebrarAsChegadas(acervo);
    assert.throws(
      () =>
        registrarTransicao(acervo, {
          origemDaChegada: 'ao-vivo',
          conversaId,
          identificadorId: membro,
          natureza: 'saiu',
          ocorridaEm: OCORRIDA,
          fonte: 'whatsapp',
          idExterno: 'S1',
          codigoDaFonte: '2',
        }),
      /falha injetada/,
    );
    assert.equal(contar(acervo, 'transicoes_de_participacao'), 0);
    assert.throws(
      () =>
        registrarEtiqueta(acervo, {
          origemDaChegada: 'ao-vivo',
          conversaId,
          identificadorId: membro,
          texto: 'Torre B',
          ocorridaEm: OCORRIDA,
          fonte: 'whatsapp',
          idExterno: 'E1',
        }),
      /falha injetada/,
    );
    assert.equal(contar(acervo, 'etiquetas_de_participacao'), 0);
  } finally {
    c.limpar();
  }
});

test('a recepcao grava a origem que o chamador declarou, em todos os fatos do lote', () => {
  const c = cenario();
  try {
    const quando = Math.floor(Date.UTC(2026, 9, 26) / 1000);
    for (const origemDaChegada of ['ao-vivo', 'reprocesso'] as const) {
      const { acervo } = c.novoInquilino(`Padme ${origemDaChegada}`);
      const inicio = pontoDePartida(acervo);
      receberEvento(
        acervo,
        [mensagemDireta('AAAA1111BBBB2222CCCC', quando), mensagemColetivaComPar('DDDD3333EEEE4444FFFF', quando)],
        { origemDaChegada, agora: AGORA, configuracao: CFG_WHATSAPP },
      );
      const lidas = chegadasDesde(acervo, inicio);
      assert.equal(lidas.length, 2, `${origemDaChegada}: uma Chegada por Mensagem`);
      assert.deepEqual(
        lidas.map((x) => [x.tipo, x.origem]),
        [
          ['mensagem', origemDaChegada],
          ['mensagem', origemDaChegada],
        ],
      );
    }
  } finally {
    c.limpar();
  }
});
