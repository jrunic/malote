// tests/memoria-do-envio.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  criarMemoriaDoEnvio,
  TETO_DA_MEMORIA_DO_ENVIO,
  VIDA_DA_MEMORIA_DO_ENVIO_MS,
} from '../src/adaptadores/whatsapp/memoria-do-envio.js';

const CONTATO = '5511900000001@s.whatsapp.net';

function relogio(inicio = 1_800_000_000_000): { agora: () => number; andar: (ms: number) => void } {
  let t = inicio;
  return { agora: () => t, andar: (ms) => (t += ms) };
}

test('os numeros de partida da spec: 256 mensagens e 1 h', () => {
  assert.equal(TETO_DA_MEMORIA_DO_ENVIO, 256);
  assert.equal(VIDA_DA_MEMORIA_DO_ENVIO_MS, 3_600_000);
});

test('guarda a mensagem COMO VEIO (o mesmo objeto), o endereco e o instante', () => {
  const r = relogio();
  const memoria = criarMemoriaDoEnvio({ agora: r.agora });
  const mensagem = { conversation: 'sintetica' };
  memoria.guardar('ID-1', mensagem, CONTATO);
  const l = memoria.buscar('ID-1');
  assert.equal(l?.mensagem, mensagem, 'o mesmo objeto, sem copia');
  assert.equal(l?.endereco, CONTATO);
  assert.equal(l?.guardadaEm, r.agora());
  assert.equal(memoria.buscar('OUTRO'), undefined);
});

test('o teto padrao e 256: a 257a guardada tira a mais antiga, e so ela', () => {
  const memoria = criarMemoriaDoEnvio({ agora: relogio().agora });
  for (let i = 0; i < 257; i++) memoria.guardar(`ID-${i}`, { i }, CONTATO);
  assert.equal(memoria.tamanho(), 256);
  assert.equal(memoria.buscar('ID-0'), undefined, 'a mais antiga saiu');
  assert.notEqual(memoria.buscar('ID-1'), undefined, 'a segunda ficou');
  assert.notEqual(memoria.buscar('ID-256'), undefined, 'a ultima ficou');
});

test('a vida padrao e 1 h: na hora exata ainda vale, um milissegundo depois ja nao', () => {
  const r = relogio();
  const memoria = criarMemoriaDoEnvio({ agora: r.agora });
  memoria.guardar('ID-1', {}, CONTATO);
  memoria.guardar('ID-2', {}, CONTATO);
  r.andar(3_600_000);
  assert.notEqual(memoria.buscar('ID-1'), undefined);
  r.andar(1);
  assert.equal(memoria.buscar('ID-1'), undefined);
  assert.equal(memoria.buscar('ID-2'), undefined);
});

test('o que venceu sai ao guardar a proxima, sem temporizador', () => {
  const r = relogio();
  const memoria = criarMemoriaDoEnvio({ agora: r.agora });
  memoria.guardar('ID-1', {}, CONTATO);
  r.andar(3_600_001);
  memoria.guardar('ID-2', {}, CONTATO);
  assert.equal(memoria.tamanho(), 1);
});

test('limpar esquece tudo o que foi guardado', () => {
  const memoria = criarMemoriaDoEnvio({ agora: relogio().agora });
  memoria.guardar('ID-1', {}, CONTATO);
  memoria.guardar('ID-2', {}, CONTATO);
  memoria.limpar();
  assert.equal(memoria.tamanho(), 0);
  assert.equal(memoria.buscar('ID-1'), undefined);
});

test('regravar o mesmo identificador renova o instante e o leva para o fim da fila', () => {
  const r = relogio();
  const memoria = criarMemoriaDoEnvio({ agora: r.agora, teto: 2 });
  memoria.guardar('A', { v: 1 }, CONTATO);
  memoria.guardar('B', {}, CONTATO);
  memoria.guardar('A', { v: 2 }, CONTATO);
  memoria.guardar('C', {}, CONTATO);
  assert.equal(memoria.buscar('B'), undefined, 'B passou a ser a mais antiga');
  assert.deepEqual(memoria.buscar('A')?.mensagem, { v: 2 });
});
