// tests/ouvir-pendentes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirAcervo, abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { caminhosDaConta, ouvir } from '../src/cli/ouvir.js';
import { lerDerrame } from '../src/cli/derrame.js';
import { lerEstadoDosPendentes } from '../src/cli/estado-dos-pendentes.js';
import { lerUltimoEvento } from '../src/cli/ultimo-evento.js';

const AGORA = Date.parse('2026-10-23T12:00:00Z');

const mensagem = {
  key: { remoteJid: '5511000000000@s.whatsapp.net', id: 'M1', fromMe: false },
  messageTimestamp: Math.floor((AGORA - 60_000) / 1000),
  message: { conversation: 'oi' },
};

const PREVIEW = {
  tag: 'ib',
  attrs: {},
  content: [
    { tag: 'offline_preview', attrs: { count: '500', message: '40', notification: '460' } },
  ],
};

/**
 * Biblioteca falsa que abre, recebe o anuncio de pendentes, entrega uma Mensagem e o aviso de FIM, e diz
 * "deslogado" para o ouvir terminar. `ev.on` aceita varios ouvintes, como o emissor real; `completa: false`
 * tira o que os Pendentes precisam (enviar no).
 */
function biblioteca(
  completa: boolean,
  opcoes: { repetir?: boolean; quantidade?: number } = {},
): unknown {
  const { repetir = false, quantidade = 1 } = opcoes;
  const mensagens = Array.from({ length: quantidade }, (_, i) =>
    i === 0 ? mensagem : { ...mensagem, key: { ...mensagem.key, id: `G${i}` } },
  );
  const ouvintes = new Map<string, ((d: unknown) => void)[]>();
  const ev = (nome: string, dado: unknown): void => {
    for (const f of ouvintes.get(nome) ?? []) f(dado);
  };
  const ws = new EventEmitter();
  return {
    default: () => ({
      ev: {
        on: (nome: string, f: (d: unknown) => void) =>
          ouvintes.set(nome, [...(ouvintes.get(nome) ?? []), f]),
        isBuffering: () => true,
        flush: () => true,
      },
      ws,
      ...(completa ? { sendNode: () => Promise.resolve() } : {}),
      requestPairingCode: () => Promise.resolve('12345678'),
    }),
    useMultiFileAuthState: () => Promise.resolve({ state: {}, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401, connectionClosed: 428, connectionLost: 408 },
    disparar: (): void => {
      setImmediate(() => {
        ws.emit('CB:ib,,offline_preview', PREVIEW);
        ev('connection.update', { connection: 'open' });
        ws.emit('CB:message', {
          tag: 'message',
          attrs: { id: 'M1', from: '5511000000000@s.whatsapp.net' },
        });
        ev('messages.upsert', { type: 'append', messages: mensagens });
        if (repetir) ev('messages.upsert', { type: 'notify', messages: [mensagem] });
        ev('connection.update', { receivedPendingNotifications: true });
        setImmediate(() =>
          ev('connection.update', {
            connection: 'close',
            lastDisconnect: { error: { output: { statusCode: 401 } } },
          }),
        );
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
  lib: unknown,
): Promise<{ codigo: number; linhas: string[] }> {
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
  return { codigo, linhas };
}

test('o ouvir grava o estado dos Pendentes, loga o anuncio e o resumo, e a Mensagem entra como sempre', async () => {
  const c = cenario();
  try {
    const { codigo, linhas } = await rodar(c, biblioteca(true));
    assert.equal(
      codigo,
      1,
      `o vinculo invalidado do cenario termina o ouvir com 1: ${linhas.join(' | ')}`,
    );
    const caminhos = caminhosDaConta(c.raiz, 'conta');
    const estado = lerEstadoDosPendentes(caminhos.pendentes);
    assert.notEqual(estado, null, 'o estado ficou no arquivo');
    assert.equal(estado!.desfecho, 'fim-natural', 'o fim chegou antes de qualquer pausa');
    assert.equal(estado!.socketCriadoEm, AGORA, 'o recolhimento usa o relogio do ouvir');
    assert.equal(estado!.anunciados?.total, 500);
    assert.equal(estado!.recebidos.mensagens, 1);
    assert.equal(estado!.pedidos, 0);
    assert.ok(
      linhas.some(
        (l) =>
          l ===
          '[ouvinte] pendentes anunciados: 500 (mensagens 40, recibos 0, notificacoes 460, status 0, chamadas 0, outros 0)',
      ),
    );
    assert.ok(
      linhas.some((l) =>
        /^\[ouvinte\] pendentes: desfecho=fim-natural conexao=\d+ anunciados=500 /.test(l),
      ),
    );
    assert.notEqual(
      lerUltimoEvento(caminhos.ultimoEvento),
      null,
      'a Mensagem foi gravada: o ultimo evento avancou',
    );
    const todas = linhas.join('\n');
    assert.ok(!todas.includes('5511000000000'), 'nenhum JID no registro');
  } finally {
    c.limpar();
  }
});

test('biblioteca SEM a superficie dos Pendentes: o ouvir funciona e nao deixa estado nem linha', async () => {
  const c = cenario();
  try {
    const { codigo, linhas } = await rodar(c, biblioteca(false));
    assert.equal(codigo, 1);
    const caminhos = caminhosDaConta(c.raiz, 'conta');
    assert.equal(existsSync(caminhos.pendentes), false);
    assert.ok(!linhas.some((l) => l.includes('pendentes')));
    assert.notEqual(lerUltimoEvento(caminhos.ultimoEvento), null, 'a recepcao segue');
  } finally {
    c.limpar();
  }
});

test('escrita do estado FALHANDO nao custa Mensagem: a do mesmo evento e gravada, com um unico aviso', async () => {
  const c = cenario();
  try {
    const caminhos = caminhosDaConta(c.raiz, 'conta');
    // O estado vira DIRETORIO: o temporario grava e a troca por cima de um diretorio falha (EISDIR). Mais robusto
    // que `chmod`, que o root ignora na CI.
    mkdirSync(caminhos.pendentes);
    const { codigo, linhas } = await rodar(c, biblioteca(true));
    assert.equal(codigo, 1, linhas.join(' | '));
    assert.equal(
      linhas.filter((l) => l.includes('estado dos pendentes: falha ao gravar')).length,
      1,
    );
    assert.notEqual(
      lerUltimoEvento(caminhos.ultimoEvento),
      null,
      'a Mensagem foi gravada assim mesmo',
    );
  } finally {
    c.limpar();
  }
});

test('liberar duas vezes a mesma Mensagem nao a duplica no Acervo', async () => {
  const c = cenario();
  try {
    const { codigo, linhas } = await rodar(c, biblioteca(true, { repetir: true }));
    assert.equal(codigo, 1, linhas.join(' | '));
    const acervo = abrirAcervoSomenteLeitura(join(c.raiz, 'acervos'), c.inquilino);
    try {
      const gravadas = acervo
        .preparar('SELECT COUNT(*) AS n FROM mensagens WHERE id_externo = ?')
        .get('M1') as {
        n: number;
      };
      const eventos = acervo
        .preparar("SELECT COUNT(*) AS n FROM operacoes WHERE natureza = 'receber-ao-vivo'")
        .get() as { n: number };
      assert.equal(eventos.n, 2, 'os dois eventos foram processados (uma Operacao por evento)');
      assert.equal(gravadas.n, 1, 'a mesma Mensagem entregue duas vezes foi gravada uma vez');
    } finally {
      acervo.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('um recolhimento grande com o Acervo OCUPADO: o Derrame absorve todos os eventos e o ouvir segue', async () => {
  const c = cenario();
  const Database = (await import('better-sqlite3')).default;
  let travador: InstanceType<typeof Database> | undefined;
  try {
    // O Acervo nasce ANTES da trava: abrir para escrita migra, e migrar com a base travada mediria outra coisa.
    abrirAcervo(join(c.raiz, 'acervos'), c.inquilino).fechar();
    const lib = biblioteca(true, { quantidade: 2_000 });
    const linhas: string[] = [];
    const codigo = await ouvir(
      ['ouvir', '--inquilino', c.inquilino, '--conta', 'conta', '--configuracao', 'teste'],
      {
        dados: c.raiz,
        estado: c.raiz,
        agora: () => AGORA,
        escrever: (t: string) => linhas.push(t),
        carregarBiblioteca: () => {
          travador = new Database(join(c.raiz, 'acervos', `${c.inquilino}.db`));
          travador.pragma('journal_mode = WAL');
          travador.prepare('BEGIN IMMEDIATE').run();
          (lib as { disparar: () => void }).disparar();
          return Promise.resolve(lib);
        },
      },
    );
    assert.equal(codigo, 1, `o ouvinte nao chegou a processar o logout: ${linhas.join(' | ')}`);
    const caminhos = caminhosDaConta(c.raiz, 'conta');
    const guardados = lerDerrame(caminhos.derrame).reduce(
      (n, lote) => n + (lote as unknown[]).length,
      0,
    );
    assert.equal(guardados, 2_000, 'o Derrame guardou todos os eventos liberados de uma vez');
    assert.notEqual(
      lerEstadoDosPendentes(caminhos.pendentes),
      null,
      'e o estado dos Pendentes ficou gravado',
    );
  } finally {
    travador?.close();
    c.limpar();
  }
});
