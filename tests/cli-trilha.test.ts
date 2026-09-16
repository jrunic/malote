import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalacaoComChave, instalacaoTemporaria, rodar } from './ajuda/instalacao.js';

/** Duas mudanças de Política: dois atos, o segundo com valor anterior. */
function duasPoliticas(raiz: string, inquilino: string, chave: string): void {
  for (const dias of ['365', '90']) {
    const r = rodar(raiz, [
      'retencao',
      'definir',
      '--inquilino',
      inquilino,
      '--chave',
      chave,
      '--mais-velho-que-dias',
      dias,
    ]);
    assert.equal(r.codigo, 0, r.saida);
  }
}

test('operacao listar mostra a trilha do Inquilino, do mais recente ao mais antigo', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, chave } = instalacaoComChave(raiz);
    duasPoliticas(raiz, inquilino, chave);

    const r = rodar(raiz, ['operacao', 'listar', '--inquilino', inquilino, '--chave', chave]);
    assert.equal(r.codigo, 0, r.saida);
    const linhas = r.saida.split('\n').filter((l) => l.includes('definir-politica'));
    assert.equal(linhas.length, 2, r.saida);
  } finally {
    limpar();
  }
});

test('operacao ver mostra o efeito linha a linha, com antes e depois', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, chave } = instalacaoComChave(raiz);
    duasPoliticas(raiz, inquilino, chave);

    const listar = rodar(raiz, ['operacao', 'listar', '--inquilino', inquilino, '--chave', chave]);
    // O identificador da Operacao e o ULTIMO da linha, e a ancora importa: a
    // listagem passou a trazer o Ator antes dele, e o Ator de um comando
    // administrativo e `operador:<uuid>` — que casa com o mesmo padrao. Pegar
    // o primeiro devolvia o id da CHAVE, e o comando respondia "Operacao
    // desconhecida". Medido em 03/09/2026, ao acrescentar o Ator a saida.
    const id = listar.saida.match(/([0-9a-f-]{36})(?:\s+\(desfeita\))?\s*$/m)?.[1] ?? '';
    const ver = rodar(raiz, ['operacao', 'ver', id, '--inquilino', inquilino, '--chave', chave]);

    assert.equal(ver.codigo, 0, ver.saida);
    assert.match(ver.saida, /365/, 'o valor anterior é legível');
    assert.match(ver.saida, /90/, 'e o posterior também');
  } finally {
    limpar();
  }
});

test('operacao desfazer é ENSAIO por padrão — e a recusa aparece antes de escrever', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, chave } = instalacaoComChave(raiz);
    duasPoliticas(raiz, inquilino, chave);
    const listar = rodar(raiz, ['operacao', 'listar', '--inquilino', inquilino, '--chave', chave]);
    // O identificador da Operacao e o ULTIMO da linha, e a ancora importa: a
    // listagem passou a trazer o Ator antes dele, e o Ator de um comando
    // administrativo e `operador:<uuid>` — que casa com o mesmo padrao. Pegar
    // o primeiro devolvia o id da CHAVE, e o comando respondia "Operacao
    // desconhecida". Medido em 03/09/2026, ao acrescentar o Ator a saida.
    const id = listar.saida.match(/([0-9a-f-]{36})(?:\s+\(desfeita\))?\s*$/m)?.[1] ?? '';

    const ensaio = rodar(raiz, [
      'operacao',
      'desfazer',
      id,
      '--inquilino',
      inquilino,
      '--chave',
      chave,
    ]);
    assert.match(ensaio.saida, /Nada foi escrito/i);
    // Decisão de configuração se desfaz redefinindo — e o ensaio já diz isso.
    assert.match(ensaio.saida, /REDEFININDO/i);
  } finally {
    limpar();
  }
});

test('operacao ver recusa identificador desconhecido', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, chave } = instalacaoComChave(raiz);
    const r = rodar(raiz, [
      'operacao',
      'ver',
      'nao-existe',
      '--inquilino',
      inquilino,
      '--chave',
      chave,
    ]);
    assert.equal(r.codigo, 2);
    assert.match(r.saida, /desconhecida/i);
  } finally {
    limpar();
  }
});
