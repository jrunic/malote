// tests/ouvinte-estado-decifra.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { executar } from '../src/cli/index.js';
import { caminhosDaConta } from '../src/cli/ouvir.js';
import { marcarUltimoEvento } from '../src/cli/ultimo-evento.js';

const QUANDO = Date.parse('2026-11-10T10:00:00Z');

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
const json = (raiz: string): Record<string, unknown> => JSON.parse(estado(raiz, true)[0] ?? '{}') as Record<string, unknown>;

const falha = (id: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ t: 'falha', em: '2026-11-10T09:00:00.000Z', id, conversa: 'g@g.us', direcao: 'recebida', tipo: 'grupo', causa: 'sem-sessao', jaGravada: true, ...extra });

test('os arquivos da decifra moram na pasta de estado da conta, ao lado do ultimo-evento', () => {
  comConta((_raiz, caminhos) => {
    assert.equal(dirname(caminhos.decifra), dirname(caminhos.ultimoEvento));
    assert.match(caminhos.decifra, /decifra\.jsonl$/);
    assert.match(caminhos.decifraContador, /decifra\.json$/);
  });
});

test('--json traz o bloco da decifra lido so dos arquivos', () => {
  comConta((raiz, caminhos) => {
    writeFileSync(caminhos.decifraContador, JSON.stringify({ desde: '2026-11-09T08:00:00.000Z', falhasDeRegistro: 0 }));
    writeFileSync(caminhos.decifra, [falha('A'), falha('B', { jaGravada: true })].join('\n') + '\n');
    const lido = json(raiz);
    const decifra = lido['decifra'] as { desde: string; falhasDeRegistro: number; dias: Record<string, { total: Record<string, number> }> };
    assert.equal(decifra.desde, '2026-11-09T08:00:00.000Z');
    assert.equal(decifra.falhasDeRegistro, 0);
    assert.equal(decifra.dias['2026-11-10']?.total['jaGravada'], 2);
    assert.equal('decifraIndisponivel' in lido, false);
  });
});

test('--json: sem os arquivos o campo existe e e null, COM o motivo ao lado, nunca zero', () => {
  comConta((raiz) => {
    const lido = json(raiz);
    assert.ok('decifra' in lido, 'a chave existe');
    assert.equal(lido['decifra'], null);
    assert.equal(typeof lido['decifraIndisponivel'], 'string');
  });
});

test('a saida padrao (a do vigia) nao muda com o bloco: o texto e o mesmo com e sem os arquivos', () => {
  comConta((raiz, caminhos) => {
    const sem = estado(raiz, false);
    writeFileSync(caminhos.decifraContador, JSON.stringify({ desde: '2026-11-09T08:00:00.000Z', falhasDeRegistro: 0 }));
    writeFileSync(caminhos.decifra, falha('A') + '\n');
    assert.deepEqual(estado(raiz, false), sem);
    assert.ok(!sem.join('\n').toLowerCase().includes('decifra'));
  });
});

test('ouvinte estado --json nao abre o Acervo, com o bloco da decifra presente', () => {
  comConta((raiz, caminhos) => {
    writeFileSync(caminhos.decifraContador, JSON.stringify({ desde: '2026-11-09T08:00:00.000Z', falhasDeRegistro: 0 }));
    writeFileSync(caminhos.decifra, falha('A') + '\n');
    json(raiz); // todo comando cria o Registro; o que este teste fixa e o Acervo
    const antes = readdirSync(raiz).sort();
    const lido = json(raiz);
    assert.notEqual(lido['decifra'], null);
    assert.deepEqual(readdirSync(raiz).sort(), antes);
    assert.equal(existsSync(`${raiz}/acervos`), false, 'nenhum Acervo foi criado nem aberto');
  });
});

test('--json devolve so os campos do contrato: texto plantado numa linha nao aparece', () => {
  comConta((raiz, caminhos) => {
    writeFileSync(caminhos.decifraContador, JSON.stringify({ desde: '2026-11-09T08:00:00.000Z', falhasDeRegistro: 0 }));
    writeFileSync(caminhos.decifra, falha('A', { texto: 'plantado', conteudo: 'SEGREDO', conversa: 'x@g.us' }) + '\n');
    const bruto = estado(raiz, true)[0] ?? '';
    assert.ok(!bruto.includes('plantado'));
    assert.ok(!bruto.includes('SEGREDO'));
    assert.ok(!bruto.includes('x@g.us'), 'o bloco nao leva enderecos');
  });
});
