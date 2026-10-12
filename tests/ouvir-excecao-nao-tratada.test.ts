import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { caminhosDaConta, ouvir } from '../src/cli/ouvir.js';

const ENTRADA = join(import.meta.dirname, 'ajuda', 'ouvinte-de-teste-com-falha.ts');

/**
 * O contrato de saida do ouvinte (#1173). O unit reserva `0 1 2 78` (`RestartPreventExitStatus`) e
 * reinicia qualquer outro: 1 e vinculo invalidado e pede pareamento humano. Uma excecao que a
 * biblioteca deixa escapar tem de sair por um codigo FORA dessa lista, senao o ouvinte cai e nao
 * volta (30/09/2026: 9h24 fora, sem alarme). O literal e de proposito: o numero e um contrato com
 * o supervisor, e trocar a constante sem trocar o unit e o defeito.
 */
const CODIGO_DE_EXCECAO = 70;
const RESERVADOS_PELO_UNIT = [0, 1, 2, 78];

function cenario(): { raiz: string; inquilino: string; limpar: () => void } {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const inquilino = criarInquilino(registro, { titularNome: 'Agente' });
  resolverConfiguracao(registro, inquilino, 'whatsapp', 'teste');
  registro.fechar();
  const caminhos = caminhosDaConta(raiz, 'conta');
  mkdirSync(caminhos.vinculo, { recursive: true });
  writeFileSync(join(caminhos.vinculo, 'creds.json'), '{}');
  return { raiz, inquilino, limpar };
}

interface Resultado {
  codigo: number | null;
  saida: string;
  morreuSozinho: boolean;
}

/** Sobe o ouvinte de teste. `esperarMs` e a janela em que o processo PODE sair sozinho. */
async function rodar(modo: string, esperarMs = 10_000): Promise<Resultado> {
  const c = cenario();
  try {
    const filho = spawn(process.execPath, ['--import', 'tsx', ENTRADA, c.raiz, c.inquilino, modo], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let saida = '';
    filho.stdout.on('data', (d) => (saida += d));
    filho.stderr.on('data', (d) => (saida += d));
    const fim = new Promise<number | null>((r) => filho.once('exit', (codigo) => r(codigo)));
    const prazo = new Promise<'prazo'>((r) => setTimeout(() => r('prazo'), esperarMs).unref());
    const primeiro = await Promise.race([fim, prazo]);
    if (primeiro === 'prazo') {
      filho.kill('SIGKILL');
      await fim;
      return { codigo: null, saida, morreuSozinho: false };
    }
    return { codigo: primeiro, saida, morreuSozinho: true };
  } finally {
    c.limpar();
  }
}

test('rejeicao nao tratada da biblioteca: o processo sai por codigo que o supervisor reinicia (#1173)', async () => {
  const r = await rodar('rejeicao');
  assert.equal(r.morreuSozinho, true, `o processo nao saiu: ${r.saida}`);
  assert.equal(r.codigo, CODIGO_DE_EXCECAO, r.saida);
  assert.ok(!RESERVADOS_PELO_UNIT.includes(r.codigo as number), 'o codigo caiu na lista que o unit NAO reinicia');
  // O rotulo da origem tambem e contrato: sem o tratador de rejeicao o Node entrega a mesma falha ao de excecao.
  assert.match(r.saida, /EXCECAO NAO TRATADA \(rejeicao\)/);
  assert.match(r.saida, /Connection Closed/);
});

test('excecao nao capturada: o mesmo codigo', async () => {
  const r = await rodar('excecao');
  assert.equal(r.codigo, CODIGO_DE_EXCECAO, r.saida);
  assert.match(r.saida, /excecao nao tratada/i);
});

test('vinculo invalidado continua saindo 1, e a saida NAO se diz excecao', async () => {
  const r = await rodar('vinculo');
  assert.equal(r.codigo, 1, r.saida);
  assert.doesNotMatch(r.saida, /excecao nao tratada/i);
});

test('queda de rotina (428) nao sai: a religacao e por dentro, sem passar pelo tratador', async () => {
  const r = await rodar('rotina', 1_500);
  assert.equal(r.morreuSozinho, false, `saiu com ${r.codigo}: ${r.saida}`);
  assert.match(r.saida, /religando/);
  assert.doesNotMatch(r.saida, /excecao nao tratada/i);
});

test('os tratadores NAO sobram no processo depois que o ouvir termina', async () => {
  const antes = [process.listenerCount('unhandledRejection'), process.listenerCount('uncaughtException')];
  const c = cenario();
  try {
    const ouvintes = new Map<string, (d: unknown) => void>();
    const biblioteca = {
      default: () => ({
        ev: { on: (f: string, fn: (d: unknown) => void) => ouvintes.set(f, fn) },
        requestPairingCode: () => Promise.resolve('12345678'),
      }),
      useMultiFileAuthState: () => Promise.resolve({ state: {}, saveCreds: () => undefined }),
      DisconnectReason: { loggedOut: 401, connectionClosed: 428, connectionLost: 408 },
    };
    const codigo = await ouvir(['ouvir', '--inquilino', c.inquilino, '--conta', 'conta', '--configuracao', 'teste'], {
      dados: c.raiz,
      estado: c.raiz,
      escrever: () => undefined,
      carregarBiblioteca: () => {
        setImmediate(() =>
          ouvintes.get('connection.update')?.({
            connection: 'close',
            lastDisconnect: { error: { output: { statusCode: 401 } } },
          }),
        );
        return Promise.resolve(biblioteca);
      },
    });
    assert.equal(codigo, 1);
  } finally {
    c.limpar();
  }
  assert.deepEqual(
    [process.listenerCount('unhandledRejection'), process.listenerCount('uncaughtException')],
    antes,
  );
});
