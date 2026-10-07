import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subirCenaDeIdentidade } from './ajuda/identidade.js';
import { executarConsultaRede } from '../src/cli/index.js';

test('o cliente de rede encaminha --ordem e imprime o truncado que o servidor devolve', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const linhas: string[] = [];
    const codigo = await executarConsultaRede(
      ['buscar', '--texto', 'texto', '--limite', '3', '--ordem', 'cronologica'],
      { servidor: cena.url, chave: cena.chave.valor, escrever: (t) => linhas.push(t) },
    );
    assert.equal(codigo, 0);
    const corpo = JSON.parse(linhas.join('\n')) as { mensagens: Array<{ conteudo: string }>; truncado: boolean };
    assert.deepEqual(corpo.mensagens.map((m) => m.conteudo), ['texto 1', 'texto 2', 'texto 3']);
    assert.equal(corpo.truncado, true);
  } finally {
    cena.encerrar();
  }
});

test('--ordem invalida no cliente de rede sai 2 antes de qualquer requisicao', async () => {
  const linhas: string[] = [];
  const codigo = await executarConsultaRede(['buscar', '--texto', 'x', '--ordem', 'banana'], {
    servidor: 'http://127.0.0.1:1', chave: 'k', escrever: (t) => linhas.push(t),
  });
  assert.equal(codigo, 2);
  assert.deepEqual(linhas, ['A flag --ordem aceita recentes ou cronologica.']);
});
