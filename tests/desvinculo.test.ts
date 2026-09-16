import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import { contarAcervo } from '../src/nucleo/consulta.js';
import {
  criarPessoa,
  desvincularIdentificador,
  desvinculosDaPessoa,
  historicoDeNomes,
  lerVinculo,
  registrarNome,
  vincularIdentificador,
} from '../src/nucleo/identidade.js';

test('desvincular o ÚLTIMO Identificador não apaga a Pessoa nem o histórico', () => {
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
    registrarNome(acervo, { autoridade: 'terceiro', pessoaId: pessoa, origem: 'contatos', nome: 'Leia Organa' });

    desvincularIdentificador(acervo, ident);

    assert.equal(lerVinculo(acervo, ident), null);
    assert.equal(contarAcervo(acervo).pessoas, 1, 'a Pessoa continua existindo');
    assert.equal(historicoDeNomes(acervo, pessoa).length, 1, 'o histórico fica com ela');
  } finally {
    c.limpar();
  }
});

test('a Pessoa registra o que foi desfeito, com o endereço e quem afirmava', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    const { id: ident } = registrarIdentificador(acervo, { fonte: 'instagram', valor: 'conversa:42' });
    const pessoa = criarPessoa(acervo);
    vincularIdentificador(acervo, {
      identificadorId: ident,
      pessoaId: pessoa,
      procedencia: 'catalogo',
    });

    desvincularIdentificador(acervo, ident);

    const desfeitos = desvinculosDaPessoa(acervo, pessoa);
    assert.equal(desfeitos.length, 1);
    assert.equal(desfeitos[0]?.fonte, 'instagram');
    assert.equal(desfeitos[0]?.valor, 'conversa:42');
    assert.equal(desfeitos[0]?.procedencia, 'catalogo');
  } finally {
    c.limpar();
  }
});

test('desvincular Identificador que não tem Pessoa não registra nada e não é erro', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Chewbacca');
    const { id: ident } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000002' });
    const pessoa = criarPessoa(acervo);

    desvincularIdentificador(acervo, ident);

    assert.equal(desvinculosDaPessoa(acervo, pessoa).length, 0);
    const linhas = acervo.db.prepare('SELECT COUNT(*) AS n FROM desvinculos').get() as { n: number };
    assert.equal(linhas.n, 0, 'sem vinculo nao ha nada a registrar');
  } finally {
    c.limpar();
  }
});

test('desvincular duas vezes registra uma vez só', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Lando');
    const { id: ident } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000003' });
    const pessoa = criarPessoa(acervo);
    vincularIdentificador(acervo, {
      identificadorId: ident,
      pessoaId: pessoa,
      procedencia: 'humano',
    });

    desvincularIdentificador(acervo, ident);
    desvincularIdentificador(acervo, ident);

    assert.equal(desvinculosDaPessoa(acervo, pessoa).length, 1);
  } finally {
    c.limpar();
  }
});
