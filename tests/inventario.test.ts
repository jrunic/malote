import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { listarIdentificadores } from '../src/nucleo/inventario.js';
import { registrarCartaoDeCatalogo, registrarIdentificador } from '../src/nucleo/escrita.js';
import { CFG_CONTATOS, CFG_CONTATOS_SEGUNDA } from './ajuda/configuracao.js';
import {
  criarPessoa,
  mesclarPessoas,
  registrarNome,
  vincularIdentificador,
} from '../src/nucleo/identidade.js';

test('devolve todo Identificador com Fonte, valor, Pessoa e os nomes dele', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const { id: w } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511912345678' });
  const { id: k } = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5511912345678' });
  registrarNome(acervo, { autoridade: 'terceiro', identificadorId: k, origem: 'contatos', nome: 'Joana Prado' });
  registrarNome(acervo, { autoridade: 'terceiro', identificadorId: k, origem: 'contatos', nome: 'Joana P' });
  const pessoa = criarPessoa(acervo);
  vincularIdentificador(acervo, { identificadorId: w, pessoaId: pessoa, procedencia: 'material' });

  const inv = listarIdentificadores(acervo);
  assert.equal(inv.length, 2);

  const doWhats = inv.find((i) => i.id === w);
  assert.equal(doWhats?.fonte, 'whatsapp');
  assert.equal(doWhats?.pessoaId, pessoa);
  assert.deepEqual(doWhats?.nomes, []);
  assert.deepEqual(doWhats?.cartoes, [], 'so endereco de catalogo tem laco de cartao');

  const doCat = inv.find((i) => i.id === k);
  assert.equal(doCat?.fonte, 'contatos');
  assert.equal(doCat?.pessoaId, null);
  assert.deepEqual([...(doCat?.nomes ?? [])].sort(), ['Joana P', 'Joana Prado']);
  c.limpar();
});

test('não inclui nome pendurado em Pessoa — o inventário é de endereço', () => {
  // Nome de Pessoa existe (forma B do ciclo 3) e NAO e evidencia de endereco:
  // incluir aqui faria o produtor por nome casar coisas que ninguem afirmou
  // sobre aquele endereco.
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const { id } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511999990000' });
  const pessoa = criarPessoa(acervo);
  vincularIdentificador(acervo, { identificadorId: id, pessoaId: pessoa, procedencia: 'humano' });
  registrarNome(acervo, { autoridade: 'terceiro', pessoaId: pessoa, origem: 'manual', nome: 'Nome Da Pessoa' });

  const inv = listarIdentificadores(acervo);
  assert.deepEqual(inv[0]?.nomes, []);
  c.limpar();
});

test('a Pessoa devolvida é a MESTRE quando o Identificador pertence a uma absorvida', () => {
  // Sem isto, o criterio 14 falharia: dois enderecos de uma familia mesclada
  // pareceriam de Pessoas diferentes e a Proposta seria oferecida de novo.
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const { id: a } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511900000001' });
  const { id: b } = registrarIdentificador(acervo, { fonte: 'instagram', valor: 'perfil-x' });
  const pA = criarPessoa(acervo);
  const pB = criarPessoa(acervo);
  vincularIdentificador(acervo, { identificadorId: a, pessoaId: pA, procedencia: 'material' });
  vincularIdentificador(acervo, { identificadorId: b, pessoaId: pB, procedencia: 'material' });
  mesclarPessoas(acervo, { pessoaA: pA, pessoaB: pB });

  const inv = listarIdentificadores(acervo);
  const pessoas = new Set(inv.map((i) => i.pessoaId));
  assert.equal(pessoas.size, 1, 'os dois enderecos devem apontar para a mesma mestre');
  c.limpar();
});

test('um endereço em DUAS bases devolve os dois cartões, com a Configuração de cada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const { id } = registrarIdentificador(acervo, {
      fonte: 'contatos',
      valor: 'leia@exemplo.test',
    });
    // O MESMO endereço, em duas bases. É UMA linha em `identificadores` —
    // `UNIQUE (fonte, valor)` —, e a única coisa que distingue as bases é o
    // par (cartão, Configuração). Sem os dois, o produtor que liga uma base à
    // outra não tem o que cruzar.
    registrarCartaoDeCatalogo(acervo, id, 'cartao-A', CFG_CONTATOS.id, '2026-09-01T00:00:00Z');
    registrarCartaoDeCatalogo(
      acervo, id, 'cartao-B', CFG_CONTATOS_SEGUNDA.id, '2026-09-02T00:00:00Z',
    );

    const achado = listarIdentificadores(acervo).find((i) => i.id === id);
    assert.deepEqual(
      [...(achado?.cartoes ?? [])].sort((a, b) => a.cartao.localeCompare(b.cartao)),
      [
        { cartao: 'cartao-A', configuracaoId: CFG_CONTATOS.id },
        { cartao: 'cartao-B', configuracaoId: CFG_CONTATOS_SEGUNDA.id },
      ],
    );
  } finally {
    c.limpar();
  }
});

test('endereço de Fonte que não é catálogo vem com lista VAZIA, nunca nula', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const { id } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000001' });
    const achado = listarIdentificadores(acervo).find((i) => i.id === id);
    // Vazio, e não `null`: o tipo deixa de ter dois estados para dizer
    // "nenhum", que é a forma de alguém esquecer um deles.
    assert.deepEqual(achado?.cartoes, []);
  } finally {
    c.limpar();
  }
});
