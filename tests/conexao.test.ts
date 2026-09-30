import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conectar, baixarMidiaReconstituida, type MidiaAoVivo } from '../src/adaptadores/whatsapp/conexao.js';

/**
 * A #1068: o modulo de conexao e o UNICO autorizado a falar com a biblioteca,
 * e e ele que precisa baixar os bytes do Anexo usando a mensagem CRUA — o
 * `aoReceber` recebe a mensagem depois do round-trip de JSON que a
 * normaliza, e esse round-trip transforma `mediaKey` (um Uint8Array de
 * verdade) num objeto `{type:'Buffer',data:[...]}` que o decrypt da
 * biblioteca nao consegue usar.
 *
 * Este teste mede exatamente essa fronteira: se alguem "simplificar" e
 * chamar `downloadMediaMessage` com a mensagem NORMALIZADA em vez da crua,
 * `mediaKey` deixa de ser `Uint8Array` e o mutante deveria morrer aqui.
 */

function bibliotecaComDownload(
  aoBaixar: (mensagem: unknown) => void,
): { disparar: () => void } {
  const ouvintes = new Map<string, (dado: unknown) => void>();
  return {
    default: () => ({
      ev: { on: (fluxo: string, f: (dado: unknown) => void) => ouvintes.set(fluxo, f) },
      requestPairingCode: () => Promise.resolve('12345678'),
      updateMediaMessage: (m: unknown) => Promise.resolve(m),
    }),
    useMultiFileAuthState: () => Promise.resolve({ state: {}, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401 },
    downloadMediaMessage: (mensagem: unknown) => {
      aoBaixar(mensagem);
      return Promise.resolve(Buffer.from('bytes-decifrados'));
    },
    disparar: (): void => {
      setImmediate(() =>
        ouvintes.get('messages.upsert')?.({
          type: 'notify',
          messages: [
            {
              key: { remoteJid: '5511000000009@s.whatsapp.net', id: 'MIDIA1', fromMe: false },
              messageTimestamp: 1_700_000_000,
              message: {
                imageMessage: {
                  mimetype: 'image/jpeg',
                  // O mediaKey REAL e binario. E o que este teste protege:
                  // ele tem de chegar assim em downloadMediaMessage, nao como
                  // {type:'Buffer',data:[...]} (a forma pos round-trip).
                  mediaKey: new Uint8Array([1, 2, 3, 4]),
                  directPath: '/v/t62.0-24/sintetico',
                },
              },
            },
          ],
        }),
      );
    },
  } as unknown as { disparar: () => void };
}

test('midia.baixar chama downloadMediaMessage com a mensagem CRUA, mediaKey binario', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-conexao-teste-'));
  try {
    let mensagemRecebida: unknown;
    let midiaCapturada: MidiaAoVivo | undefined;
    const biblioteca = bibliotecaComDownload((m) => {
      mensagemRecebida = m;
    });

    await conectar({
      pastaDoVinculo: pasta,
      registrar: () => undefined,
      aoTerminar: () => undefined,
      carregarBiblioteca: () => {
        biblioteca.disparar();
        return Promise.resolve(biblioteca);
      },
      aoReceber: (_mensagens, midia) => {
        midiaCapturada = midia;
      },
    });

    // O disparo interno de `disparar()` e `setImmediate`; espera um tique
    // para o evento ter corrido.
    await new Promise((r) => setImmediate(r));

    assert.ok(midiaCapturada !== undefined, 'aoReceber nao foi chamado');
    const bytes = await midiaCapturada?.baixar(0);
    assert.equal(bytes?.toString(), 'bytes-decifrados');

    const msg = mensagemRecebida as { message: { imageMessage: { mediaKey: unknown } } };
    assert.ok(
      msg.message.imageMessage.mediaKey instanceof Uint8Array,
      'mediaKey chegou normalizado (perdeu o tipo binario) em vez de cru',
    );
    assert.deepEqual([...(msg.message.imageMessage.mediaKey as Uint8Array)], [1, 2, 3, 4]);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('midia.baixar com indice invalido rejeita, sem tocar a biblioteca', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-conexao-teste-'));
  try {
    let midiaCapturada: MidiaAoVivo | undefined;
    let chamouDownload = false;
    const biblioteca = bibliotecaComDownload(() => {
      chamouDownload = true;
    });

    await conectar({
      pastaDoVinculo: pasta,
      registrar: () => undefined,
      aoTerminar: () => undefined,
      carregarBiblioteca: () => {
        biblioteca.disparar();
        return Promise.resolve(biblioteca);
      },
      aoReceber: (_mensagens, midia) => {
        midiaCapturada = midia;
      },
    });
    await new Promise((r) => setImmediate(r));

    assert.ok(midiaCapturada !== undefined, 'aoReceber nao foi chamado');
    await assert.rejects(() => midiaCapturada?.baixar(99) as Promise<Buffer>);
    assert.equal(chamouDownload, false);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('baixarMidiaReconstituida (#1084) chama downloadMediaMessage SEM precisar de socket vivo', async () => {
  let mensagemRecebida: unknown;
  const mensagemReconstruida = {
    key: { remoteJid: '5511000000001@s.whatsapp.net', id: 'M1', fromMe: false },
    message: { videoMessage: { mediaKey: Buffer.from([1, 2, 3]), directPath: '/x' } },
  };
  const biblioteca = {
    downloadMediaMessage: (mensagem: unknown) => {
      mensagemRecebida = mensagem;
      return Promise.resolve(Buffer.from('bytes-recuperados'));
    },
  };

  const bytes = await baixarMidiaReconstituida(mensagemReconstruida, {
    carregarBiblioteca: () => Promise.resolve(biblioteca),
  });

  assert.equal(bytes.toString(), 'bytes-recuperados');
  assert.equal(mensagemRecebida, mensagemReconstruida, 'a MESMA mensagem chega a biblioteca, sem copia');
});

test('baixarMidiaReconstituida propaga a falha da biblioteca, sem mascarar', async () => {
  const biblioteca = {
    downloadMediaMessage: () => Promise.reject(new Error('bad decrypt')),
  };

  await assert.rejects(
    () => baixarMidiaReconstituida({}, { carregarBiblioteca: () => Promise.resolve(biblioteca) }),
    /bad decrypt/,
  );
});
