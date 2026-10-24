// tests/ouvinte-estado-pendentes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { executar } from '../src/cli/index.js';
import { caminhosDaConta } from '../src/cli/ouvir.js';
import { marcarUltimoEvento } from '../src/cli/ultimo-evento.js';
import { derramar } from '../src/cli/derrame.js';
import { gravarEstadoDosPendentes } from '../src/cli/estado-dos-pendentes.js';
import type { EstadoDosPendentes } from '../src/adaptadores/whatsapp/pendentes.js';

const QUANDO = Date.parse('2026-10-23T10:00:00Z');

const ESTADO: EstadoDosPendentes = {
  socketCriadoEm: QUANDO,
  abertoEm: QUANDO + 400,
  atualizadoEm: QUANDO + 60_000,
  anunciados: {
    total: 500,
    mensagens: 40,
    recibos: 10,
    notificacoes: 440,
    status: 9,
    chamadas: 1,
    outros: 0,
  },
  recebidos: { mensagens: 40, notificacoes: 440, recibos: 10, chamadas: 1 },
  falhasDeDecifra: 2,
  pedidos: 4,
  nosPorPedido: [100, 100, 100, 91],
  liberadoEm: QUANDO + 6_000,
  fimDeclaradoEm: QUANDO + 55_000,
  desfecho: 'recolheu',
};

function comConta(f: (raiz: string, caminhos: ReturnType<typeof caminhosDaConta>) => void): void {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const caminhos = caminhosDaConta(raiz, 'c');
    mkdirSync(dirname(caminhos.ultimoEvento), { recursive: true });
    marcarUltimoEvento(caminhos.ultimoEvento, QUANDO);
    f(raiz, caminhos);
  } finally {
    limpar();
  }
}

function estado(raiz: string, json: boolean): string[] {
  const saida: string[] = [];
  executar(['ouvinte', 'estado', '--conta', 'c', ...(json ? ['--json'] : [])], {
    dados: raiz,
    estado: raiz,
    escrever: (t: string) => saida.push(t),
  });
  return saida;
}

test('o estado dos Pendentes mora na pasta de estado da conta, ao lado do ultimo-evento', () => {
  comConta((raiz, caminhos) => {
    assert.equal(dirname(caminhos.pendentes), dirname(caminhos.ultimoEvento));
    assert.match(caminhos.pendentes, /pendentes\.json$/);
  });
});

test('--json traz o estado dos Pendentes igual ao gravado', () => {
  comConta((raiz, caminhos) => {
    gravarEstadoDosPendentes(caminhos.pendentes, ESTADO);
    const lido = JSON.parse(estado(raiz, true)[0] ?? '{}') as Record<string, unknown>;
    assert.deepEqual(lido['pendentes'], ESTADO);
  });
});

test('--json devolve so os campos do contrato: chave extra plantada no arquivo nao aparece', () => {
  comConta((raiz, caminhos) => {
    writeFileSync(
      caminhos.pendentes,
      JSON.stringify({ ...ESTADO, jid: '5599900000000@s.whatsapp.net', texto: 'plantado' }),
    );
    const bruto = estado(raiz, true)[0] ?? '';
    assert.ok(!bruto.includes('5599900000000'));
    assert.ok(!bruto.includes('plantado'));
    assert.deepEqual((JSON.parse(bruto) as Record<string, unknown>)['pendentes'], ESTADO);
  });
});

test('a saida DEFAULT nao muda: uma linha, o instante ISO, com ou sem o estado dos Pendentes', () => {
  comConta((raiz, caminhos) => {
    const esperado = [new Date(QUANDO).toISOString()];
    assert.deepEqual(estado(raiz, false), esperado, 'sem o arquivo');
    gravarEstadoDosPendentes(caminhos.pendentes, ESTADO);
    assert.deepEqual(estado(raiz, false), esperado, 'com o arquivo: contrato com a frota');
  });
});

test('--json: sem arquivo, ou com arquivo ilegivel, o campo existe e e null (indisponivel)', () => {
  comConta((raiz, caminhos) => {
    const sem = JSON.parse(estado(raiz, true)[0] ?? '{}') as Record<string, unknown>;
    assert.ok('pendentes' in sem, 'a chave existe');
    assert.equal(sem['pendentes'], null);
    writeFileSync(caminhos.pendentes, '{ nao e json');
    const ruim = JSON.parse(estado(raiz, true)[0] ?? '{}') as Record<string, unknown>;
    assert.equal(ruim['pendentes'], null);
  });
});

test('o campo novo NAO reusa `lotes`, que continua sendo a contagem do Derrame', () => {
  comConta((raiz, caminhos) => {
    derramar(caminhos.derrame, [{ key: { id: 'X' } }, { key: { id: 'Y' } }]);
    derramar(caminhos.derrame, [{ key: { id: 'Z' } }]);
    gravarEstadoDosPendentes(caminhos.pendentes, ESTADO);
    const lido = JSON.parse(estado(raiz, true)[0] ?? '{}') as Record<string, unknown>;
    assert.equal(lido['derramados'], 3);
    assert.equal(lido['lotes'], 2, 'lotes segue sendo do Derrame');
    assert.deepEqual(lido['pendentes'], ESTADO);
  });
});

test('as chaves do --json: as de sempre e `pendentes`, aditivo', () => {
  comConta((raiz) => {
    const lido = JSON.parse(estado(raiz, true)[0] ?? '{}') as Record<string, unknown>;
    for (const chave of [
      'conta',
      'ultimoEvento',
      'derramados',
      'lotes',
      'correspondencia',
      'ultimoRetrato',
      'pulos',
      'descartes',
      'instantesAdiantados',
      'guarda',
      'ultimoSinalDaConexao',
    ]) {
      assert.ok(chave in lido, `a chave ${chave} segue la`);
    }
    assert.ok('pendentes' in lido);
  });
});
