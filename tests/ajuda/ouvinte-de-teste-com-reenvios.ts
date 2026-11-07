import { EventEmitter } from 'node:events';
import { ouvir } from '../../src/cli/ouvir.js';
import { encerrar } from '../../src/cli/encerrar.js';

/**
 * Um `malote ouvir` de TESTE em PROCESSO SEPARADO, com biblioteca falsa que abre a conexao, recebe dois pedidos de
 * reenvio (a `getMessage` do socket) e avisa "PRONTO". Depois fica vivo: `sigterm` espera o teste mandar o sinal;
 * `excecao` provoca uma excecao nao tratada. O que se mede e o que fica no arquivo do contador depois da saida.
 *
 * Uso: node --import tsx tests/ajuda/ouvinte-de-teste-com-reenvios.ts <dados> <inquilino> <modo>
 *   modo: sigterm | excecao | cedo | cedo-excecao
 *   `cedo`: os dois pedidos e o fim por vinculo invalidado chegam de dentro de `conectar`, antes de ele devolver.
 *   `cedo-excecao`: o mesmo, mas em vez do fim chega uma excecao nao tratada (o poller de Envio ainda nao existe).
 */
const [dados, inquilino, modo] = process.argv.slice(2) as [string, string, string];

const ouvintes = new Map<string, (dado: unknown) => void>();
let opcoesDoSocket: Record<string, unknown> | undefined;

const biblioteca = {
  default: (opcoes: Record<string, unknown>) => {
    opcoesDoSocket = opcoes;
    return {
      ev: {
        on: (fluxo: string, f: (dado: unknown) => void) => {
          ouvintes.set(fluxo, f);
          if ((modo === 'cedo' || modo === 'cedo-excecao') && fluxo === 'connection.update') {
            queueMicrotask(() => {
              const pergunta = opcoesDoSocket?.['getMessage'] as ((chave: unknown) => Promise<unknown>) | undefined;
              for (const i of [0, 1]) {
                void pergunta?.({ remoteJid: '5511000000000@s.whatsapp.net', id: `REF-${i}`, fromMe: true });
              }
              // Lancada de dentro da microtarefa: o tratador roda antes de `conectar` devolver.
              if (modo === 'cedo-excecao') throw new Error('falha sintetica fora de qualquer try');
              f({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
            });
          }
        },
      },
      ws: new EventEmitter(),
      requestPairingCode: () => Promise.resolve('12345678'),
    };
  },
  useMultiFileAuthState: () => Promise.resolve({ state: {}, saveCreds: () => undefined }),
  DisconnectReason: { loggedOut: 401, connectionClosed: 428, connectionLost: 408 },
};

async function pedir(): Promise<void> {
  ouvintes.get('connection.update')?.({ connection: 'open' });
  const pergunta = opcoesDoSocket?.['getMessage'] as ((chave: unknown) => Promise<unknown>) | undefined;
  for (const i of [0, 1]) {
    await pergunta?.({ remoteJid: '5511000000000@s.whatsapp.net', id: `REF-${i}`, fromMe: true });
  }
  process.stdout.write('PRONTO\n');
  // Mantem o processo vivo ate o sinal (ou a excecao).
  setInterval(() => undefined, 1_000);
  if (modo === 'excecao') setTimeout(() => { throw new Error('falha sintetica fora de qualquer try'); }, 50);
}

void ouvir(['ouvir', '--inquilino', inquilino, '--conta', 'conta', '--configuracao', 'teste'], {
  dados,
  estado: dados,
  escrever: (t: string) => process.stdout.write(`${t}\n`),
  carregarBiblioteca: () => {
    if (modo !== 'cedo' && modo !== 'cedo-excecao') setImmediate(() => void pedir());
    return Promise.resolve(biblioteca);
  },
}).then(encerrar);
