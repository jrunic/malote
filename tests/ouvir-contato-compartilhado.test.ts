import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino, listarInquilinos } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { abrirAcervo, abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { caminhosDaConta, ouvir } from '../src/cli/ouvir.js';

/** Biblioteca falsa que ENTREGA UMA MENSAGEM e depois desloga (copia de tests/ouvir.test.ts). */
function bibliotecaQueEntrega(mensagem: unknown): { disparar: () => void } {
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

const NOME = 'NOME-SINTETICO-QUE-NAO-PODE-VAZAR';
const NUMERO = '5565988887777';

test('o cartao NAO aparece na saida do ouvinte, que so conta, e chega ao Acervo pelo caminho real', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const id = criarInquilino(registro, { titularNome: 'Padme' });
    registro.fechar();
    comConfiguracao(raiz, 'teste');
    comVinculo(raiz, 'viva');
    abrirAcervo(join(raiz, 'acervos'), id).fechar();

    const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${NOME}\nTEL;waid=${NUMERO}:+${NUMERO}\nEND:VCARD`;
    const biblioteca = bibliotecaQueEntrega({
      key: { remoteJid: '5565911110002@s.whatsapp.net', id: 'C1', fromMe: false },
      messageTimestamp: Math.floor(Date.parse('2026-10-01T10:00:00Z') / 1000),
      message: { contactMessage: { displayName: NOME, vcard } },
    });
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
    assert.equal(saida.includes(NOME), false, 'o nome do cartao vazou para a saida do ouvinte');
    assert.equal(saida.includes(NUMERO), false, 'o telefone do cartao vazou para a saida do ouvinte');
    assert.match(saida, /contatos compartilhados: 1 gravado/);

    const acervo = abrirAcervoSomenteLeitura(join(raiz, 'acervos'), id);
    try {
      const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM contatos_compartilhados').get() as { n: number };
      assert.equal(n.n, 1, 'o cartao nao chegou ao Acervo pelo caminho real do ouvinte');
    } finally {
      acervo.fechar();
    }
  } finally {
    limpar();
  }
});
