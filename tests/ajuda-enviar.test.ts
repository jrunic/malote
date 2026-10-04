import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executar } from '../src/cli/index.js';

test('a ajuda lista enviar (os dois modos), envio estado, envio reprocessar e --chave-em', () => {
  const linhas: string[] = [];
  const codigo = executar(['--ajuda'], {
    dados: '/nao/usado',
    estado: '/nao/usado',
    escrever: (t: string) => linhas.push(t),
  });
  assert.equal(codigo, 0);
  const saida = linhas.join('\n');
  assert.match(saida, /malote enviar\s+--inquilino <id> --configuracao <apelido> --para/);
  assert.match(saida, /malote enviar\s+--configuracao <apelido> --para .*--chave-em/);
  assert.match(saida, /malote envio estado/);
  assert.match(saida, /--identificador <uuid>/);
  assert.match(saida, /malote envio estado\s+\[<identificador>\] \[--chave-em <VARIAVEL>\]/);
  assert.match(saida, /envio reprocessar.*so local/);
  assert.match(saida, /malote envio reprocessar/);
});
