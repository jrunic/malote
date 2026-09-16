import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync, renameSync } from 'node:fs';
import { cenario } from './ajuda/acervo.js';
import {
  abrirAcervo,
  abrirAcervoSomenteLeitura,
  VERSAO_SCHEMA_ACERVO,
} from '../src/nucleo/acervo.js';

test('cada Inquilino tem seu próprio arquivo de Acervo', () => {
  const c = cenario();
  try {
    const leia = c.novoInquilino('Leia Organa');
    const han = c.novoInquilino('Han Solo');

    assert.ok(existsSync(join(c.raiz, 'acervos', `${leia.id}.db`)));
    assert.ok(existsSync(join(c.raiz, 'acervos', `${han.id}.db`)));
    assert.notEqual(leia.acervo.caminho, han.acervo.caminho);
  } finally {
    c.limpar();
  }
});

test('o Acervo nasce na versão corrente do schema, com integridade referencial ligada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    assert.equal(acervo.versaoDoSchema(), VERSAO_SCHEMA_ACERVO);
    assert.equal(acervo.db.pragma('foreign_keys', { simple: true }), 1);
  } finally {
    c.limpar();
  }
});

test('reabrir o Acervo do mesmo Inquilino é idempotente', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Leia Organa');
    const caminho = acervo.caminho;
    acervo.fechar();

    const reaberto = abrirAcervo(join(c.raiz, 'acervos'), id);
    assert.equal(reaberto.caminho, caminho);
    assert.equal(reaberto.versaoDoSchema(), VERSAO_SCHEMA_ACERVO);
    reaberto.fechar();
  } finally {
    c.limpar();
  }
});

test('abrir um Acervo sob Inquilino diferente do gravado é recusado', () => {
  const c = cenario();
  try {
    const leia = c.novoInquilino('Leia Organa');
    const han = c.novoInquilino('Han Solo');
    leia.acervo.fechar();
    han.acervo.fechar();

    // Simula defeito de resolução de caminho: o arquivo do Han passa a ocupar
    // o nome do arquivo da Leia. A separação física não protege sozinha —
    // quem protege é a identidade gravada dentro do Acervo.
    const pasta = join(c.raiz, 'acervos');
    renameSync(join(pasta, `${leia.id}.db`), join(pasta, `${leia.id}.db.guardado`));
    renameSync(join(pasta, `${han.id}.db`), join(pasta, `${leia.id}.db`));

    assert.throws(
      () => abrirAcervo(pasta, leia.id),
      /Acervo pertence a outro Inquilino/,
      'mensagem própria desta guarda',
    );
  } finally {
    c.limpar();
  }
});

test('o Acervo aberto só-leitura recusa escrita', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Leia Organa');
    acervo.fechar();

    const leitura = abrirAcervoSomenteLeitura(join(c.raiz, 'acervos'), id);
    assert.throws(() => leitura.db.exec("INSERT INTO acervo (inquilino_id) VALUES ('x')"));
    leitura.fechar();
  } finally {
    c.limpar();
  }
});
