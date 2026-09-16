import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paraDrenar } from './ajuda/drenagem.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino, listarInquilinos } from '../src/registro/registro.js';
import { caminhosDaConta, ouvir } from '../src/cli/ouvir.js';
import { lerUltimoEvento, marcarUltimoEvento } from '../src/cli/ultimo-evento.js';
import {
  caminhoDoEnvenenado,
  contarDerrame,
  derramar,
  lerDerrame,
} from '../src/cli/derrame.js';
import { drenar } from '../src/cli/ouvir.js';
import { abrirAcervo, abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { existsSync } from 'node:fs';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';

/**
 * Biblioteca falsa que sobe e imediatamente diz "deslogado".
 *
 * Existe para exercitar a ponta que o coletor descartavel nao tinha: o modulo
 * de conexao nao pode chamar `process.exit`, entao precisa AVISAR quem o
 * chamou de que nao vai voltar.
 */
function bibliotecaQueDesloga(): { disparar: () => void } {
  const ouvintes = new Map<string, (dado: unknown) => void>();
  return {
    default: () => ({
      ev: { on: (fluxo: string, f: (dado: unknown) => void) => ouvintes.set(fluxo, f) },
      requestPairingCode: () => Promise.resolve('12345678'),
    }),
    useMultiFileAuthState: () => Promise.resolve({ state: {}, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401 },
    // O disparo acontece no proximo tique, depois de `conectar` ter assinado.
    disparar: (): void => {
      setImmediate(() =>
        ouvintes.get('connection.update')?.({
          connection: 'close',
          lastDisconnect: { error: { output: { statusCode: 401 } } },
        }),
      );
    },
  } as unknown as { disparar: () => void };
}

/**
 * Cria a Configuracao no Registro. O `ouvir` a BUSCA e recusa quando nao acha —
 * criar no caminho ao vivo produziria Configuracao vazia recebendo Conversa.
 */
function comConfiguracao(raiz: string, apelido: string): void {
  const registro = abrirRegistro(raiz);
  try {
    const inquilinos = listarInquilinos(registro);
    const id = inquilinos[0]?.id;
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

test('o ouvinte recusa Inquilino desconhecido antes de tocar na rede', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const linhas: string[] = [];
    const codigo = await ouvir(['ouvir', '--inquilino', 'nao-existe', '--conta', 'a', '--configuracao', 'teste'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => linhas.push(t),
    });
    assert.equal(codigo, 1);
    assert.match(linhas.join('\n'), /Inquilino desconhecido/);
  } finally {
    limpar();
  }
});

test('a conta e obrigatoria — um processo, uma conta', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const id = criarInquilino(registro, { titularNome: 'Bail' });
    registro.fechar();
    const linhas: string[] = [];
    const codigo = await ouvir(['ouvir', '--inquilino', id, '--configuracao', 'teste'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => linhas.push(t),
    });
    assert.equal(codigo, 2);
    assert.match(linhas.join('\n'), /--conta/);
  } finally {
    limpar();
  }
});

test('conta nao pareada e sem numero para em vez de religar para sempre', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const id = criarInquilino(registro, { titularNome: 'Wedge' });
    registro.fechar();
    // A Configuracao existe: o que este teste mede e a falta de VINCULO, e sem
    // ela o guard anterior responderia primeiro.
    comConfiguracao(raiz, 'teste');
    const linhas: string[] = [];
    // Sem vinculo, o socket sobe nao-registrado, toma 428 e a religacao tenta
    // de novo para sempre — espera sem prazo disfarcada de processo saudavel.
    const codigo = await ouvir(['ouvir', '--inquilino', id, '--conta', 'nova', '--configuracao', 'teste'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => linhas.push(t),
      carregarBiblioteca: () => Promise.reject(new Error('nao deveria chegar aqui')),
    });
    assert.equal(codigo, 2);
    assert.match(linhas.join('\n'), /--numero/);
  } finally {
    limpar();
  }
});

test('a subida NAO cria a pasta do ouvinte — pre-condicao do operador', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const id = criarInquilino(registro, { titularNome: 'Wedge' });
    registro.fechar();
    comConfiguracao(raiz, 'teste');
    const linhas: string[] = [];
    // Conta sem vinculo e sem numero: a recusa vem antes de conectar. E a
    // pasta <raiz>/ouvinte/<conta> NAO pode ter nascido no caminho: criacao de
    // diretorio na subida e o trabalho que travou em filesystem patologico
    // (CONTEXTO.md) — e pre-condicao do operador, nao da partida.
    const codigo = await ouvir(['ouvir', '--inquilino', id, '--conta', 'nova', '--configuracao', 'teste'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => linhas.push(t),
      carregarBiblioteca: () => Promise.reject(new Error('nao deveria chegar aqui')),
    });
    assert.equal(codigo, 2);
    assert.equal(existsSync(join(raiz, 'ouvinte')), false, 'a partida criou a pasta do ouvinte');
  } finally {
    limpar();
  }
});

test('a partida declara o risco e a lacuna, ANTES de conectar', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const id = criarInquilino(registro, { titularNome: 'Mothma' });
    registro.fechar();
    comVinculo(raiz, 'pessoal');
    comConfiguracao(raiz, 'teste');
    marcarUltimoEvento(
      caminhosDaConta(raiz, 'pessoal').ultimoEvento,
      Date.parse('2026-09-01T12:00:00Z'),
    );

    const linhas: string[] = [];
    // A biblioteca e injetada e recusa carregar: o que se mede aqui e o que o
    // comando DIZ antes de tocar na rede, e nao a conexao.
    const codigo = await ouvir(['ouvir', '--inquilino', id, '--conta', 'pessoal', '--configuracao', 'teste'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => linhas.push(t),
      carregarBiblioteca: () => Promise.reject(new Error('sem rede no teste')),
      agora: () => Date.parse('2026-09-02T12:00:00Z'),
    });
    const texto = linhas.join('\n');
    // O aviso sai em TODA partida, e nao so na primeira: "primeira execucao" e
    // estado que alguem zera reinstalando.
    assert.match(texto, /nao-oficial/);
    assert.match(texto, /bloqueada/);
    // A lacuna e DECLARADA, nao silencio.
    assert.match(texto, /Ultimo evento recebido em 2026-09-01/);
    assert.match(texto, /Intervalo sem cobertura: 24 h/);
    assert.match(texto, /importacao de backup posterior/);
    assert.equal(codigo, 1, 'falha ao carregar a biblioteca sai diferente de zero');
  } finally {
    limpar();
  }
});

test('vinculo invalidado encerra o processo, e nao o deixa pendurado', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const id = criarInquilino(registro, { titularNome: 'Hera' });
    registro.fechar();
    comVinculo(raiz, 'pessoal');
    comConfiguracao(raiz, 'teste');

    const linhas: string[] = [];
    const codigo = await ouvir(['ouvir', '--inquilino', id, '--conta', 'pessoal', '--configuracao', 'teste'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => linhas.push(t),
      carregarBiblioteca: () => {
        const lib = bibliotecaQueDesloga();
        lib.disparar();
        return Promise.resolve(lib);
      },
    });
    assert.equal(codigo, 1, 'sair 1 diz ao supervisor que a parada NAO foi pedida');
    assert.match(linhas.join('\n'), /vinculo invalidado/);
  } finally {
    limpar();
  }
});

test('o vinculo vive fora do Acervo e do Registro', () => {
  const caminhos = caminhosDaConta('/raiz', 'pessoal');
  // Perder o vinculo custa parear de novo e NADA do acervo.
  assert.ok(!caminhos.vinculo.includes('acervos'));
  assert.ok(!caminhos.vinculo.includes('registro'));
  assert.equal(caminhos.vinculo, join('/raiz', 'ouvinte', 'pessoal', 'vinculo'));
});

/**
 * Biblioteca falsa que ENTREGA UMA MENSAGEM e depois desloga.
 *
 * O deslogar no fim existe para o `ouvir` retornar em vez de escutar para
 * sempre; o que o teste mede acontece antes dele.
 */
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

/**
 * O TESTE QUE MEDE O DEFEITO DE 08/09/2026, e ele segura a trava DE VERDADE.
 *
 * Simular o erro com um dublê provaria que o `catch` existe, não que ele pega
 * o que acontece em produção. Aqui uma segunda conexão abre `BEGIN IMMEDIATE`
 * e não solta: é a mesma disputa que a conversão produz.
 *
 * DEMORA ~5 SEGUNDOS de propósito — é o `busy_timeout` esgotando, que é
 * exatamente o que acontece no host. Encurtá-lo seria medir outra coisa.
 */
test('com o Acervo travado, o ouvinte DERRAMA o evento e continua vivo', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const Database = (await import('better-sqlite3')).default;
  let travador: InstanceType<typeof Database> | undefined;
  try {
    const registro = abrirRegistro(raiz);
    const id = criarInquilino(registro, { titularNome: 'Jyn' });
    registro.fechar();
    comConfiguracao(raiz, 'teste');
    comVinculo(raiz, 'trancada');

    // Cria o Acervo ANTES: abrir para escrita migra, e migrar com a base
    // travada mediria a migração, não a recepção.
    const { abrirAcervo } = await import('../src/nucleo/acervo.js');
    abrirAcervo(join(raiz, 'acervos'), id).fechar();

    const biblioteca = bibliotecaQueEntrega({
      key: { remoteJid: '5511000000009@s.whatsapp.net', id: 'TRAVADA1', fromMe: false },
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: { conversation: 'nao deve sumir' },
    });
    const linhas: string[] = [];
    const codigo = await ouvir(
      ['ouvir', '--inquilino', id, '--conta', 'trancada', '--configuracao', 'teste'],
      {
        dados: raiz,
        estado: raiz,
        escrever: (t: string) => linhas.push(t),
        // A TRAVA ENTRA AQUI, e o lugar importa: `carregarBiblioteca` roda
        // DEPOIS de `abrirAcervo`. Travar antes mediria outra coisa — a base
        // ocupada na PARTIDA derruba o ouvinte no `abrirAcervo`, que é falha
        // de subir, não de receber. Em produção ele já estava de pé quando a
        // conversão começou.
        carregarBiblioteca: () => {
          travador = new Database(join(raiz, 'acervos', `${id}.db`));
          travador.pragma('journal_mode = WAL');
          travador.prepare('BEGIN IMMEDIATE').run();
          setImmediate(() => biblioteca.disparar());
          return Promise.resolve(biblioteca as never);
        },
      },
    );

    // 1 é o código do LOGOUT que o dublê dispara DEPOIS do evento — não é
    // crash. E é justamente ele a prova de que a execução continuou: se a
    // escrita travada tivesse derrubado o processo, o logout nunca teria sido
    // processado e a promessa teria REJEITADO em vez de resolver.
    assert.equal(codigo, 1, 'o ouvinte não chegou a processar o logout — morreu antes');
    const derramados = lerDerrame(caminhosDaConta(raiz, 'trancada').derrame);
    assert.equal(derramados.length, 1, `nao derramou. o ouvinte disse: ${linhas.join(' | ')}`);
    assert.equal(
      (derramados[0] as { key: { id: string } }[])[0]?.key.id,
      'TRAVADA1',
      'o derrame não preservou o evento',
    );
    assert.match(linhas.join('\n'), /derramad/i, 'o ouvinte não avisou que derramou');
  } finally {
    travador?.close();
    limpar();
  }
});

// --- a drenagem (#842): tres cenarios que so a chamada direta alcanca ---
//
// O manipulador de eventos e SINCRONO: `receberEvento` sucede,
// `marcarUltimoEvento`, `drenar` — tudo na mesma pilha. Nao existe ponto em que
// um teste pela biblioteca falsa adquira a trava ENTRE o sucesso e a drenagem,
// entao disputa DURANTE a drenagem so e alcancavel chamando `drenar` direto.

function eventoDe(idExterno: string): unknown {
  return {
    key: { remoteJid: '5511000000009@s.whatsapp.net', id: idExterno, fromMe: false },
    messageTimestamp: Math.floor(Date.parse('2026-09-09T10:00:00Z') / 1000),
    message: { conversation: idExterno },
  };
}

test('a drenagem consome no maximo o limite por execucao', async () => {
  const c = await paraDrenar();
  try {
    for (let i = 0; i < 5; i += 1) derramar(c.caminho, [eventoDe(`L${i}`)]);
    drenar(c.acervo, c.caminho, c.cfg, () => Date.now(), () => undefined);
    assert.equal(contarDerrame(c.caminho), 2, 'drenou tudo de uma vez, e o limite era 3');
  } finally {
    c.limpar();
  }
});

test('drenagem que esbarra na disputa PARA, e o lote continua no derrame', async () => {
  const c = await paraDrenar();
  const Database = (await import('better-sqlite3')).default;
  const travador = new Database(join(c.raiz, 'acervos', `${c.id}.db`));
  try {
    derramar(c.caminho, [eventoDe('PRESO')]);
    travador.pragma('journal_mode = WAL');
    travador.prepare('BEGIN IMMEDIATE').run();

    const ditas: string[] = [];
    // NAO pode lancar: disputa na drenagem nao mata o ouvinte.
    drenar(c.acervo, c.caminho, c.cfg, () => Date.now(), (t: string) => ditas.push(t));

    // ESTE assert mata o mutante da ORDEM: com `removerPrimeiroLote` ANTES de
    // `receberEvento`, o lote sai do arquivo e nao entra no Acervo — some dos
    // dois lados, que e exatamente a perda que a ordem existe para impedir.
    assert.equal(contarDerrame(c.caminho), 1, 'o lote sumiu do derrame sem ter sido gravado');
    assert.match(ditas.join('\n'), /adiada|ocupado/i);
  } finally {
    travador.close();
    c.limpar();
  }
});

test('lote venenoso sai para o irmao, e a drenagem seguinte NAO o retenta', async () => {
  const c = await paraDrenar();
  try {
    // O veneno tem de LANCAR, e nao virar `recusado`: erro de DADO dentro de
    // `receberEvento` e capturado por evento e vira recusa, o lote seria
    // removido como sucesso, e o teste passaria por vacuidade. `[null]` estoura
    // no acesso a `m.key`, ANTES do try por evento.
    derramar(c.caminho, [null]);
    derramar(c.caminho, [eventoDe('BOM')]);

    const ditas: string[] = [];
    drenar(c.acervo, c.caminho, c.cfg, () => Date.now(), (t: string) => ditas.push(t));

    assert.match(ditas.join('\n'), /ENVENENADO/, 'o aviso alto nao saiu');
    assert.equal(contarDerrame(c.caminho), 0, 'o bom nao foi drenado depois do venenoso');
    assert.equal(existsSync(caminhoDoEnvenenado(c.caminho)), true);

    // O LACO QUE ESTE CRITERIO EXISTE PARA CORTAR: a proxima drenagem nao pode
    // reencontrar o mesmo lote.
    const ditasDepois: string[] = [];
    drenar(c.acervo, c.caminho, c.cfg, () => Date.now(), (t: string) => ditasDepois.push(t));
    assert.equal(
      ditasDepois.join('\n').includes('ENVENENADO'),
      false,
      'retentou o venenoso — o laco continua de pe',
    );

    const noAcervo = c.acervo
      .preparar('SELECT COUNT(*) AS n FROM mensagens WHERE id_externo = ?')
      .get('BOM') as { n: number };
    assert.equal(noAcervo.n, 1, 'o lote bom depois do venenoso nao entrou');
  } finally {
    c.limpar();
  }
});

/**
 * Entrega duas mensagens, com um gancho no meio.
 *
 * A ordem e o teste inteiro: a primeira chega com a base travada (derrama), o
 * gancho SOLTA a trava, a segunda chega e grava — e e o sucesso dela que dispara
 * a drenagem. O deslogar no fim existe so para `ouvir` retornar.
 *
 * Cada passo em seu proprio `setImmediate`: `conexao.ts` assina os fluxos depois
 * que a biblioteca resolve, e disparar antes disso perde o evento.
 */
function bibliotecaQueEntregaEmDuas(
  primeira: unknown,
  segunda: unknown,
  entreElas: () => void,
): { disparar: () => void } {
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
        ouvintes.get('messages.upsert')?.({ type: 'notify', messages: [primeira] });
        entreElas();
        setImmediate(() => {
          ouvintes.get('messages.upsert')?.({ type: 'notify', messages: [segunda] });
          setImmediate(() =>
            ouvintes.get('connection.update')?.({
              connection: 'close',
              lastDisconnect: { error: { output: { statusCode: 401 } } },
            }),
          );
        });
      });
    },
  } as unknown as { disparar: () => void };
}

test('depois que a trava sai, o ouvinte drena sozinho o que derramou', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const Database = (await import('better-sqlite3')).default;
  let travador: InstanceType<typeof Database> | undefined;
  try {
    const registro = abrirRegistro(raiz);
    const id = criarInquilino(registro, { titularNome: 'Bodhi' });
    registro.fechar();
    comConfiguracao(raiz, 'teste');
    comVinculo(raiz, 'drena');
    abrirAcervo(join(raiz, 'acervos'), id).fechar();

    const biblioteca = bibliotecaQueEntregaEmDuas(
      eventoDe('DERRAMADA'),
      eventoDe('DEPOIS'),
      () => {
        travador?.close();
        travador = undefined;
      },
    );

    const linhas: string[] = [];
    await ouvir(['ouvir', '--inquilino', id, '--conta', 'drena', '--configuracao', 'teste'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => linhas.push(t),
      carregarBiblioteca: () => {
        travador = new Database(join(raiz, 'acervos', `${id}.db`));
        travador.pragma('journal_mode = WAL');
        travador.prepare('BEGIN IMMEDIATE').run();
        setImmediate(() => biblioteca.disparar());
        return Promise.resolve(biblioteca as never);
      },
    });

    // VACUIDADE: sem derrame no meio, este teste passaria sem medir nada.
    assert.match(linhas.join('\n'), /derramad/i, 'o cenario nao produziu derrame');

    // CRITERIO 7: derramar NAO pode parecer silencio. O instante do ultimo
    // evento avanca mesmo quando o Acervo recusou a escrita — o ouvinte esta
    // vivo e recebendo, e declara-lo parado mandaria olhar o lugar errado.
    assert.notEqual(
      lerUltimoEvento(caminhosDaConta(raiz, 'drena').ultimoEvento),
      null,
      'o derrame nao marcou o ultimo evento',
    );

    const acervo = abrirAcervoSomenteLeitura(join(raiz, 'acervos'), id);
    try {
      const ids = (
        acervo.preparar('SELECT id_externo FROM mensagens').all() as { id_externo: string }[]
      ).map((x) => x.id_externo);
      assert.deepEqual(ids.sort(), ['DEPOIS', 'DERRAMADA'], 'a derramada nao foi drenada');
    } finally {
      acervo.fechar();
    }
    assert.equal(contarDerrame(caminhosDaConta(raiz, 'drena').derrame), 0, 'o derrame nao esvaziou');
  } finally {
    travador?.close();
    limpar();
  }
});

test('ouvir anota favoritosSemMensagem quando a Mensagem nao existe', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const id = criarInquilino(registro, { titularNome: 'Jyn' });
    registro.fechar();
    comConfiguracao(raiz, 'teste');
    comVinculo(raiz, 'fav');
    abrirAcervo(join(raiz, 'acervos'), id).fechar();

    const ouvintes = new Map<string, Array<(dado: unknown) => void>>();
    const biblioteca = {
      default: () => ({
        ev: {
          on: (fluxo: string, f: (dado: unknown) => void) => {
            const atuais = ouvintes.get(fluxo) ?? [];
            atuais.push(f);
            ouvintes.set(fluxo, atuais);
          },
        },
        requestPairingCode: () => Promise.resolve('12345678'),
      }),
      useMultiFileAuthState: () => Promise.resolve({ state: {}, saveCreds: () => undefined }),
      DisconnectReason: { loggedOut: 401 },
    };
    const codigo = await ouvir(
      ['ouvir', '--inquilino', id, '--conta', 'fav', '--configuracao', 'teste'],
      {
        dados: raiz,
        estado: raiz,
        escrever: () => undefined,
        carregarBiblioteca: () => {
          setImmediate(() => {
            for (const f of ouvintes.get('messages.update') ?? []) {
              f([{ key: { id: 'sumida' }, update: { starred: true } }]);
            }
            setImmediate(() => {
              for (const f of ouvintes.get('connection.update') ?? []) {
                f({
                  connection: 'close',
                  lastDisconnect: { error: { output: { statusCode: 401 } } },
                });
              }
            });
          });
          return Promise.resolve(biblioteca);
        },
      },
    );
    assert.equal(codigo, 1);
    const { lerPulos } = await import('../src/cli/pulos.js');
    assert.equal(lerPulos(caminhosDaConta(raiz, 'fav').pulos).favoritosSemMensagem, 1);
  } finally {
    limpar();
  }
});
