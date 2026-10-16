import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { abrirAcervo, abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { caminhosDaConta, ouvir } from '../src/cli/ouvir.js';
import { executar } from '../src/cli/index.js';

// #1204 pelo caminho REAL do ouvinte: a Mensagem 2 s a frente do relogio entra, o log conta (so numero), e
// `ouvinte estado --json` expoe a serie. A saida DEFAULT de `ouvinte estado` e contrato com a frota e nao muda.

function bibliotecaQueEntrega(mensagem: unknown): unknown {
  const ouvintes = new Map<string, (dado: unknown) => void>();
  return {
    default: () => ({
      ev: { on: (fluxo: string, f: (dado: unknown) => void) => ouvintes.set(fluxo, f) },
      requestPairingCode: () => Promise.resolve('12345678'),
    }),
    useMultiFileAuthState: () => Promise.resolve({ state: {}, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401 },
    disparar: (): void => {
      setImmediate(() => {
        ouvintes.get('messages.upsert')?.({ type: 'notify', messages: [mensagem] });
        setImmediate(() =>
          ouvintes.get('connection.update')?.({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } }),
        );
      });
    },
  };
}

test('a Mensagem 2 s a frente do relogio entra pelo ouvinte, o log conta e o --json expoe a serie', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const id = criarInquilino(registro, { titularNome: 'Padme' });
    resolverConfiguracao(registro, id, 'whatsapp', 'teste');
    registro.fechar();
    const caminhos = caminhosDaConta(raiz, 'viva');
    mkdirSync(caminhos.vinculo, { recursive: true });
    writeFileSync(join(caminhos.vinculo, 'creds.json'), '{}');
    abrirAcervo(join(raiz, 'acervos'), id).fechar();

    // O relogio do ouvinte e INJETADO: com `Date.now()` o teste dependeria de a recepcao chegar em menos de 2 s, e de
    // nao virar o dia UTC no meio.
    const AGORA = Date.parse('2026-10-16T12:00:00.000Z');
    const hoje = '2026-10-16';
    const mensagem = {
      key: { remoteJid: '5511900000001@s.whatsapp.net', id: 'A1', fromMe: false },
      messageTimestamp: AGORA / 1000 + 2,
      message: { conversation: 'oi' },
    };
    const biblioteca = bibliotecaQueEntrega(mensagem) as { disparar: () => void };
    const linhas: string[] = [];
    const codigo = await ouvir(['ouvir', '--inquilino', id, '--conta', 'viva', '--configuracao', 'teste'], {
      dados: raiz,
      estado: raiz,
      agora: () => AGORA,
      escrever: (t: string) => linhas.push(t),
      carregarBiblioteca: () => {
        setImmediate(() => biblioteca.disparar());
        return Promise.resolve(biblioteca as never);
      },
    });
    assert.equal(codigo, 1, `nao chegou ao logout — o ouvinte disse: ${linhas.join(' | ')}`);
    assert.match(linhas.join('\n'), /mensagens aceitas pela tolerancia de relogio: 1/);

    const acervo = abrirAcervoSomenteLeitura(join(raiz, 'acervos'), id);
    try {
      assert.equal((acervo.db.prepare('SELECT COUNT(*) AS n FROM mensagens').get() as { n: number }).n, 1);
    } finally {
      acervo.fechar();
    }

    const saida: string[] = [];
    executar(['ouvinte', 'estado', '--conta', 'viva', '--json'], { dados: raiz, estado: raiz, escrever: (t: string) => saida.push(t) });
    const estado = JSON.parse(saida.join('')) as { instantesAdiantados?: Record<string, Record<string, number>> };
    assert.deepEqual(estado.instantesAdiantados, { [hoje]: { mensagens: 1 } });
  } finally {
    limpar();
  }
});
