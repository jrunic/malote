import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { registrarContatosCompartilhados, type CartaoCompartilhado } from '../src/nucleo/contato-compartilhado.js';
import { buscarMensagens, buscarMensagensComCorte } from '../src/nucleo/consulta.js';

const AGORA = Date.parse('2026-10-13T12:00:00Z');
const ANA: CartaoCompartilhado = {
  nome: 'Ana Souza',
  organizacao: 'Eletrica Souza',
  nomeComercial: 'Souza Instalacoes',
  valores: [
    { tipo: 'telefone', texto: '+55 65 99999-1234', digitos: '5565999991234', rotulo: 'cell' },
    { tipo: 'email', texto: 'Ana.Souza@Exemplo.com', digitos: null, rotulo: null },
  ],
};

function conversa(acervo: Acervo, idExterno = '5565900000001@s.whatsapp.net'): string {
  return registrarConversa(acervo, { fonte: 'whatsapp', idExterno, coletiva: false, configuracao: CFG_WHATSAPP });
}

function mensagem(acervo: Acervo, cv: string, idExterno: string, minuto = 0, conteudo?: string): string {
  return registrarMensagem(acervo, {
    origemDaChegada: 'importacao',
    conversaId: cv,
    fonte: 'whatsapp',
    idExterno,
    ocorridaEm: Date.parse('2026-10-01T10:00:00Z') + minuto * 60_000,
    agora: AGORA,
    direcao: 'recebida',
    ...(conteudo === undefined ? {} : { conteudo }),
  });
}

function comCartao(corpo: (acervo: Acervo, cv: string, m: string) => void): void {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const cv = conversa(acervo);
    const m = mensagem(acervo, cv, 'm1');
    registrarContatosCompartilhados(acervo, m, [ANA]);
    corpo(acervo, cv, m);
  } finally {
    c.limpar();
  }
}

const ids = (acervo: Acervo, texto: string): string[] => buscarMensagens(acervo, { texto }).map((x) => x.id);

test('acha a Mensagem pelo nome, pela organizacao e pelo nome comercial do cartao', () => {
  comCartao((acervo, _cv, m) => {
    assert.deepEqual(ids(acervo, 'Ana'), [m]);
    assert.deepEqual(ids(acervo, 'eletrica'), [m], 'sem diferenciar caixa');
    assert.deepEqual(ids(acervo, 'Instalacoes'), [m]);
    assert.deepEqual(ids(acervo, 'Ana Eletrica'), [m], 'palavras por E');
    assert.deepEqual(ids(acervo, 'Beto'), []);
  });
});

test('a correspondencia pelo cartao leva a origem marcada como contato-compartilhado', () => {
  comCartao((acervo) => {
    const achada = buscarMensagens(acervo, { texto: 'Souza' })[0];
    assert.equal(achada?.origemDaCorrespondencia, 'contato-compartilhado');
    assert.equal(achada?.contatosCompartilhados[0]?.nome, 'Ana Souza', 'o cartao vem junto, para quem le ver o porque');
  });
});

test('o conteudo vence o cartao quando os dois casam a mesma Mensagem', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const cv = conversa(acervo);
    const m = mensagem(acervo, cv, 'm1', 0, 'falei com a Ana Souza ontem');
    registrarContatosCompartilhados(acervo, m, [ANA]);
    const achadas = buscarMensagens(acervo, { texto: 'Souza' });
    assert.equal(achadas.length, 1, 'a mesma Mensagem nos dois lados conta uma vez');
    assert.equal(achadas[0]?.origemDaCorrespondencia, 'conteudo');
  } finally {
    c.limpar();
  }
});

test('o corte e a ordem valem para o cartao, e truncado diz que ha mais', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const cv = conversa(acervo);
    const feitas = [0, 1, 2].map((i) => {
      const m = mensagem(acervo, cv, `m${i}`, i);
      registrarContatosCompartilhados(acervo, m, [ANA]);
      return m;
    });
    const recentes = buscarMensagensComCorte(acervo, { texto: 'Souza', limite: 2 });
    assert.deepEqual(recentes.mensagens.map((x) => x.id), [feitas[2], feitas[1]]);
    assert.equal(recentes.truncado, true);
    const exato = buscarMensagensComCorte(acervo, { texto: 'Souza', limite: 3, ordem: 'cronologica' });
    assert.deepEqual(exato.mensagens.map((x) => x.id), feitas);
    assert.equal(exato.truncado, false);
  } finally {
    c.limpar();
  }
});

test('termo hostil nao derruba a busca: aspas, operadores e curingas', () => {
  comCartao((acervo) => {
    for (const hostil of ['"', 'a"b', 'AND', 'OR NOT', '*', 'NEAR(a b)', "'; --", '%', '_']) {
      assert.doesNotThrow(() => buscarMensagens(acervo, { texto: hostil }), hostil);
    }
  });
});
