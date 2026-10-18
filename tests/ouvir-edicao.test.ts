import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino, listarInquilinos } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { abrirAcervo, abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { caminhosDaConta, ouvir } from '../src/cli/ouvir.js';
import { cifrarEdicao, segredoSintetico } from './ajuda/edicao-cifrada.js';

/**
 * Biblioteca falsa que ENTREGA UM LOTE e depois desloga. Leva um `proto` que le de volta o JSON que o teste cifrou, no
 * lugar do protobuf: o ouvinte tem de pedir o decodificador ao portao e entrega-lo ao `receberEvento`.
 */
function bibliotecaQueEntrega(mensagens: unknown[]): { disparar: () => void } {
  const ouvintes = new Map<string, (dado: unknown) => void>();
  return {
    default: () => ({
      ev: { on: (fluxo: string, f: (dado: unknown) => void) => ouvintes.set(fluxo, f) },
      requestPairingCode: () => Promise.resolve('12345678'),
    }),
    useMultiFileAuthState: () => Promise.resolve({ state: {}, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401 },
    proto: {
      Message: {
        decode: (bytes: Uint8Array) => JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown,
        toObject: (m: unknown) => m as Record<string, unknown>,
      },
    },
    disparar: (): void => {
      setImmediate(() => {
        ouvintes.get('messages.upsert')?.({ type: 'notify', messages: mensagens });
        setImmediate(() =>
          ouvintes.get('connection.update')?.({
            connection: 'close',
            lastDisconnect: { error: { output: { statusCode: 401 } } },
          }),
        );
      });
    },
  } as unknown as { disparar: () => void };
}

function comConfiguracao(raiz: string, apelido: string): void {
  const registro = abrirRegistro(raiz);
  try {
    const id = listarInquilinos(registro)[0]?.id;
    if (id === undefined) throw new Error('cenario sem Inquilino');
    resolverConfiguracao(registro, id, 'whatsapp', apelido);
  } finally {
    registro.fechar();
  }
}

function comVinculo(raiz: string, conta: string): void {
  const caminhos = caminhosDaConta(raiz, conta);
  mkdirSync(caminhos.vinculo, { recursive: true });
  writeFileSync(join(caminhos.vinculo, 'creds.json'), '{}');
}

const GRUPO = '120363000000000001@g.us';
const AUTOR = '5511000000009@lid';
const TEXTO_NOVO = 'TEXTO-SINTETICO-DA-EDICAO-QUE-NAO-PODE-VAZAR';

test('o ouvinte entrega o decodificador do portao: a edicao cifrada chega ao Acervo, e a saida so conta', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const id = criarInquilino(registro, { titularNome: 'Padme' });
    registro.fechar();
    comConfiguracao(raiz, 'teste');
    comVinculo(raiz, 'viva');
    abrirAcervo(join(raiz, 'acervos'), id).fechar();

    const agora = Date.now();
    const segredo = segredoSintetico();
    const claro = {
      protocolMessage: {
        type: 'MESSAGE_EDIT',
        key: { id: 'ORIG-1' },
        editedMessage: { conversation: TEXTO_NOVO },
        timestampMs: agora - 1_000,
      },
    };
    const { encIv, encPayload } = cifrarEdicao({ segredo, idOriginal: 'ORIG-1', editor: AUTOR, claro });
    const biblioteca = bibliotecaQueEntrega([
      {
        key: { remoteJid: GRUPO, id: 'ORIG-1', fromMe: false, participant: AUTOR },
        messageTimestamp: Math.floor((agora - 60_000) / 1000),
        message: { conversation: 'texto original', messageContextInfo: { messageSecret: segredo.toString('base64') } },
      },
      {
        key: { remoteJid: GRUPO, id: 'EV-1', fromMe: false, participant: AUTOR },
        messageTimestamp: Math.floor((agora - 1_000) / 1000),
        message: {
          secretEncryptedMessage: {
            targetMessageKey: { remoteJid: GRUPO, fromMe: false, id: 'ORIG-1' },
            encPayload,
            encIv,
            secretEncType: 'MESSAGE_EDIT',
          },
        },
      },
    ]);
    const linhas: string[] = [];
    const codigo = await ouvir(['ouvir', '--inquilino', id, '--conta', 'viva', '--configuracao', 'teste'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => linhas.push(t),
      carregarBiblioteca: () => {
        setImmediate(() => biblioteca.disparar());
        return Promise.resolve(biblioteca as never);
      },
    });
    assert.equal(codigo, 1, `nao chegou ao logout — o ouvinte disse: ${linhas.join(' | ')}`);

    const saida = linhas.join('\n');
    assert.equal(saida.includes(TEXTO_NOVO), false, 'o texto da edicao vazou para a saida do ouvinte');
    assert.match(saida, /edicoes: 1 gravada\(s\)/);
    assert.equal(saida.includes('decodificador de edicao indisponivel'), false);

    const acervo = abrirAcervoSomenteLeitura(join(raiz, 'acervos'), id);
    try {
      const linhasDeEdicao = acervo.db.prepare('SELECT texto, origem FROM edicoes').all() as { texto: string; origem: string }[];
      assert.deepEqual(linhasDeEdicao, [{ texto: TEXTO_NOVO, origem: 'cifrada' }]);
      assert.equal((acervo.db.prepare('SELECT COUNT(*) AS n FROM mensagens').get() as { n: number }).n, 1);
    } finally {
      acervo.fechar();
    }
  } finally {
    limpar();
  }
});

test('sem a biblioteca entregar o protobuf, o ouvinte segue de pe, diz que o decodificador falta e guarda a edicao', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const id = criarInquilino(registro, { titularNome: 'Padme' });
    registro.fechar();
    comConfiguracao(raiz, 'teste');
    comVinculo(raiz, 'viva');
    abrirAcervo(join(raiz, 'acervos'), id).fechar();

    const agora = Date.now();
    const segredo = segredoSintetico();
    const { encIv, encPayload } = cifrarEdicao({
      segredo,
      idOriginal: 'ORIG-1',
      editor: AUTOR,
      claro: { protocolMessage: { type: 'MESSAGE_EDIT', key: { id: 'ORIG-1' }, editedMessage: { conversation: 'x' }, timestampMs: agora - 1_000 } },
    });
    const biblioteca = bibliotecaQueEntrega([
      {
        key: { remoteJid: GRUPO, id: 'ORIG-1', fromMe: false, participant: AUTOR },
        messageTimestamp: Math.floor((agora - 60_000) / 1000),
        message: { conversation: 'texto original', messageContextInfo: { messageSecret: segredo.toString('base64') } },
      },
      {
        key: { remoteJid: GRUPO, id: 'EV-1', fromMe: false, participant: AUTOR },
        messageTimestamp: Math.floor((agora - 1_000) / 1000),
        message: {
          secretEncryptedMessage: {
            targetMessageKey: { remoteJid: GRUPO, fromMe: false, id: 'ORIG-1' },
            encPayload,
            encIv,
            secretEncType: 'MESSAGE_EDIT',
          },
        },
      },
    ]) as unknown as Record<string, unknown> & { disparar: () => void };
    delete biblioteca['proto'];
    const linhas: string[] = [];
    const codigo = await ouvir(['ouvir', '--inquilino', id, '--conta', 'viva', '--configuracao', 'teste'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => linhas.push(t),
      carregarBiblioteca: () => {
        setImmediate(() => biblioteca.disparar());
        return Promise.resolve(biblioteca as never);
      },
    });
    assert.equal(codigo, 1, `o ouvinte nao chegou ao logout — disse: ${linhas.join(' | ')}`);
    const saida = linhas.join('\n');
    assert.match(saida, /decodificador de edicao indisponivel/);
    assert.match(saida, /edicoes nao gravadas: sem-decodificador=1/);

    const acervo = abrirAcervoSomenteLeitura(join(raiz, 'acervos'), id);
    try {
      assert.equal((acervo.db.prepare('SELECT COUNT(*) AS n FROM edicoes').get() as { n: number }).n, 0);
    } finally {
      acervo.fechar();
    }
  } finally {
    limpar();
  }
});
