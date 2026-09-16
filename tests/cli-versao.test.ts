import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoTemporaria, rodar } from './ajuda/instalacao.js';

/**
 * A versao do manifesto, lida do MESMO arquivo que o produto publica.
 *
 * Ler daqui e o que da poder ao teste: cravar o numero faria a assercao passar
 * com a CLI respondendo qualquer coisa, desde que alguem lembrasse de editar os
 * dois lugares. O teste tem de quebrar quando a CLI parar de acompanhar o
 * manifesto — que e exatamente o defeito que ele existe para impedir.
 */
const VERSAO_DO_MANIFESTO = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version as string;

test('--versao responde a versao do manifesto, e sai zero', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const r = rodar(raiz, ['--versao']);
    assert.equal(r.codigo, 0);
    assert.equal(r.saida.trim(), VERSAO_DO_MANIFESTO);
  } finally {
    limpar();
  }
});

/**
 * A PROPRIEDADE que importa, e a razao de `--versao` vir antes de abrir o
 * Registro: quem instala de fora roda isto ANTES de existir instalacao alguma.
 *
 * Se o comando fosse despachado depois da abertura, ele criaria `registro.db`
 * numa raiz vazia, migraria a base e gravaria Operacao — tudo para responder um
 * numero que nao depende de nada disso. O teste mede o EFEITO no disco, nao a
 * ordem das linhas no codigo.
 */
test('--versao nao toca o disco: nao cria instalacao para responder', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    assert.deepEqual(readdirSync(raiz), [], 'a fixture precisa comecar vazia');

    const r = rodar(raiz, ['--versao']);
    assert.equal(r.codigo, 0);

    assert.equal(existsSync(join(raiz, 'registro.db')), false, 'nao pode criar o Registro');
    assert.deepEqual(readdirSync(raiz), [], 'nada pode aparecer na raiz');
  } finally {
    limpar();
  }
});

/**
 * Ancora o formato: quem le a saida em script espera UM numero, nao uma frase.
 * Sem isto, "malote versao 0.10.0" passaria no primeiro teste se alguem
 * afrouxasse a comparacao para `match`.
 */
test('a saida de --versao e so o numero, em uma linha', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const r = rodar(raiz, ['--versao']);
    assert.equal(r.saida.split('\n').length, 1);
    assert.match(r.saida.trim(), /^\d+\.\d+\.\d+$/);
  } finally {
    limpar();
  }
});
