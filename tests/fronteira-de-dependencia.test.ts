import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A biblioteca de recepcao ao vivo e nao-oficial e quebra quando a plataforma
 * muda o protocolo. A ADR que a adotou fixa o limite que torna a decisao
 * sustentavel: se ela morrer, o que sai do produto e um ADAPTADOR, nao o
 * produto. Isso so vale enquanto o nucleo nao a importar — e disciplina nao
 * guarda fronteira, teste guarda.
 *
 * Escrito ANTES de a dependencia ser instalada, de proposito: se viesse
 * depois, haveria um commit inteiro de janela em que o nucleo poderia
 * importa-la sem nada acusar.
 */
const PROIBIDAS = ['baileys'];

/** Pastas que NAO podem importar a biblioteca. O adaptador pode. */
const PROTEGIDAS = ['src/nucleo', 'src/registro', 'src/cli'];

function arquivosDe(raiz: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(raiz)) {
    const caminho = join(raiz, nome);
    if (statSync(caminho).isDirectory()) achados.push(...arquivosDe(caminho));
    else if (nome.endsWith('.ts')) achados.push(caminho);
  }
  return achados;
}

/**
 * Modulos importados por um arquivo, por leitura de texto.
 *
 * Texto e nao parser porque a pergunta e de fronteira, nao de semantica: o
 * nome do pacote aparece literalmente no `from`, e nao ha forma de importa-lo
 * sem escreve-lo. Cobre `import ... from 'x'`, `import 'x'` e `import('x')`.
 */
function importados(caminho: string): string[] {
  const fonte = readFileSync(caminho, 'utf8');
  const achados: string[] = [];
  for (const m of fonte.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    const alvo = m[1];
    if (alvo !== undefined) achados.push(alvo);
  }
  return achados;
}

for (const pasta of PROTEGIDAS) {
  test(`nenhum modulo de ${pasta} importa a biblioteca de recepcao`, () => {
    const violacoes: string[] = [];
    for (const arquivo of arquivosDe(pasta)) {
      for (const alvo of importados(arquivo)) {
        if (PROIBIDAS.some((p) => alvo === p || alvo.startsWith(`${p}/`))) {
          violacoes.push(`${arquivo} importa ${alvo}`);
        }
      }
    }
    assert.deepEqual(violacoes, [], violacoes.join('; '));
  });
}

test('a guarda enxerga os imports de verdade', () => {
  // A propria guarda precisa ser exercitada. Sem este caso ela passaria por
  // VACUIDADE se o extrator estivesse quebrado — achando zero import em vez
  // de zero import proibido, que sao coisas diferentes e parecem iguais.
  const alvos = importados('tests/fronteira-de-dependencia.test.ts');
  assert.ok(alvos.includes('node:fs'), 'o extrator tem de achar os imports reais');
  assert.ok(alvos.includes('node:path'), 'e todos eles');
});

test('as pastas protegidas existem e têm código', () => {
  // Segunda proteção contra vacuidade: se uma pasta for renomeada, o laço
  // acima roda sobre lista vazia e o teste dela passa sem medir nada.
  for (const pasta of PROTEGIDAS) {
    assert.ok(arquivosDe(pasta).length > 0, `${pasta} não pode estar vazia`);
  }
});

/** O unico arquivo do repositorio autorizado a alcancar a biblioteca. */
const PORTAO = join('src', 'adaptadores', 'whatsapp', 'conexao.ts');

test('so o modulo de conexao alcanca a biblioteca — nem os outros adaptadores', () => {
  // A pasta de adaptadores NAO e liberada em bloco. Se qualquer outro arquivo
  // dela importar a biblioteca, o adaptador puro deixa de ser testavel sem
  // socket, que e o que sustenta a medicao de convergencia inteira.
  const violacoes: string[] = [];
  for (const arquivo of arquivosDe('src/adaptadores')) {
    if (arquivo === PORTAO) continue;
    for (const alvo of importados(arquivo)) {
      if (PROIBIDAS.some((p) => alvo === p || alvo.startsWith(`${p}/`))) {
        violacoes.push(`${arquivo} importa ${alvo}`);
      }
    }
  }
  assert.deepEqual(violacoes, [], violacoes.join('; '));
});

test('e ate no portao o import e DINAMICO', () => {
  // Import estatico aqui carregaria os 120 pacotes da arvore em TODO comando —
  // `malote conversas` incluso — e faria o produto inteiro parar de subir no
  // dia em que a biblioteca quebrar. O criterio 19 da spec exige que importar e
  // consultar nao dependam do ouvinte, e essa exigencia morre num `import` de
  // uma linha que ninguem nota na revisao.
  const fonte = readFileSync(PORTAO, 'utf8');
  assert.doesNotMatch(fonte, /^\s*import\s[^;]*['"]baileys['"]/m, 'estatico e proibido');
  assert.match(fonte, /import\(\s*['"]baileys['"]\s*\)/, 'o dinamico tem de estar la');
});

test('a arvore de dependencias de producao e esta, e mudar aqui e deliberado', () => {
  // CHANGELOG DELIBERADO, e nao invariante — mesmo precedente do teste que crava
  // a versao do Acervo, e a escolha esta dita para quem vier depois.
  //
  // Quebrar este teste e INTENCIONAL: acrescentar dependencia de runtime passa
  // pela quarentena com aprovacao humana por mudanca de arvore. O teste obriga
  // quem acrescenta a vir aqui e escrever POR QUE, do mesmo jeito que subir a
  // forma do Acervo obriga a documentar a versao.
  //
  //   baileys        — recepcao ao vivo (ciclo 10)
  //   better-sqlite3 — as duas bases, desde o ciclo 1
  //   tsx            — o interpretador de producao (03/09/2026)
  //
  // A superficie de rede do ciclo 11 NAO acrescentou nenhuma: ela e `node:http`,
  // da biblioteca padrao.
  const manifesto = JSON.parse(readFileSync('package.json', 'utf8')) as {
    dependencies: Record<string, string>;
  };
  assert.deepEqual(Object.keys(manifesto.dependencies).sort(), [
    'baileys',
    'better-sqlite3',
    'tsx',
  ]);
});

test('importar e consultar nao dependem da rede', () => {
  // Criterio 21: o produto continua completo sem subir a rede. So o comando
  // `servir` alcanca `src/rede/`
  //
  // O import de `servir.ts` no despacho da CLI e ESTATICO, diferente do da
  // biblioteca de recepcao, que e dinamico — e a diferenca tem razao: aquela
  // sao 120 pacotes de terceiro que podem quebrar e levar o produto junto;
  // esta e `node:http`, da biblioteca padrao, que nao quebra e nao custa
  // arvore. O que se guarda aqui e o inverso: que o NUCLEO nao passe a
  // depender da rede. — se o nucleo, o registro, os adaptadores ou o
  // resto da CLI passarem a importa-lo, a rede deixa de ser opcional sem que
  // ninguem note.
  const violacoes: string[] = [];
  for (const arquivo of arquivosDe('src')) {
    if (arquivo.startsWith(join('src', 'rede'))) continue;
    if (arquivo === join('src', 'cli', 'servir.ts')) continue;
    for (const alvo of importados(arquivo)) {
      if (alvo.includes('/rede/')) violacoes.push(`${arquivo} importa ${alvo}`);
    }
  }
  assert.deepEqual(violacoes, [], violacoes.join('; '));
});

/**
 * O NUCLEO NAO CONHECE ADAPTADOR — a fronteira que faltava guarda.
 *
 * A convencao ja estava escrita no CONTEXTO.md e valia na pratica: medido em
 * 12/09/2026, ZERO modulos de `src/nucleo` e `src/registro` importam
 * `src/adaptadores`. Quem compoe adaptador de mais de uma Fonte e `src/cli`,
 * com 11 imports — precedentes `ouvir.ts` e `varredura.ts`.
 *
 * O que NAO existia era o teste. E a mesma classe de erosao que a guarda da
 * biblioteca de recepcao existe para impedir, com a razao da ADR valendo igual:
 * se a Fonte morrer, o que sai do produto e um adaptador, nao o produto. Isso
 * exige que o nucleo seja testavel sem o formato de Fonte nenhuma.
 */
const SEM_ADAPTADOR = ['src/nucleo', 'src/registro'];

/** Um import alcanca `src/adaptadores`? Relativo ou pela raiz. */
function alcancaAdaptadores(alvo: string): boolean {
  return /(^|\/)adaptadores(\/|$)/.test(alvo);
}

for (const pasta of SEM_ADAPTADOR) {
  test(`nenhum modulo de ${pasta} importa um adaptador`, () => {
    const violacoes: string[] = [];
    for (const arquivo of arquivosDe(pasta)) {
      for (const alvo of importados(arquivo)) {
        if (alcancaAdaptadores(alvo)) violacoes.push(`${arquivo} importa ${alvo}`);
      }
    }
    assert.deepEqual(violacoes, [], violacoes.join('; '));
  });
}

test('o detector de adaptador ACHA os imports que existem de verdade', () => {
  // A protecao anti-vacuidade que decide. As duas anteriores garantem que ha
  // arquivos e que o extrator le imports; esta garante que o DETECTOR casa o
  // que precisa casar. Sem ela, um padrao quebrado devolveria zero violacoes em
  // `src/nucleo` por nao achar nada, e o teste passaria verde afirmando o
  // contrario do que mede.
  //
  // `src/cli` e o oraculo porque ele PODE e DEVE importar adaptador: e ali que
  // a composicao acontece.
  const daCli = arquivosDe('src/cli')
    .flatMap((a) => importados(a))
    .filter((alvo) => alcancaAdaptadores(alvo));
  assert.ok(
    daCli.length > 0,
    'src/cli importa adaptadores — se o detector nao os ve, ele nao ve nada',
  );

  // E nao casa o que nao deve: o nome tem de ser segmento de caminho, nao
  // substring solta.
  assert.equal(alcancaAdaptadores('../nucleo/acervo.js'), false);
  assert.equal(alcancaAdaptadores('node:fs'), false);
  assert.equal(alcancaAdaptadores('../adaptadores/whatsapp/importar.js'), true);
  assert.equal(alcancaAdaptadores('src/adaptadores'), true);
});
