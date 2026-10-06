import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { criarRegistroNoPiso } from './ajuda/registro-no-piso.js';
import { abrirRegistro, VERSAO_SCHEMA_REGISTRO } from '../src/registro/registro.js';

/**
 * O servidor e cada ouvinte abrem o Registro para escrita no boot, e todos
 * reiniciam juntos pelo mesmo `post_install` (spec #1149, critério 12). Um passo
 * que migra tem de sobreviver a varios abridores SIMULTANEOS: processos de
 * verdade, porque no mesmo processo a abertura e sincrona e nao disputa nada.
 */
function abrirEmProcessoSeparado(raiz: string): Promise<{ codigo: number | null; erro: string }> {
  const modulo = pathToFileURL(join(process.cwd(), 'src/registro/registro.ts')).href;
  const codigo = `import { abrirRegistro } from ${JSON.stringify(modulo)};
    abrirRegistro(${JSON.stringify(raiz)}).fechar();`;
  return new Promise((resolver) => {
    const filho = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', codigo], {
      cwd: process.cwd(),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let erro = '';
    filho.stderr.on('data', (d: Buffer) => {
      erro += d.toString();
    });
    filho.on('close', (c) => resolver({ codigo: c, erro }));
  });
}

test('tres abridores simultaneos de um Registro de forma anterior terminam todos na v8, sem erro', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    criarRegistroNoPiso(raiz);
    const resultados = await Promise.all([
      abrirEmProcessoSeparado(raiz),
      abrirEmProcessoSeparado(raiz),
      abrirEmProcessoSeparado(raiz),
    ]);
    for (const r of resultados) assert.equal(r.codigo, 0, `um abridor falhou: ${r.erro}`);

    const r = abrirRegistro(raiz);
    try {
      assert.equal(r.versaoDoSchema(), VERSAO_SCHEMA_REGISTRO);
      const aplicadas = r.db
        .prepare('SELECT COUNT(*) AS n FROM migracoes_aplicadas WHERE para = ?')
        .get(VERSAO_SCHEMA_REGISTRO) as { n: number };
      assert.equal(aplicadas.n, 1, 'o passo para a v8 foi registrado UMA vez, nao tres');
    } finally {
      r.fechar();
    }
  } finally {
    limpar();
  }
});
