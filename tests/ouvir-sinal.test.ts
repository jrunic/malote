// tests/ouvir-sinal.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { caminhosDaConta, ouvir } from '../src/cli/ouvir.js';
import { lerSinalDaConexao } from '../src/cli/sinal-da-conexao.js';
import { lerUltimoEvento } from '../src/cli/ultimo-evento.js';

const AGORA = Date.parse('2026-10-12T12:00:00Z');

function mensagem(id: string): unknown {
  return {
    key: { remoteJid: '5511000000000@s.whatsapp.net', id, fromMe: false },
    messageTimestamp: Math.floor((AGORA - 60_000) / 1000),
    message: { conversation: 'oi' },
  };
}

/** Biblioteca falsa: abre, o transporte recebe `n` frames, entrega as Mensagens e diz "deslogado" para o ouvir terminar. */
function biblioteca(frames: number, mensagens: unknown[] = []): { lib: unknown } {
  const ev = new Map<string, (d: unknown) => void>();
  const ws = new EventEmitter();
  const lib = {
    default: () => ({
      ev: { on: (f: string, fn: (d: unknown) => void) => ev.set(f, fn) },
      ws,
      requestPairingCode: () => Promise.resolve('12345678'),
    }),
    useMultiFileAuthState: () => Promise.resolve({ state: {}, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401, connectionClosed: 428, connectionLost: 408 },
    disparar: (): void => {
      setImmediate(() => {
        ev.get('connection.update')?.({ connection: 'open' });
        for (let i = 0; i < frames; i += 1) ws.emit('frame', { tag: 'iq' });
        if (mensagens.length > 0) ev.get('messages.upsert')?.({ type: 'notify', messages: mensagens });
        setImmediate(() =>
          ev.get('connection.update')?.({
            connection: 'close',
            lastDisconnect: { error: { output: { statusCode: 401 } } },
          }),
        );
      });
    },
  };
  return { lib };
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

test('o ouvir grava o sinal quando o transporte recebe frames, sem tocar no ultimo-evento', async () => {
  const c = cenario();
  try {
    const { lib } = biblioteca(5);
    const antes = Date.now();
    const codigo = await ouvir(
      ['ouvir', '--inquilino', c.inquilino, '--conta', 'conta', '--configuracao', 'teste'],
      {
        dados: c.raiz,
        estado: c.raiz,
        escrever: () => undefined,
        carregarBiblioteca: () => {
          (lib as { disparar: () => void }).disparar();
          return Promise.resolve(lib);
        },
      },
    );
    const depois = Date.now();
    assert.equal(codigo, 1, 'o vinculo invalidado do cenario termina o ouvir com 1');

    const caminhos = caminhosDaConta(c.raiz, 'conta');
    const sinal = lerSinalDaConexao(caminhos.sinal);
    assert.notEqual(sinal, null, 'frames recebidos deixam o sinal');
    assert.ok(sinal! >= antes && sinal! <= depois, 'o instante e o do relogio do processo');
    assert.equal(lerUltimoEvento(caminhos.ultimoEvento), null, 'frame nao e evento: o ultimo-evento nao e tocado');
  } finally {
    c.limpar();
  }
});

test('escrita do sinal FALHANDO nao custa Mensagem: a do mesmo lote e gravada, com um unico aviso', async () => {
  const c = cenario();
  try {
    const caminhos = caminhosDaConta(c.raiz, 'conta');
    // O sinal vira DIRETORIO: o temporario (`.parcial`) grava, e a troca por cima de um diretorio falha
    // (EISDIR). Mais robusto que `chmod`, que o root ignora na CI.
    mkdirSync(caminhos.sinal);
    const { lib } = biblioteca(5, [mensagem('M1')]);
    const linhas: string[] = [];
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
    assert.equal(codigo, 1, `o ouvir nao chegou ao logout: ${linhas.join(' | ')}`);

    const avisos = linhas.filter((l) => l.includes('sinal da conexao: falha'));
    assert.equal(avisos.length, 1, `esperava UM aviso, vieram: ${avisos.join(' | ')}`);

    const acervo = abrirAcervo(join(c.raiz, 'acervos'), c.inquilino);
    try {
      const n = (acervo.db.prepare('SELECT COUNT(*) AS n FROM mensagens').get() as { n: number }).n;
      assert.equal(n, 1, 'a Mensagem do mesmo lote foi gravada apesar da falha do sinal');
    } finally {
      acervo.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('sem frame nenhum, o ouvir nao deixa sinal', async () => {
  const c = cenario();
  try {
    const { lib } = biblioteca(0);
    await ouvir(['ouvir', '--inquilino', c.inquilino, '--conta', 'conta', '--configuracao', 'teste'], {
      dados: c.raiz,
      estado: c.raiz,
      escrever: () => undefined,
      carregarBiblioteca: () => {
        (lib as { disparar: () => void }).disparar();
        return Promise.resolve(lib);
      },
    });
    assert.equal(lerSinalDaConexao(caminhosDaConta(c.raiz, 'conta').sinal), null);
  } finally {
    c.limpar();
  }
});
