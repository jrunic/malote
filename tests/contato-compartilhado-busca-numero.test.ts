import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { subirCenaDeIdentidade } from './ajuda/identidade.js';
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

test('acha por TRECHO de digitos, com 6 ou mais, em qualquer formatacao do termo', () => {
  comCartao((acervo, _cv, m) => {
    assert.deepEqual(ids(acervo, '99991234'), [m], 'trecho do meio');
    assert.deepEqual(ids(acervo, '5565999991234'), [m], 'numero inteiro');
    assert.deepEqual(ids(acervo, '(65) 99999-1234'), [m], 'formatado como se digita');
    assert.deepEqual(ids(acervo, '+55 65 99999-1234'), [m]);
    assert.deepEqual(ids(acervo, '99991299'), [], 'digitos que nao estao la');
    assert.deepEqual(ids(acervo, 'zzz 99991234'), [], 'palavra + numero e busca de palavras (por E), nao de numero');
  });
});

test('menos de 6 digitos nao busca valores: ruido demais para um trecho curto', () => {
  comCartao((acervo) => {
    assert.deepEqual(ids(acervo, '1234'), []);
    assert.deepEqual(ids(acervo, '99'), []);
  });
});

test('os filtros de conversa e de periodo valem para o cartao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const cv1 = conversa(acervo, '5565900000001@s.whatsapp.net');
    const cv2 = conversa(acervo, '5565900000002@s.whatsapp.net');
    const m1 = mensagem(acervo, cv1, 'm1', 0);
    const m2 = mensagem(acervo, cv2, 'm2', 120);
    registrarContatosCompartilhados(acervo, m1, [ANA]);
    registrarContatosCompartilhados(acervo, m2, [ANA]);

    assert.deepEqual(buscarMensagens(acervo, { texto: 'Souza', conversaId: cv1 }).map((x) => x.id), [m1]);
    assert.deepEqual(
      buscarMensagens(acervo, { texto: '99991234', de: Date.parse('2026-10-01T11:00:00Z') }).map((x) => x.id),
      [m2],
    );
  } finally {
    c.limpar();
  }
});

test('GET /buscar acha o cartao e marca a origem (rede)', async () => {
  const cena = await subirCenaDeIdentidade<string>({
    semearMais: (acervo, s) => {
      const m = mensagem(acervo, s.diretaDeAna, 'cartao-1', 500);
      registrarContatosCompartilhados(acervo, m, [ANA]);
      return m;
    },
  });
  try {
    const r = await cena.pedir('/buscar?texto=99991234', cena.chave.valor);
    assert.equal(r.status, 200, r.corpo);
    const corpo = JSON.parse(r.corpo) as {
      mensagens: Array<{ id: string; origemDaCorrespondencia: string; contatosCompartilhados: Array<{ nome: string }> }>;
    };
    assert.equal(corpo.mensagens.length, 1);
    assert.equal(corpo.mensagens[0]?.id, cena.extra);
    assert.equal(corpo.mensagens[0]?.origemDaCorrespondencia, 'contato-compartilhado');
    assert.equal(corpo.mensagens[0]?.contatosCompartilhados[0]?.nome, 'Ana Souza');
  } finally {
    cena.encerrar();
  }
});

test('isolamento: a busca por numero com a chave de OUTRO Inquilino nao acha o cartao do Titular (rede)', async () => {
  const cena = await subirCenaDeIdentidade<string>({
    semearMais: (acervo, s) => {
      const m = mensagem(acervo, s.diretaDeAna, 'cartao-1', 500);
      registrarContatosCompartilhados(acervo, m, [ANA]);
      return m;
    },
  });
  try {
    const doOutro = await cena.pedir('/buscar?texto=99991234', cena.chaveDoOutro.valor);
    assert.equal(doOutro.status, 200, doOutro.corpo);
    assert.deepEqual((JSON.parse(doOutro.corpo) as { mensagens: unknown[] }).mensagens, []);
    // Contraprova: a mesma busca, com a chave do Titular, acha.
    const doTitular = await cena.pedir('/buscar?texto=99991234', cena.chave.valor);
    assert.equal((JSON.parse(doTitular.corpo) as { mensagens: unknown[] }).mensagens.length, 1);
  } finally {
    cena.encerrar();
  }
});
