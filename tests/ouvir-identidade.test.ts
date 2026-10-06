import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { caminhosDaConta, ouvir } from '../src/cli/ouvir.js';
import { resolverEnderecoDeTeste } from './ajuda/endereco.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import {
  declararTelefoneDaConta,
  lerEnderecosDaConta,
} from '../src/registro/endereco-da-conta.js';

const ME = { id: '5511900000001:14@s.whatsapp.net', lid: '100000000000001:14@lid', name: 'Conta Sintetica' };
const JID = '5511900000001@s.whatsapp.net';
const LID = '100000000000001@lid';

function biblioteca(me: { id: string; lid?: string } | undefined, aoCarregar?: () => void) {
  const ouvintes = new Map<string, (d: unknown) => void>();
  return {
    default: () => ({
      ev: { on: (f: string, fn: (d: unknown) => void) => ouvintes.set(f, fn) },
      requestPairingCode: () => Promise.resolve('12345678'),
      user: me,
    }),
    useMultiFileAuthState: () =>
      Promise.resolve({ state: me === undefined ? {} : { creds: { me } }, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401, connectionClosed: 428, connectionLost: 408 },
    // abre e em seguida diz "deslogado", para o ouvir terminar sozinho (como nos testes existentes)
    disparar: (): void => {
      aoCarregar?.();
      setImmediate(() => {
        ouvintes.get('connection.update')?.({ connection: 'open' });
        setImmediate(() =>
          ouvintes.get('connection.update')?.({
            connection: 'close',
            lastDisconnect: { error: { output: { statusCode: 401 } } },
          }),
        );
      });
    },
  };
}

function cenarioDeOuvir(telefone?: string): { raiz: string; limpar: () => void; inquilino: string; cfgId: string } {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const inquilino = criarInquilino(registro, { titularNome: 'Agente' });
  const cfg = resolverConfiguracao(registro, inquilino, 'whatsapp', 'teste');
  if (telefone !== undefined) declararTelefoneDaConta(registro, cfg.id, telefone);
  registro.fechar();
  return { raiz, limpar, inquilino, cfgId: cfg.id };
}

function comVinculo(raiz: string): void {
  const caminhos = caminhosDaConta(raiz, 'conta');
  mkdirSync(caminhos.vinculo, { recursive: true });
  writeFileSync(join(caminhos.vinculo, 'creds.json'), '{}');
}

async function rodarOuvir(
  c: { raiz: string; inquilino: string },
  b: ReturnType<typeof biblioteca>,
  extras: string[] = [],
): Promise<{ codigo: number; saida: string }> {
  const linhas: string[] = [];
  const codigo = await ouvir(
    ['ouvir', '--inquilino', c.inquilino, '--conta', 'conta', '--configuracao', 'teste', ...extras],
    {
      dados: c.raiz,
      estado: c.raiz,
      escrever: (t: string) => linhas.push(t),
      carregarBiblioteca: () => {
        b.disparar();
        return Promise.resolve(b);
      },
    },
  );
  return { codigo, saida: linhas.join('\n') };
}

function contagens(c: { raiz: string; inquilino: string }): { ident: number; corr: number; opAcervo: number; opRegistro: number } {
  const acervo = abrirAcervo(join(c.raiz, 'acervos'), c.inquilino);
  const registro = abrirRegistro(c.raiz);
  try {
    const n = (db: { prepare: (s: string) => { get: () => unknown } }, tabela: string): number =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number }).n;
    return {
      ident: n(acervo.db, 'identificadores'),
      corr: n(acervo.db, 'correspondencias_de_endereco'),
      opAcervo: n(acervo.db, 'operacoes'),
      opRegistro: n(registro.db, 'operacoes'),
    };
  } finally {
    acervo.fechar();
    registro.fechar();
  }
}

test('Configuracao SEM telefone: o ouvinte aprende telefone, JID e LID e declara o par ao Acervo', async () => {
  const c = cenarioDeOuvir();
  try {
    comVinculo(c.raiz);
    await rodarOuvir(c, biblioteca(ME));

    const registro = abrirRegistro(c.raiz);
    const e = lerEnderecosDaConta(registro, c.cfgId);
    registro.fechar();
    assert.deepEqual([e?.telefone, e?.jid, e?.lid], ['5511900000001', JID, LID]);
    assert.notEqual(e?.conferidoEm, null);

    const acervo = abrirAcervo(join(c.raiz, 'acervos'), c.inquilino);
    try {
      assert.equal(resolverEnderecoDeTeste(acervo, LID), JID, 'o LID da conta resolve para o JID');
    } finally {
      acervo.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('as Operacoes da primeira conexao saem atribuidas ao SERVICO do ouvinte, nas duas bases', async () => {
  const c = cenarioDeOuvir();
  try {
    comVinculo(c.raiz);
    await rodarOuvir(c, biblioteca(ME));
    const registro = abrirRegistro(c.raiz);
    const acervo = abrirAcervo(join(c.raiz, 'acervos'), c.inquilino);
    try {
      const doRegistro = registro.db
        .prepare("SELECT ator FROM operacoes WHERE natureza = 'conferir-conta-do-vinculo'")
        .all() as Array<{ ator: string }>;
      const doAcervo = acervo.db
        .prepare("SELECT ator FROM operacoes WHERE natureza = 'declarar-endereco-da-conta'")
        .all() as Array<{ ator: string }>;
      assert.deepEqual(doRegistro.map((o) => o.ator), ['servico:ouvinte-whatsapp']);
      assert.deepEqual(doAcervo.map((o) => o.ator), ['servico:ouvinte-whatsapp']);
    } finally {
      registro.fechar();
      acervo.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('a SEGUNDA conexao nao escreve linha nem Operacao, no Registro nem no Acervo', async () => {
  const c = cenarioDeOuvir();
  try {
    comVinculo(c.raiz);
    await rodarOuvir(c, biblioteca(ME));
    const depoisDaPrimeira = contagens(c);
    // A primeira conexao ESCREVEU: sem isto o teste passaria por vacuidade (nada escrito, nada a repetir).
    assert.equal(depoisDaPrimeira.ident, 1);
    assert.equal(depoisDaPrimeira.corr, 1);
    assert.ok(depoisDaPrimeira.opAcervo >= 1 && depoisDaPrimeira.opRegistro >= 1, 'as duas Operacoes foram gravadas');
    comVinculo(c.raiz); // a primeira terminou com "deslogado", que move o vinculo
    await rodarOuvir(c, biblioteca(ME));
    assert.deepEqual(contagens(c), depoisDaPrimeira);
  } finally {
    c.limpar();
  }
});

test('telefone declarado IGUAL ao do vinculo: segue', async () => {
  const c = cenarioDeOuvir('5511900000001');
  try {
    comVinculo(c.raiz);
    const r = await rodarOuvir(c, biblioteca(ME));
    assert.notEqual(r.codigo, 2);
    assert.doesNotMatch(r.saida, /outra conta/);
  } finally {
    c.limpar();
  }
});

test('telefone declarado COM o 9 contra o JID SEM o 9: segue (a conta e a mesma)', async () => {
  const c = cenarioDeOuvir('5511999990001');
  try {
    comVinculo(c.raiz);
    const r = await rodarOuvir(c, biblioteca({ id: '551199990001:14@s.whatsapp.net', lid: '100000000000002:14@lid' }));
    assert.notEqual(r.codigo, 2);
    assert.doesNotMatch(r.saida, /outra conta/);
    const registro = abrirRegistro(c.raiz);
    const e = lerEnderecosDaConta(registro, c.cfgId);
    registro.fechar();
    assert.equal(e?.telefone, '5511999990001', 'o declarado fica');
    assert.equal(e?.jid, '551199990001@s.whatsapp.net', 'o JID e o que a Fonte entrega');
  } finally {
    c.limpar();
  }
});

test('vinculo de OUTRA conta: sai 2, nada vai ao Acervo, e a saida NAO traz os digitos', async () => {
  const c = cenarioDeOuvir('5511900000009');
  try {
    comVinculo(c.raiz);
    const antes = contagens(c);
    const timersAntes = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    const r = await rodarOuvir(c, biblioteca(ME));
    assert.equal(r.codigo, 2);
    // O poller de Envio (um setInterval) NAO pode nascer depois da recusa: ele rodaria contra o Acervo fechado.
    // Sem o retorno antecipado do `ouvir` este timer vaza e, alem de falhar aqui, pendura o processo de teste.
    assert.equal(
      process.getActiveResourcesInfo().filter((r2) => r2 === 'Timeout').length,
      timersAntes,
      'o poller de Envio nasceu depois da recusa',
    );
    assert.match(r.saida, /outra conta/);
    for (const digitos of ['5511900000001', '5511900000009', '100000000000001']) {
      assert.equal(r.saida.includes(digitos), false, `a saida vazou ${digitos}`);
    }
    assert.deepEqual(contagens(c), antes, 'recusar nao grava nada');
    const registro = abrirRegistro(c.raiz);
    const e = lerEnderecosDaConta(registro, c.cfgId);
    registro.fechar();
    assert.equal(e?.conferidoEm, null);
    assert.equal(e?.jid, null);
  } finally {
    c.limpar();
  }
});

test('vinculo sem LID grava so o JID, e o Acervo so ganha o Identificador', async () => {
  const c = cenarioDeOuvir();
  try {
    comVinculo(c.raiz);
    await rodarOuvir(c, biblioteca({ id: '5511900000001:14@s.whatsapp.net' }));
    const k = contagens(c);
    assert.equal(k.ident, 1);
    assert.equal(k.corr, 0);
    const registro = abrirRegistro(c.raiz);
    const e = lerEnderecosDaConta(registro, c.cfgId);
    registro.fechar();
    assert.equal(e?.lid, null);
  } finally {
    c.limpar();
  }
});

test('--numero DIVERGENTE do telefone da Configuracao: sai 2 ANTES de carregar a biblioteca', async () => {
  const c = cenarioDeOuvir('5511900000001');
  try {
    let carregou = false;
    const linhas: string[] = [];
    const codigo = await ouvir(
      ['ouvir', '--inquilino', c.inquilino, '--conta', 'conta', '--configuracao', 'teste', '--numero', '5511900000002'],
      {
        dados: c.raiz,
        estado: c.raiz,
        escrever: (t: string) => linhas.push(t),
        carregarBiblioteca: () => {
          carregou = true;
          return Promise.reject(new Error('nao devia carregar'));
        },
      },
    );
    assert.equal(codigo, 2);
    assert.equal(carregou, false);
    assert.equal(linhas.join('\n').includes('5511900000002'), false, 'o numero nao pode ser ecoado');
  } finally {
    c.limpar();
  }
});

test('--numero numa Configuracao SEM telefone o DECLARA (e o vinculo depois o confirma)', async () => {
  const c = cenarioDeOuvir();
  try {
    comVinculo(c.raiz);
    await rodarOuvir(c, biblioteca(ME), ['--numero', '5511900000001']);
    const registro = abrirRegistro(c.raiz);
    const e = lerEnderecosDaConta(registro, c.cfgId);
    registro.fechar();
    assert.equal(e?.telefone, '5511900000001');
    assert.notEqual(e?.declaradoEm, null, 'foi declarado, nao so aprendido');
  } finally {
    c.limpar();
  }
});

test('primeiro pareamento SEM --numero e sem telefone na Configuracao continua recusando com 2', async () => {
  const c = cenarioDeOuvir();
  try {
    const linhas: string[] = [];
    const codigo = await ouvir(
      ['ouvir', '--inquilino', c.inquilino, '--conta', 'conta', '--configuracao', 'teste'],
      { dados: c.raiz, estado: c.raiz, escrever: (t: string) => linhas.push(t), carregarBiblioteca: () => Promise.reject(new Error('x')) },
    );
    assert.equal(codigo, 2);
    assert.match(linhas.join('\n'), /--numero/);
  } finally {
    c.limpar();
  }
});

test('primeiro pareamento SEM --numero MAS com telefone na Configuracao: pede o codigo com o dela', async () => {
  const c = cenarioDeOuvir('5511900000001');
  try {
    const linhas: string[] = [];
    const codigo = await ouvir(
      ['ouvir', '--inquilino', c.inquilino, '--conta', 'conta', '--configuracao', 'teste'],
      {
        dados: c.raiz,
        estado: c.raiz,
        escrever: (t: string) => linhas.push(t),
        carregarBiblioteca: () => Promise.reject(new Error('sem rede no teste')),
      },
    );
    assert.equal(codigo, 1, 'passou da recusa de pareamento e so falhou ao carregar a biblioteca');
    assert.doesNotMatch(linhas.join('\n'), /Informe --numero/);
  } finally {
    c.limpar();
  }
});

test('telefone de OUTRA Configuracao do mesmo Inquilino no --numero: sai 2', async () => {
  const c = cenarioDeOuvir();
  try {
    const registro = abrirRegistro(c.raiz);
    const outra = resolverConfiguracao(registro, c.inquilino, 'whatsapp', 'outra');
    declararTelefoneDaConta(registro, outra.id, '5511900000001');
    registro.fechar();
    const linhas: string[] = [];
    const codigo = await ouvir(
      ['ouvir', '--inquilino', c.inquilino, '--conta', 'conta', '--configuracao', 'teste', '--numero', '5511900000001'],
      { dados: c.raiz, estado: c.raiz, escrever: (t: string) => linhas.push(t), carregarBiblioteca: () => Promise.reject(new Error('x')) },
    );
    assert.equal(codigo, 2);
    assert.match(linhas.join('\n'), /ja pertence a Configuracao outra/);
  } finally {
    c.limpar();
  }
});

test('identidade ilegivel (so LID, sem JID) segue SEM conferir e avisa — so a divergencia confirmada recusa', async () => {
  const c = cenarioDeOuvir('5511900000009');
  try {
    comVinculo(c.raiz);
    const r = await rodarOuvir(c, biblioteca({ id: '100000000000001:14@lid' }));
    assert.notEqual(r.codigo, 2, 'nao confirmou divergencia, entao nao recusa');
    assert.match(r.saida, /nao e legivel/);
    const registro = abrirRegistro(c.raiz);
    const e = lerEnderecosDaConta(registro, c.cfgId);
    registro.fechar();
    assert.equal(e?.conferidoEm, null, 'sem identidade legivel, nada foi conferido nem gravado');
  } finally {
    c.limpar();
  }
});
