import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import {
  criarPessoa,
  historicoDeNomes,
  nomeDaPessoa,
  registrarNome,
} from '../src/nucleo/identidade.js';

const SO_CATALOGO_MANDA = {
  porOrigem: { contatos: 200, whatsapp: 100, instagram: 100 },
  catalogoPreferido: null,
};

test('nome novo acrescenta; o anterior continua no histórico', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const pessoa = criarPessoa(acervo);

    registrarNome(acervo, { autoridade: 'terceiro', pessoaId: pessoa, origem: 'contatos', nome: 'Leia O.' });
    registrarNome(acervo, { autoridade: 'terceiro', pessoaId: pessoa, origem: 'contatos', nome: 'Leia Organa' });

    const historico = historicoDeNomes(acervo, pessoa);
    assert.equal(historico.length, 2);
    assert.deepEqual(
      historico.map((h) => h.nome).sort(),
      ['Leia O.', 'Leia Organa'],
    );
  } finally {
    c.limpar();
  }
});

test('registrar o mesmo nome duas vezes não duplica', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    const pessoa = criarPessoa(acervo);
    registrarNome(acervo, { autoridade: 'terceiro', pessoaId: pessoa, origem: 'whatsapp', nome: 'Han' });
    registrarNome(acervo, { autoridade: 'terceiro', pessoaId: pessoa, origem: 'whatsapp', nome: 'Han' });
    assert.equal(historicoDeNomes(acervo, pessoa).length, 1);
  } finally {
    c.limpar();
  }
});

test('o nome corrente sai da precedência, e trocá-la não escreve no Acervo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Chewbacca');
    const pessoa = criarPessoa(acervo);
    // Datas explicitas: sem elas as duas atribuicoes cairiam no mesmo
    // milissegundo e a ordenacao por data ficaria indeterminada — o teste
    // mediria a precedencia por acidente, nao por desenho.
    registrarNome(acervo, { autoridade: 'terceiro',
      pessoaId: pessoa,
      origem: 'whatsapp',
      nome: 'Chewie',
      atribuidoEm: '2026-01-02T00:00:00.000Z',
    });
    registrarNome(acervo, { autoridade: 'terceiro',
      pessoaId: pessoa,
      origem: 'contatos',
      nome: 'Chewbacca',
      atribuidoEm: '2026-01-01T00:00:00.000Z',
    });

    // O nome de contatos e o MAIS ANTIGO: se a precedencia nao valesse, a
    // recencia devolveria 'Chewie' e este assert cairia.
    assert.equal(nomeDaPessoa(acervo, pessoa, SO_CATALOGO_MANDA), 'Chewbacca');

    const antes = historicoDeNomes(acervo, pessoa).length;
    assert.equal(
      nomeDaPessoa(acervo, pessoa, {
        porOrigem: { contatos: 10, whatsapp: 900, instagram: 100 },
        catalogoPreferido: null,
      }),
      'Chewie',
    );
    assert.equal(historicoDeNomes(acervo, pessoa).length, antes);
  } finally {
    c.limpar();
  }
});

test('dentro da mesma origem, o mais recente vence', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Lando');
    const pessoa = criarPessoa(acervo);
    registrarNome(acervo, { autoridade: 'terceiro',
      pessoaId: pessoa,
      origem: 'contatos',
      nome: 'Lando C.',
      atribuidoEm: '2024-01-01T00:00:00.000Z',
    });
    registrarNome(acervo, { autoridade: 'terceiro',
      pessoaId: pessoa,
      origem: 'contatos',
      nome: 'Lando Calrissian',
      atribuidoEm: '2026-01-01T00:00:00.000Z',
    });

    assert.equal(nomeDaPessoa(acervo, pessoa, SO_CATALOGO_MANDA), 'Lando Calrissian');
  } finally {
    c.limpar();
  }
});

test('Pessoa sem nome nenhum devolve nulo, e isso não é erro', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Wedge');
    const pessoa = criarPessoa(acervo);
    assert.equal(nomeDaPessoa(acervo, pessoa, SO_CATALOGO_MANDA), null);
  } finally {
    c.limpar();
  }
});
