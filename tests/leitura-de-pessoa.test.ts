import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import {
  criarPessoa,
  lerPessoa,
  listarPessoas,
  mesclarPessoas,
  registrarNome,
  vincularIdentificador,
} from '../src/nucleo/identidade.js';

const PRECEDENCIA = {
  porOrigem: { contatos: 200, whatsapp: 100, instagram: 100 },
  catalogoPreferido: null,
};

test('a leitura devolve nome corrente, histórico e Identificadores de uma vez', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id: ident } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000001' });
    const pessoa = criarPessoa(acervo);
    vincularIdentificador(acervo, {
      identificadorId: ident,
      pessoaId: pessoa,
      procedencia: 'humano',
    });
    registrarNome(acervo, { autoridade: 'terceiro', pessoaId: pessoa, origem: 'whatsapp', nome: 'Han' });
    registrarNome(acervo, { autoridade: 'terceiro', pessoaId: pessoa, origem: 'contatos', nome: 'Han Solo' });

    const lida = lerPessoa(acervo, pessoa, PRECEDENCIA);

    assert.equal(lida?.nome, 'Han Solo');
    assert.equal(lida?.historico.length, 2);
    assert.equal(lida?.identificadores.length, 1);
    assert.equal(lida?.identificadores[0]?.valor, '5565900000001');
    assert.equal(lida?.identificadores[0]?.procedencia, 'humano');
    assert.equal(lida?.absorvidaPor, null);
  } finally {
    c.limpar();
  }
});

test('Pessoa inexistente devolve nulo, e isso não é erro', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    assert.equal(lerPessoa(acervo, 'nao-existe', PRECEDENCIA), null);
  } finally {
    c.limpar();
  }
});

test('listar traz só as Pessoas vivas por padrão, e as absorvidas sob pedido', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Chewbacca');
    const viva = criarPessoa(acervo);
    const absorvida = criarPessoa(acervo);
    mesclarPessoas(acervo, { pessoaA: viva, pessoaB: absorvida, mestreId: viva });

    assert.deepEqual(
      listarPessoas(acervo, PRECEDENCIA, {}).map((p) => p.id),
      [viva],
    );
    assert.equal(listarPessoas(acervo, PRECEDENCIA, { incluirAbsorvidas: true }).length, 2);
  } finally {
    c.limpar();
  }
});

test('a Pessoa absorvida diz quem a absorveu', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Lando');
    const viva = criarPessoa(acervo);
    const absorvida = criarPessoa(acervo);
    mesclarPessoas(acervo, { pessoaA: viva, pessoaB: absorvida, mestreId: viva });

    assert.equal(lerPessoa(acervo, absorvida, PRECEDENCIA)?.absorvidaPor, viva);
  } finally {
    c.limpar();
  }
});
