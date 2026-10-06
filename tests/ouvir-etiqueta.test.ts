import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { paraDrenar } from './ajuda/drenagem.js';
import { abrirRegistro, criarInquilino, listarInquilinos } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { abrirAcervo, abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { caminhosDaConta, drenar, ouvir } from '../src/cli/ouvir.js';
import { derramar } from '../src/cli/derrame.js';
import { TEL_DE_OUTRO, mudancaDeEtiqueta } from './ajuda/etiqueta-ao-vivo.js';

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

const TEXTO = 'TEXTO-SINTETICO-QUE-NAO-PODE-VAZAR';

test('o texto da etiqueta NAO aparece na saida do ouvinte, que so conta', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const id = criarInquilino(registro, { titularNome: 'Padme' });
    registro.fechar();
    comConfiguracao(raiz, 'teste');
    comVinculo(raiz, 'viva');
    // Cria o Acervo ANTES: abrir para escrita migra, e migrar no meio mediria a partida.
    abrirAcervo(join(raiz, 'acervos'), id).fechar();

    const biblioteca = bibliotecaQueEntrega(
      mudancaDeEtiqueta({ id: 'E1', texto: TEXTO, autorPn: TEL_DE_OUTRO }),
    );
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
    // 1 e o logout que o duble dispara DEPOIS do evento: prova de que a recepcao rodou ate o fim.
    assert.equal(codigo, 1, `nao chegou ao logout — o ouvinte disse: ${linhas.join(' | ')}`);

    const saida = linhas.join('\n');
    assert.equal(saida.includes(TEXTO), false, 'o texto da etiqueta vazou para a saida do ouvinte');
    assert.match(saida, /etiquetas: 1 gravada/);

    const acervo = abrirAcervoSomenteLeitura(join(raiz, 'acervos'), id);
    try {
      const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM etiquetas_de_participacao').get() as { n: number };
      assert.equal(n.n, 1, 'o evento nao chegou ao Acervo pelo caminho real do ouvinte');
    } finally {
      acervo.fechar();
    }
  } finally {
    limpar();
  }
});

test('o evento derramado e gravado UMA vez ao drenar, mesmo reentregue e drenado de novo', async () => {
  const c = await paraDrenar();
  try {
    const e = mudancaDeEtiqueta({ id: 'E1', texto: 'Torre A', autorPn: TEL_DE_OUTRO });
    const ditas: string[] = [];
    derramar(c.caminho, [e]);
    drenar(c.acervo, c.caminho, c.cfg, () => Date.now(), (t: string) => ditas.push(t));
    derramar(c.caminho, [e]); // a reentrega do mesmo evento
    drenar(c.acervo, c.caminho, c.cfg, () => Date.now(), (t: string) => ditas.push(t));
    const n = c.acervo.db.prepare('SELECT COUNT(*) AS n FROM etiquetas_de_participacao').get() as { n: number };
    assert.equal(n.n, 1);
    // Reentrega reconhecida, nao recusada: a drenagem diz `recusados` quando recusa.
    assert.equal(ditas.join('\n').includes('recusados'), false, `a drenagem recusou o evento: ${ditas.join(' | ')}`);
  } finally {
    c.limpar();
  }
});
