import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conectar } from '../src/adaptadores/whatsapp/conexao.js';

/**
 * Fábrica de biblioteca falsa que GUARDA os fluxos assinados e deixa disparar
 * qualquer um deles. É o que permite perguntar "o ouvinte assina isto?" sem
 * rede e sem conta real.
 */
function bibliotecaEspelho(): {
  lib: unknown;
  assinados: () => string[];
  disparar: (fluxo: string, dado: unknown) => void;
} {
  const ouvintes = new Map<string, Array<(dado: unknown) => void>>();
  const lib = {
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
  return {
    lib,
    assinados: () => [...ouvintes.keys()],
    disparar: (fluxo, dado) => {
      for (const f of ouvintes.get(fluxo) ?? []) f(dado);
    },
  };
}

/**
 * O app-state é a camada que carrega favorito, fixação, arquivado e o nome que
 * o dono da conta cadastrou na agenda. Medido em 07/09/2026: nada disso viaja
 * na Mensagem — `pushName` aparece em 415.171 payloads capturados, nome de
 * agenda em nenhum —, e o ouvinte assinava só três fluxos, nenhum deles de
 * app-state.
 *
 * Estas assinaturas SÓ REGISTRAM. Nada entra no Acervo: primeiro se descobre o
 * que chega, depois se decide o que vale modelar.
 */
test('o ouvinte assina os fluxos de app-state, e nao so os tres de mensagem', async () => {
  const espelho = bibliotecaEspelho();
  const conexao = await conectar({
    pastaDoVinculo: '/tmp/vinculo-que-nao-existe',
    registrar: () => undefined,
    aoReceber: () => undefined,
    aoTerminar: () => undefined,
    carregarBiblioteca: () => Promise.resolve(espelho.lib),
  });
  try {
    const assinados = espelho.assinados();
    for (const esperado of [
      'contacts.upsert',
      'contacts.update',
      'chats.upsert',
      'chats.update',
      'messages.update',
      // A SEGUNDA fonte possivel de Retrato de Estado, e ela nunca foi
      // assinada — entao "nao chega" nunca foi medido, so nao observado.
      // Entrega `chats`, `contacts` e `messages` de uma vez na sincronizacao.
      'messaging-history.set',
    ]) {
      assert.ok(assinados.includes(esperado), `nao assinou ${esperado}`);
    }
    // E os três originais continuam lá: acrescentar não pode ter tirado nada.
    for (const antigo of ['connection.update', 'creds.update', 'messages.upsert']) {
      assert.ok(assinados.includes(antigo), `perdeu a assinatura de ${antigo}`);
    }
  } finally {
    conexao.parar();
  }
});

test('observador que estoura NAO derruba o ouvinte — a Mensagem seguinte ainda entra', async () => {
  const espelho = bibliotecaEspelho();
  const recebidas: unknown[] = [];
  const linhas: string[] = [];
  const conexao = await conectar({
    pastaDoVinculo: '/tmp/vinculo-que-nao-existe',
    registrar: (t: string) => linhas.push(t),
    aoReceber: (m: unknown) => recebidas.push(m),
    aoTerminar: () => undefined,
    carregarBiblioteca: () => Promise.resolve(espelho.lib),
  });
  try {
    // Payload hostil: ler qualquer valor estoura. O emissor de eventos NÃO
    // protege — handler que lança mata o processo, e o processo aqui é a
    // captura. Este é o cenário que a guarda existe para cobrir.
    const hostil = [
      Object.defineProperty({}, 'name', {
        get() {
          throw new Error('payload hostil');
        },
        enumerable: true,
      }),
    ];

    assert.doesNotThrow(
      () => espelho.disparar('contacts.update', hostil),
      'o observador deixou a excecao escapar',
    );

    // A prova de que o ouvinte continua vivo é a Mensagem seguinte ENTRAR.
    // Sem esta asserção, um observador que engolisse tudo e travasse a conexão
    // passaria igual.
    espelho.disparar('messages.upsert', { messages: [{ chave: 'depois-do-estouro' }] });
    assert.equal(recebidas.length, 1, 'a Mensagem seguinte ao estouro nao foi recebida');
  } finally {
    conexao.parar();
  }
});

/**
 * O gancho de captura recebe o dado CRU, e o log continua recebendo so forma.
 *
 * As duas asserções são o par: sem a primeira, a captura poderia nao ser
 * chamada; sem a segunda, ela poderia ter passado a escrever valor no log do
 * servico, que e a propriedade que nao se negocia.
 */
test('o gancho de captura recebe o dado cru, e o log continua so com forma', async () => {
  const espelho = bibliotecaEspelho();
  const capturado: Array<{ fluxo: string; dado: unknown }> = [];
  const linhas: string[] = [];
  const conexao = await conectar({
    pastaDoVinculo: '/tmp/vinculo-que-nao-existe',
    registrar: (t: string) => linhas.push(t),
    aoReceber: () => undefined,
    aoTerminar: () => undefined,
    carregarBiblioteca: () => Promise.resolve(espelho.lib),
    capturar: (fluxo: string, dado: unknown) => capturado.push({ fluxo, dado }),
  });
  try {
    espelho.disparar('contacts.upsert', [{ id: 'a@s.whatsapp.net', name: 'Nome Sintetico' }]);

    assert.deepEqual(capturado, [
      { fluxo: 'contacts.upsert', dado: [{ id: 'a@s.whatsapp.net', name: 'Nome Sintetico' }] },
    ]);
    const doLog = linhas.filter((l) => l.includes('[app-state]')).join('\n');
    assert.ok(doLog.includes('contacts.upsert'), 'o log perdeu a linha de forma');
    assert.equal(
      doLog.includes('Nome Sintetico'),
      false,
      'VALOR vazou para o log do servico',
    );
  } finally {
    conexao.parar();
  }
});

test('aoEstado recebe o dado CRU de chats.update e de messaging-history.set', async () => {
  const espelho = bibliotecaEspelho();
  const vistos: Array<{ fluxo: string; dado: unknown }> = [];
  const conexao = await conectar({
    pastaDoVinculo: '/tmp/vinculo-que-nao-existe',
    registrar: () => undefined,
    aoReceber: () => undefined,
    aoTerminar: () => undefined,
    carregarBiblioteca: () => Promise.resolve(espelho.lib),
    aoEstado: (fluxo, dado) => vistos.push({ fluxo, dado }),
  });
  try {
    const chats = [{ id: 'a@s.whatsapp.net', pinned: true }];
    espelho.disparar('chats.update', chats);
    const envelope = { chats, contacts: [{ id: 'c' }], messages: [{}] };
    espelho.disparar('messaging-history.set', envelope);
    assert.equal(vistos.length, 2);
    assert.equal(vistos[0]?.fluxo, 'chats.update');
    assert.equal(vistos[0]?.dado, chats);
    assert.equal(vistos[1]?.fluxo, 'messaging-history.set');
    assert.equal(vistos[1]?.dado, envelope);
  } finally {
    conexao.parar();
  }
});

test('aoEstado que estoura NAO impede a Mensagem seguinte', async () => {
  const espelho = bibliotecaEspelho();
  const recebidas: unknown[] = [];
  const conexao = await conectar({
    pastaDoVinculo: '/tmp/vinculo-que-nao-existe',
    registrar: () => undefined,
    aoReceber: (m: unknown) => recebidas.push(m),
    aoTerminar: () => undefined,
    carregarBiblioteca: () => Promise.resolve(espelho.lib),
    aoEstado: () => {
      throw new Error('processador quebrado');
    },
  });
  try {
    assert.doesNotThrow(() =>
      espelho.disparar('chats.update', [{ id: 'a@s.whatsapp.net', pinned: true }]),
    );
    espelho.disparar('messages.upsert', { messages: [{ chave: 'depois' }] });
    assert.equal(recebidas.length, 1);
  } finally {
    conexao.parar();
  }
});

test('sem gancho declarado, observar segue funcionando — a captura e opcional', async () => {
  const espelho = bibliotecaEspelho();
  const linhas: string[] = [];
  const conexao = await conectar({
    pastaDoVinculo: '/tmp/vinculo-que-nao-existe',
    registrar: (t: string) => linhas.push(t),
    aoReceber: () => undefined,
    aoTerminar: () => undefined,
    carregarBiblioteca: () => Promise.resolve(espelho.lib),
  });
  try {
    assert.doesNotThrow(() => espelho.disparar('contacts.upsert', [{ id: 'a' }]));
    assert.ok(linhas.some((l) => l.includes('[app-state] contacts.upsert')));
  } finally {
    conexao.parar();
  }
});
