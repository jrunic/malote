import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cenario } from './ajuda/acervo.js';
import { abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { listarConversas, contarAcervo } from '../src/nucleo/consulta.js';

/** Termos que pertencem a Adaptador e nunca ao núcleo. */
const TERMOS_DE_FERRAMENTA = ['jid', 'lid', 'handle', 'resource_name', 'etag', 'push_name'];

test('nenhum nome do schema do Acervo contém termo de ferramenta', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');

    const objetos = acervo.db
      .prepare('SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL')
      .all() as Array<{ name: string; sql: string }>;
    assert.ok(objetos.length > 0, 'o teste precisa achar objetos no schema');

    const achados: string[] = [];
    for (const { name, sql } of objetos) {
      const alvo = `${name} ${sql}`.toLowerCase();
      for (const termo of TERMOS_DE_FERRAMENTA) {
        // \b para não casar 'lid' dentro de 'valido' ou 'consolidado'.
        if (new RegExp(`\\b${termo}\\b`).test(alvo)) achados.push(`${name}: ${termo}`);
      }
    }
    assert.deepEqual(achados, [], `termo de ferramenta no schema do nucleo: ${achados.join(', ')}`);
  } finally {
    c.limpar();
  }
});

test('nenhum módulo do núcleo importa módulo de adaptador', () => {
  const raizNucleo = fileURLToPath(new URL('../src/nucleo/', import.meta.url));
  const arquivos = readdirSync(raizNucleo).filter((f) => f.endsWith('.ts'));
  assert.ok(arquivos.length > 0, 'o teste precisa achar os módulos do núcleo');

  const infratores: string[] = [];
  for (const arquivo of arquivos) {
    const fonte = readFileSync(join(raizNucleo, arquivo), 'utf8');
    for (const linha of fonte.split('\n')) {
      if (/^\s*import\b/.test(linha) && /adaptadores?\//.test(linha)) {
        infratores.push(`${arquivo}: ${linha.trim()}`);
      }
    }
  }
  assert.deepEqual(infratores, [], `nucleo importando adaptador: ${infratores.join(' | ')}`);
});

test('nenhum caminho de consulta escreve — a bateria roda contra Acervo só-leitura', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Leia Organa');
    acervo.fechar();

    const leitura = abrirAcervoSomenteLeitura(join(c.raiz, 'acervos'), id);
    assert.doesNotThrow(() => listarConversas(leitura, {}));
    assert.doesNotThrow(() => contarAcervo(leitura));
    leitura.fechar();
  } finally {
    c.limpar();
  }
});
