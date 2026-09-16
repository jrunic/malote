import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { executar } from '../src/cli/index.js';
import { caminhosDaConta } from '../src/cli/ouvir.js';
import { marcarUltimoEvento } from '../src/cli/ultimo-evento.js';
import { derramar } from '../src/cli/derrame.js';
import { anotarRetrato } from '../src/cli/retrato.js';
import { anotarPulos } from '../src/cli/pulos.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * `marcarUltimoEvento` grava direto, sem criar a pasta — quem a cria e o
 * `ouvir`, na partida. Num teste que nao passa por ele, a pasta e do arranjo.
 */
function comPastaDaConta(raiz: string, conta: string): void {
  mkdirSync(dirname(caminhosDaConta(raiz, conta).ultimoEvento), { recursive: true });
}

const QUANDO = Date.parse('2026-09-09T10:00:00Z');

/**
 * A SAIDA DEFAULT E CONTRATO COM A FROTA, e nao estilo.
 *
 * Medido em 09/09/2026 no `jd-health-check`: ele passa a saida INTEIRA para
 * `date -u -d "$saida"`. Uma linha a mais e a conversao falha nos dois ramos,
 * `evento_epoch` vira 0, e a idade calculada conta desde 1970 — alarme de
 * silencio em toda execucao, em todas as contas.
 */
test('a saida default e EXATAMENTE a de hoje: uma linha, o instante ISO', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    comPastaDaConta(raiz, 'c');
    marcarUltimoEvento(caminhosDaConta(raiz, 'c').ultimoEvento, QUANDO);
    derramar(caminhosDaConta(raiz, 'c').derrame, [{ key: { id: 'X' } }]);
    const linhas: string[] = [];
    const codigo = executar(['ouvinte', 'estado', '--conta', 'c'], {
      dados: raiz, estado: raiz,
      escrever: (t: string) => linhas.push(t),
    });
    assert.equal(codigo, 0);
    assert.equal(linhas.length, 1, `saida com ${linhas.length} linhas quebra o watchdog da frota`);
    assert.equal(linhas[0], '2026-09-09T10:00:00.000Z');
  } finally {
    limpar();
  }
});

test('o trecho do watchdog calcula a MESMA idade com derrame pendente', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    comPastaDaConta(raiz, 'c');
    marcarUltimoEvento(caminhosDaConta(raiz, 'c').ultimoEvento, QUANDO);
    const semDerrame: string[] = [];
    executar(['ouvinte', 'estado', '--conta', 'c'], {
      dados: raiz, estado: raiz,
      escrever: (t: string) => semDerrame.push(t),
    });
    derramar(caminhosDaConta(raiz, 'c').derrame, [{ key: { id: 'X' } }, { key: { id: 'Y' } }]);
    const comDerrame: string[] = [];
    executar(['ouvinte', 'estado', '--conta', 'c'], {
      dados: raiz, estado: raiz,
      escrever: (t: string) => comDerrame.push(t),
    });
    // A conversao que o watchdog faz, reproduzida: parse da saida INTEIRA.
    assert.equal(Date.parse(semDerrame.join('\n')), QUANDO);
    assert.equal(Date.parse(comDerrame.join('\n')), QUANDO, 'o derrame mudou o que o watchdog le');
  } finally {
    limpar();
  }
});

test('--json traz a contagem, e e ai que o sinal novo mora', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    comPastaDaConta(raiz, 'c');
    marcarUltimoEvento(caminhosDaConta(raiz, 'c').ultimoEvento, QUANDO);
    // UM lote de dois e OUTRO de um: 2 lotes, 3 eventos. Lotes de tamanho um
    // nao distinguiriam as duas contagens, e a spec pede EVENTOS.
    derramar(caminhosDaConta(raiz, 'c').derrame, [{ key: { id: 'X' } }, { key: { id: 'Y' } }]);
    derramar(caminhosDaConta(raiz, 'c').derrame, [{ key: { id: 'Z' } }]);
    const linhas: string[] = [];
    executar(['ouvinte', 'estado', '--conta', 'c', '--json'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => linhas.push(t),
    });
    const o = JSON.parse(linhas.join('\n')) as {
      conta: string;
      ultimoEvento: string;
      derramados: number;
      lotes: number;
    };
    assert.equal(o.conta, 'c');
    assert.equal(o.ultimoEvento, '2026-09-09T10:00:00.000Z');
    assert.equal(o.derramados, 3, 'derramados conta EVENTOS');
    assert.equal(o.lotes, 2, 'lotes conta a unidade da drenagem');
  } finally {
    limpar();
  }
});

test('sem derrame, --json diz zero — ausencia nao e erro', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    comPastaDaConta(raiz, 'c');
    marcarUltimoEvento(caminhosDaConta(raiz, 'c').ultimoEvento, QUANDO);
    const linhas: string[] = [];
    executar(['ouvinte', 'estado', '--conta', 'c', '--json'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => linhas.push(t),
    });
    const o = JSON.parse(linhas.join('\n')) as { derramados: number; lotes: number };
    assert.equal(o.derramados, 0);
    assert.equal(o.lotes, 0);
  } finally {
    limpar();
  }
});

test('conta sem evento continua saindo 1, com --json ou sem', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const linhas: string[] = [];
    const codigo = executar(['ouvinte', 'estado', '--conta', 'nunca', '--json'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => linhas.push(t),
    });
    assert.equal(codigo, 1, 'o ramo de "sem evento" nao pode mudar de codigo por causa do --json');
    assert.match(linhas.join('\n'), /sem evento registrado/);
  } finally {
    limpar();
  }
});

/**
 * O criterio 27 do ciclo 18: "nenhuma marcada" e "o retrato nao veio" TEM de
 * ser respostas distintas. Quem as distingue e este campo ser `null`, e nao
 * zero nem ausente.
 */
test('--json diz ultimoRetrato NULL quando nenhum Retrato chegou', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    comPastaDaConta(raiz, 'c');
    marcarUltimoEvento(caminhosDaConta(raiz, 'c').ultimoEvento, QUANDO);
    const linhas: string[] = [];
    executar(['ouvinte', 'estado', '--conta', 'c', '--json'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => linhas.push(t),
    });
    const lido = JSON.parse(linhas.join('')) as Record<string, unknown>;
    assert.ok('ultimoRetrato' in lido, 'o campo tem de EXISTIR, senao some do JSON');
    assert.equal(lido['ultimoRetrato'], null);
  } finally {
    limpar();
  }
});

test('--json traz o instante e o tamanho do Retrato anotado', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    comPastaDaConta(raiz, 'c');
    marcarUltimoEvento(caminhosDaConta(raiz, 'c').ultimoEvento, QUANDO);
    anotarRetrato(caminhosDaConta(raiz, 'c').retrato, {
      em: '2026-09-13T02:00:00.000Z',
      itens: 2674,
    });
    const linhas: string[] = [];
    executar(['ouvinte', 'estado', '--conta', 'c', '--json'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => linhas.push(t),
    });
    const lido = JSON.parse(linhas.join('')) as { ultimoRetrato: { em: string; itens: number } };
    assert.deepEqual(lido.ultimoRetrato, { em: '2026-09-13T02:00:00.000Z', itens: 2674 });
  } finally {
    limpar();
  }
});

test('--json traz pulos; ausente e zero', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    comPastaDaConta(raiz, 'c');
    marcarUltimoEvento(caminhosDaConta(raiz, 'c').ultimoEvento, QUANDO);
    const sem: string[] = [];
    executar(['ouvinte', 'estado', '--conta', 'c', '--json'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => sem.push(t),
    });
    assert.deepEqual(JSON.parse(sem.join('')).pulos, {
      enderecosOpacos: 0,
      favoritosSemMensagem: 0,
    });
    anotarPulos(caminhosDaConta(raiz, 'c').pulos, { enderecosOpacos: 4, favoritosSemMensagem: 0 });
    const com: string[] = [];
    executar(['ouvinte', 'estado', '--conta', 'c', '--json'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => com.push(t),
    });
    assert.deepEqual(JSON.parse(com.join('')).pulos, {
      enderecosOpacos: 4,
      favoritosSemMensagem: 0,
    });
  } finally {
    limpar();
  }
});

test('--json traz favoritosSemMensagem; saida default intacta', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    comPastaDaConta(raiz, 'c');
    marcarUltimoEvento(caminhosDaConta(raiz, 'c').ultimoEvento, QUANDO);
    anotarPulos(caminhosDaConta(raiz, 'c').pulos, {
      enderecosOpacos: 0,
      favoritosSemMensagem: 2,
    });
    const json: string[] = [];
    executar(['ouvinte', 'estado', '--conta', 'c', '--json'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => json.push(t),
    });
    assert.equal(JSON.parse(json.join('')).pulos.favoritosSemMensagem, 2);
    const def: string[] = [];
    executar(['ouvinte', 'estado', '--conta', 'c'], {
      dados: raiz, estado: raiz,
      escrever: (t: string) => def.push(t),
    });
    assert.equal(def.length, 1);
    assert.equal(Date.parse(def[0] as string), QUANDO);
  } finally {
    limpar();
  }
});

test('o Retrato anotado NAO vaza para a saida default — contrato com a frota', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    comPastaDaConta(raiz, 'c');
    marcarUltimoEvento(caminhosDaConta(raiz, 'c').ultimoEvento, QUANDO);
    anotarRetrato(caminhosDaConta(raiz, 'c').retrato, {
      em: '2026-09-13T02:00:00.000Z',
      itens: 2674,
    });
    const linhas: string[] = [];
    executar(['ouvinte', 'estado', '--conta', 'c'], {
      dados: raiz, estado: raiz,
      escrever: (t: string) => linhas.push(t),
    });
    assert.equal(linhas.length, 1, 'sinal novo na saida default quebra o watchdog');
    assert.equal(Date.parse(linhas.join('\n')), QUANDO);
  } finally {
    limpar();
  }
});
