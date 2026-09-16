import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');

/**
 * Onde compilar direto é legítimo, e por quê. Nenhuma outra exceção entra sem
 * a razão escrita aqui.
 */
const PERMITIDOS = new Map<string, string>([
  ['nucleo/acervo.ts', 'implementa o próprio `preparar` e abre a base'],
  ['registro/registro.ts', 'implementa o próprio `preparar` e abre a base'],
  ['nucleo/migracao.ts', 'DDL de passo de migração: roda uma vez e troca a tabela que o statement referencia'],
  ['adaptadores/whatsapp/material.ts', 'conexão própria com o material lido, que não é Acervo nem Registro'],
  // Entrou em 08/09/2026, com o passo 13 -> 14. Os passos anteriores só faziam
  // `exec`; este precisa de PARÂMETRO, porque o valor do backfill vem do
  // Registro. E `preparar` não existe aqui: o passo recebe um `Database` cru,
  // não um `Acervo` — a porta é do agregado, e a migração roda por baixo dele.
  // O custo que a Restrição evita (~3,8 KB de RSS por compilação) é irrelevante
  // numa execução única, de uma iteração por Fonte.
  ['nucleo/passos-do-acervo.ts', 'passo de migração: recebe `Database` cru, sem porta `preparar`, e roda uma vez'],
]);

/**
 * O padrão tolera quebra de linha ANTES do ponto.
 *
 * Isso não é zelo: a varredura anterior deste repositório casava `.db.prepare`
 * numa linha só, e o formatador quebra a cadeia quando o SQL é longo — foi
 * assim que uma violação real passou invisível. Ver o `CONTEXTO.md`.
 */
const PADRAO = /\.\s*db\s*\n?\s*\.\s*prepare\s*\(|(?<![.\w])db\s*\n?\s*\.\s*prepare\s*\(/g;

function arquivosTs(dir: string): string[] {
  const saida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const p = join(dir, entrada);
    if (statSync(p).isDirectory()) saida.push(...arquivosTs(p));
    else if (entrada.endsWith('.ts')) saida.push(p);
  }
  return saida;
}

/**
 * Compilar SQL por chamada vaza memória nativa que a coleta de lixo não
 * alcança: o `better-sqlite3` mantém cada statement referenciado na conexão
 * para finalizá-lo no `close()`.
 *
 * Medido em 07/09/2026 contra o acervo real: ~3,8 KB de RSS por compilação, com
 * o heap do V8 imóvel. Na importação eram 4 statements por Mensagem; na
 * conversão, 7,28 — 26 KB por Mensagem, e um processo morto pelo OOM killer com
 * 6,58 GB. A porta é `preparar`, que compila uma vez por conexão.
 */
test('nenhuma escrita compila SQL fora da porta `preparar`', () => {
  const violacoes: string[] = [];
  for (const arquivo of arquivosTs(RAIZ)) {
    const rel = relative(RAIZ, arquivo).split('\\').join('/');
    if (PERMITIDOS.has(rel)) continue;
    const texto = readFileSync(arquivo, 'utf8');
    const achados = texto.match(PADRAO);
    if (achados !== null) violacoes.push(`${rel}: ${achados.length}`);
  }

  assert.deepEqual(
    violacoes,
    [],
    `estes arquivos compilam SQL direto em vez de usar \`preparar\`:\n  ${violacoes.join('\n  ')}`,
  );
});

/**
 * A varredura acima só vale se pegar a forma que o formatador produz. Este
 * teste prova o padrão contra as duas escritas, sem depender de alguém lembrar
 * de reintroduzir a violação à mão.
 */
test('a varredura pega a compilação direta mesmo com a cadeia quebrada em duas linhas', () => {
  const numaLinha = 'const x = acervo.db.prepare("SELECT 1").get();';
  const emDuas = 'const x = acervo.db\n    .prepare("SELECT 1")\n    .get();';
  const bare = 'const x = db\n  .prepare("SELECT 1")\n  .get();';
  const limpo = 'const x = acervo.preparar("SELECT 1").get();';

  assert.notEqual(numaLinha.match(PADRAO), null, 'nao pegou em uma linha');
  assert.notEqual(emDuas.match(PADRAO), null, 'nao pegou com a cadeia quebrada');
  assert.notEqual(bare.match(PADRAO), null, 'nao pegou a compilacao em `db` nu');
  assert.equal(limpo.match(PADRAO), null, 'acusou a porta correta como violacao');
});
