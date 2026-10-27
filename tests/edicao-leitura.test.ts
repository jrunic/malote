import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { registrarEdicao, textoAtualDe } from '../src/nucleo/edicao.js';
import { buscarMensagens, lerMensagens } from '../src/nucleo/consulta.js';
import { subirCenaDeIdentidade } from './ajuda/identidade.js';
import type { Acervo } from '../src/nucleo/acervo.js';

const AGORA = 1_791_300_000_000;
const GRUPO = '120363000000000001@g.us';

function cena() {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular de Teste');
  const conversaId = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: GRUPO, coletiva: true });
  const mensagem = (idExterno: string, conteudo: string | undefined, deslocamento: number): string =>
    registrarMensagem(acervo, {
      origemDaChegada: 'importacao',
      conversaId,
      fonte: 'whatsapp',
      idExterno,
      ocorridaEm: AGORA - 900_000 + deslocamento,
      agora: AGORA,
      bruto: '{}',
      direcao: 'recebida',
      ...(conteudo !== undefined ? { conteudo } : {}),
    });
  const editar = (mensagemId: string, idExterno: string, texto: string, editadaEm: number) =>
    registrarEdicao(acervo, { origemDaChegada: 'importacao', mensagemId, fonte: 'whatsapp', idExterno, texto, editadaEm, origem: 'cifrada', bruto: '{}', agora: AGORA });
  return { c, acervo, conversaId, mensagem, editar };
}

test('Mensagem sem edicao traz lista vazia e o texto atual e o proprio conteudo', () => {
  const { c, acervo, conversaId, mensagem } = cena();
  try {
    mensagem('M1', 'texto original', 0);
    const [m] = lerMensagens(acervo, { conversaId });
    assert.deepEqual(m?.edicoes, []);
    assert.equal(m !== undefined && 'textoAtual' in m, false, 'sem edicao a chave nao existe (nao repete o conteudo na rede)');
    assert.equal(m?.conteudo, 'texto original');
  } finally {
    c.limpar();
  }
});

test('Mensagem editada traz as edicoes em ordem, o texto atual e o conteudo original intacto', () => {
  const { c, acervo, conversaId, mensagem, editar } = cena();
  try {
    const id = mensagem('M1', 'texto original', 0);
    editar(id, 'EV-2', 'segunda', AGORA - 200_000);
    editar(id, 'EV-1', 'primeira', AGORA - 250_000);
    const [m] = lerMensagens(acervo, { conversaId });
    assert.deepEqual(m?.edicoes, [
      { texto: 'primeira', editadaEm: AGORA - 250_000, origem: 'cifrada' },
      { texto: 'segunda', editadaEm: AGORA - 200_000, origem: 'cifrada' },
    ]);
    assert.equal(m?.textoAtual, 'segunda');
    assert.equal(m?.conteudo, 'texto original');
  } finally {
    c.limpar();
  }
});

test('a midia sem texto, com a legenda editada, tem a legenda como texto atual; legenda apagada deixa o texto atual vazio', () => {
  const { c, acervo, conversaId, mensagem, editar } = cena();
  try {
    const comLegenda = mensagem('M1', undefined, 0);
    editar(comLegenda, 'EV-1', 'legenda nova', AGORA - 300_000);
    const apagada = mensagem('M2', 'texto', 1_000);
    editar(apagada, 'EV-2', '', AGORA - 290_000);
    const lidas = lerMensagens(acervo, { conversaId });
    assert.equal(lidas.find((m) => m.id === comLegenda)?.conteudo, null);
    assert.equal(lidas.find((m) => m.id === comLegenda)?.textoAtual, 'legenda nova');
    assert.equal(lidas.find((m) => m.id === apagada)?.textoAtual, '');
  } finally {
    c.limpar();
  }
});

test('as edicoes da pagina inteira saem em UMA consulta, nunca uma por Mensagem', () => {
  const { c, acervo, conversaId, mensagem, editar } = cena();
  try {
    for (let i = 0; i < 5; i += 1) {
      const id = mensagem(`M${i}`, `texto ${i}`, i * 1_000);
      editar(id, `EV-${i}`, `novo ${i}`, AGORA - 100_000 + i);
    }
    const original = acervo.preparar.bind(acervo);
    let consultasDeEdicao = 0;
    acervo.preparar = (sql: string) => {
      if (/FROM edicoes\b/.test(sql)) consultasDeEdicao += 1;
      return original(sql);
    };
    const lidas = lerMensagens(acervo, { conversaId });
    assert.equal(lidas.length, 5);
    assert.equal(consultasDeEdicao, 1);
    assert.ok(lidas.every((m) => m.edicoes.length === 1));
  } finally {
    c.limpar();
  }
});

test('a busca devolve a Mensagem com as edicoes dela', () => {
  const { c, acervo, mensagem, editar } = cena();
  try {
    const id = mensagem('M1', 'palavraoriginal aqui', 0);
    editar(id, 'EV-1', 'texto corrigido', AGORA - 200_000);
    const achadas = buscarMensagens(acervo, { texto: 'palavraoriginal' });
    assert.equal(achadas.length, 1);
    assert.deepEqual(achadas[0]?.edicoes.map((e) => e.texto), ['texto corrigido']);
    assert.equal(achadas[0]?.textoAtual, 'texto corrigido');
  } finally {
    c.limpar();
  }
});

test('textoAtualDe: a ultima edicao vence, e sem edicao vale o conteudo', () => {
  assert.equal(textoAtualDe('original', []), 'original');
  assert.equal(textoAtualDe(null, []), null);
  assert.equal(textoAtualDe('original', [{ texto: 'a', editadaEm: 1, origem: 'cifrada' }, { texto: 'b', editadaEm: 2, origem: 'aberta' }]), 'b');
  assert.equal(textoAtualDe(null, [{ texto: '', editadaEm: 1, origem: 'cifrada' }]), '');
});

const TEXTO_NOVO = 'TEXTO-SINTETICO-DA-EDICAO';

function mensagemDaCena(acervo: Acervo, conversaId: string, idExterno: string, minuto: number): string {
  return registrarMensagem(acervo, {
    origemDaChegada: 'importacao',
    conversaId,
    fonte: 'whatsapp',
    idExterno,
    ocorridaEm: Date.parse('2026-10-01T10:00:00Z') + minuto * 60_000,
    agora: Date.parse('2026-10-13T12:00:00Z'),
    direcao: 'recebida',
    conteudo: 'texto original',
  });
}

test('GET /conversas/<id>/mensagens devolve as edicoes e o texto atual no JSON (rede)', async () => {
  const cena = await subirCenaDeIdentidade<string>({
    semearMais: (acervo, s) => {
      const id = mensagemDaCena(acervo, s.diretaDeAna, 'editada-1', 500);
      registrarEdicao(acervo, {
        origemDaChegada: 'importacao',
        mensagemId: id,
        fonte: 'whatsapp',
        idExterno: 'EV-1',
        texto: TEXTO_NOVO,
        editadaEm: Date.parse('2026-10-01T10:00:00Z') + 501 * 60_000,
        origem: 'cifrada',
        bruto: '{}',
        agora: Date.parse('2026-10-13T12:00:00Z'),
      });
      return id;
    },
  });
  try {
    const r = await cena.pedir(`/conversas/${cena.s.diretaDeAna}/mensagens?limite=500`, cena.chave.valor);
    assert.equal(r.status, 200, r.corpo);
    const corpo = JSON.parse(r.corpo) as {
      mensagens: Array<{ id: string; conteudo: string | null; textoAtual: string | null; edicoes: Array<{ texto: string; origem: string }> }>;
    };
    const dela = corpo.mensagens.find((m) => m.id === cena.extra);
    assert.equal(dela?.conteudo, 'texto original');
    assert.equal(dela?.textoAtual, TEXTO_NOVO);
    assert.deepEqual(dela?.edicoes.map((e) => [e.texto, e.origem]), [[TEXTO_NOVO, 'cifrada']]);
    assert.ok(
      corpo.mensagens.filter((m) => m.id !== cena.extra).every((m) => Array.isArray(m.edicoes)),
      'toda Mensagem traz a lista, vazia quando nao ha edicao',
    );
  } finally {
    cena.encerrar();
  }
});

test('isolamento: a chave de OUTRO Inquilino nao ve edicao nenhuma do Titular (rede)', async () => {
  const cena = await subirCenaDeIdentidade<string>({
    semearMais: (acervo, s) => {
      const id = mensagemDaCena(acervo, s.diretaDeAna, 'editada-1', 500);
      registrarEdicao(acervo, {
        origemDaChegada: 'importacao',
        mensagemId: id,
        fonte: 'whatsapp',
        idExterno: 'EV-1',
        texto: TEXTO_NOVO,
        editadaEm: Date.parse('2026-10-01T10:00:00Z') + 501 * 60_000,
        origem: 'cifrada',
        bruto: '{}',
        agora: Date.parse('2026-10-13T12:00:00Z'),
      });
      return id;
    },
  });
  try {
    for (const caminho of ['/mensagens?limite=500', `/conversas/${cena.s.diretaDeAna}/mensagens?limite=500`]) {
      const dele = await cena.pedir(caminho, cena.chaveDoOutro.valor);
      assert.equal(dele.corpo.includes(TEXTO_NOVO), false, `${caminho}: o texto da edicao vazou entre Inquilinos`);
    }
    // Contraprova: sem ela o teste passaria vazio.
    const doTitular = await cena.pedir('/mensagens?limite=500', cena.chave.valor);
    assert.equal(doTitular.corpo.includes(TEXTO_NOVO), true, 'a contraprova falhou: o Titular nao ve a propria edicao');
  } finally {
    cena.encerrar();
  }
});
