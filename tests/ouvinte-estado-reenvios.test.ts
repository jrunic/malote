// tests/ouvinte-estado-reenvios.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { executar } from '../src/cli/index.js';
import { caminhosDaConta } from '../src/cli/ouvir.js';
import { marcarUltimoEvento } from '../src/cli/ultimo-evento.js';
import { derramar } from '../src/cli/derrame.js';
import type { EstadoDosReenvios } from '../src/cli/reenvios.js';

const QUANDO = Date.parse('2026-11-10T10:00:00Z');

const ESTADO: EstadoDosReenvios = {
  desde: '2026-11-09T08:00:00.000Z',
  dias: {
    '2026-11-10': {
      pedidos: 4,
      achadosNaMemoria: 2,
      achadosNoAcervo: 1,
      naoAchados: 1,
      erros: 0,
      enderecoDiferente: 0,
      reciboFalhou: 1,
      recusadosPorLimite: 0,
      recusadosNaoPropria: 0,
    },
  },
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

test('o contador dos reenvios mora na pasta de estado da conta, ao lado do ultimo-evento', () => {
  comConta((_raiz, caminhos) => {
    assert.equal(dirname(caminhos.reenvios), dirname(caminhos.ultimoEvento));
    assert.match(caminhos.reenvios, /reenvios\.json$/);
  });
});

test('--json traz o contador igual ao gravado', () => {
  comConta((raiz, caminhos) => {
    writeFileSync(caminhos.reenvios, JSON.stringify(ESTADO));
    const lido = JSON.parse(estado(raiz, true)[0] ?? '{}') as Record<string, unknown>;
    assert.deepEqual(lido['reenvios'], ESTADO);
  });
});

test('--json: `desde` presente e `dias` vazio e "nenhum pedido", e NAO null', () => {
  comConta((raiz, caminhos) => {
    const vazio = { desde: '2026-11-09T08:00:00.000Z', dias: {} };
    writeFileSync(caminhos.reenvios, JSON.stringify(vazio));
    const lido = JSON.parse(estado(raiz, true)[0] ?? '{}') as Record<string, unknown>;
    assert.deepEqual(lido['reenvios'], vazio);
  });
});

test('--json: sem arquivo, ilegivel ou sem `desde`, o campo existe e e null (indisponivel), nunca zero', () => {
  comConta((raiz, caminhos) => {
    const sem = JSON.parse(estado(raiz, true)[0] ?? '{}') as Record<string, unknown>;
    assert.ok('reenvios' in sem, 'a chave existe');
    assert.equal(sem['reenvios'], null);
    writeFileSync(caminhos.reenvios, '{ nao e json');
    assert.equal((JSON.parse(estado(raiz, true)[0] ?? '{}') as Record<string, unknown>)['reenvios'], null);
    writeFileSync(caminhos.reenvios, JSON.stringify({ dias: ESTADO.dias }));
    assert.equal((JSON.parse(estado(raiz, true)[0] ?? '{}') as Record<string, unknown>)['reenvios'], null);
  });
});

test('--json devolve so os campos do contrato: chave extra plantada no arquivo nao aparece', () => {
  comConta((raiz, caminhos) => {
    writeFileSync(
      caminhos.reenvios,
      JSON.stringify({ ...ESTADO, jid: '5599900000000@s.whatsapp.net', texto: 'plantado' }),
    );
    const bruto = estado(raiz, true)[0] ?? '';
    assert.ok(!bruto.includes('5599900000000'));
    assert.ok(!bruto.includes('plantado'));
    assert.deepEqual((JSON.parse(bruto) as Record<string, unknown>)['reenvios'], ESTADO);
  });
});

test('a saida DEFAULT nao muda um byte: uma linha, o instante ISO, com ou sem o contador', () => {
  comConta((raiz, caminhos) => {
    const esperado = [new Date(QUANDO).toISOString()];
    assert.deepEqual(estado(raiz, false), esperado, 'sem o arquivo');
    writeFileSync(caminhos.reenvios, JSON.stringify(ESTADO));
    assert.deepEqual(estado(raiz, false), esperado, 'com o arquivo: contrato com a frota');
    assert.equal(estado(raiz, false).join('\n'), new Date(QUANDO).toISOString(), 'byte a byte');
  });
});

test('o campo novo e aditivo: as chaves de sempre seguem, o Derrame segue contando `lotes`', () => {
  comConta((raiz, caminhos) => {
    derramar(caminhos.derrame, [{ key: { id: 'X' } }]);
    writeFileSync(caminhos.reenvios, JSON.stringify(ESTADO));
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
      'pendentes',
      'reenvios',
    ]) {
      assert.ok(chave in lido, `a chave ${chave} esta la`);
    }
    assert.equal(lido['lotes'], 1);
  });
});
