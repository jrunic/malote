// tests/ouvir-reenvios-integracao.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { configuracaoPorApelido, resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { abrirAcervo, abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { registrarEnvio } from '../src/nucleo/envio.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { caminhosDaConta, ouvir } from '../src/cli/ouvir.js';
import { lerReenvios } from '../src/cli/reenvios.js';

/**
 * A COMPOSICAO de `ouvir.ts` com o Acervo REAL, a porta REAL do nucleo, o `processarEnvios` REAL e a biblioteca real montando
 * a mensagem (socket falso, sem rede). Prova o discriminador de seguranca (so o que um Envio DESTA Configuracao gravou) e o
 * atendimento depois do reinicio. Trocar a Configuracao entregue a porta, ou desligar a leitura do Acervo, reprova aqui.
 */

interface Montada {
  key: { id?: string };
  message: unknown;
}
interface BibliotecaReal {
  generateWAMessage: (jid: string, conteudo: unknown, opcoes: unknown) => Promise<Montada>;
}

const CONTATO = '5511900000001@s.whatsapp.net';
const DA_CONTA = '5511900000009:3@s.whatsapp.net';
const silencioso = {
  level: 'silent',
  child() {
    return silencioso;
  },
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

interface ConfigDoSocket {
  getMessage?: (chave: { remoteJid?: string; id?: string }) => Promise<unknown>;
}

/** Uma Conexao da biblioteca real com socket falso. `aoEnviar(n)` roda DEPOIS de montar a n-esima mensagem, antes de ecoar. */
function biblioteca(real: BibliotecaReal, prefixo: string, aoEnviar?: (n: number) => void) {
  const configs: ConfigDoSocket[] = [];
  const enviados: string[] = [];
  const ouvintes = new Map<string, ((d: unknown) => void)[]>();
  const lib = {
    ...(real as object),
    default: (config: ConfigDoSocket) => {
      configs.push(config);
      return {
        ev: {
          on: (nome: string, f: (d: unknown) => void) => {
            ouvintes.set(nome, [...(ouvintes.get(nome) ?? []), f]);
          },
        },
        ws: { on: () => undefined },
        requestPairingCode: () => Promise.resolve('12345678'),
        sendMessage: async (jid: string, conteudo: unknown) => {
          const n = enviados.length + 1;
          const m = await real.generateWAMessage(jid, conteudo, {
            userJid: DA_CONTA,
            logger: silencioso,
            messageId: `3EB0${prefixo}${String(n).padStart(6, '0')}`,
          });
          enviados.push(m.key.id as string);
          aoEnviar?.(n);
          for (const f of ouvintes.get('messages.upsert') ?? []) f({ type: 'append', messages: [m] });
          return m;
        },
      };
    },
    useMultiFileAuthState: () => Promise.resolve({ state: { creds: 'sintetico' }, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401, connectionClosed: 428, connectionLost: 408 },
    DEFAULT_CONNECTION_CONFIG: { logger: silencioso },
  };
  const fechar = (): void => {
    for (const f of ouvintes.get('connection.update') ?? [])
      f({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
  };
  return { lib, configs, enviados, fechar };
}

interface Cenario {
  raiz: string;
  inquilino: string;
  cfg: { teste: string; outra: string };
  limpar: () => void;
}

function cenario(): Cenario {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const inquilino = criarInquilino(registro, { titularNome: 'Agente' });
  resolverConfiguracao(registro, inquilino, 'whatsapp', 'teste');
  resolverConfiguracao(registro, inquilino, 'whatsapp', 'outra');
  const teste = configuracaoPorApelido(registro, inquilino, 'whatsapp', 'teste')!.id;
  const outra = configuracaoPorApelido(registro, inquilino, 'whatsapp', 'outra')!.id;
  registro.fechar();
  return { raiz, inquilino, cfg: { teste, outra }, limpar };
}

const esperar = async (ate: () => boolean, ms = 5000): Promise<void> => {
  const limite = Date.now() + ms;
  while (!ate() && Date.now() < limite) await new Promise((r) => setTimeout(r, 10));
  assert.ok(ate(), 'a condicao nao veio a tempo');
};

const contarEnviados = (c: Cenario): number => {
  const a = abrirAcervoSomenteLeitura(join(c.raiz, 'acervos'), c.inquilino);
  try {
    return (a.preparar("SELECT COUNT(*) AS n FROM envios WHERE estado = 'enviado'").get() as { n: number }).n;
  } finally {
    a.fechar();
  }
};

/** Uma sessao do `ouvir` (um processo do ouvinte): sobe, deixa passar `esperarEnviados` Envios, pergunta e termina. */
async function sessao(
  c: Cenario,
  o: {
    apelido: 'teste' | 'outra';
    conta: 'conta' | 'conta2';
    prefixo: string;
    esperarEnviados?: number;
    aoEnviar?: (n: number) => void;
    perguntar: (ctx: { getMessage: NonNullable<ConfigDoSocket['getMessage']>; enviados: string[] }) => Promise<void>;
  },
): Promise<{ linhas: string[]; enviados: string[] }> {
  // O fim por vinculo invalidado (401) tira o vinculo do lugar: cada sessao recoloca o seu, como o pareamento faria.
  const vinculo = caminhosDaConta(c.raiz, o.conta).vinculo;
  mkdirSync(vinculo, { recursive: true });
  writeFileSync(join(vinculo, 'creds.json'), '{}');
  const real = (await import('baileys')) as unknown as BibliotecaReal;
  const b = biblioteca(real, o.prefixo, o.aoEnviar);
  const linhas: string[] = [];
  const promessa = ouvir(['ouvir', '--inquilino', c.inquilino, '--conta', o.conta, '--configuracao', o.apelido], {
    dados: c.raiz,
    estado: c.raiz,
    escrever: (t: string) => linhas.push(t),
    carregarBiblioteca: () => Promise.resolve(b.lib as never),
  });
  await esperar(() => b.configs.length > 0).catch((e) => { throw new Error(`sem socket: ${linhas.join(' | ')}`, { cause: e }); });
  if (o.esperarEnviados !== undefined)
    await esperar(() => contarEnviados(c) >= (o.esperarEnviados as number)).catch((e) => { throw new Error(`sem envio: ${linhas.join(' | ')}`, { cause: e }); });
  try {
    await o.perguntar({ getMessage: b.configs[b.configs.length - 1]!.getMessage!, enviados: b.enviados });
  } finally {
    // Asserção que falha em `perguntar` nao pode deixar o ouvinte vivo: a suite penduraria.
    b.fechar();
  }
  assert.equal(await promessa, 1);
  return { linhas, enviados: b.enviados };
}

const pedidos = (linhas: string[]): string[] =>
  linhas.filter((l) => l.startsWith('[ouvinte] pedido de reenvio:')).map((l) => l.split(' ')[4] as string);

test('Envio da Configuracao do ouvinte: pela memoria na mesma sessao, pelo Acervo depois do reinicio; e a conta acumula entre as duas', async () => {
  const c = cenario();
  process.env['MALOTE_ENVIO_INTERVALO_MS'] = '10';
  try {
    const acervo = abrirAcervo(join(c.raiz, 'acervos'), c.inquilino);
    registrarEnvio(acervo, {
      configuracaoId: c.cfg.teste,
      destino: { enderecoCru: CONTATO },
      conteudo: { tipo: 'texto', texto: 'oi da fila' },
    });
    acervo.fechar();

    const um = await sessao(c, {
      apelido: 'teste',
      conta: 'conta',
      prefixo: 'A',
      esperarEnviados: 1,
      perguntar: async ({ getMessage, enviados }) => {
        assert.ok((await getMessage({ remoteJid: CONTATO, id: enviados[0] as string })) !== undefined, 'a memoria atende');
      },
    });
    assert.deepEqual(pedidos(um.linhas), ['achada-na-memoria']);
    const id = um.enviados[0]!;

    // Reinicio: sessao nova, memoria vazia. So o Acervo atende, e so porque o Envio e DESTA Configuracao.
    const dois = await sessao(c, {
      apelido: 'teste',
      conta: 'conta',
      prefixo: 'B',
      perguntar: async ({ getMessage }) => {
        assert.ok((await getMessage({ remoteJid: CONTATO, id })) !== undefined, 'o Acervo atende depois do reinicio');
      },
    });
    assert.deepEqual(pedidos(dois.linhas), ['achada-no-acervo']);
    for (const l of [...um.linhas, ...dois.linhas]) {
      assert.ok(!l.includes(id) && !l.includes('5511900000001'), `a linha leva identificador ou endereco: ${l}`);
    }

    const e = lerReenvios(caminhosDaConta(c.raiz, 'conta').reenvios);
    const dia = Object.values(e!.dias)[0]!;
    assert.equal(dia.pedidos, 2, 'o contador soma as duas sessoes');
    assert.equal(dia.achadosNaMemoria, 1);
    assert.equal(dia.achadosNoAcervo, 1);
  } finally {
    delete process.env['MALOTE_ENVIO_INTERVALO_MS'];
    c.limpar();
  }
});

test('o mesmo identificador num ouvinte de OUTRA Configuracao, e uma Mensagem enviada sem Envio, sao "nao achada"', async () => {
  const c = cenario();
  process.env['MALOTE_ENVIO_INTERVALO_MS'] = '10';
  try {
    const acervo = abrirAcervo(join(c.raiz, 'acervos'), c.inquilino);
    registrarEnvio(acervo, {
      configuracaoId: c.cfg.teste,
      destino: { enderecoCru: CONTATO },
      conteudo: { tipo: 'texto', texto: 'oi' },
    });
    acervo.fechar();
    const um = await sessao(c, { apelido: 'teste', conta: 'conta', prefixo: 'C', esperarEnviados: 1, perguntar: async () => undefined });
    const id = um.enviados[0]!;

    // Uma Mensagem `enviada` por OUTRO aparelho da conta: esta no Acervo, sem Envio.
    const gravar = abrirAcervo(join(c.raiz, 'acervos'), c.inquilino);
    const r = receberEvento(
      gravar,
      [
        {
          key: { remoteJid: CONTATO, id: 'DE-OUTRO-APARELHO', fromMe: true },
          messageTimestamp: Math.floor(Date.now() / 1000),
          message: { conversation: 'enviada por outro aparelho' },
        },
      ],
      { origemDaChegada: 'ao-vivo', agora: Date.now() + 60_000, configuracao: { id: c.cfg.teste, fonte: 'whatsapp' } },
    );
    assert.equal(r.recusados.length, 0, JSON.stringify(r.recusados));
    gravar.fechar();

    const outra = await sessao(c, {
      apelido: 'outra',
      conta: 'conta2',
      prefixo: 'D',
      perguntar: async ({ getMessage }) => {
        assert.equal(await getMessage({ remoteJid: CONTATO, id }), undefined, 'o Envio e de outra Configuracao');
      },
    });
    assert.deepEqual(pedidos(outra.linhas), ['nao-achada']);

    const mesma = await sessao(c, {
      apelido: 'teste',
      conta: 'conta',
      prefixo: 'E',
      perguntar: async ({ getMessage }) => {
        assert.equal(await getMessage({ remoteJid: CONTATO, id: 'DE-OUTRO-APARELHO' }), undefined, 'sem Envio');
        assert.equal(await getMessage({ remoteJid: CONTATO, id: 'NUNCA-EXISTIU' }), undefined);
      },
    });
    assert.deepEqual(pedidos(mesma.linhas), ['nao-achada', 'nao-achada']);
  } finally {
    delete process.env['MALOTE_ENVIO_INTERVALO_MS'];
    c.limpar();
  }
});

test('Envio reenviado depois de falha da contabilidade: a primeira mensagem so na memoria, e depois do reinicio e "nao achada"', async () => {
  const c = cenario();
  process.env['MALOTE_ENVIO_INTERVALO_MS'] = '10';
  try {
    const acervo = abrirAcervo(join(c.raiz, 'acervos'), c.inquilino);
    const caminho = (acervo as unknown as { db: { name: string } }).db.name;
    registrarEnvio(acervo, {
      configuracaoId: c.cfg.teste,
      destino: { enderecoCru: CONTATO },
      conteudo: { tipo: 'texto', texto: 'oi' },
    });
    acervo.fechar();
    // A contabilidade falha na primeira passada: marcar `enviado` e abortado por um gatilho. A segunda passada (o poller
    // reenvia, com outro identificador) o remove antes de enviar.
    const w = new Database(caminho);
    w.exec("CREATE TRIGGER falha_sintetica BEFORE UPDATE OF estado ON envios BEGIN SELECT RAISE(ABORT, 'falha sintetica'); END");

    const um = await sessao(c, {
      apelido: 'teste',
      conta: 'conta',
      prefixo: 'F',
      esperarEnviados: 1,
      aoEnviar: (n) => {
        if (n === 2) w.exec('DROP TRIGGER falha_sintetica');
      },
      perguntar: async ({ getMessage, enviados }) => {
        assert.equal(enviados.length, 2, 'a mensagem saiu duas vezes: a contabilidade da primeira falhou');
        for (const id of enviados) {
          assert.ok((await getMessage({ remoteJid: CONTATO, id })) !== undefined, 'as duas estao na memoria');
        }
      },
    });
    w.close();
    assert.deepEqual(pedidos(um.linhas), ['achada-na-memoria', 'achada-na-memoria']);
    const [primeira, segunda] = um.enviados as [string, string];

    const dois = await sessao(c, {
      apelido: 'teste',
      conta: 'conta',
      prefixo: 'G',
      perguntar: async ({ getMessage }) => {
        assert.equal(await getMessage({ remoteJid: CONTATO, id: primeira }), undefined, 'o Envio guarda so a ultima tentativa');
        assert.ok((await getMessage({ remoteJid: CONTATO, id: segunda })) !== undefined, 'a ultima o Acervo atende');
      },
    });
    assert.deepEqual(pedidos(dois.linhas), ['nao-achada', 'achada-no-acervo']);
  } finally {
    delete process.env['MALOTE_ENVIO_INTERVALO_MS'];
    c.limpar();
  }
});
