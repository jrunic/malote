import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BANDEIRAS, validarBandeiras, VALORES_FECHADOS } from '../src/cli/bandeiras.js';

const SRC = join(import.meta.dirname, '..', 'src');

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const FONTES = arquivos(SRC).map((p) => ({ rel: relative(SRC, p), texto: readFileSync(p, 'utf8') }));
const FORA = FONTES.filter((f) => f.rel !== join('cli', 'bandeiras.ts'));

// `includes('--inquilino')` PERGUNTA se a flag com valor esta presente (para recusa no modo rede);
// nao e leitura de bandeira.
const PRESENCA_DE_FLAG_COM_VALOR = new Set(['inquilino']);

// Cada excecao e justificada: o que NAO e leitura de flag da CLI.
const EXCECOES_DE_STARTSWITH = [
  { rel: join('cli', 'index.ts'), trecho: "acao.startsWith('--')" }, // o argumento posicional nao pode ser uma flag
  { rel: join('cli', 'posicional.ts'), trecho: "!a.startsWith('--')" }, // o leitor posicional le o MESMO registro
];

test('nenhum leitor de flag fora de bandeiras.ts', () => {
  const achados: string[] = [];
  for (const f of FORA) {
    if (/argumentos\.indexOf\(`--\$\{/.test(f.texto)) achados.push(`${f.rel}: indexOf de flag`);
    if (/function opcao\(/.test(f.texto)) achados.push(`${f.rel}: cópia de opcao`);
    for (const m of f.texto.matchAll(/^.*startsWith\('--'\).*$/gm)) {
      const permitido = EXCECOES_DE_STARTSWITH.some((e) => e.rel === f.rel && m[0].includes(e.trecho));
      if (!permitido) achados.push(`${f.rel}: ${m[0].trim()}`);
    }
  }
  assert.deepEqual(achados, []);
});

/** Os nomes de flag COM VALOR que o codigo le: por chamada direta e pelas listas que alimentam laços. */
function flagsComValor(): Set<string> {
  const nomes = new Set<string>();
  for (const f of FORA) {
    for (const m of f.texto.matchAll(/\b(?:opcao|todasAsOpcoes)\(\s*[A-Za-z_.]+\s*,\s*'([a-z-]+)'\s*\)/g)) nomes.add(m[1] as string);
    for (const m of f.texto.matchAll(/for \(const nome of \[([^\]]+)\]/g)) {
      for (const n of (m[1] as string).matchAll(/'([a-z-]+)'/g)) nomes.add(n[1] as string);
    }
    for (const m of f.texto.matchAll(/COM_VALOR = \[([^\]]+)\]/g)) {
      for (const n of (m[1] as string).matchAll(/'([a-z-]+)'/g)) nomes.add(n[1] as string);
    }
  }
  return nomes;
}

function bandeirasLidas(): Set<string> {
  const nomes = new Set<string>();
  for (const f of FORA) {
    for (const m of f.texto.matchAll(/\btemBandeira\(\s*[A-Za-z_.]+\s*,\s*'([a-z-]+)'\s*\)/g)) nomes.add(m[1] as string);
    for (const m of f.texto.matchAll(/includes\('--([a-z-]+)'\)/g)) nomes.add(m[1] as string);
  }
  return nomes;
}

test('o registro cobre toda bandeira lida no codigo, e nenhuma entrada dele esta morta', () => {
  const lidas = bandeirasLidas();
  for (const nome of lidas) {
    assert.ok(BANDEIRAS.has(nome) || PRESENCA_DE_FLAG_COM_VALOR.has(nome), `--${nome} e lida como bandeira e nao esta no registro`);
  }
  for (const nome of BANDEIRAS) assert.ok(lidas.has(nome), `--${nome} esta no registro e nenhum codigo a le`);
});

test('toda flag com valor lida no codigo: no fim da linha e seguida de flag sao erro; com valor passa', () => {
  const nomes = flagsComValor();
  assert.ok(nomes.size >= 40, `o inventario achou so ${nomes.size} flags com valor: o padrao de varredura quebrou`);
  for (const nome of nomes) {
    assert.ok(!BANDEIRAS.has(nome), `--${nome} e lida com valor e esta no registro como bandeira`);
    const esperada = `A flag --${nome} pede um valor.`;
    assert.equal(validarBandeiras(['x', `--${nome}`]), esperada, `fim da linha: --${nome}`);
    assert.equal(validarBandeiras(['x', `--${nome}`, '--json']), esperada, `seguida de flag: --${nome}`);
    const valido = VALORES_FECHADOS[nome]?.[0] ?? 'v';
    assert.equal(validarBandeiras(['x', `--${nome}`, valido]), undefined, `com valor: --${nome}`);
  }
});
