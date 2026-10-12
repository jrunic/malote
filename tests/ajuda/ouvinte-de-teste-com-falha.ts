import { ouvir } from '../../src/cli/ouvir.js';
import { encerrar } from '../../src/cli/encerrar.js';

/**
 * Um `malote ouvir` de TESTE em PROCESSO SEPARADO, com biblioteca falsa que abre a conexao e
 * depois provoca a falha pedida. O que se mede e o codigo com que o PROCESSO sai, que e o que o
 * supervisor le: rejeicao dentro do mesmo processo do teste seria vista pelo proprio executor de
 * testes, e nao provaria o codigo.
 *
 * Uso: node --import tsx tests/ajuda/ouvinte-de-teste-com-falha.ts <dados> <inquilino> <modo>
 *   modo: rejeicao | excecao | vinculo | rotina
 */
const [dados, inquilino, modo] = process.argv.slice(2) as [string, string, string];

const ouvintes = new Map<string, (dado: unknown) => void>();
const emitir = (fluxo: string, dado: unknown): void => ouvintes.get(fluxo)?.(dado);

const biblioteca = {
  default: () => ({
    ev: { on: (fluxo: string, f: (dado: unknown) => void) => ouvintes.set(fluxo, f) },
    requestPairingCode: () => Promise.resolve('12345678'),
  }),
  useMultiFileAuthState: () => Promise.resolve({ state: {}, saveCreds: () => undefined }),
  DisconnectReason: { loggedOut: 401, connectionClosed: 428, connectionLost: 408 },
};

function falhar(): void {
  emitir('connection.update', { connection: 'open' });
  setTimeout(() => {
    if (modo === 'rejeicao') {
      // O caso de 30/09/2026: a biblioteca rejeita uma promessa que ninguem espera (sendRetryRequest
      // sobre socket ja fechado, Boom 428).
      void Promise.reject(Object.assign(new Error('Connection Closed'), { output: { statusCode: 428 } }));
    } else if (modo === 'excecao') {
      throw new Error('falha sintetica fora de qualquer try');
    } else if (modo === 'vinculo') {
      emitir('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 401 } } },
      });
    } else if (modo === 'rotina') {
      emitir('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 428 } } },
      });
    }
  }, 50);
}

void ouvir(['ouvir', '--inquilino', inquilino, '--conta', 'conta', '--configuracao', 'teste'], {
  dados,
  estado: dados,
  escrever: (t: string) => process.stdout.write(`${t}\n`),
  carregarBiblioteca: () => {
    setImmediate(falhar);
    return Promise.resolve(biblioteca);
  },
}).then(encerrar);
