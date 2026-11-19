// tests/decifra-ouvinte.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { configuracaoPorApelido, resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { abrirAcervo, abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { caminhosDaConta, ouvir } from '../src/cli/ouvir.js';
import { lerBlocoDaDecifra } from '../src/cli/decifra.js';

/**
 * A COMPOSICAO de `ouvir.ts` com o Acervo REAL e o registro das falhas de decifra (#1537): a falha que a biblioteca loga
 * chega ao arquivo da conta, com a consulta ao Acervo na hora e a reconferencia depois. Socket falso, sem rede.
 */

const CONTATO = '5511900000001@s.whatsapp.net';
const GRUPO = '120363000000000001@g.us';

interface ConfigDoSocket {
  logger?: { error: (...a: unknown[]) => void };
}

function biblioteca() {
  const configs: ConfigDoSocket[] = [];
  const ouvintes = new Map<string, ((d: unknown) => void)[]>();
  const silencioso = { level: 'silent', child: () => silencioso, trace: () => undefined, debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };
  const lib = {
    default: (config: ConfigDoSocket) => {
      configs.push(config);
      return {
        ev: { on: (nome: string, f: (d: unknown) => void) => void ouvintes.set(nome, [...(ouvintes.get(nome) ?? []), f]) },
        ws: { on: () => undefined },
        requestPairingCode: () => Promise.resolve('12345678'),
        sendMessage: () => Promise.resolve(undefined),
      };
    },
    useMultiFileAuthState: () => Promise.resolve({ state: { creds: 'sintetico' }, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401, connectionClosed: 428, connectionLost: 408 },
    DEFAULT_CONNECTION_CONFIG: { logger: silencioso },
  };
  const fechar = (): void => {
    for (const f of ouvintes.get('connection.update') ?? []) f({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
  };
  return { lib, configs, fechar };
}

const esperar = async (ate: () => boolean, ms = 5000): Promise<void> => {
  const limite = Date.now() + ms;
  while (!ate() && Date.now() < limite) await new Promise((r) => setTimeout(r, 10));
  assert.ok(ate(), 'a condicao nao veio a tempo');
};

const linhas = (caminho: string): Array<Record<string, unknown>> => {
  try {
    return readFileSync(caminho, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    return [];
  }
};

test('a falha de decifra chega ao arquivo com a consulta ao Acervo, e a reconferencia anota a recuperada, sem escrever nada no Acervo', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  process.env['MALOTE_DECIFRA_INTERVALO_MS'] = '20';
  try {
    const registro = abrirRegistro(raiz);
    const inquilino = criarInquilino(registro, { titularNome: 'Agente' });
    resolverConfiguracao(registro, inquilino, 'whatsapp', 'teste');
    const cfg = configuracaoPorApelido(registro, inquilino, 'whatsapp', 'teste')!.id;
    registro.fechar();

    // Uma Mensagem JA gravada (a reentrega) e o Acervo antes das falhas.
    const gravar = abrirAcervo(join(raiz, 'acervos'), inquilino);
    const r = receberEvento(
      gravar,
      [{ key: { remoteJid: CONTATO, id: 'JA-GRAVADA', fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: 'oi' } }],
      { origemDaChegada: 'ao-vivo', agora: Date.now() + 60_000, configuracao: { id: cfg, fonte: 'whatsapp' } },
    );
    assert.equal(r.recusados.length, 0);
    gravar.fechar();
    const contar = (): Record<string, number> => {
      const a = abrirAcervoSomenteLeitura(join(raiz, 'acervos'), inquilino);
      try {
        const n = (sql: string): number => (a.preparar(sql).get() as { n: number }).n;
        return { mensagens: n('SELECT COUNT(*) AS n FROM mensagens'), chegadas: n('SELECT COUNT(*) AS n FROM chegadas'), operacoes: n('SELECT COUNT(*) AS n FROM operacoes') };
      } finally {
        a.fechar();
      }
    };
    const antes = contar();

    const caminhos = caminhosDaConta(raiz, 'conta');
    mkdirSync(caminhos.vinculo, { recursive: true });
    writeFileSync(join(caminhos.vinculo, 'creds.json'), '{}');
    const b = biblioteca();
    const saida: string[] = [];
    const promessa = ouvir(['ouvir', '--inquilino', inquilino, '--conta', 'conta', '--configuracao', 'teste'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => saida.push(t),
      carregarBiblioteca: () => Promise.resolve(b.lib as never),
    });
    await esperar(() => b.configs.length > 0);
    try {
      const logger = b.configs[0]!.logger!;
      assert.notEqual(logger, undefined, 'o socket ganha o logger embrulhado para a captura');

      logger.error({ key: { id: 'JA-GRAVADA', remoteJid: CONTATO, fromMe: false }, err: { message: 'Key used already or never filled' } }, 'failed to decrypt message');
      logger.error({ key: { id: 'DEPOIS', remoteJid: GRUPO, participant: '100000000000001@lid', fromMe: false }, err: { message: 'No session found to decrypt message' } }, 'failed to decrypt message');
      await esperar(() => linhas(caminhos.decifra).length === 2);
      const [a, d] = linhas(caminhos.decifra);
      assert.equal(a?.['jaGravada'], true, 'a mensagem ja estava no Acervo');
      assert.equal(d?.['jaGravada'], false);
      assert.equal(d?.['tipo'], 'grupo');

      // A mensagem "DEPOIS" entra no Acervo: a reconferencia do ouvinte a anota como recuperada.
      const gravar2 = abrirAcervo(join(raiz, 'acervos'), inquilino);
      receberEvento(
        gravar2,
        [{ key: { remoteJid: GRUPO, id: 'DEPOIS', fromMe: false, participant: '100000000000001@lid' }, messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: 'chegou' } }],
        { origemDaChegada: 'ao-vivo', agora: Date.now() + 60_000, configuracao: { id: cfg, fonte: 'whatsapp' } },
      );
      gravar2.fechar();
      await esperar(() => linhas(caminhos.decifra).some((l) => l['t'] === 'situacao' && l['id'] === 'DEPOIS' && l['situacao'] === 'recuperada'));

      const bloco = lerBlocoDaDecifra({ registro: caminhos.decifra, contadores: caminhos.decifraContador }, Date.now()).bloco;
      assert.notEqual(bloco, null, 'o ouvinte criou o arquivo dos contadores na subida');
      const dia = Object.values(bloco!.dias)[0];
      assert.deepEqual(dia?.total, { jaGravada: 1, recuperada: 1, perdida: 0, incerta: 0, aberta: 0 });

      b.fechar();
      assert.equal(await promessa, 1);

      // O registro e a reconferencia nao escrevem no Acervo: so a Mensagem que o proprio teste gravou (mais 1 e 1 Chegada).
      const depois = contar();
      assert.deepEqual(
        { mensagens: depois['mensagens']! - antes['mensagens']!, chegadas: depois['chegadas']! - antes['chegadas']!, operacoes: depois['operacoes']! - antes['operacoes']! },
        { mensagens: 1, chegadas: 1, operacoes: 1 },
        'so o que o teste gravou (a Mensagem DEPOIS, a Chegada e a Operacao dela)',
      );
    } catch (erro) {
      // Asserção que falha nao pode deixar o ouvinte vivo: a suite penduraria.
      b.fechar();
      await promessa.catch(() => undefined);
      throw erro;
    }
  } finally {
    delete process.env['MALOTE_DECIFRA_INTERVALO_MS'];
    limpar();
  }
});
