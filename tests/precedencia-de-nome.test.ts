import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import {
  definirPrecedenciaDeNome,
  lerPrecedenciasDeNome,
  PRECEDENCIA_PADRAO,
} from '../src/registro/precedencia-de-nome.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import {
  criarPessoa,
  nomeDaPessoa,
  registrarNome,
  vincularIdentificador,
} from '../src/nucleo/identidade.js';

/** Contagem das tabelas que uma leitura poderia tocar, como string. */
function digestDoAcervo(acervo: Acervo): string {
  const conta = (t: string): number =>
    (acervo.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  return [
    conta('pessoas'),
    conta('identificadores'),
    conta('atribuicoes_de_nome'),
    conta('desvinculos'),
    conta('atos_de_mesclagem'),
  ].join('/');
}

test('o padrão declarado põe o catálogo acima do material', () => {
  const catalogo = PRECEDENCIA_PADRAO['contatos'];
  const material = PRECEDENCIA_PADRAO['whatsapp'];
  assert.ok(catalogo !== undefined);
  assert.ok(material !== undefined);
  assert.ok(catalogo > material);
});

test('Inquilino sem configuração recebe o padrão', () => {
  const c = cenario();
  try {
    const { id } = c.novoInquilino('Leia Organa');
    assert.deepEqual(lerPrecedenciasDeNome(c.registro, id), {
      porOrigem: PRECEDENCIA_PADRAO,
      // Nulo, e nao um catalogo qualquer: quem nao declarou preferencia
      // desempata por recencia, que e o comportamento de sempre.
      catalogoPreferido: null,
    });
  } finally {
    c.limpar();
  }
});

test('a precedência é do Inquilino: mudar num não muda no outro', () => {
  const c = cenario();
  try {
    const { id: leia } = c.novoInquilino('Leia Organa');
    const { id: han } = c.novoInquilino('Han Solo');

    definirPrecedenciaDeNome(c.registro, leia, 'whatsapp', 900);

    assert.equal(lerPrecedenciasDeNome(c.registro, leia).porOrigem['whatsapp'], 900);
    assert.equal(
      lerPrecedenciasDeNome(c.registro, han).porOrigem['whatsapp'],
      PRECEDENCIA_PADRAO['whatsapp'],
    );
  } finally {
    c.limpar();
  }
});

test('redefinir a mesma origem substitui, não acumula', () => {
  const c = cenario();
  try {
    const { id } = c.novoInquilino('Chewbacca');
    definirPrecedenciaDeNome(c.registro, id, 'contatos', 500);
    definirPrecedenciaDeNome(c.registro, id, 'contatos', 50);
    assert.equal(lerPrecedenciasDeNome(c.registro, id).porOrigem['contatos'], 50);
  } finally {
    c.limpar();
  }
});

test('definir precedência para Inquilino inexistente é recusado', () => {
  const c = cenario();
  try {
    assert.throws(
      () => definirPrecedenciaDeNome(c.registro, 'nao-existe', 'contatos', 10),
      /Inquilino desconhecido/,
    );
  } finally {
    c.limpar();
  }
});

test('trocar a precedência muda o nome exibido SEM reescrever o Acervo', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const { id } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511900000001' });
  const p = criarPessoa(acervo);
  vincularIdentificador(acervo, { identificadorId: id, pessoaId: p, procedencia: 'material' });
  registrarNome(acervo, { autoridade: 'terceiro', identificadorId: id, origem: 'whatsapp', nome: '5511900000001' });
  registrarNome(acervo, { autoridade: 'terceiro', identificadorId: id, origem: 'contatos', nome: 'Joana Prado' });

  const antes = digestDoAcervo(acervo);
  const comCatalogoAcima = nomeDaPessoa(acervo, p, { porOrigem: { contatos: 200, whatsapp: 100 }, catalogoPreferido: null });
  const comMaterialAcima = nomeDaPessoa(acervo, p, { porOrigem: { contatos: 100, whatsapp: 200 }, catalogoPreferido: null });
  const depois = digestDoAcervo(acervo);

  assert.equal(comCatalogoAcima, 'Joana Prado');
  assert.equal(comMaterialAcima, '5511900000001');
  // Nenhuma escrita entre as duas leituras.
  assert.equal(depois, antes);
  c.limpar();
});
