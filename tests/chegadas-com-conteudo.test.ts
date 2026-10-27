import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { umaColetiva, umMembro } from './ajuda/etiqueta.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { registrarEtiqueta, registrarMensagem } from '../src/nucleo/escrita.js';
import { registrarEdicao } from '../src/nucleo/edicao.js';
import { pontoDePartida } from '../src/nucleo/chegada.js';
import { lerMensagens, lerMensagensPorIds } from '../src/nucleo/consulta.js';
import { lerChegadasComConteudo, TETO_DE_BYTES_COM_CONTEUDO } from '../src/nucleo/chegadas-com-conteudo.js';

const AGORA = Date.UTC(2026, 9, 26, 12);
const OCORRIDA = AGORA - 60_000;

function mensagem(acervo: Acervo, conversaId: string, autorId: string, idExterno: string, texto: string): string {
  return registrarMensagem(acervo, {
    origemDaChegada: 'ao-vivo',
    conversaId,
    fonte: 'whatsapp',
    idExterno,
    autorId,
    conteudo: texto,
    ocorridaEm: OCORRIDA,
    agora: AGORA,
    direcao: 'recebida',
  });
}

test('lerMensagensPorIds: lista vazia nao le nada, id inexistente nao entra e a forma e a de lerMensagens', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversaId = umaColetiva(acervo);
    const autor = umMembro(acervo);
    const id = mensagem(acervo, conversaId, autor, 'M1', 'texto um');
    assert.deepEqual(lerMensagensPorIds(acervo, []), []);
    assert.deepEqual(lerMensagensPorIds(acervo, ['nao-existe']), []);
    const porIds = lerMensagensPorIds(acervo, [id, 'nao-existe']);
    assert.deepEqual(porIds, lerMensagens(acervo, { conversaId, ordem: 'cronologica' }));
  } finally {
    c.limpar();
  }
});

test('o conteudo e a Mensagem como a leitura de Mensagens a entrega, e o Diario nao a guarda', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversaId = umaColetiva(acervo);
    const autor = umMembro(acervo);
    const inicio = pontoDePartida(acervo);
    const id = mensagem(acervo, conversaId, autor, 'M1', 'texto um');
    const pagina = lerChegadasComConteudo(acervo, { depois: inicio });
    assert.equal(pagina.chegadas.length, 1);
    const ch = pagina.chegadas[0]!;
    assert.equal(ch.tipo, 'mensagem');
    assert.deepEqual(ch.conteudo, lerMensagensPorIds(acervo, [id])[0]);
    assert.equal(ch.conteudo?.conteudo, 'texto um');
  } finally {
    c.limpar();
  }
});

test('a Chegada de Edicao traz a Mensagem com o texto atual, e a Chegada da Mensagem, lida depois, tambem o mostra aplicado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversaId = umaColetiva(acervo);
    const autor = umMembro(acervo);
    const inicio = pontoDePartida(acervo);
    const id = mensagem(acervo, conversaId, autor, 'M1', 'texto original');
    registrarEdicao(acervo, {
      origemDaChegada: 'ao-vivo',
      mensagemId: id,
      fonte: 'whatsapp',
      idExterno: 'EV1',
      texto: 'texto novo',
      editadaEm: AGORA - 30_000,
      origem: 'aberta',
      bruto: '{}',
      agora: AGORA,
    });
    const { chegadas } = lerChegadasComConteudo(acervo, { depois: inicio });
    assert.deepEqual(
      chegadas.map((x) => x.tipo),
      ['mensagem', 'edicao'],
    );
    for (const ch of chegadas) {
      assert.equal(ch.conteudo?.textoAtual, 'texto novo', `${ch.tipo}: o conteudo e a Mensagem como esta agora`);
      assert.equal(ch.conteudo?.conteudo, 'texto original', 'o texto original nunca muda');
      assert.equal(ch.conteudo?.edicoes.length, 1);
    }
  } finally {
    c.limpar();
  }
});

test('a Chegada de Etiqueta nao leva a chave conteudo; a de Mensagem apagada leva conteudo nulo e continua legivel', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversaId = umaColetiva(acervo);
    const autor = umMembro(acervo);
    const inicio = pontoDePartida(acervo);
    const id = mensagem(acervo, conversaId, autor, 'M1', 'vai sumir');
    registrarEtiqueta(acervo, {
      origemDaChegada: 'ao-vivo',
      conversaId,
      identificadorId: autor,
      texto: 'Torre A',
      ocorridaEm: OCORRIDA,
      fonte: 'whatsapp',
      idExterno: 'E1',
    });
    acervo.db.prepare('DELETE FROM mensagens WHERE id = ?').run(id);
    const { chegadas } = lerChegadasComConteudo(acervo, { depois: inicio });
    assert.deepEqual(
      chegadas.map((x) => x.tipo),
      ['mensagem', 'etiqueta'],
    );
    assert.equal('conteudo' in chegadas[0]!, true);
    assert.equal(chegadas[0]!.conteudo, null);
    assert.equal('conteudo' in chegadas[1]!, false, 'a Etiqueta nao tem Mensagem: sem a chave');
  } finally {
    c.limpar();
  }
});

test('o filtro da leitura vale com conteudo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversaId = umaColetiva(acervo);
    const autor = umMembro(acervo);
    const inicio = pontoDePartida(acervo);
    const id = mensagem(acervo, conversaId, autor, 'M1', 'a');
    registrarEdicao(acervo, {
      origemDaChegada: 'ao-vivo',
      mensagemId: id,
      fonte: 'whatsapp',
      idExterno: 'EV1',
      texto: 'b',
      editadaEm: AGORA - 30_000,
      origem: 'aberta',
      bruto: '{}',
      agora: AGORA,
    });
    const { chegadas } = lerChegadasComConteudo(acervo, { depois: inicio, tipos: ['edicao'] });
    assert.deepEqual(
      chegadas.map((x) => x.tipo),
      ['edicao'],
    );
  } finally {
    c.limpar();
  }
});

test('o teto de bytes corta a pagina, ao menos uma Chegada sai sempre, e a leitura seguinte continua sem repetir nem pular', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversaId = umaColetiva(acervo);
    const autor = umMembro(acervo);
    const inicio = pontoDePartida(acervo);
    const texto = 'x'.repeat(400);
    const gravadas = [1, 2, 3, 4, 5, 6].map((n) => mensagem(acervo, conversaId, autor, `M${String(n)}`, `${texto}${String(n)}`));

    // Teto que nao cabe nem uma: sai uma so, e ainda assim com o proximo certo.
    const so1 = lerChegadasComConteudo(acervo, { depois: inicio }, 1);
    assert.equal(so1.chegadas.length, 1);
    assert.equal(so1.ultima, false);

    // Teto do meio: algumas, nao todas.
    const meio = lerChegadasComConteudo(acervo, { depois: inicio }, 2_500);
    assert.ok(meio.chegadas.length > 1 && meio.chegadas.length < 6, `saiu ${String(meio.chegadas.length)}`);
    assert.equal(meio.ultima, false);

    // O laco inteiro pelo teto pequeno devolve as seis, na ordem, sem repetir.
    const vistas: string[] = [];
    let marcador = inicio;
    for (let voltas = 0; voltas < 20; voltas += 1) {
      const p = lerChegadasComConteudo(acervo, { depois: marcador }, 2_500);
      vistas.push(...p.chegadas.map((x) => x.mensagemId as string));
      marcador = p.proximo;
      if (p.ultima) break;
    }
    assert.deepEqual(vistas, gravadas);
    assert.equal(marcador, pontoDePartida(acervo));
  } finally {
    c.limpar();
  }
});

test('o teto padrao de uma pagina com conteudo fica abaixo dos 2,0 MB do modo rede', () => {
  assert.ok(TETO_DE_BYTES_COM_CONTEUDO < 2_000_000);
  assert.ok(TETO_DE_BYTES_COM_CONTEUDO >= 1_000_000, 'um teto pequeno demais encurta toda pagina');
});

test('sem corte, a pagina com conteudo devolve tudo, ultima e proximo na ultima gravada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversaId = umaColetiva(acervo);
    const autor = umMembro(acervo);
    const inicio = pontoDePartida(acervo);
    mensagem(acervo, conversaId, autor, 'M1', 'a');
    mensagem(acervo, conversaId, autor, 'M2', 'b');
    const p = lerChegadasComConteudo(acervo, { depois: inicio });
    assert.equal(p.chegadas.length, 2);
    assert.equal(p.ultima, true);
    assert.equal(p.proximo, pontoDePartida(acervo));
  } finally {
    c.limpar();
  }
});
