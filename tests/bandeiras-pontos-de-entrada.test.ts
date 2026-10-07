import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  executar, executarConsultaRede, executarMidiaReprocessar,
} from '../src/cli/index.js';
import { executarEnviarRede } from '../src/cli/enviar-rede.js';
import { executarEnvioEstadoRede } from '../src/cli/envio-estado-rede.js';
import { executarExportarRede } from '../src/cli/exportar.js';
import { ouvir } from '../src/cli/ouvir.js';
import { servir } from '../src/cli/servir.js';

const INDEX = join(import.meta.dirname, '..', 'src', 'cli', 'index.ts');
// Porta 1 nao escuta: sem a validacao, qualquer requisicao sairia com 4 (conexao), nunca com 2.
const SERVIDOR_MORTO = 'http://127.0.0.1:1';

function capturar(): { linhas: string[]; escrever: (t: string) => void } {
  const linhas: string[] = [];
  return { linhas, escrever: (t) => linhas.push(t) };
}

test('executar (modo local): flag sem valor sai 2 e nao abre base', () => {
  const dados = mkdtempSync(join(tmpdir(), 'malote-bandeiras-'));
  try {
    const c = capturar();
    const codigo = executar(['conversas', '--inquilino', 'x', '--coletiva', '--json'], {
      dados, estado: dados, escrever: c.escrever,
    });
    assert.equal(codigo, 2);
    assert.deepEqual(c.linhas, ['A flag --coletiva pede um valor.']);
    assert.equal(existsSync(join(dados, 'registro.db')), false, 'a invocacao abriu base');
  } finally {
    rmSync(dados, { recursive: true, force: true });
  }
});

test('executarConsultaRede: flag sem valor sai 2 e nenhuma requisicao sai', async () => {
  const c = capturar();
  const codigo = await executarConsultaRede(['conversas', '--coletiva', '--json'], {
    servidor: SERVIDOR_MORTO, chave: 'k', escrever: c.escrever,
  });
  assert.equal(codigo, 2, 'com requisicao, o servidor morto daria 4');
  assert.deepEqual(c.linhas, ['A flag --coletiva pede um valor.']);
});

test('executarExportarRede: flag sem valor sai 2 pela saida de erro', async () => {
  const dados: string[] = [];
  const erros: string[] = [];
  const codigo = await executarExportarRede(['exportar', '--conversa', 'c', '--desde'], {
    servidor: SERVIDOR_MORTO, chave: 'k', escrever: (t) => dados.push(t), erro: (t) => erros.push(t),
    aguardarEscoamento: async () => undefined,
  });
  assert.equal(codigo, 2);
  assert.deepEqual(erros, ['A flag --desde pede um valor.']);
  assert.deepEqual(dados, []);
});

test('executarEnviarRede e executarEnvioEstadoRede: flag sem valor sai 2', async () => {
  const a = capturar();
  const enviar = await executarEnviarRede(['enviar', '--para'], {
    servidor: SERVIDOR_MORTO, chave: 'k', env: {}, escrever: a.escrever,
  });
  assert.equal(enviar, 2);
  assert.deepEqual(a.linhas, ['A flag --para pede um valor.']);
  const b = capturar();
  const estado = await executarEnvioEstadoRede(['envio', 'estado', '--chave-em'], {
    servidor: SERVIDOR_MORTO, chave: 'k', env: {}, escrever: b.escrever,
  });
  assert.equal(estado, 2);
  assert.deepEqual(b.linhas, ['A flag --chave-em pede um valor.']);
});

test('executarMidiaReprocessar, ouvir e servir: flag sem valor sai 2 antes de qualquer efeito', async () => {
  const dados = mkdtempSync(join(tmpdir(), 'malote-bandeiras-'));
  try {
    for (const [nome, chamar] of [
      ['midia', (e: Parameters<typeof executar>[1]) => executarMidiaReprocessar(['midia', 'reprocessar', '--inquilino'], e)],
      ['ouvir', (e: Parameters<typeof executar>[1]) => ouvir(['ouvir', '--conta'], e)],
      // `criar` injetado: sem a validacao, `servir --porta` sobe um servidor de verdade e o teste PENDURA
      // em vez de falhar (medido na revisao); assim, a falta da guarda falha rapido.
      ['servir', (e: Parameters<typeof executar>[1]) => servir(['servir', '--porta'], {
        ...e, criar: () => { throw new Error('servir nao devia subir: a validacao nao rodou'); },
      })],
    ] as const) {
      const c = capturar();
      const codigo = await chamar({ dados, estado: dados, escrever: c.escrever });
      assert.equal(codigo, 2, nome);
      assert.match(c.linhas[0] ?? '', /^A flag --\w+ pede um valor\.$/, nome);
    }
    assert.equal(existsSync(join(dados, 'registro.db')), false, 'alguma entrada abriu base');
  } finally {
    rmSync(dados, { recursive: true, force: true });
  }
});

function rodarBinario(env: Record<string, string>, argumentos: string[]): Promise<{ codigo: number; saida: string }> {
  return new Promise((resolver) => {
    const base = { ...process.env };
    delete base['MALOTE_SERVIDOR'];
    delete base['MALOTE_CHAVE_DE_ACESSO'];
    const filho = spawn(process.execPath, ['--import', 'tsx', INDEX, ...argumentos], { env: { ...base, ...env } });
    let saida = '';
    filho.stdout.on('data', (d) => (saida += d));
    filho.stderr.on('data', (d) => (saida += d));
    filho.on('close', (codigo) => resolver({ codigo: codigo ?? -1, saida }));
  });
}

test('o binario, em modo REDE: conversas --coletiva --json sai 2 (era 0 com tudo)', async () => {
  const dados = mkdtempSync(join(tmpdir(), 'malote-bandeiras-'));
  try {
    const r = await rodarBinario(
      { MALOTE_HOME: dados, MALOTE_SERVIDOR: SERVIDOR_MORTO, MALOTE_CHAVE_DE_ACESSO: 'k' },
      ['conversas', '--coletiva', '--json'],
    );
    assert.equal(r.codigo, 2, r.saida);
    assert.match(r.saida, /A flag --coletiva pede um valor\./);
  } finally {
    rmSync(dados, { recursive: true, force: true });
  }
});

test('o binario, em modo LOCAL: flag sem valor sai 2 e a instalacao vazia continua vazia', async () => {
  const dados = mkdtempSync(join(tmpdir(), 'malote-bandeiras-'));
  try {
    const r = await rodarBinario({ MALOTE_HOME: dados }, ['conversas', '--inquilino', 'x', '--coletiva', '--json']);
    assert.equal(r.codigo, 2, r.saida);
    assert.match(r.saida, /A flag --coletiva pede um valor\./);
    assert.equal(existsSync(join(dados, 'registro.db')), false);
  } finally {
    rmSync(dados, { recursive: true, force: true });
  }
});
