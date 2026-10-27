import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { subirCenaDeIdentidade } from './ajuda/identidade.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { registrarContatosCompartilhados, type CartaoCompartilhado } from '../src/nucleo/contato-compartilhado.js';
import { lerMensagens } from '../src/nucleo/consulta.js';

const AGORA = Date.parse('2026-10-13T12:00:00Z');
const ANA: CartaoCompartilhado = {
  nome: 'Ana Souza',
  organizacao: 'Eletrica Souza',
  nomeComercial: null,
  valores: [
    { tipo: 'telefone', texto: '+55 65 99999-1234', digitos: '5565999991234', rotulo: 'cell' },
    { tipo: 'email', texto: 'ana@exemplo.com', digitos: null, rotulo: null },
  ],
};

function conversa(acervo: Acervo): string {
  return registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: '5565900000001@s.whatsapp.net',
    coletiva: false,
    configuracao: CFG_WHATSAPP,
  });
}

function mensagem(acervo: Acervo, conversaId: string, idExterno: string, minuto: number): string {
  return registrarMensagem(acervo, {
    origemDaChegada: 'importacao',
    conversaId,
    fonte: 'whatsapp',
    idExterno,
    ocorridaEm: Date.parse('2026-10-01T10:00:00Z') + minuto * 60_000,
    agora: AGORA,
    direcao: 'recebida',
  });
}

test('lerMensagens traz os cartoes de cada Mensagem, e lista vazia onde nao ha', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const cv = conversa(acervo);
    const comCartao = mensagem(acervo, cv, 'm1', 1);
    const semCartao = mensagem(acervo, cv, 'm2', 2);
    registrarContatosCompartilhados(acervo, comCartao, [ANA]);

    const lidas = lerMensagens(acervo, { conversaId: cv, ordem: 'cronologica' });

    assert.equal(lidas.find((m) => m.id === comCartao)?.contatosCompartilhados[0]?.nome, 'Ana Souza');
    assert.deepEqual(lidas.find((m) => m.id === comCartao)?.contatosCompartilhados[0]?.valores, ANA.valores);
    assert.deepEqual(lidas.find((m) => m.id === semCartao)?.contatosCompartilhados, []);
  } finally {
    c.limpar();
  }
});

test('os cartoes de uma pagina saem em consultas que NAO crescem com o numero de Mensagens', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const cv = conversa(acervo);
    const ids = Array.from({ length: 30 }, (_, i) => mensagem(acervo, cv, `m${i}`, i));
    for (const id of ids) registrarContatosCompartilhados(acervo, id, [ANA]);

    const consultasDeCartao = (limite: number): number => {
      let n = 0;
      const original = acervo.preparar.bind(acervo);
      acervo.preparar = (sql: string) => {
        if (/FROM (contatos_compartilhados|valores_de_contato_compartilhado)/.test(sql)) n += 1;
        return original(sql);
      };
      try {
        lerMensagens(acervo, { conversaId: cv, ordem: 'cronologica', limite });
      } finally {
        acervo.preparar = original;
      }
      return n;
    };

    assert.equal(consultasDeCartao(3), consultasDeCartao(30), 'o numero de consultas depende do tamanho da pagina');
    assert.ok(consultasDeCartao(30) <= 2, 'cartoes e valores: no maximo duas consultas por pagina');
  } finally {
    c.limpar();
  }
});

test('GET /conversas/<id>/mensagens devolve os cartoes no JSON (rede)', async () => {
  const cena = await subirCenaDeIdentidade<string>({
    semearMais: (acervo, s) => {
      const id = mensagem(acervo, s.diretaDeAna, 'cartao-1', 500);
      registrarContatosCompartilhados(acervo, id, [ANA]);
      return id;
    },
  });
  try {
    const r = await cena.pedir(`/conversas/${cena.s.diretaDeAna}/mensagens?limite=500`, cena.chave.valor);
    assert.equal(r.status, 200, r.corpo);
    const corpo = JSON.parse(r.corpo) as {
      mensagens: Array<{ id: string; contatosCompartilhados: Array<{ nome: string; valores: unknown[] }> }>;
    };
    const dela = corpo.mensagens.find((m) => m.id === cena.extra);
    assert.equal(dela?.contatosCompartilhados[0]?.nome, 'Ana Souza');
    assert.equal(dela?.contatosCompartilhados[0]?.valores.length, 2);
    assert.ok(
      corpo.mensagens.filter((m) => m.id !== cena.extra).every((m) => Array.isArray(m.contatosCompartilhados)),
      'toda Mensagem traz a lista, vazia quando nao ha cartao',
    );
  } finally {
    cena.encerrar();
  }
});

test('isolamento: a chave de OUTRO Inquilino nao ve cartao nenhum do Titular (rede)', async () => {
  const cena = await subirCenaDeIdentidade<string>({
    semearMais: (acervo, s) => {
      const id = mensagem(acervo, s.diretaDeAna, 'cartao-1', 500);
      registrarContatosCompartilhados(acervo, id, [ANA]);
      return id;
    },
  });
  try {
    for (const caminho of ['/mensagens?limite=500', `/conversas/${cena.s.diretaDeAna}/mensagens?limite=500`]) {
      const dele = await cena.pedir(caminho, cena.chaveDoOutro.valor);
      assert.equal(dele.corpo.includes('Ana Souza'), false, `${caminho}: o nome do cartao vazou entre Inquilinos`);
      assert.equal(dele.corpo.includes('99999-1234'), false, `${caminho}: o telefone do cartao vazou entre Inquilinos`);
    }
    // Contraprova: sem ela o teste passaria vazio. A chave do Titular ve o cartao.
    const doTitular = await cena.pedir('/mensagens?limite=500', cena.chave.valor);
    assert.equal(doTitular.corpo.includes('Ana Souza'), true, 'a contraprova falhou: o Titular nao ve o proprio cartao');
  } finally {
    cena.encerrar();
  }
});
