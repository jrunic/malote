import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RAIZ_DO_REPO = join(import.meta.dirname, '..');

/**
 * O ponto de entrada REAL, como processo. `ouvinte reprocessar*` e `ouvinte reprocessar-descartados` carregam o decodificador
 * da biblioteca ANTES de despachar (#1246). Com Inquilino inexistente o comando recusa cedo (nenhum Acervo, nenhuma escrita) e
 * sai 1, e isso basta para medir duas coisas que o teste em processo nao ve: o ramo novo do ponto de entrada nao derruba o
 * processo, e a biblioteca REAL carrega nele (sem o aviso de decodificador indisponivel). Sem as variaveis do modo rede: com
 * elas o comando local recusa por outro motivo.
 */
function invocar(argumentos: string[], home: string): { codigo: number; saida: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, MALOTE_HOME: home };
  delete env['MALOTE_SERVIDOR'];
  delete env['MALOTE_CHAVE_DE_ACESSO'];
  const r = spawnSync(process.execPath, ['--import', 'tsx', join(RAIZ_DO_REPO, 'src', 'cli', 'index.ts'), ...argumentos], {
    encoding: 'utf8',
    env,
    timeout: 60_000,
  });
  return { codigo: r.status ?? -1, saida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

for (const verbo of ['reprocessar-descartados', 'reprocessar']) {
  test(`ouvinte ${verbo}, como processo: o ramo do ponto de entrada roda e a biblioteca real carrega`, () => {
    const home = mkdtempSync(join(tmpdir(), 'malote-entrada-reprocessar-'));
    try {
      const r = invocar(['ouvinte', verbo, '--inquilino', 'inexistente', '--conta', 'principal', '--configuracao', 'principal'], home);
      assert.equal(r.codigo, 1, r.saida);
      assert.match(r.saida, /Configuracao "principal" nao existe no Inquilino inexistente/);
      assert.equal(r.saida.includes('decodificador de edicao indisponivel'), false, r.saida);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
}
