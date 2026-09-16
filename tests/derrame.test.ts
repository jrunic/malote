import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  caminhoDoEnvenenado,
  contarDerrame,
  contarEventosDerramados,
  derramar,
  descartarDerrame,
  moverLoteEnvenenado,
  removerPrimeiroLote,
  ehBancoOcupado,
  lerDerrame,
} from '../src/cli/derrame.js';

function pasta(): string {
  return mkdtempSync(join(tmpdir(), 'derrame-'));
}

/**
 * O DISCRIMINANTE E O TESTE MAIS IMPORTANTE DESTE ARQUIVO.
 *
 * Um `catch` que engole tudo transforma qualquer defeito do produto em evento
 * derramado em silencio — o ouvinte sobreviveria a um bug de tipo, a um
 * invariante violado, a uma Conversa recusada por natureza divergente, e
 * ninguem saberia. So `SQLITE_BUSY` e disputa de escrita; o resto sobe.
 */
test('so SQLITE_BUSY conta como banco ocupado', () => {
  assert.equal(ehBancoOcupado(Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' })), true);
  assert.equal(ehBancoOcupado(Object.assign(new Error('x'), { code: 'SQLITE_CONSTRAINT' })), false);
  assert.equal(ehBancoOcupado(Object.assign(new Error('x'), { code: 'SQLITE_READONLY' })), false);
  assert.equal(ehBancoOcupado(new Error('database is locked')), false, 'mensagem nao basta; o codigo decide');
  assert.equal(ehBancoOcupado('database is locked'), false);
  assert.equal(ehBancoOcupado(undefined), false);
});

test('o derrame preserva o evento inteiro, e a ida e volta nao o deforma', () => {
  const caminho = join(pasta(), 'nao-gravados.jsonl');
  const evento = [
    { key: { remoteJid: '5511000000001@s.whatsapp.net', id: 'A1', fromMe: false }, messageTimestamp: 17, message: { conversation: 'ola' } },
  ];
  derramar(caminho, evento);
  const lido = lerDerrame(caminho);
  assert.equal(lido.length, 1);
  assert.deepEqual(lido[0], evento);
});

test('derramar ACRESCENTA — o segundo evento nao apaga o primeiro', () => {
  const caminho = join(pasta(), 'nao-gravados.jsonl');
  derramar(caminho, [{ key: { id: 'A1' } }]);
  derramar(caminho, [{ key: { id: 'A2' } }, { key: { id: 'A3' } }]);
  const lido = lerDerrame(caminho);
  assert.equal(lido.length, 2, 'sao dois LOTES, nao tres mensagens');
  assert.equal((lido[1] as { key: { id: string } }[]).length, 2);
});

test('linha ilegivel nao derruba a leitura, e e contada', () => {
  const caminho = join(pasta(), 'nao-gravados.jsonl');
  derramar(caminho, [{ key: { id: 'A1' } }]);
  writeFileSync(caminho, `${readFileSync(caminho, 'utf8')}{isso nao e json\n`);
  derramar(caminho, [{ key: { id: 'A2' } }]);
  const lido = lerDerrame(caminho);
  assert.equal(lido.length, 2, 'as duas legiveis sobrevivem a uma corrompida no meio');
});

test('ler derrame que nao existe devolve vazio, e nao erro', () => {
  assert.deepEqual(lerDerrame(join(pasta(), 'nunca-existiu.jsonl')), []);
});

test('descartar so apaga depois que se leu — e o arquivo some', () => {
  const caminho = join(pasta(), 'nao-gravados.jsonl');
  derramar(caminho, [{ key: { id: 'A1' } }]);
  descartarDerrame(caminho);
  assert.deepEqual(lerDerrame(caminho), []);
});

// --- consumo em parte: o que a drenagem incremental exige (#842) ---

test('contar o derrame nao o consome, e ausente e zero', () => {
  const caminho = join(pasta(), 'nao-gravados.jsonl');
  assert.equal(contarDerrame(caminho), 0, 'arquivo ausente conta zero, nao explode');
  derramar(caminho, [{ key: { id: 'A1' } }]);
  derramar(caminho, [{ key: { id: 'A2' } }, { key: { id: 'A3' } }]);
  assert.equal(contarDerrame(caminho), 2, 'conta LOTES, que e a unidade que a drenagem consome');
  assert.equal(lerDerrame(caminho).length, 2, 'contar nao pode consumir');
});

/**
 * As duas contagens respondem perguntas diferentes, e confundi-las diria 1 onde
 * a resposta e 5. A spec pede EVENTOS na saida do `ouvinte estado`; a drenagem
 * trabalha por LOTE.
 */
test('lotes e eventos sao contagens distintas, e a fixture tem de distingui-las', () => {
  const caminho = join(pasta(), 'nao-gravados.jsonl');
  derramar(caminho, [{ key: { id: 'A1' } }, { key: { id: 'A2' } }]);
  derramar(caminho, [{ key: { id: 'A3' } }]);
  assert.equal(contarDerrame(caminho), 2, 'lotes');
  assert.equal(contarEventosDerramados(caminho), 3, 'eventos');
  assert.equal(contarEventosDerramados(join(pasta(), 'nunca.jsonl')), 0, 'ausente e zero');
});

test('remover o primeiro lote preserva a ORDEM dos demais', () => {
  const caminho = join(pasta(), 'nao-gravados.jsonl');
  derramar(caminho, [{ key: { id: 'A1' } }]);
  derramar(caminho, [{ key: { id: 'A2' } }]);
  derramar(caminho, [{ key: { id: 'A3' } }]);
  removerPrimeiroLote(caminho);
  const restam = lerDerrame(caminho) as { key: { id: string } }[][];
  assert.deepEqual(
    restam.map((l) => l[0]?.key.id),
    ['A2', 'A3'],
    'o arquivo e a ordem em que os eventos chegaram; embaralhar perde o sentido',
  );
});

test('remover o ultimo lote apaga o arquivo, em vez de deixar rastro vazio', () => {
  const caminho = join(pasta(), 'nao-gravados.jsonl');
  derramar(caminho, [{ key: { id: 'A1' } }]);
  removerPrimeiroLote(caminho);
  assert.equal(existsSync(caminho), false);
  assert.equal(contarDerrame(caminho), 0);
});

test('remover de derrame vazio nao explode', () => {
  const caminho = join(pasta(), 'nao-gravados.jsonl');
  removerPrimeiroLote(caminho);
  assert.equal(contarDerrame(caminho), 0);
});

test('lote envenenado sai do derrame e vai para o irmao, com a causa junto', () => {
  const caminho = join(pasta(), 'nao-gravados.jsonl');
  derramar(caminho, [{ key: { id: 'MAU' } }]);
  derramar(caminho, [{ key: { id: 'BOM' } }]);
  moverLoteEnvenenado(caminho, new Error('forma inesperada'));

  const restam = lerDerrame(caminho) as { key: { id: string } }[][];
  assert.equal(restam.length, 1, 'so o envenenado sai');
  assert.equal(restam[0]?.[0]?.key.id, 'BOM');

  const irmao = caminhoDoEnvenenado(caminho);
  assert.equal(existsSync(irmao), true, 'o lote tem de ser PRESERVADO, nao descartado');
  const linha = JSON.parse(readFileSync(irmao, 'utf8').trim()) as {
    causa: string;
    lote: { key: { id: string } }[];
  };
  assert.equal(linha.lote[0]?.key.id, 'MAU');
  assert.match(linha.causa, /forma inesperada/, 'sem a causa, o arquivo e um lixo sem pista');
});

test('mover envenenado de derrame vazio e no-op, e nao cria o irmao', () => {
  const caminho = join(pasta(), 'nao-gravados.jsonl');
  moverLoteEnvenenado(caminho, new Error('nada a mover'));
  assert.equal(existsSync(caminhoDoEnvenenado(caminho)), false);
});
