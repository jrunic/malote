import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { abrirCaptura, CAPTURA_DESLIGADA } from '../src/cli/captura-de-retrato.js';

// PODER: afirmar "nao criou arquivo" numa pasta que `abrirCaptura(undefined)`
// nunca recebeu passa com QUALQUER implementacao — inclusive uma que escreva em
// outro lugar. O que tem poder e afirmar IDENTIDADE com o nada nomeado.
test('sem caminho declarado, a captura E o nada — nao uma funcao que nao escreve', () => {
  assert.equal(abrirCaptura(undefined), CAPTURA_DESLIGADA);
  // Vazio conta como ausente: variavel de ambiente declarada e vazia devolve
  // '', nao undefined. Mesma familia do defeito que a v0.13.0 pagou.
  assert.equal(abrirCaptura(''), CAPTURA_DESLIGADA);
});

test('com caminho declarado, grava o evento inteiro, uma linha por chamada', () => {
  const alvo = join(mkdtempSync(join(tmpdir(), 'captura-')), 'captura.jsonl');
  const capturar = abrirCaptura(alvo);
  capturar('contacts.upsert', [{ id: '5500000000000@s.whatsapp.net', name: 'Nome Sintetico' }]);
  capturar('chats.update', [{ id: '120000000000000000@g.us', pinned: 1 }]);

  const linhas = readFileSync(alvo, 'utf8').trim().split('\n');
  assert.equal(linhas.length, 2);
  const primeira = JSON.parse(linhas[0] as string) as { fluxo: string; dado: unknown };
  assert.equal(primeira.fluxo, 'contacts.upsert');
  assert.deepEqual(primeira.dado, [
    { id: '5500000000000@s.whatsapp.net', name: 'Nome Sintetico' },
  ]);
  const segunda = JSON.parse(linhas[1] as string) as { fluxo: string };
  assert.equal(segunda.fluxo, 'chats.update');
});

test('captura NUNCA custa Mensagem: caminho impossivel nao lanca', () => {
  // Um ARQUIVO usado como pasta: falha com ENOTDIR nos dois sistemas. NAO usar
  // /proc — medido em 13/09/2026, `mkdirSync` recursivo ali PENDURA no Linux,
  // e foi assim que a suite ficou 30 minutos presa no CI enquanto passava em
  // segundos no macOS.
  const arquivo = join(mkdtempSync(join(tmpdir(), 'captura-')), 'sou-um-arquivo');
  writeFileSync(arquivo, 'x');
  const capturar = abrirCaptura(join(arquivo, 'captura.jsonl'));
  assert.doesNotThrow(() => {
    capturar('contacts.upsert', []);
  });
});

test('abrir a captura NAO toca o disco — subir o ouvinte nao pode travar', () => {
  // A guarda do travamento: se `abrirCaptura` voltar a criar pasta, este teste
  // fica lento ou pendura num caminho patologico. Aqui ele so exige que abrir
  // sobre uma pasta INEXISTENTE devolva na hora, sem lancar.
  const inexistente = join(tmpdir(), 'pasta-que-nao-existe-' + String(process.pid), 'c.jsonl');
  const capturar = abrirCaptura(inexistente);
  assert.notEqual(capturar, CAPTURA_DESLIGADA, 'caminho declarado nao e o nada');
  assert.doesNotThrow(() => {
    capturar('contacts.upsert', []);
  });
  assert.equal(existsSync(inexistente), false, 'a captura nao pode criar pasta');
});
