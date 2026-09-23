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
import { listarSemEndereco } from '../src/nucleo/consulta.js';
import { criarPessoa, registrarNome, vincularIdentificador } from '../src/nucleo/identidade.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-08-27T12:00:00Z');
const EM_USO = Date.parse('2021-06-15T10:00:00Z');
const PRECEDENCIA = {
  porOrigem: { whatsapp: 100, instagram: 100, manual: 300 },
  catalogoPreferido: null,
};

/** Uma Conversa com N Mensagens, e o Identificador da contraparte. */
function conversaCom(acervo: Acervo, marca: string, quantas: number): string {
  const { id: ident } = registrarIdentificador(acervo, {
    fonte: 'whatsapp',
    valor: `${marca}@s.whatsapp.net`,
  });
  const conversa = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: `conversa-${marca}`,
    coletiva: false, configuracao: CFG_WHATSAPP,
  });
  registrarParticipacao(acervo, {
    conversaId: conversa,
    identificadorId: ident,
    observadaEm: new Date(AGORA).toISOString(),
  });
  for (let i = 0; i < quantas; i += 1) {
    registrarMensagem(acervo, {
      direcao: 'recebida',
      conversaId: conversa,
      fonte: 'whatsapp',
      idExterno: `${marca}-${i}`,
      autorId: ident,
      conteudo: 'oi',
      ocorridaEm: EM_USO + i,
      agora: AGORA,
    });
  }
  return ident;
}

test('a lista vem ordenada por cobertura, decrescente', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    conversaCom(acervo, 'pouco', 2);
    conversaCom(acervo, 'muito', 40);
    conversaCom(acervo, 'medio', 10);

    const lista = listarSemEndereco(acervo, PRECEDENCIA, {});

    assert.deepEqual(
      lista.map((l) => l.mensagens),
      [40, 10, 2],
    );
  } finally {
    c.limpar();
  }
});

test('cada linha diz quantas Mensagens o vínculo passa a cobrir, e mostra o nome', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const ident = conversaCom(acervo, 'han', 7);
    registrarNome(acervo, { autoridade: 'terceiro', identificadorId: ident, origem: 'whatsapp', nome: 'Han Solo' });

    const linha = listarSemEndereco(acervo, PRECEDENCIA, {})[0];

    assert.equal(linha?.identificadorId, ident);
    assert.equal(linha?.mensagens, 7);
    assert.equal(linha?.conversas, 1);
    assert.equal(linha?.nome, 'Han Solo');
  } finally {
    c.limpar();
  }
});

test('endereço sem nome aparece na lista, com nome nulo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    conversaCom(acervo, 'anonimo', 3);
    assert.equal(listarSemEndereco(acervo, PRECEDENCIA, {})[0]?.nome, null);
  } finally {
    c.limpar();
  }
});

test('endereço JÁ vinculado sai da lista', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const resolvido = conversaCom(acervo, 'resolvido', 30);
    const pendente = conversaCom(acervo, 'pendente', 5);
    const pessoa = criarPessoa(acervo);
    vincularIdentificador(acervo, {
      identificadorId: resolvido,
      pessoaId: pessoa,
      procedencia: 'humano',
    });

    const lista = listarSemEndereco(acervo, PRECEDENCIA, {});
    assert.deepEqual(
      lista.map((l) => l.identificadorId),
      [pendente],
    );
  } finally {
    c.limpar();
  }
});

test('um endereço em duas Conversas soma a cobertura das duas', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const ident = conversaCom(acervo, 'han', 4);
    // Segunda Conversa com o MESMO endereço: ligar uma vez cobre as duas.
    const outra = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'conversa-outra',
      coletiva: false, configuracao: CFG_WHATSAPP,
    });
    registrarParticipacao(acervo, {
      conversaId: outra,
      identificadorId: ident,
      observadaEm: new Date(AGORA).toISOString(),
    });
    registrarMensagem(acervo, {
      direcao: 'recebida',
      conversaId: outra,
      fonte: 'whatsapp',
      idExterno: 'outra-0',
      autorId: ident,
      conteudo: 'oi',
      ocorridaEm: EM_USO,
      agora: AGORA,
    });

    const linha = listarSemEndereco(acervo, PRECEDENCIA, {})[0];
    assert.equal(linha?.conversas, 2);
    assert.equal(linha?.mensagens, 5);
  } finally {
    c.limpar();
  }
});

test('o limite corta a cauda sem mudar a ordem', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    // A ordem alfabética é DELIBERADAMENTE o inverso da de cobertura: com
    // a=30, b=20, c=1 as duas coincidiriam, e o teste passaria mesmo se a
    // consulta ordenasse pelo desempate. Medido ao revisar o plano.
    conversaCom(acervo, 'a', 1);
    conversaCom(acervo, 'b', 20);
    conversaCom(acervo, 'c', 30);

    const lista = listarSemEndereco(acervo, PRECEDENCIA, { limite: 2 });
    assert.deepEqual(
      lista.map((l) => l.mensagens),
      [30, 20],
    );
  } finally {
    c.limpar();
  }
});
