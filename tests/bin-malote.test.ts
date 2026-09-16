import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * O alvo de `package.json.bin` é o que quem instala de fora executa. Ele não
 * pode depender de `dist/` — a frota roda o malote DA FONTE, sem build
 * (decisão de 03/09/2026), e `dist/` nunca existe numa instalação real.
 *
 * `node --import tsx` resolve o pacote `tsx` pelo CWD do PROCESSO, não pelo
 * caminho do script: por isso o teste roda com `cwd` FORA do repositório — é
 * exatamente a invocação que quebrava antes do fix (achado na tarefa #991,
 * generalizado na #992).
 */
const raizDoRepo = dirname(dirname(fileURLToPath(import.meta.url)));

function manifesto(): { bin: { malote: string }; version: string } {
  return JSON.parse(readFileSync(join(raizDoRepo, 'package.json'), 'utf8'));
}

test('o alvo de package.json.bin roda de fora do repositório, sem dist/', () => {
  const { bin, version } = manifesto();
  const binAbsoluto = join(raizDoRepo, bin.malote);

  const r = spawnSync(process.execPath, [binAbsoluto, '--versao'], {
    cwd: tmpdir(),
    encoding: 'utf8',
  });

  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), version);
});

test('o alvo de package.json.bin não é dist/ — dist só existe após build, que a frota não roda', () => {
  const { bin } = manifesto();
  assert.doesNotMatch(bin.malote, /dist\//);
});
