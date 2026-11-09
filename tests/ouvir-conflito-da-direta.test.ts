import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { paraDrenar } from './ajuda/drenagem.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { abrirAcervo, abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { caminhosDaConta, drenar, ouvir } from '../src/cli/ouvir.js';
import { derramar } from '../src/cli/derrame.js';

/**
 * O conflito do par da Conversa direta (#1439, criterio 3) vira UMA linha no registro do ouvinte, so com a contagem: sem
 * endereco, nome nem texto. E o que deixa o campo contar conflitos, que a recepcao mantem fora da trilha.
 */

const OPACO = '200000000000001@lid';
const FIXO = '556533334444@s.whatsapp.net';
const DE_OUTRO_PAIS = '14155550100@s.whatsapp.net';
const NOME = 'NOME-SINTETICO-QUE-NAO-PODE-VAZAR';
const TEXTO = 'TEXTO-SINTETICO-QUE-NAO-PODE-VAZAR';
const LINHA = '[ouvinte] correspondencia em conflito (direta): 1';

/** Dois eventos do MESMO opaco com numeros diferentes: o primeiro ensina o par, o segundo e conflito. */
function loteEmConflito(agora: number): unknown[] {
  return [FIXO, DE_OUTRO_PAIS].map((senderPn, i) => ({
    key: { remoteJid: OPACO, id: `M${String(i)}`, fromMe: false, senderPn },
    messageTimestamp: Math.floor((agora - 60_000) / 1000),
    pushName: NOME,
    message: { conversation: TEXTO },
  }));
}

/** Biblioteca falsa que ENTREGA UM LOTE e depois desloga (copia de tests/ouvir-edicao.test.ts, sem o decodificador). */
function bibliotecaQueEntrega(mensagens: unknown[]): { disparar: () => void } {
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

async function ouvirUmLote(mensagens: (agora: number) => unknown[]): Promise<{ saida: string; contar: (sql: string) => number }> {
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

    const biblioteca = bibliotecaQueEntrega(mensagens(Date.now()));
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
    const acervo = abrirAcervoSomenteLeitura(join(raiz, 'acervos'), id);
    const contagens: Record<string, number> = {};
    try {
      for (const sql of ['SELECT COUNT(*) AS n FROM mensagens', 'SELECT COUNT(*) AS n FROM correspondencias_de_endereco']) {
        contagens[sql] = (acervo.db.prepare(sql).get() as { n: number }).n;
      }
    } finally {
      acervo.fechar();
    }
    return { saida: linhas.join('\n'), contar: (sql) => contagens[sql] ?? -1 };
  } finally {
    limpar();
  }
}

function semDadoDeConversa(saida: string): void {
  for (const proibido of ['200000000000001', '556533334444', '14155550100', NOME, TEXTO]) {
    assert.equal(saida.includes(proibido), false, `a saida do ouvinte vazou ${proibido}`);
  }
}

test('o ouvinte escreve UMA linha com a contagem do conflito da direta, sem endereco, nome nem texto', async () => {
  const { saida, contar } = await ouvirUmLote(loteEmConflito);

  assert.equal(saida.split('\n').filter((l) => l === LINHA).length, 1, `saida: ${saida}`);
  semDadoDeConversa(saida);
  assert.equal(contar('SELECT COUNT(*) AS n FROM mensagens'), 2, 'as duas Mensagens entram');
  assert.equal(contar('SELECT COUNT(*) AS n FROM correspondencias_de_endereco'), 1, 'o primeiro par fica');
});

test('sem conflito o ouvinte nao escreve a linha', async () => {
  const { saida, contar } = await ouvirUmLote((agora) => loteEmConflito(agora).slice(0, 1));

  assert.equal(saida.includes('correspondencia em conflito'), false, `saida: ${saida}`);
  assert.equal(contar('SELECT COUNT(*) AS n FROM correspondencias_de_endereco'), 1);
});

test('a drenagem do derrame tambem escreve a linha do conflito da direta', async () => {
  const c = await paraDrenar();
  try {
    const ditas: string[] = [];
    derramar(c.caminho, loteEmConflito(Date.now()));
    drenar(c.acervo, c.caminho, c.cfg, () => Date.now(), (t: string) => ditas.push(t));

    const saida = ditas.join('\n');
    assert.equal(ditas.filter((l) => l === LINHA).length, 1, `saida: ${saida}`);
    semDadoDeConversa(saida);
  } finally {
    c.limpar();
  }
});
