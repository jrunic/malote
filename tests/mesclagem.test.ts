import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import {
  registrarConversa,
  registrarIdentificador,
  registrarMensagem,
} from '../src/nucleo/escrita.js';
import { contarAcervo, lerMensagens } from '../src/nucleo/consulta.js';
import {
  criarPessoa,
  historicoDeNomes,
  identificadoresDaPessoa,
  lerVinculo,
  MesclagemDeUmaPessoaSoError,
  mesclarPessoas,
  registrarNome,
  vincularIdentificador,
} from '../src/nucleo/identidade.js';
import { familiaDe } from '../src/nucleo/familia.js';
import { CFG_INSTAGRAM } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-08-27T12:00:00Z');
const EM_USO = Date.parse('2021-06-15T10:00:00Z');

/** Duas Pessoas com um endereço e um nome cada, vistas em Fontes diferentes. */
function duasPessoas(acervo: Acervo) {
  const { id: noWhats } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000001' });
  const { id: noInsta } = registrarIdentificador(acervo, { fonte: 'instagram', valor: 'conversa:42' });
  const daFonteA = criarPessoa(acervo);
  const daFonteB = criarPessoa(acervo);
  vincularIdentificador(acervo, {
    identificadorId: noWhats,
    pessoaId: daFonteA,
    procedencia: 'material',
  });
  vincularIdentificador(acervo, {
    identificadorId: noInsta,
    pessoaId: daFonteB,
    procedencia: 'material',
  });
  registrarNome(acervo, { autoridade: 'terceiro', pessoaId: daFonteA, origem: 'whatsapp', nome: 'Han' });
  registrarNome(acervo, { autoridade: 'terceiro', pessoaId: daFonteB, origem: 'instagram', nome: 'Han Solo' });
  return { noWhats, noInsta, daFonteA, daFonteB };
}

// EXPECTATIVA MUDADA em 29/08/2026: mesclar NAO move mais os Identificadores.
//
// Cada um continua na Pessoa em que sempre esteve; e a leitura da mestre que
// alcanca a familia. A procedencia continua preservada — mesclar nunca promove
// ninguem, e nao pode virar caminho oblíquo para transformar `catalogo` em
// `humano`.
test('mesclar não move os Identificadores, e preserva a procedência de cada um', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { noWhats, noInsta, daFonteA, daFonteB } = duasPessoas(acervo);

    mesclarPessoas(acervo, { pessoaA: daFonteA, pessoaB: daFonteB, mestreId: daFonteA });

    // O vínculo de cada Identificador continua na Pessoa original.
    assert.equal(lerVinculo(acervo, noWhats)?.pessoaId, daFonteA);
    assert.equal(lerVinculo(acervo, noInsta)?.pessoaId, daFonteB, 'não mudou de dono');
    assert.equal(lerVinculo(acervo, noInsta)?.procedencia, 'material');

    // E a leitura da mestre alcança os dois.
    assert.deepEqual(
      identificadoresDaPessoa(acervo, daFonteA).map((i) => i.id).sort(),
      [noWhats, noInsta].sort(),
    );
  } finally {
    c.limpar();
  }
});

test('a Pessoa absorvida PERMANECE, sem Identificador, marcada como absorvida', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    const { daFonteA, daFonteB } = duasPessoas(acervo);

    mesclarPessoas(acervo, { pessoaA: daFonteA, pessoaB: daFonteB, mestreId: daFonteA });

    assert.equal(contarAcervo(acervo).pessoas, 2, 'nenhuma Pessoa é apagada');
    const linha = acervo.db
      .prepare('SELECT absorvida_por, absorvida_em FROM pessoas WHERE id = ?')
      .get(daFonteB) as { absorvida_por: string | null; absorvida_em: string | null };
    assert.equal(linha.absorvida_por, daFonteA);
    assert.ok(linha.absorvida_em);
  } finally {
    c.limpar();
  }
});

test('as DUAS histórias de nome sobrevivem, cada uma na sua Pessoa', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Chewbacca');
    const { daFonteA, daFonteB } = duasPessoas(acervo);

    mesclarPessoas(acervo, { pessoaA: daFonteA, pessoaB: daFonteB, mestreId: daFonteA });

    // A sobrevivente recebe os nomes da absorvida, e nenhum e escolhido em
    // detrimento do outro: os dois viram Atribuicao de Nome dela.
    const naSobrevivente = historicoDeNomes(acervo, daFonteA)
      .map((h) => h.nome)
      .sort();
    assert.deepEqual(naSobrevivente, ['Han', 'Han Solo']);

    // E a absorvida guarda o que ela sabia, para que desfazer seja possivel.
    assert.equal(historicoDeNomes(acervo, daFonteB).length, 1);
  } finally {
    c.limpar();
  }
});

test('mesclar não escreve em Mensagem nenhuma', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Lando');
    const { noInsta, daFonteA, daFonteB } = duasPessoas(acervo);
    const conversa = registrarConversa(acervo, {
      fonte: 'instagram',
      idExterno: 'conversa:42',
      coletiva: false, configuracao: CFG_INSTAGRAM,
    });
    registrarMensagem(acervo, {
      direcao: 'recebida',
      conversaId: conversa,
      fonte: 'instagram',
      idExterno: 'msg-1',
      autorId: noInsta,
      conteudo: 'nunca me diga as chances',
      ocorridaEm: EM_USO,
      agora: AGORA,
    });
    const antes = lerMensagens(acervo, {});

    mesclarPessoas(acervo, { pessoaA: daFonteA, pessoaB: daFonteB, mestreId: daFonteA });

    const depois = lerMensagens(acervo, {});
    assert.deepEqual(depois, antes, 'a Mensagem aponta para o Identificador, nunca para a Pessoa');
    // E o filtro por Pessoa passa a alcançar a Mensagem pela sobrevivente.
    assert.equal(lerMensagens(acervo, { pessoaId: daFonteA }).length, 1);
  } finally {
    c.limpar();
  }
});

test('mesclar uma Pessoa com ela mesma é recusado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Wedge');
    const { daFonteA } = duasPessoas(acervo);
    assert.throws(
      () => mesclarPessoas(acervo, { pessoaA: daFonteA, pessoaB: daFonteA, mestreId: daFonteA }),
      MesclagemDeUmaPessoaSoError,
    );
  } finally {
    c.limpar();
  }
});

// EXPECTATIVA MUDADA em 29/08/2026, e declarada em vez de apagada.
//
// Este teste afirmava que Pessoa ja absorvida nao absorve nem e absorvida de
// novo. Aquela recusa existia porque mesclar MOVIA, e cadeia produzia estado
// que nenhuma leitura resolvia sem percorrer. Com o apontamento em estrela,
// unir duas familias e caso normal: quem recebe uma absorvida resolve para a
// mestre dela, e a familia que perde o posto e reapontada.
test('referenciar uma absorvida resolve para a mestre dela, em vez de recusar', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Rey');
    const { daFonteA, daFonteB } = duasPessoas(acervo);
    const terceira = criarPessoa(acervo);
    mesclarPessoas(acervo, { pessoaA: daFonteA, pessoaB: daFonteB, mestreId: daFonteA });

    // Referenciar daFonteB é natural para quem está olhando daFonteB.
    const r = mesclarPessoas(acervo, { pessoaA: daFonteB, pessoaB: terceira, mestreId: daFonteA });
    assert.equal(r.mestreId, daFonteA, 'resolveu para a mestre da família');
    assert.deepEqual(familiaDe(acervo, daFonteA).sort(), [daFonteA, daFonteB, terceira].sort());
  } finally {
    c.limpar();
  }
});

// EXPECTATIVA MUDADA em 29/08/2026: mesclar nao copia mais nada.
test('mesclar não copia nome nenhum; a leitura da mestre alcança a família', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { noInsta, daFonteA, daFonteB } = duasPessoas(acervo);
    // Nome que pertence ao ENDEREÇO, não à Pessoa absorvida.
    registrarNome(acervo, { autoridade: 'terceiro', identificadorId: noInsta, origem: 'instagram', nome: 'Han do Insta' });

    mesclarPessoas(acervo, { pessoaA: daFonteA, pessoaB: daFonteB, mestreId: daFonteA });

    // Nada foi copiado: a mestre continua com o nome que sempre teve.
    const naMestre = acervo.db
      .prepare('SELECT COUNT(*) AS n FROM atribuicoes_de_nome WHERE pessoa_id = ?')
      .get(daFonteA) as { n: number };
    assert.equal(naMestre.n, 1, 'mesclar não acrescentou nome nenhum à mestre');
    // E a leitura alcança tudo: o nome de nível Pessoa da absorvida e o do endereço.
    assert.equal(historicoDeNomes(acervo, daFonteA).length, 3);
  } finally {
    c.limpar();
  }
});
