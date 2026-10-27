import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { registrarContatosCompartilhados, type CartaoCompartilhado } from '../src/nucleo/contato-compartilhado.js';
import { buscarMensagens } from '../src/nucleo/consulta.js';

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

test('acha por trecho de e-mail, sem diferenciar caixa, e o curto demais nao busca', () => {
  comCartao((acervo, _cv, m) => {
    assert.deepEqual(ids(acervo, 'exemplo.com'), [m]);
    assert.deepEqual(ids(acervo, 'ANA.SOUZA@EXEMPLO'), [m]);
    assert.deepEqual(ids(acervo, '@e'), [], 'dois caracteres nao bastam');
  });
});

test('% e _ no termo sao literais: nao viram curinga do LIKE', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const cv = conversa(acervo);
    const m = mensagem(acervo, cv, 'm1');
    registrarContatosCompartilhados(acervo, m, [
      { nome: 'Fulano', organizacao: null, nomeComercial: null, valores: [{ tipo: 'email', texto: 'axb@x.com', digitos: null, rotulo: null }] },
    ]);
    assert.deepEqual(ids(acervo, 'a_b@x'), [], '_ nao casa um caractere qualquer');
    assert.deepEqual(ids(acervo, 'a%b@x'), [], '% nao casa qualquer sequencia');
    assert.deepEqual(ids(acervo, 'axb@x'), [m]);
  } finally {
    c.limpar();
  }
});
