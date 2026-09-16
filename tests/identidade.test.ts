import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import {
  criarPessoa,
  desvincularIdentificador,
  registrarNome,
  IdentificadorDeOutraPessoaError,
  lerVinculo,
  vincularIdentificador,
  VinculoDeProcedenciaMaiorError,
} from '../src/nucleo/identidade.js';

test('o vínculo grava quem o afirmou e quando', () => {
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

    const vinculo = lerVinculo(acervo, ident);
    assert.equal(vinculo?.pessoaId, pessoa);
    assert.equal(vinculo?.procedencia, 'humano');
    assert.match(vinculo?.vinculadoEm ?? '', /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    c.limpar();
  }
});

test('execução automática NÃO desfaz vínculo afirmado por humano', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    const { id: ident } = registrarIdentificador(acervo, { fonte: 'instagram', valor: 'conversa:42' });
    const daPessoaCerta = criarPessoa(acervo);
    const daPessoaErrada = criarPessoa(acervo);

    vincularIdentificador(acervo, {
      identificadorId: ident,
      pessoaId: daPessoaCerta,
      procedencia: 'humano',
    });

    assert.throws(
      () =>
        vincularIdentificador(acervo, {
          identificadorId: ident,
          pessoaId: daPessoaErrada,
          procedencia: 'catalogo',
        }),
      VinculoDeProcedenciaMaiorError,
    );

    assert.equal(lerVinculo(acervo, ident)?.pessoaId, daPessoaCerta);
    assert.equal(lerVinculo(acervo, ident)?.procedencia, 'humano');
  } finally {
    c.limpar();
  }
});

test('vincular Identificador que já é de outra Pessoa é recusado, não roubado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Chewbacca');
    const { id: ident } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000002' });
    const primeira = criarPessoa(acervo);
    const segunda = criarPessoa(acervo);

    vincularIdentificador(acervo, {
      identificadorId: ident,
      pessoaId: primeira,
      procedencia: 'material',
    });

    assert.throws(
      () =>
        vincularIdentificador(acervo, {
          identificadorId: ident,
          pessoaId: segunda,
          procedencia: 'humano',
        }),
      IdentificadorDeOutraPessoaError,
    );

    assert.equal(lerVinculo(acervo, ident)?.pessoaId, primeira);
  } finally {
    c.limpar();
  }
});

test('reafirmar com procedência menor não move a data do vínculo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Rey');
    const { id: ident } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000005' });
    const pessoa = criarPessoa(acervo);

    vincularIdentificador(acervo, {
      identificadorId: ident,
      pessoaId: pessoa,
      procedencia: 'humano',
    });
    const quandoOHumanoAfirmou = lerVinculo(acervo, ident)?.vinculadoEm;

    vincularIdentificador(acervo, {
      identificadorId: ident,
      pessoaId: pessoa,
      procedencia: 'material',
    });

    assert.equal(lerVinculo(acervo, ident)?.vinculadoEm, quandoOHumanoAfirmou);
  } finally {
    c.limpar();
  }
});

test('revincular à MESMA Pessoa é aceito e nunca rebaixa a procedência', () => {
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
    vincularIdentificador(acervo, {
      identificadorId: ident,
      pessoaId: pessoa,
      procedencia: 'material',
    });

    assert.equal(lerVinculo(acervo, ident)?.procedencia, 'humano');
  } finally {
    c.limpar();
  }
});

test('desvincular deixa o Identificador sem Pessoa e sem procedência', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Wedge');
    const { id: ident } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000004' });
    const pessoa = criarPessoa(acervo);
    vincularIdentificador(acervo, {
      identificadorId: ident,
      pessoaId: pessoa,
      procedencia: 'humano',
    });

    desvincularIdentificador(acervo, ident);

    assert.equal(lerVinculo(acervo, ident), null);
  } finally {
    c.limpar();
  }
});

test('registrarNome diz se a atribuição é nova', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const { id } = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5511912345678' });
  const primeira = registrarNome(acervo, { autoridade: 'terceiro', identificadorId: id, origem: 'contatos', nome: 'Joana' });
  const segunda = registrarNome(acervo, { autoridade: 'terceiro', identificadorId: id, origem: 'contatos', nome: 'Joana' });
  assert.equal(primeira, true);
  assert.equal(segunda, false);
  c.limpar();
});
