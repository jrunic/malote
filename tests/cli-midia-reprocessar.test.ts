import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalacaoTemporaria, rodar } from './ajuda/instalacao.js';
import { executarMidiaReprocessar } from '../src/cli/index.js';

/**
 * #1084: `midia reprocessar` e o UNICO comando local, fora de `ouvir`/`servir`,
 * que precisa ser assincrono (baixar midia e I/O de rede) — testado chamando
 * `executarMidiaReprocessar` direto, mesmo molde de `servir.test.ts`, porque
 * `rodar()` (o helper que o resto de `cli.test.ts` usa) so exercita o
 * `executar()` SINCRONO, e nunca chegaria neste comando.
 */
function ambienteDeTeste(raiz: string): { dados: string; estado: string; escrever: (t: string) => void; linhas: string[] } {
  const linhas: string[] = [];
  return { dados: raiz, estado: raiz, escrever: (t) => linhas.push(t), linhas };
}

test('midia reprocessar sem Destino configurado recusa, mesma mensagem do trazer (#1084)', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const chave = /valor: (\S+)/.exec(rodar(raiz, ['operador', 'chave', 'criar']).saida)?.[1];
    assert.ok(chave);
    const inq = /id: (\S+)/.exec(
      rodar(raiz, ['inquilino', 'criar', '--chave', chave, '--titular', 'Leia Organa']).saida,
    )?.[1];
    assert.ok(inq);

    const ambiente = ambienteDeTeste(raiz);
    const codigo = await executarMidiaReprocessar(['midia', 'reprocessar', '--inquilino', inq!], ambiente);
    assert.notEqual(codigo, 0);
    const saida = ambiente.linhas.join('\n');
    assert.match(saida, /Destino de Midia nao configurado/);
    assert.match(saida, /malote inquilino destino/, 'a mensagem cita o comando que resolve');
  } finally {
    limpar();
  }
});

test('midia reprocessar sem Anexo nunca-obtido nenhum reporta zero, sem estourar (#1084)', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const chave = /valor: (\S+)/.exec(rodar(raiz, ['operador', 'chave', 'criar']).saida)?.[1];
    assert.ok(chave);
    const inq = /id: (\S+)/.exec(
      rodar(raiz, ['inquilino', 'criar', '--chave', chave, '--titular', 'Leia Organa']).saida,
    )?.[1];
    assert.ok(inq);
    rodar(raiz, ['inquilino', 'destino', '--chave', chave!, '--inquilino', inq!, '--endereco', raiz]);

    const ambiente = ambienteDeTeste(raiz);
    const codigo = await executarMidiaReprocessar(['midia', 'reprocessar', '--inquilino', inq!], ambiente);
    assert.equal(codigo, 0);
    assert.match(ambiente.linhas.join('\n'), /0 recuperado/);
  } finally {
    limpar();
  }
});

test('midia reprocessar sem --inquilino recusa com uso, codigo 2 (#1084)', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const ambiente = ambienteDeTeste(raiz);
    const codigo = await executarMidiaReprocessar(['midia', 'reprocessar'], ambiente);
    assert.equal(codigo, 2);
    assert.match(ambiente.linhas.join('\n'), /Uso: malote midia reprocessar/);
  } finally {
    limpar();
  }
});
