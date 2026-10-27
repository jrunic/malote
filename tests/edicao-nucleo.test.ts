import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { lerEdicoes, mensagemParaEdicao, registrarEdicao, EdicaoImplausivelError } from '../src/nucleo/edicao.js';

const AGORA = 1_791_300_000_000;
const GRUPO = '120363000000000001@g.us';

function cena() {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular de Teste');
  const conversaId = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: GRUPO, coletiva: true });
  const mensagemId = registrarMensagem(acervo, {
    origemDaChegada: 'importacao',
    conversaId,
    fonte: 'whatsapp',
    idExterno: 'MSG-ORIGINAL',
    ocorridaEm: AGORA - 600_000,
    agora: AGORA,
    bruto: '{"marca":"original"}',
    direcao: 'recebida',
    conteudo: 'texto original',
  });
  const edicao = (idExterno: string, texto: string, editadaEm = AGORA - 300_000) => ({
    origemDaChegada: 'importacao' as const,
    mensagemId,
    fonte: 'whatsapp' as const,
    idExterno,
    texto,
    editadaEm,
    origem: 'cifrada' as const,
    bruto: `{"evento":"${idExterno}"}`,
    agora: AGORA,
  });
  return { c, acervo, mensagemId, conversaId, edicao };
}

test('a Edicao fica ligada a Mensagem e nao mexe no texto nem no bruto da original', () => {
  const { c, acervo, mensagemId, edicao } = cena();
  try {
    const r = registrarEdicao(acervo, edicao('EV-1', 'texto novo'));
    assert.equal(r.gravou, true);
    const lidas = lerEdicoes(acervo, [mensagemId]).get(mensagemId) ?? [];
    assert.deepEqual(
      lidas.map((e) => ({ texto: e.texto, editadaEm: e.editadaEm, origem: e.origem })),
      [{ texto: 'texto novo', editadaEm: AGORA - 300_000, origem: 'cifrada' }],
    );
    const original = acervo.db.prepare('SELECT conteudo, bruto FROM mensagens WHERE id = ?').get(mensagemId) as {
      conteudo: string;
      bruto: string;
    };
    assert.equal(original.conteudo, 'texto original');
    assert.equal(original.bruto, '{"marca":"original"}');
    const mensagens = acervo.db.prepare('SELECT COUNT(*) AS n FROM mensagens').get() as { n: number };
    assert.equal(mensagens.n, 1, 'a edicao nao pode criar Mensagem');
  } finally {
    c.limpar();
  }
});

test('o mesmo evento de edicao duas vezes e uma Edicao so', () => {
  const { c, acervo, mensagemId, edicao } = cena();
  try {
    assert.equal(registrarEdicao(acervo, edicao('EV-1', 'texto novo')).gravou, true);
    assert.equal(registrarEdicao(acervo, edicao('EV-1', 'texto novo')).gravou, false);
    assert.equal((lerEdicoes(acervo, [mensagemId]).get(mensagemId) ?? []).length, 1);
  } finally {
    c.limpar();
  }
});

test('duas edicoes da mesma Mensagem saem na ordem do instante, e o empate desfaz pela gravacao', () => {
  const { c, acervo, mensagemId, edicao } = cena();
  try {
    registrarEdicao(acervo, edicao('EV-B', 'segunda', AGORA - 200_000));
    registrarEdicao(acervo, edicao('EV-A', 'primeira', AGORA - 250_000));
    registrarEdicao(acervo, edicao('EV-C', 'empate', AGORA - 200_000));
    const lidas = lerEdicoes(acervo, [mensagemId]).get(mensagemId) ?? [];
    assert.deepEqual(
      lidas.map((e) => e.texto),
      ['primeira', 'segunda', 'empate'],
    );
  } finally {
    c.limpar();
  }
});

test('a leitura de varias Mensagens e uma consulta so, e Mensagem sem edicao nao entra no mapa', () => {
  const { c, acervo, mensagemId, conversaId, edicao } = cena();
  try {
    const outra = registrarMensagem(acervo, {
      origemDaChegada: 'importacao',
      conversaId,
      fonte: 'whatsapp',
      idExterno: 'MSG-OUTRA',
      ocorridaEm: AGORA - 500_000,
      agora: AGORA,
      bruto: '{}',
      direcao: 'recebida',
      conteudo: 'sem edicao',
    });
    registrarEdicao(acervo, edicao('EV-1', 'texto novo'));
    const mapa = lerEdicoes(acervo, [mensagemId, outra]);
    assert.equal(mapa.has(outra), false);
    assert.equal(mapa.get(mensagemId)?.length, 1);
    assert.equal(lerEdicoes(acervo, []).size, 0);
  } finally {
    c.limpar();
  }
});

test('texto vazio e uma Edicao valida (legenda apagada)', () => {
  const { c, acervo, mensagemId, edicao } = cena();
  try {
    assert.equal(registrarEdicao(acervo, edicao('EV-1', '')).gravou, true);
    assert.equal(lerEdicoes(acervo, [mensagemId]).get(mensagemId)?.[0]?.texto, '');
  } finally {
    c.limpar();
  }
});

test('instante implausivel e recusado: no futuro alem da tolerancia e antes do inicio da Fonte', () => {
  const { c, acervo, edicao } = cena();
  try {
    assert.throws(() => registrarEdicao(acervo, { ...edicao('EV-1', 'x', AGORA + 60_000), toleranciaDeRelogioMs: 5_000 }), EdicaoImplausivelError);
    assert.throws(() => registrarEdicao(acervo, edicao('EV-2', 'x', Date.parse('2001-01-01T00:00:00Z'))), EdicaoImplausivelError);
    // dentro da tolerancia, vale
    assert.equal(registrarEdicao(acervo, { ...edicao('EV-3', 'x', AGORA + 3_000), toleranciaDeRelogioMs: 5_000 }).gravou, true);
  } finally {
    c.limpar();
  }
});

test('a busca de texto acha a Edicao e a remocao da Mensagem leva a Edicao e a linha da busca', () => {
  const { c, acervo, mensagemId, edicao } = cena();
  try {
    registrarEdicao(acervo, edicao('EV-1', 'palavraunica nova'));
    const achadas = acervo.db
      .prepare("SELECT rowid FROM edicoes_texto WHERE edicoes_texto MATCH 'palavraunica'")
      .all();
    assert.equal(achadas.length, 1);
    acervo.db.prepare('DELETE FROM mensagens WHERE id = ?').run(mensagemId);
    assert.equal((acervo.db.prepare('SELECT COUNT(*) AS n FROM edicoes').get() as { n: number }).n, 0);
    assert.equal(
      acervo.db.prepare("SELECT rowid FROM edicoes_texto WHERE edicoes_texto MATCH 'palavraunica'").all().length,
      0,
    );
  } finally {
    c.limpar();
  }
});

test('mensagemParaEdicao devolve a Mensagem pelo par (Fonte, id), com o bruto e o endereco canonico da Conversa', () => {
  const { c, acervo, mensagemId } = cena();
  try {
    const achada = mensagemParaEdicao(acervo, { fonte: 'whatsapp', idExterno: 'MSG-ORIGINAL' });
    assert.deepEqual(achada, {
      id: mensagemId,
      bruto: '{"marca":"original"}',
      enderecoDaConversa: GRUPO,
    });
    assert.equal(mensagemParaEdicao(acervo, { fonte: 'whatsapp', idExterno: 'NAO-EXISTE' }), undefined);
  } finally {
    c.limpar();
  }
});
