import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import {
  registrarConversa,
  registrarIdentificador,
  registrarMensagem,
  registrarParticipacao,
} from '../src/nucleo/escrita.js';
import { buscarMensagens, lerMensagens, listarConversas } from '../src/nucleo/consulta.js';
import { criarPessoa, vincularIdentificador } from '../src/nucleo/identidade.js';
import { cfgDaFonte } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-08-27T12:00:00Z');
const EM_USO = Date.parse('2021-06-15T10:00:00Z');

/**
 * A MESMA Pessoa em duas Fontes, mais um estranho na terceira Conversa.
 * Duas Fontes é o que dá poder ao teste: com uma só, um filtro que alcançasse
 * apenas o Identificador dado passaria igual.
 */
function acervoComDuasFontes(acervo: Acervo): { pessoa: string; conversas: string[] } {
  const { id: noWhats } = registrarIdentificador(acervo, {
    fonte: 'whatsapp',
    valor: 'han@s.whatsapp.net',
  });
  const { id: noInsta } = registrarIdentificador(acervo, { fonte: 'instagram', valor: 'conversa:9' });
  const { id: estranho } = registrarIdentificador(acervo, {
    fonte: 'whatsapp',
    valor: 'outro@s.whatsapp.net',
  });

  const pessoa = criarPessoa(acervo);
  for (const i of [noWhats, noInsta]) {
    vincularIdentificador(acervo, { identificadorId: i, pessoaId: pessoa, procedencia: 'humano' });
  }

  const conversas: string[] = [];
  for (const [marca, fonte, autor] of [
    ['w', 'whatsapp', noWhats],
    ['i', 'instagram', noInsta],
    ['x', 'whatsapp', estranho],
  ] as const) {
    const conversa = registrarConversa(acervo, {
      fonte,
      idExterno: `conversa-${marca}`,
      coletiva: false, configuracao: cfgDaFonte(fonte),
    });
    registrarParticipacao(acervo, {
      conversaId: conversa,
      identificadorId: autor,
      observadaEm: new Date(AGORA).toISOString(),
    });
    registrarMensagem(acervo, {
      direcao: 'recebida',
      conversaId: conversa,
      fonte,
      idExterno: `msg-${marca}`,
      autorId: autor,
      conteudo: 'chances remotas',
      ocorridaEm: EM_USO,
      agora: AGORA,
    });
    conversas.push(conversa);
  }
  return { pessoa, conversas };
}

test('ler Mensagens por Pessoa alcança as duas Fontes', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const { pessoa } = acervoComDuasFontes(acervo);
    assert.equal(lerMensagens(acervo, { pessoaId: pessoa }).length, 2);
  } finally {
    c.limpar();
  }
});

test('buscar por texto filtrando por Pessoa alcança as duas Fontes', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const { pessoa } = acervoComDuasFontes(acervo);

    assert.equal(buscarMensagens(acervo, { texto: 'chances' }).length, 3, 'sem filtro, as três');
    assert.equal(buscarMensagens(acervo, { texto: 'chances', pessoaId: pessoa }).length, 2);
  } finally {
    c.limpar();
  }
});

test('listar Conversas filtrando por Pessoa alcança as duas Fontes', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const { pessoa, conversas } = acervoComDuasFontes(acervo);

    assert.equal(listarConversas(acervo, {}).length, 3, 'sem filtro, as três');
    const daPessoa = listarConversas(acervo, { pessoaId: pessoa })
      .map((x) => x.id)
      .sort();
    assert.deepEqual(daPessoa, conversas.slice(0, 2).sort());
  } finally {
    c.limpar();
  }
});
