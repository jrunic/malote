import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Todo ponto de entrada de producao que grava um fato declara a ORIGEM da Chegada, e declara a certa.
 *
 * O compilador ja recusa a chamada sem `origemDaChegada`. O que ele nao ve e o valor: um importador que declarasse
 * `ao-vivo` compilaria, e o consumidor que ignora importacao reagiria a um backup inteiro. Este teste enumera cada
 * chamada de porta em `src/` com a origem esperada, e reprova chamada nova que a lista nao classifica (a mesma ideia
 * do teste da guarda de descartes em todo ponto de entrada).
 */

const RAIZ = join(import.meta.dirname, '..', 'src');

const PORTAS = [
  'registrarMensagem',
  'registrarAnexo',
  'registrarEdicao',
  'registrarTransicao',
  'registrarEtiqueta',
  'gravarArquivoDeAnexo',
  'gravarArquivoDeAnexoDeCaminho',
  'receberEvento',
];

/** [arquivo, porta, origem declarada]. `opcoes.origemDaChegada` e a origem que a recepcao recebeu do chamador. */
const ESPERADO: ReadonlyArray<readonly [string, string, string]> = [
  ['adaptadores/instagram/importar.ts', 'registrarMensagem', "'importacao'"],
  ['adaptadores/instagram/importar.ts', 'registrarAnexo', "'importacao'"],
  ['adaptadores/whatsapp/importar.ts', 'registrarTransicao', "'importacao'"],
  ['adaptadores/whatsapp/importar.ts', 'registrarMensagem', "'importacao'"],
  ['adaptadores/whatsapp/importar.ts', 'registrarAnexo', "'importacao'"],
  ['adaptadores/whatsapp/trazer.ts', 'gravarArquivoDeAnexoDeCaminho', "'importacao'"],
  ['adaptadores/whatsapp/reprocessar-midia.ts', 'gravarArquivoDeAnexo', "'reprocesso'"],
  ['adaptadores/whatsapp/extrair-imagem-de-modelo.ts', 'registrarAnexo', "'reprocesso'"],
  ['adaptadores/whatsapp/ao-vivo.ts', 'registrarEdicao', 'opcoes.origemDaChegada'],
  ['adaptadores/whatsapp/ao-vivo.ts', 'registrarMensagem', 'opcoes.origemDaChegada'],
  ['adaptadores/whatsapp/ao-vivo.ts', 'registrarAnexo', 'opcoes.origemDaChegada'],
  ['adaptadores/whatsapp/ao-vivo.ts', 'registrarAnexo', 'opcoes.origemDaChegada'],
  ['adaptadores/whatsapp/ao-vivo.ts', 'registrarTransicao', 'opcoes.origemDaChegada'],
  ['adaptadores/whatsapp/ao-vivo.ts', 'registrarEtiqueta', 'origemDaChegada'],
  ['cli/ouvir.ts', 'receberEvento', "'ao-vivo'"],
  ['cli/ouvir.ts', 'receberEvento', "'ao-vivo'"],
  ['cli/ouvir.ts', 'gravarArquivoDeAnexo', "'ao-vivo'"],
  ['cli/index.ts', 'receberEvento', "'reprocesso'"],
  ['cli/guarda-de-descartes.ts', 'receberEvento', "'reprocesso'"],
];

function arquivosTs(pasta: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivosTs(caminho));
    else if (nome.endsWith('.ts')) saida.push(caminho);
  }
  return saida;
}

/** O texto entre os parenteses da chamada que abre em `abre`, contando parenteses aninhados. */
function argumentos(texto: string, abre: number): string {
  let fundo = 0;
  for (let i = abre; i < texto.length; i += 1) {
    if (texto[i] === '(') fundo += 1;
    else if (texto[i] === ')') {
      fundo -= 1;
      if (fundo === 0) return texto.slice(abre + 1, i);
    }
  }
  throw new Error('parenteses sem fechamento');
}

function chamadasDeProducao(): Array<[string, string, string]> {
  const achadas: Array<[string, string, string]> = [];
  for (const arquivo of arquivosTs(RAIZ)) {
    const rel = relative(RAIZ, arquivo);
    // As definicoes das portas moram no nucleo; o que se mede aqui sao as chamadas de quem as usa.
    if (rel.startsWith('nucleo/')) continue;
    const texto = readFileSync(arquivo, 'utf8');
    for (const porta of PORTAS) {
      const re = new RegExp(`(?<![\\w.])${porta}\\(`, 'g');
      for (let m = re.exec(texto); m !== null; m = re.exec(texto)) {
        const inicio = texto.lastIndexOf('\n', m.index) + 1;
        if (/^\s*(export\s+)?(async\s+)?function\s/.test(texto.slice(inicio, m.index + porta.length + 1))) continue;
        const args = argumentos(texto, m.index + porta.length);
        const campo = /origemDaChegada(?:\s*:\s*([^,\n}]+))?/.exec(args);
        achadas.push([rel, porta, campo === null ? '(sem origem)' : (campo[1] ?? 'origemDaChegada').trim()]);
      }
    }
  }
  return achadas;
}

test('cada chamada de porta de escrita em producao declara a origem esperada, e nenhuma fica sem classificar', () => {
  const chave = (t: readonly [string, string, string]) => t.join(' | ');
  const achadas = chamadasDeProducao().map(chave).sort();
  const esperadas = ESPERADO.map(chave).sort();
  assert.deepEqual(achadas, esperadas);
});
