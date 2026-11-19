import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { configuracaoPorApelido, resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import {
  declararTelefoneDaConta,
  lerEnderecosDaConta,
  registrarEnderecosDoVinculo,
  trocarTelefoneDaConta,
} from '../src/registro/endereco-da-conta.js';
import { caminhosDaConta, ouvir } from '../src/cli/ouvir.js';

/**
 * A conferencia do vinculo DEPOIS da troca do telefone (#1564, criterio 5): o vinculo do numero NOVO passa e grava os
 * Enderecos da Conta; o do numero ANTIGO sai 2 sem gravar e sem imprimir numero. Composicao de `ouvir.ts` com
 * socket falso, vinculo ja pareado (a identidade esta no estado de autenticacao). Numeros sinteticos.
 */
const ANTIGO = '5511900000001';
const NOVO = '5511900000002';

function biblioteca(meId: string) {
  let aberto = 0;
  const ouvintes = new Map<string, ((d: unknown) => void)[]>();
  const silencioso = { level: 'silent', child: () => silencioso, trace: () => undefined, debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined, fatal: () => undefined };
  const lib = {
    default: () => {
      aberto += 1;
      return {
        ev: { on: (nome: string, f: (d: unknown) => void) => void ouvintes.set(nome, [...(ouvintes.get(nome) ?? []), f]) },
        ws: { on: () => undefined },
        requestPairingCode: () => Promise.resolve('12345678'),
        sendMessage: () => Promise.resolve(undefined),
      };
    },
    useMultiFileAuthState: () => Promise.resolve({ state: { creds: { me: { id: meId } } }, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401, connectionClosed: 428, connectionLost: 408 },
    DEFAULT_CONNECTION_CONFIG: { logger: silencioso },
  };
  const fechar = (): void => {
    for (const f of ouvintes.get('connection.update') ?? []) f({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
  };
  return { lib, sockets: () => aberto, fechar };
}

const esperar = async (ate: () => boolean, ms = 5000): Promise<void> => {
  const limite = Date.now() + ms;
  while (!ate() && Date.now() < limite) await new Promise((r) => setTimeout(r, 10));
  assert.ok(ate(), 'a condicao nao veio a tempo');
};

/** Uma conta com o telefone ANTIGO declarado e conferido pelo vinculo antigo, com `trocou` decidindo se o telefone ja foi trocado. */
function preparar(raiz: string, trocou: boolean): { inquilino: string; cfgId: string } {
  const registro = abrirRegistro(raiz);
  try {
    const inquilino = criarInquilino(registro, { titularNome: 'Agente' });
    resolverConfiguracao(registro, inquilino, 'whatsapp', 'conta');
    const cfgId = configuracaoPorApelido(registro, inquilino, 'whatsapp', 'conta')!.id;
    declararTelefoneDaConta(registro, cfgId, ANTIGO);
    registrarEnderecosDoVinculo(registro, cfgId, { telefone: ANTIGO, jid: `${ANTIGO}@s.whatsapp.net`, lid: '100000000000001@lid' });
    if (trocou) trocarTelefoneDaConta(registro, cfgId, NOVO);
    return { inquilino, cfgId };
  } finally {
    registro.fechar();
  }
}

function lerJid(raiz: string, cfgId: string): string | null | undefined {
  const registro = abrirRegistro(raiz);
  try {
    return lerEnderecosDaConta(registro, cfgId)?.jid;
  } finally {
    registro.fechar();
  }
}

async function ouvirCom(raiz: string, inquilino: string, meId: string, comoFecha: 'por-recusa' | 'fechar-socket') {
  const caminhos = caminhosDaConta(raiz, 'conta');
  mkdirSync(caminhos.vinculo, { recursive: true });
  writeFileSync(join(caminhos.vinculo, 'creds.json'), '{}');
  const b = biblioteca(meId);
  const saida: string[] = [];
  const promessa = ouvir(['ouvir', '--inquilino', inquilino, '--conta', 'conta', '--configuracao', 'conta'], {
    dados: raiz,
    estado: raiz,
    escrever: (t: string) => saida.push(t),
    carregarBiblioteca: () => Promise.resolve(b.lib as never),
  });
  if (comoFecha === 'fechar-socket') {
    await esperar(() => b.sockets() > 0);
    b.fechar();
  }
  // Se a conferencia NAO recusar, o ouvinte ficaria vivo para sempre: o prazo o fecha e o teste FALHA pelo codigo, nao pendura.
  const prazo = setTimeout(() => b.fechar(), 3000);
  try {
    return { codigo: await promessa, saida: saida.join('\n'), sockets: b.sockets() };
  } finally {
    clearTimeout(prazo);
  }
}

test('DEPOIS da troca, o vinculo do numero NOVO passa a conferencia e grava os Enderecos da Conta', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, cfgId } = preparar(raiz, true);
    const r = await ouvirCom(raiz, inquilino, `${NOVO}:7@s.whatsapp.net`, 'fechar-socket');
    assert.equal(r.codigo, 1, 'o fim e o do socket fechado (vinculo invalidado), nao a recusa da conta');
    assert.doesNotMatch(r.saida, /RECUSADO/);
    assert.equal(lerJid(raiz, cfgId), `${NOVO}@s.whatsapp.net`, 'o vinculo novo regravou o jid');
  } finally {
    limpar();
  }
});

test('DEPOIS da troca, o vinculo do numero ANTIGO sai 2 sem gravar nada e sem imprimir numero', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, cfgId } = preparar(raiz, true);
    const r = await ouvirCom(raiz, inquilino, `${ANTIGO}:7@s.whatsapp.net`, 'por-recusa');
    assert.equal(r.codigo, 2);
    assert.match(r.saida, /RECUSADO: o vinculo e de outra conta/);
    assert.equal(r.saida.includes(ANTIGO) || r.saida.includes(NOVO), false, 'nenhum digito da conta na saida');
    assert.equal(lerJid(raiz, cfgId), `${ANTIGO}@s.whatsapp.net`, 'nada foi gravado');
  } finally {
    limpar();
  }
});

test('ANTES da troca, o vinculo do numero novo e recusado: a troca e o que o habilita', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, cfgId } = preparar(raiz, false);
    const r = await ouvirCom(raiz, inquilino, `${NOVO}:7@s.whatsapp.net`, 'por-recusa');
    assert.equal(r.codigo, 2);
    assert.equal(lerJid(raiz, cfgId), `${ANTIGO}@s.whatsapp.net`);
  } finally {
    limpar();
  }
});
