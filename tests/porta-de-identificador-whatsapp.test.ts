import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Todo Identificador de WhatsApp gravado pelo Adaptador nasce pela porta que confere a forma do endereco (#1519). A guarda
 * cobre so `src/adaptadores/whatsapp` (o diretorio nao tem subpastas). Ficam fora, declarados: os tres caminhos do nucleo que
 * criam Identificador de WhatsApp a partir de Configuracao e de par ja gravado (a declaracao da conta, `endereco-da-conta.ts`;
 * a resolucao retroativa, `resolucao-retroativa.ts`; e a uniao, `registrarIdentificadorComEfeito`).
 */
const PASTA = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  'src',
  'adaptadores',
  'whatsapp',
);
const PORTA = 'endereco-de-whatsapp.ts';
const CHAMADA_DIRETA = /(^|[^A-Za-z])registrarIdentificador\s*\(/;

test('todo Identificador de WhatsApp nasce pela porta do Adaptador: nenhum arquivo chama registrarIdentificador direto', () => {
  const arquivos = readdirSync(PASTA).filter((f) => f.endsWith('.ts'));
  assert.ok(arquivos.length > 10, 'o detector nao viu os arquivos do Adaptador');
  const violacoes: string[] = [];
  for (const f of arquivos) {
    if (f === PORTA) continue;
    if (CHAMADA_DIRETA.test(readFileSync(join(PASTA, f), 'utf8'))) violacoes.push(f);
  }
  assert.deepEqual(violacoes, [], `use registrarIdentificadorDeWhatsapp: ${violacoes.join(', ')}`);
  // anti-vacuidade: a porta de fato chama a do nucleo, e o Adaptador a usa
  assert.match(readFileSync(join(PASTA, PORTA), 'utf8'), CHAMADA_DIRETA);
  assert.ok(
    arquivos.some(
      (f) =>
        f !== PORTA &&
        /registrarIdentificadorDeWhatsapp\s*\(/.test(readFileSync(join(PASTA, f), 'utf8')),
    ),
    'nenhum arquivo do Adaptador usa a porta',
  );
});

test('o detector casa a chamada direta e nao casa os nomes vizinhos', () => {
  assert.ok(CHAMADA_DIRETA.test('const { id } = registrarIdentificador(acervo, {'));
  assert.ok(CHAMADA_DIRETA.test('registrarIdentificador (acervo'));
  assert.ok(!CHAMADA_DIRETA.test('registrarIdentificadorDeWhatsapp(acervo, v)'));
  assert.ok(!CHAMADA_DIRETA.test('registrarIdentificadorComEfeito(acervo, e, op)'));
});
