// tests/ouvir-reenvios.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { caminhosDaConta, ouvir } from '../src/cli/ouvir.js';
import { lerReenvios } from '../src/cli/reenvios.js';

const AGORA = Date.parse('2026-11-10T12:00:00Z');
const DIA = '2026-11-10';
const JID_DO_RECIBO = '5511000000000@s.whatsapp.net';
const ENTRADA = join(import.meta.dirname, 'ajuda', 'ouvinte-de-teste-com-reenvios.ts');

/**
 * Biblioteca falsa que abre a conexao, guarda as opcoes com que o socket foi criado e, se `pedidos > 0`, chama a
 * `getMessage` (o que a biblioteca real faz quando a plataforma pede o reenvio) com identificadores que o Acervo nao
 * tem, e depois diz "deslogado" para o ouvir terminar.
 */
function biblioteca(pedidos: number, opcoesDoSocket: Array<Record<string, unknown>>): unknown {
  const ouvintes = new Map<string, (d: unknown) => void>();
  const ev = (nome: string, dado: unknown): void => ouvintes.get(nome)?.(dado);
  return {
    default: (opcoes: Record<string, unknown>) => {
      opcoesDoSocket.push(opcoes);
      return {
        ev: {
          on: (nome: string, f: (d: unknown) => void) => ouvintes.set(nome, f),
        },
        ws: new EventEmitter(),
        requestPairingCode: () => Promise.resolve('12345678'),
      };
    },
    useMultiFileAuthState: () => Promise.resolve({ state: {}, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401, connectionClosed: 428, connectionLost: 408 },
    disparar: (): void => {
      setImmediate(() => {
        ev('connection.update', { connection: 'open' });
        const pergunta = opcoesDoSocket[0]?.['getMessage'] as
          | ((chave: unknown) => Promise<unknown>)
          | undefined;
        void (async (): Promise<void> => {
          for (let i = 0; i < pedidos; i += 1) {
            await pergunta?.({ remoteJid: JID_DO_RECIBO, id: `REF-QUE-NAO-EXISTE-${i}`, fromMe: true });
          }
          ev('connection.update', {
            connection: 'close',
            lastDisconnect: { error: { output: { statusCode: 401 } } },
          });
        })();
      });
    },
  };
}

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

async function rodar(
  c: { raiz: string; inquilino: string },
  pedidos: number,
): Promise<{ codigo: number; linhas: string[]; opcoesDoSocket: Array<Record<string, unknown>> }> {
  const linhas: string[] = [];
  const opcoesDoSocket: Array<Record<string, unknown>> = [];
  const lib = biblioteca(pedidos, opcoesDoSocket);
  const codigo = await ouvir(
    ['ouvir', '--inquilino', c.inquilino, '--conta', 'conta', '--configuracao', 'teste'],
    {
      dados: c.raiz,
      estado: c.raiz,
      agora: () => AGORA,
      escrever: (t: string) => linhas.push(t),
      carregarBiblioteca: () => {
        (lib as { disparar: () => void }).disparar();
        return Promise.resolve(lib);
      },
    },
  );
  return { codigo, linhas, opcoesDoSocket };
}

test('o ouvir liga o pedido de reenvio: o socket nasce com `getMessage`', async () => {
  const c = cenario();
  try {
    const { opcoesDoSocket } = await rodar(c, 0);
    assert.equal(typeof opcoesDoSocket[0]?.['getMessage'], 'function', 'sem o gancho do ouvir o socket nao responde ao pedido');
  } finally {
    c.limpar();
  }
});

test('sem pedido nenhum: o arquivo existe com `desde` e zero dias, e o log nao tem linha de reenvio', async () => {
  const c = cenario();
  try {
    const { linhas } = await rodar(c, 0);
    const e = lerReenvios(caminhosDaConta(c.raiz, 'conta').reenvios);
    assert.deepEqual(e, { desde: new Date(AGORA).toISOString(), dias: {} }, '"nenhum pedido", e nao `null`');
    assert.ok(!linhas.some((l) => l.includes('reenvio')), linhas.join(' | '));
  } finally {
    c.limpar();
  }
});

test('dois pedidos de uma Mensagem que o malote nao enviou: contam como nao achados, os dois chegam ao arquivo ao parar, e o log nao carrega endereco', async () => {
  const c = cenario();
  try {
    const { codigo, linhas } = await rodar(c, 2);
    assert.equal(codigo, 1);
    const e = lerReenvios(caminhosDaConta(c.raiz, 'conta').reenvios);
    // O relogio do teste e fixo: o segundo pedido cai na janela de 5 s e so chega ao arquivo porque o ouvir PAROU o gravador.
    assert.equal(e?.dias[DIA]?.pedidos, 2);
    assert.equal(e?.dias[DIA]?.naoAchados, 2);
    const doReenvio = linhas.filter((l) => l.startsWith('[ouvinte] pedido de reenvio:'));
    assert.equal(doReenvio.length, 2, linhas.join(' | '));
    for (const l of doReenvio) {
      assert.match(l, /^\[ouvinte\] pedido de reenvio: nao-achada idade=\S+ endereco=(igual|diferente|desconhecido)$/);
    }
    const tudo = linhas.join('\n');
    assert.ok(!tudo.includes('5511000000000'), 'o log nao leva o endereco do recibo');
    assert.ok(!tudo.includes('REF-QUE-NAO-EXISTE'), 'o log nao leva o identificador');
  } finally {
    c.limpar();
  }
});

for (const modo of ['sigterm', 'excecao', 'cedo', 'cedo-excecao'] as const) {
  test(`parar o ouvinte (${modo}) grava o que o estrangulamento segurava`, async () => {
    const c = cenario();
    try {
      const filho = spawn(process.execPath, ['--import', 'tsx', ENTRADA, c.raiz, c.inquilino, modo], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let saida = '';
      const pronto = new Promise<void>((resolver) => {
        filho.stdout.on('data', (d) => {
          saida += d;
          if (saida.includes('PRONTO')) resolver();
        });
      });
      filho.stderr.on('data', (d) => (saida += d));
      const fim = new Promise<number | null>((r) => filho.once('exit', (codigo) => r(codigo)));
      const prazo = setTimeout(() => filho.kill('SIGKILL'), 15_000);
      try {
        // `cedo`: os pedidos e o fim (vinculo invalidado) chegam ANTES de `conectar` devolver, isto e, antes de o poller de
        // Envio existir; so a parada explicita do `aoTerminar` grava o que o estrangulamento segurava.
        if (modo !== 'cedo' && modo !== 'cedo-excecao') await pronto;
        if (modo === 'sigterm') filho.kill('SIGTERM');
        const codigo = await fim;
        assert.equal(codigo, { sigterm: 0, excecao: 70, cedo: 1, 'cedo-excecao': 70 }[modo], saida);
      } finally {
        clearTimeout(prazo);
        filho.kill('SIGKILL');
      }
      const e = lerReenvios(caminhosDaConta(c.raiz, 'conta').reenvios);
      assert.equal(e?.dias[new Date().toISOString().slice(0, 10)]?.pedidos, 2, `os dois pedidos: ${saida}`);
    } finally {
      c.limpar();
    }
  });
}
