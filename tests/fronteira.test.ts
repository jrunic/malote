import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function arquivosDe(pasta: string): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(pasta)) {
    const caminho = join(pasta, entrada);
    if (statSync(caminho).isDirectory()) achados.push(...arquivosDe(caminho));
    else if (entrada.endsWith('.ts')) achados.push(caminho);
  }
  return achados;
}

const RAIZ_NUCLEO = fileURLToPath(new URL('../src/nucleo/', import.meta.url));
const RAIZ_ADAPTADORES = fileURLToPath(new URL('../src/adaptadores/', import.meta.url));

test('nenhum módulo do núcleo importa módulo de adaptador', () => {
  const arquivos = arquivosDe(RAIZ_NUCLEO);
  assert.ok(arquivos.length > 0, 'o teste precisa achar os módulos do núcleo');

  const infratores: string[] = [];
  for (const arquivo of arquivos) {
    for (const linha of readFileSync(arquivo, 'utf8').split('\n')) {
      if (/^\s*import\b/.test(linha) && /adaptadores?\//.test(linha)) {
        infratores.push(`${arquivo}: ${linha.trim()}`);
      }
    }
  }
  assert.deepEqual(infratores, [], `nucleo importando adaptador: ${infratores.join(' | ')}`);
});

test('nenhum adaptador escreve em tabela: toda escrita passa pela porta', () => {
  const arquivos = arquivosDe(RAIZ_ADAPTADORES);
  assert.ok(arquivos.length > 0, 'o teste precisa achar os módulos de adaptador');

  // INSERT, UPDATE e DELETE no código de adaptador significam que ele
  // conhece o schema. É exatamente o que o desenho existe para impedir.
  const infratores: string[] = [];
  for (const arquivo of arquivos) {
    const fonte = readFileSync(arquivo, 'utf8');
    for (const [numero, linha] of fonte.split('\n').entries()) {
      if (/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(linha)) {
        infratores.push(`${arquivo}:${numero + 1}: ${linha.trim()}`);
      }
    }
  }
  assert.deepEqual(infratores, [], `adaptador escrevendo direto: ${infratores.join(' | ')}`);
});

test('nenhum adaptador conhece o layout de arquivo em disco', () => {
  // Decidir ONDE o arquivo cai é do núcleo. A guarda mede o efeito —
  // adaptador construindo caminho ou mandando caminho pela porta —, e não a
  // técnica: derivar identidade de mensagem por digest é legítimo e não
  // decide layout nenhum. Antes de afiar, esta guarda reprovava qualquer
  // `createHash(`, medido em 26/08/2026.
  const arquivos = arquivosDe(RAIZ_ADAPTADORES);
  const infratores: string[] = [];
  for (const arquivo of arquivos) {
    // Comentário fora antes de medir: a guarda mede CÓDIGO. Sem isto,
    // uma frase em português que cite caminho reprova o arquivo, e o
    // conserto vira reescrever prosa — remendo que volta sempre.
    const fonte = readFileSync(arquivo, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    if (/EXTENSAO_POR_TIPO/.test(fonte)) infratores.push(`${arquivo}: tabela de extensao`);
    if (/caminho-de-midia/.test(fonte)) infratores.push(`${arquivo}: importa o construtor de caminho`);
    // As três formas de mandar caminho pela porta. Sem as duas últimas, o
    // desvio é trivial e involuntário: `{ caminho }` e `x.caminho = y` não
    // têm dois-pontos.
    if (/\bcaminho\s*:/.test(fonte)) infratores.push(`${arquivo}: passa caminho pela porta`);
    // Atalho de objeto em duas posições: primeira propriedade e demais.
    // O `(?<!\$)` exclui interpolação de template — `${caminho}` numa
    // mensagem de erro é legítimo, e sem isso a guarda reprova o
    // adaptador de WhatsApp que já existe. Medido antes de entrar.
    if (/(?<!\$)\{\s*caminho\s*[,}]/.test(fonte) || /,\s*caminho\s*[,}]/.test(fonte)) {
      infratores.push(`${arquivo}: caminho por atalho de objeto`);
    }
    if (/\.caminho\s*=/.test(fonte)) infratores.push(`${arquivo}: atribui caminho`);
  }
  assert.deepEqual(infratores, [], `adaptador decidindo layout: ${infratores.join(', ')}`);
});

test('nenhum adaptador afirma vinculo de procedencia humana', () => {
  const arquivos = arquivosDe(RAIZ_ADAPTADORES);
  assert.ok(arquivos.length > 0, 'o teste precisa achar os módulos de adaptador');

  const infratores: string[] = [];
  for (const arquivo of arquivos) {
    // Comentário fora antes de medir, pelo mesmo motivo da guarda acima:
    // prosa que cite o defeito para explicá-lo reprovaria o arquivo.
    const fonte = readFileSync(arquivo, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    if (/procedencia\s*:\s*'humano'/.test(fonte)) infratores.push(arquivo);
  }
  assert.deepEqual(
    infratores,
    [],
    `adaptador afirmando vinculo humano: ${infratores.join(', ')}. So o humano ` +
      `afirma isso — vinculo humano e o unico que execucao automatica nao desfaz, ` +
      `e um Adaptador que o declare torna os proprios erros incorrigiveis.`,
  );
});

const ADAPTADORES = [
  'src/adaptadores/whatsapp/importar.ts',
  'src/adaptadores/whatsapp/material.ts',
  'src/adaptadores/instagram/importar.ts',
  'src/adaptadores/instagram/material.ts',
];

test('nenhum Adaptador remove linha do Acervo', () => {
  for (const arquivo of ADAPTADORES) {
    const fonte = readFileSync(join(process.cwd(), arquivo), 'utf8');
    assert.equal(/\bDELETE\s+FROM\b/i.test(fonte), false, `${arquivo} contém DELETE`);
    assert.equal(/\bDROP\s+TABLE\b/i.test(fonte), false, `${arquivo} contém DROP`);
    assert.equal(/\bUPDATE\s+\w+\s+SET\b/i.test(fonte), false, `${arquivo} escreve por SQL direto`);
  }
});

test('o relatório não compara Acervo com Material nem fala em remoção', () => {
  const fonte = readFileSync(join(process.cwd(), 'src/adaptadores/relatorio.ts'), 'utf8');
  const interfaceDoRelatorio = fonte.slice(
    fonte.indexOf('export interface RelatorioDeImportacao'),
    fonte.indexOf('export function relatorioVazio'),
  );
  for (const proibido of ['removid', 'apagad', 'excluid', 'totalDoAcervo', 'acervoTotal']) {
    assert.equal(
      new RegExp(proibido, 'i').test(interfaceDoRelatorio),
      false,
      `o relatório não pode ter campo com "${proibido}": nada é inferido da ausência`,
    );
  }
});

test('o relatório de Acervo não lê conteúdo de Mensagem', () => {
  const fonte = readFileSync(join(process.cwd(), 'src/nucleo/relatorio-de-acervo.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  // Quem opera precisa saber quanto ocupa, nunca o que diz. A guarda mede o
  // CODIGO, com comentario removido antes — senao uma frase em portugues que
  // cite a palavra reprova o arquivo, e o conserto vira reescrever prosa.
  // A lista cobre os apelidos que o relatorio usa hoje — `m` para mensagens,
  // `a` para anexos, `c` para conversas. O schema v10 levou o Conteudo Bruto
  // para as tres tabelas, e a guarda cresceu junto: sem isso ela protegeria
  // so a coluna que existia quando foi escrita.
  for (const proibido of [
    'm.conteudo',
    'm.bruto',
    'a.bruto',
    'c.bruto',
    'conteudo,',
    'bruto,',
  ]) {
    assert.ok(
      !fonte.includes(proibido),
      `o relatório não pode selecionar "${proibido}": ele reporta espaço, não conteúdo`,
    );
  }
});
