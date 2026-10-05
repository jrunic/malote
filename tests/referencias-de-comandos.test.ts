import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMANDOS_DE_REDE, executar } from '../src/cli/index.js';

/**
 * As referencias de comandos (`docs/referencias/`) sao derivadas da `--ajuda`. Sem este teste elas envelhecem em
 * silencio: comando novo na `--ajuda` sem linha na referencia, ou linha na referencia de um comando que nao existe mais.
 *
 * A CHAVE de um comando e a sequencia de palavras minusculas depois de `malote`, ate a primeira flag, argumento ou
 * parenteses: `operador chave criar`, `envio estado`, `conversas sem-endereco`, `midia`.
 */
const RAIZ = join(import.meta.dirname, '..');
const SERVIDOR = readFileSync(join(RAIZ, 'docs', 'referencias', 'comandos-modo-servidor.md'), 'utf8');
const CLIENTE = readFileSync(join(RAIZ, 'docs', 'referencias', 'comandos-modo-cliente.md'), 'utf8');

function chaveDe(texto: string): string {
  const palavras: string[] = [];
  for (const p of texto.trim().split(/\s+/)) {
    if (!/^[a-z][a-z-]*$/.test(p)) break;
    palavras.push(p);
  }
  return palavras.join(' ');
}

function chavesDaAjuda(): Set<string> {
  const linhas: string[] = [];
  assert.equal(
    executar(['--ajuda'], { dados: '/nao/usado', estado: '/nao/usado', escrever: (t: string) => linhas.push(t) }),
    0,
  );
  const chaves = new Set<string>();
  for (const linha of linhas.join('\n').split('\n')) {
    const m = /^ {2}malote (.+)$/.exec(linha);
    if (m === null) continue;
    const chave = chaveDe(m[1]!);
    if (chave !== '') chaves.add(chave);
  }
  return chaves;
}

/** As chaves dos comandos que uma referencia lista em tabela: o primeiro trecho de codigo de cada linha. */
function chavesDaTabela(documento: string, prefixo: 'malote ' | ''): Set<string> {
  const chaves = new Set<string>();
  for (const linha of documento.split('\n')) {
    const m = /^\| `([^`]+)`/.exec(linha);
    if (m === null) continue;
    let trecho = m[1]!;
    if (prefixo === 'malote ') {
      if (!trecho.startsWith('malote ')) continue;
      trecho = trecho.slice('malote '.length);
    }
    const chave = chaveDe(trecho);
    if (chave !== '') chaves.add(chave);
  }
  return chaves;
}

function mencionado(documento: string, chave: string): boolean {
  const escapada = chave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:`|malote )' + escapada + '(?=[ `<\\[])').test(documento);
}

/** Os dois comandos que so existem por rede: nao ha o que dizer deles na referencia do modo servidor. */
const SO_POR_REDE = new Set(['relatorio', 'midia']);

test('todo comando da --ajuda aparece na referencia do servidor, e os de rede na do cliente (#1132)', () => {
  const chaves = chavesDaAjuda();
  assert.ok(chaves.size > 40, `a --ajuda tem ${chaves.size} comandos: o extrator nao pode estar vazio`);
  const semServidor = [...chaves].filter((c) => !SO_POR_REDE.has(c) && !mencionado(SERVIDOR, c));
  assert.deepEqual(semServidor, [], `na --ajuda e sem linha na referencia do servidor: ${semServidor.join(', ')}`);
  const semCliente = [...SO_POR_REDE].filter((c) => !mencionado(CLIENTE, c));
  assert.deepEqual(semCliente, [], `so por rede e sem linha na referencia do cliente: ${semCliente.join(', ')}`);
});

test('toda linha de tabela das referencias e um comando que a --ajuda lista (#1132)', () => {
  const chaves = chavesDaAjuda();
  const doServidor = chavesDaTabela(SERVIDOR, '');
  const doCliente = chavesDaTabela(CLIENTE, 'malote ');
  assert.ok(doServidor.size > 40, `o servidor lista ${doServidor.size} comandos em tabela`);
  assert.ok(doCliente.size >= 10, `o cliente lista ${doCliente.size} comandos em tabela`);
  const sobram = [...doServidor, ...doCliente].filter((c) => !chaves.has(c));
  assert.deepEqual(sobram, [], `nas referencias e fora da --ajuda: ${sobram.join(', ')}`);
});

test('todo comando do modo rede esta na referencia do cliente (#1132)', () => {
  // `COMANDOS_DE_REDE` e a allowlist de LEITURA; `exportar`, `enviar` e `envio estado` tem despacho proprio.
  const doModoRede = [...COMANDOS_DE_REDE, 'exportar', 'enviar', 'envio estado'];
  const faltam = doModoRede.filter((c) => !new RegExp('malote ' + c + '(?=[ `<\\[])').test(CLIENTE));
  assert.deepEqual(faltam, [], `modo rede sem linha na referencia do cliente: ${faltam.join(', ')}`);
});
