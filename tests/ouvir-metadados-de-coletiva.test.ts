import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino, listarInquilinos } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { abrirAcervo, abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { caminhosDaConta, ouvir } from '../src/cli/ouvir.js';
import { avisoDeTroca, eventoDeGrupo, LID_DA_CONTA } from './ajuda/metadados-de-coletiva-ao-vivo.js';

// #1160 fatia C pelo caminho REAL do ouvinte: o evento de grupo entra por `aoReceber`, o aviso por `aoAvisoDeGrupo`,
// e os dois gravam sob o Ator de servico. So contagens no log: assunto e descricao sao texto de conversa.

const TEXTO = 'TEXTO-SINTETICO-QUE-NAO-PODE-VAZAR';
const TS = 1_791_922_324;

function bibliotecaQueEntrega(passos: Array<[string, unknown]>): unknown {
  const ouvintes = new Map<string, Array<(dado: unknown) => void>>();
  return {
    default: () => ({
      ev: { on: (fluxo: string, f: (dado: unknown) => void) => ouvintes.set(fluxo, [...(ouvintes.get(fluxo) ?? []), f]) },
      requestPairingCode: () => Promise.resolve('12345678'),
    }),
    useMultiFileAuthState: () => Promise.resolve({ state: {}, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401 },
    disparar: (): void => {
      setImmediate(() => {
        for (const [fluxo, dado] of passos) (ouvintes.get(fluxo) ?? []).forEach((f) => f(dado));
        setImmediate(() =>
          (ouvintes.get('connection.update') ?? []).forEach((f) =>
            f({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } }),
          ),
        );
      });
    },
  };
}

test('o evento de grupo e o aviso gravam pelo ouvinte, sob o Ator de servico, e o log so conta', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const id = criarInquilino(registro, { titularNome: 'Padme' });
    registro.fechar();
    const r2 = abrirRegistro(raiz);
    const inquilino = listarInquilinos(r2)[0]?.id;
    if (inquilino === undefined) throw new Error('cenario sem Inquilino');
    resolverConfiguracao(r2, inquilino, 'whatsapp', 'teste');
    r2.fechar();
    const caminhos = caminhosDaConta(raiz, 'viva');
    mkdirSync(caminhos.vinculo, { recursive: true });
    writeFileSync(join(caminhos.vinculo, 'creds.json'), '{}');
    abrirAcervo(join(raiz, 'acervos'), id).fechar();

    const biblioteca = bibliotecaQueEntrega([
      ['messages.upsert', { type: 'notify', messages: [eventoDeGrupo({ id: 'E1', tipo: 'GROUP_CHANGE_SUBJECT', parametros: [TEXTO], ts: TS, autor: LID_DA_CONTA })] }],
      ['groups.update', avisoDeTroca({ descricao: `${TEXTO}-DESCRICAO`, autor: LID_DA_CONTA })],
      // O que NAO grava tambem e contado, por motivo: forma vazia do evento, e aviso sem texto (o da remocao).
      ['messages.upsert', { type: 'notify', messages: [eventoDeGrupo({ id: 'E2', tipo: 'GROUP_CHANGE_DESCRIPTION', parametros: [], ts: TS + 1 })] }],
      ['groups.update', avisoDeTroca({ autor: LID_DA_CONTA })],
    ]) as { disparar: () => void };
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
    assert.equal(saida.includes(TEXTO), false, 'o texto do assunto ou da descricao vazou para a saida do ouvinte');
    assert.match(saida, /metadados de coletiva: 1 gravado/);
    assert.match(saida, /metadados de coletiva \(aviso\): 1 gravado/);
    assert.match(saida, /metadados de coletiva ignorados: forma-vazia=1/);
    assert.match(saida, /metadados de coletiva \(aviso\): 0 gravado\(s\), 0 repetido\(s\), 1 sem texto/);

    const acervo = abrirAcervoSomenteLeitura(join(raiz, 'acervos'), id);
    try {
      const m = acervo.db.prepare('SELECT assunto, descricao FROM metadados_de_coletiva').all() as Array<{ assunto: string; descricao: string }>;
      assert.deepEqual(m, [{ assunto: TEXTO, descricao: `${TEXTO}-DESCRICAO` }]);
      const atores = acervo.db
        .prepare("SELECT DISTINCT ator FROM operacoes WHERE natureza = 'receber-ao-vivo'")
        .all() as Array<{ ator: string | null }>;
      assert.deepEqual(atores.map((a) => a.ator), ['servico:ouvinte-whatsapp'], 'alguma Operacao de recepcao saiu sem o Ator de servico');
    } finally {
      acervo.fechar();
    }
  } finally {
    limpar();
  }
});
