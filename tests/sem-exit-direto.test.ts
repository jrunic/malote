import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');

/**
 * `process.exit(` direto perde o que o stdout ainda nao entregou por pipe — o corte em 65.536
 * bytes que os agentes viam (#1125). Quem encerra o processo e `cli/encerrar.ts`, que espera o
 * flush. Nenhuma outra excecao entra sem a razao escrita aqui.
 */
const PERMITIDOS = new Map<string, string>([
  ['cli/encerrar.ts', 'e o proprio encerramento que espera o flush (e o teto de tempo)'],
]);

function arquivosTs(dir: string): string[] {
  const saida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const p = join(dir, entrada);
    if (statSync(p).isDirectory()) saida.push(...arquivosTs(p));
    else if (p.endsWith('.ts')) saida.push(p);
  }
  return saida;
}

test('nenhum arquivo de src chama process.exit direto, fora de encerrar (#1125)', () => {
  const violacoes: string[] = [];
  let lidos = 0;
  for (const arquivo of arquivosTs(RAIZ)) {
    lidos += 1;
    const rel = relative(RAIZ, arquivo);
    if (PERMITIDOS.has(rel)) continue;
    if (/process\s*\.\s*exit\s*\(/.test(readFileSync(arquivo, 'utf8'))) violacoes.push(rel);
  }
  // Anti-vacuidade: a varredura tem de estar olhando para os arquivos de verdade.
  assert.ok(lidos > 50, `a varredura leu so ${lidos} arquivos`);
  assert.deepEqual(violacoes, [], 'use `encerrar(codigo)` de cli/encerrar.ts');
});
