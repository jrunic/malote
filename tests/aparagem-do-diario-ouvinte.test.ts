import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino, listarInquilinos } from '../src/registro/registro.js';
import { abrirAcervo, abrirAcervoSomenteLeitura, type Acervo } from '../src/nucleo/acervo.js';
import { registrarChegada } from '../src/nucleo/chegada.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { caminhosDaConta, ouvir } from '../src/cli/ouvir.js';
import { iniciarAparagemDoDiario } from '../src/cli/aparagem-do-diario.js';

const DIA = 86_400_000;

function gravar(acervo: Acervo, n: number): void {
  for (let i = 0; i < n; i += 1) {
    registrarChegada(acervo, { tipo: 'mensagem', origem: 'ao-vivo', criadoEm: Date.now(), ocorridaEm: 1, alvoId: `m${String(i)}` });
  }
}

function contar(acervo: Acervo): number {
  return (acervo.db.prepare('SELECT COUNT(*) AS n FROM chegadas').get() as { n: number }).n;
}

async function esperar(condicao: () => boolean, ms = 3000): Promise<boolean> {
  const limite = Date.now() + ms;
  while (!condicao() && Date.now() < limite) await new Promise((r) => setTimeout(r, 10));
  return condicao();
}

test('a aparagem so comeca no primeiro passo, remove em lotes ate esvaziar o removivel, e diz so um numero', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    gravar(acervo, 25);
    const linhas: string[] = [];
    const inicio = Date.now();
    const parar = iniciarAparagemDoDiario(acervo, {
      agora: () => Date.now() + 40 * DIA,
      escrever: (t) => linhas.push(t),
      primeiroPassoMs: 150,
      intervaloMs: 60_000,
      lote: 10,
    });
    try {
      assert.equal(contar(acervo), 26, 'nada na hora: o primeiro passo vem depois');
      assert.equal(await esperar(() => contar(acervo) === 1), true, 'os tres lotes (10, 10 e 5) saem num passo so');
      assert.ok(Date.now() - inicio >= 140, 'o primeiro passo respeitou o atraso');
    } finally {
      parar();
    }
    assert.deepEqual(linhas, ['[ouvinte] diario de chegadas: 25 aparada(s).']);
  } finally {
    c.limpar();
  }
});

test('parar a aparagem para de vez: nada mais e removido depois', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    gravar(acervo, 3);
    const parar = iniciarAparagemDoDiario(acervo, {
      agora: () => Date.now() + 40 * DIA,
      escrever: () => undefined,
      primeiroPassoMs: 10,
      intervaloMs: 20,
    });
    assert.equal(await esperar(() => contar(acervo) === 1), true);
    parar();
    gravar(acervo, 3);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(contar(acervo), 4, 'as tres novas, mais a ultima de antes, ficam');
  } finally {
    c.limpar();
  }
});

test('o tique sem nada a remover nao diz nada, e o erro que nao e banco ocupado e dito sem derrubar', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    gravar(acervo, 2);
    const linhas: string[] = [];
    const parar = iniciarAparagemDoDiario(acervo, { agora: () => Date.now(), escrever: (t) => linhas.push(t), primeiroPassoMs: 10, intervaloMs: 20 });
    await new Promise((r) => setTimeout(r, 120));
    parar();
    assert.deepEqual(linhas, [], 'tudo dentro da retencao: silencio');
    assert.equal(contar(acervo), 3);

    const comErro: string[] = [];
    const { acervo: outro } = c.novoInquilino('Bail');
    outro.fechar();
    const parar2 = iniciarAparagemDoDiario(outro, { agora: () => Date.now(), escrever: (t) => comErro.push(t), primeiroPassoMs: 10, intervaloMs: 60_000 });
    assert.equal(await esperar(() => comErro.length > 0), true);
    parar2();
    assert.match(comErro[0]!, /aparagem do diario de chegadas abortou/);
  } finally {
    c.limpar();
  }
});

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

/** Conecta, fica ABERTA e so desloga quando `fecharAgora()` for chamado: o teste controla o instante. */
function bibliotecaAberta(): { biblioteca: unknown; abrirConexao: () => void; fecharAgora: () => void } {
  const ouvintes = new Map<string, (dado: unknown) => void>();
  const biblioteca = {
    default: () => ({
      ev: { on: (fluxo: string, f: (dado: unknown) => void) => ouvintes.set(fluxo, f) },
      requestPairingCode: () => Promise.resolve('12345678'),
      sendMessage: () => Promise.resolve(undefined),
    }),
    useMultiFileAuthState: () => Promise.resolve({ state: {}, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401, connectionClosed: 428, connectionLost: 408 },
  };
  return {
    biblioteca,
    abrirConexao: (): void => {
      setImmediate(() => ouvintes.get('connection.update')?.({ connection: 'open' }));
    },
    fecharAgora: (): void => {
      ouvintes.get('connection.update')?.({
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 401 } } },
      });
    },
  };
}

function instalarComDiarioVelho(conta: string): { raiz: string; id: string; limpar: () => void } {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const id = criarInquilino(registro, { titularNome: 'Leia' });
  registro.fechar();
  comConfiguracao(raiz, 'teste');
  comVinculo(raiz, conta);
  const acervo = abrirAcervo(join(raiz, 'acervos'), id);
  try {
    gravar(acervo, 3);
    acervo.db.prepare('UPDATE chegadas SET criado_em = ?').run(Date.now() - 40 * DIA);
  } finally {
    acervo.fechar();
  }
  return { raiz, id, limpar };
}

function contarNoDisco(raiz: string, id: string): number {
  const acervo = abrirAcervoSomenteLeitura(join(raiz, 'acervos'), id);
  try {
    return contar(acervo);
  } finally {
    acervo.fechar();
  }
}

/** Sobe o ouvinte com o ambiente dado, espera o Diario ficar so com a ultima Chegada, e o para. Devolve as linhas do registro. */
async function ouvinteQueApara(
  conta: string,
  ambiente: Record<string, string>,
  depoisDeParar?: (raiz: string, id: string, linhas: string[]) => Promise<void>,
): Promise<string[]> {
  const { raiz, id, limpar } = instalarComDiarioVelho(conta);
  const linhas: string[] = [];
  try {
    for (const [k, v] of Object.entries(ambiente)) process.env[k] = v;
    const fake = bibliotecaAberta();
    const promessa = ouvir(['ouvir', '--inquilino', id, '--conta', conta, '--configuracao', 'teste'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => linhas.push(t),
      carregarBiblioteca: () => {
        fake.abrirConexao();
        return Promise.resolve(fake.biblioteca as never);
      },
    });
    try {
      assert.equal(await esperar(() => contarNoDisco(raiz, id) === 1), true, 'o ouvinte vivo apara o que passou de 30 dias');
    } finally {
      fake.fecharAgora();
      await promessa;
      for (const k of Object.keys(ambiente)) delete process.env[k];
    }
    if (depoisDeParar !== undefined) await depoisDeParar(raiz, id, linhas);
    return linhas;
  } finally {
    limpar();
  }
}

test('o ouvinte apara o Diario depois da subida: o PRIMEIRO passo vem do ambiente', async () => {
  const linhas = await ouvinteQueApara('conta-primeiro-passo', {
    MALOTE_APARAGEM_PRIMEIRO_MS: '30',
    MALOTE_APARAGEM_INTERVALO_MS: '3600000',
  });
  assert.match(linhas.join('\n'), /diario de chegadas: 3 aparada\(s\)/);
});

test('o ouvinte apara o Diario depois da subida: o INTERVALO vem do ambiente', async () => {
  const linhas = await ouvinteQueApara('conta-intervalo', { MALOTE_APARAGEM_INTERVALO_MS: '30' });
  assert.match(linhas.join('\n'), /diario de chegadas: 3 aparada\(s\)/);
});

test('o ouvinte para de aparar quando para', async () => {
  await ouvinteQueApara(
    'conta-para',
    { MALOTE_APARAGEM_PRIMEIRO_MS: '30', MALOTE_APARAGEM_INTERVALO_MS: '30' },
    async (raiz, id, linhas) => {
      // Depois de parado, nada mais e removido, ainda que o intervalo fosse de 30 ms.
      const acervo = abrirAcervo(join(raiz, 'acervos'), id);
      try {
        gravar(acervo, 2);
        acervo.db.prepare('UPDATE chegadas SET criado_em = ?').run(Date.now() - 40 * DIA);
      } finally {
        acervo.fechar();
      }
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(contarNoDisco(raiz, id), 3, 'o aparador parou junto com o ouvinte');
      assert.doesNotMatch(linhas.join('\n'), /abortou/, 'o aparador nao ficou tentando contra o Acervo ja fechado');
    },
  );
});

test('o ouvinte NAO apara na subida: sem o ambiente, o primeiro passo e de 10 minutos', async () => {
  const { raiz, id, limpar } = instalarComDiarioVelho('conta-sem-aparagem');
  try {
    delete process.env['MALOTE_APARAGEM_PRIMEIRO_MS'];
    delete process.env['MALOTE_APARAGEM_INTERVALO_MS'];
    const fake = bibliotecaAberta();
    const promessa = ouvir(['ouvir', '--inquilino', id, '--conta', 'conta-sem-aparagem', '--configuracao', 'teste'], {
      dados: raiz,
      estado: raiz,
      escrever: () => undefined,
      carregarBiblioteca: () => {
        fake.abrirConexao();
        return Promise.resolve(fake.biblioteca as never);
      },
    });
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(contarNoDisco(raiz, id), 4, 'nada foi aparado na subida nem logo depois');
    fake.fecharAgora();
    await promessa;
  } finally {
    limpar();
  }
});
