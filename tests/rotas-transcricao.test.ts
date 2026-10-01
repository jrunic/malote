import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { criarServidor } from '../src/rede/servidor.js';
import { pedirGet } from '../src/cli/cliente.js';
import { cenario } from './ajuda/acervo.js';
import { registrarConversa, registrarMensagem, registrarAnexo } from '../src/nucleo/escrita.js';
import { emitirChaveDeAcesso } from '../src/registro/chave-de-acesso.js';
import { abrirRegistro } from '../src/registro/registro.js';
// Usado para reabrir e CONFERIR efeito depois que um teste fecha o Acervo —
// sempre em par com `.fechar()` no `finally`, nunca deixado aberto.
import { abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

async function portaLivre(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const porta = (srv.address() as { port: number }).port;
  await new Promise<void>((r) => srv.close(() => r()));
  return porta;
}

test('GET /mensagens inclui a Transcricao do Anexo de audio', async () => {
  const c = cenario();
  try {
    const { id: inquilinoId, acervo } = c.novoInquilino('Leia');
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: '111@s.whatsapp.net', coletiva: false, configuracao: CFG_WHATSAPP,
    });
    const mensagemId = registrarMensagem(acervo, {
      direcao: 'recebida', conversaId, fonte: 'whatsapp', idExterno: 'm1',
      ocorridaEm: Date.parse('2026-09-01T12:00:00Z'), agora: Date.now(),
    });
    const anexoId = registrarAnexo(acervo, {
      mensagemId, tipo: 'audio', presenca: 'presente', caminho: '/x/a1.opus',
    });
    acervo
      .preparar(
        `INSERT INTO transcricoes (anexo_id, estado, texto, motor, modelo, gerada_em)
         VALUES (?, 'concluida', 'ola mundo', 'whisper.cpp', 'small', '2026-09-28T00:00:00.000Z')`,
      )
      .run(anexoId);
    acervo.fechar();

    const registro = abrirRegistro(c.raiz);
    const chave = emitirChaveDeAcesso(registro, inquilinoId);
    registro.fechar();

    const porta = await portaLivre();
    const srv = criarServidor({ dados: c.raiz, porta });
    await new Promise<void>((r) => srv.listen(porta, '127.0.0.1', r));
    try {
      const r = await pedirGet(`http://127.0.0.1:${porta}`, chave.valor, '/mensagens');
      assert.equal(r.status, 200);
      const corpo = JSON.parse(r.corpo) as {
        mensagens: Array<{ anexos: Array<{ transcricao: { texto: string } | null }> }>;
      };
      assert.equal(corpo.mensagens[0]?.anexos[0]?.transcricao?.texto, 'ola mundo');
    } finally {
      srv.close();
    }
  } finally {
    c.limpar();
  }
});

test('POST /transcricoes/solicitar aceita um Anexo elegível, com 202, e grava o Ator certo', async () => {
  const c = cenario();
  try {
    const { id: inquilinoId, acervo } = c.novoInquilino('Leia');
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: '111@s.whatsapp.net', coletiva: false, configuracao: CFG_WHATSAPP,
    });
    const mensagemId = registrarMensagem(acervo, {
      direcao: 'recebida', conversaId, fonte: 'whatsapp', idExterno: 'm1',
      ocorridaEm: Date.now(), agora: Date.now(),
    });
    const anexoId = registrarAnexo(acervo, {
      mensagemId, tipo: 'audio', presenca: 'presente', caminho: '/x/a1.opus',
    });
    acervo.fechar();

    const registro = abrirRegistro(c.raiz);
    const chave = emitirChaveDeAcesso(registro, inquilinoId);
    registro.fechar();

    const porta = await portaLivre();
    const srv = criarServidor({ dados: c.raiz, porta });
    await new Promise<void>((r) => srv.listen(porta, '127.0.0.1', r));
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/transcricoes/solicitar`, {
        method: 'POST',
        headers: { authorization: `Bearer ${chave.valor}`, 'content-type': 'application/json' },
        body: JSON.stringify({ anexoId }),
      });
      assert.equal(r.status, 202);
      const corpo = (await r.json()) as { aceita: boolean };
      assert.equal(corpo.aceita, true);
    } finally {
      srv.close();
    }

    // Reabre SOMENTE-LEITURA, lê, fecha — nunca deixa conexão aberta entre testes.
    const conferencia = abrirAcervoSomenteLeitura(`${c.raiz}/acervos`, inquilinoId);
    try {
      const linha = conferencia
        .preparar('SELECT estado, solicitada_em FROM transcricoes WHERE anexo_id = ?')
        .get(anexoId) as { estado: string; solicitada_em: string | null };
      assert.equal(linha.estado, 'pendente');
      assert.ok(linha.solicitada_em, 'o instante da solicitação foi gravado');

      // CRÍTICO (achado na revisão, dev-10 01/10/2026): a Operação gravada
      // através da rota — chamada ASSÍNCRONA, depois de um `await` dentro do
      // `comAtor(...)` síncrono de servidor.ts — precisa carregar o MESMO
      // Ator que as rotas de leitura já carregam. Prova que o
      // AsyncLocalStorage propaga através do fire-and-forget da rota nova.
      const operacao = conferencia.db
        .prepare(`SELECT ator FROM operacoes WHERE natureza = 'solicitar-transcricao'`)
        .get() as { ator: string } | undefined;
      assert.equal(operacao?.ator, `acesso:${chave.id}`);
    } finally {
      conferencia.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('POST /transcricoes/solicitar recusa Anexo de outro Inquilino como 404, igual inexistente', async () => {
  const c = cenario();
  try {
    const { acervo: acervoAlheio } = c.novoInquilino('Outro Inquilino');
    const conversaAlheia = registrarConversa(acervoAlheio, {
      fonte: 'whatsapp', idExterno: '222@s.whatsapp.net', coletiva: false, configuracao: CFG_WHATSAPP,
    });
    const mensagemAlheia = registrarMensagem(acervoAlheio, {
      direcao: 'recebida', conversaId: conversaAlheia, fonte: 'whatsapp', idExterno: 'm2',
      ocorridaEm: Date.now(), agora: Date.now(),
    });
    const anexoAlheio = registrarAnexo(acervoAlheio, {
      mensagemId: mensagemAlheia, tipo: 'audio', presenca: 'presente', caminho: '/x/alheio.opus',
    });
    acervoAlheio.fechar();

    const { id: inquilinoId, acervo } = c.novoInquilino('Leia');
    acervo.fechar();

    const registro = abrirRegistro(c.raiz);
    const chave = emitirChaveDeAcesso(registro, inquilinoId);
    registro.fechar();

    const porta = await portaLivre();
    const srv = criarServidor({ dados: c.raiz, porta });
    await new Promise<void>((r) => srv.listen(porta, '127.0.0.1', r));
    try {
      const semAnexoNenhum = await fetch(`http://127.0.0.1:${porta}/transcricoes/solicitar`, {
        method: 'POST',
        headers: { authorization: `Bearer ${chave.valor}`, 'content-type': 'application/json' },
        body: JSON.stringify({ anexoId: 'id-que-nao-existe-em-lugar-nenhum' }),
      });

      const doOutroInquilino = await fetch(`http://127.0.0.1:${porta}/transcricoes/solicitar`, {
        method: 'POST',
        headers: { authorization: `Bearer ${chave.valor}`, 'content-type': 'application/json' },
        body: JSON.stringify({ anexoId: anexoAlheio }),
      });

      assert.equal(semAnexoNenhum.status, 404);
      assert.equal(doOutroInquilino.status, 404);
      assert.equal(await semAnexoNenhum.text(), await doOutroInquilino.text(), 'resposta indistinguível');
    } finally {
      srv.close();
    }
  } finally {
    c.limpar();
  }
});

test('POST /transcricoes/solicitar recusa com 400 e o motivo, para Anexo não elegível', async () => {
  const c = cenario();
  try {
    const { id: inquilinoId, acervo } = c.novoInquilino('Leia');
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: '111@s.whatsapp.net', coletiva: false, configuracao: CFG_WHATSAPP,
    });
    const mensagemId = registrarMensagem(acervo, {
      direcao: 'recebida', conversaId, fonte: 'whatsapp', idExterno: 'm1',
      ocorridaEm: Date.now(), agora: Date.now(),
    });
    const imagem = registrarAnexo(acervo, {
      mensagemId, tipo: 'image', presenca: 'presente', caminho: '/x/foto.jpg',
    });
    acervo.fechar();

    const registro = abrirRegistro(c.raiz);
    const chave = emitirChaveDeAcesso(registro, inquilinoId);
    registro.fechar();

    const porta = await portaLivre();
    const srv = criarServidor({ dados: c.raiz, porta });
    await new Promise<void>((r) => srv.listen(porta, '127.0.0.1', r));
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/transcricoes/solicitar`, {
        method: 'POST',
        headers: { authorization: `Bearer ${chave.valor}`, 'content-type': 'application/json' },
        body: JSON.stringify({ anexoId: imagem }),
      });
      assert.equal(r.status, 400);
      const corpo = (await r.json()) as { erro: string };
      assert.equal(corpo.erro, 'nao-e-audio');
    } finally {
      srv.close();
    }
  } finally {
    c.limpar();
  }
});

/**
 * Segura a trava DE VERDADE, mesmo molde de
 * 'com o Acervo travado, o ouvinte DERRAMA o evento e continua vivo' em
 * tests/ouvir.test.ts — um dublê provaria só que o try/catch existe, não que
 * ele pega o que acontece sob disputa real. DEMORA ~5s de propósito: é o
 * `busy_timeout` esgotando, igual em produção. A prova de que o processo não
 * caiu é a REQUISIÇÃO SEGUINTE respondendo normalmente — unhandled rejection
 * derrubaria o `malote servir` inteiro, e essa segunda chamada teria conexão
 * recusada.
 */
test('POST /transcricoes/solicitar sob disputa de escrita: 500, sem derrubar o servidor', async () => {
  const c = cenario();
  const Database = (await import('better-sqlite3')).default;
  let travador: InstanceType<typeof Database> | undefined;
  try {
    const { id: inquilinoId, acervo } = c.novoInquilino('Leia');
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: '111@s.whatsapp.net', coletiva: false, configuracao: CFG_WHATSAPP,
    });
    const mensagemId = registrarMensagem(acervo, {
      direcao: 'recebida', conversaId, fonte: 'whatsapp', idExterno: 'm1',
      ocorridaEm: Date.now(), agora: Date.now(),
    });
    const anexoId = registrarAnexo(acervo, {
      mensagemId, tipo: 'audio', presenca: 'presente', caminho: '/x/a1.opus',
    });
    acervo.fechar();

    const registro = abrirRegistro(c.raiz);
    const chave = emitirChaveDeAcesso(registro, inquilinoId);
    registro.fechar();

    const porta = await portaLivre();
    const srv = criarServidor({ dados: c.raiz, porta });
    await new Promise<void>((r) => srv.listen(porta, '127.0.0.1', r));
    try {
      travador = new Database(`${c.raiz}/acervos/${inquilinoId}.db`);
      travador.pragma('journal_mode = WAL');
      travador.prepare('BEGIN IMMEDIATE').run();

      const r = await fetch(`http://127.0.0.1:${porta}/transcricoes/solicitar`, {
        method: 'POST',
        headers: { authorization: `Bearer ${chave.valor}`, 'content-type': 'application/json' },
        body: JSON.stringify({ anexoId }),
      });
      assert.equal(r.status, 500, 'SQLITE_BUSY além do busy_timeout vira 500, nunca conexão sem resposta');

      travador.close();
      travador = undefined;

      // Prova de que o processo CONTINUA vivo: uma rota de leitura comum,
      // depois da disputa, responde normalmente.
      const depois = await fetch(`http://127.0.0.1:${porta}/conversas`, {
        headers: { authorization: `Bearer ${chave.valor}` },
      });
      assert.equal(depois.status, 200, 'o servidor sobreviveu à exceção da rota de escrita');
    } finally {
      srv.close();
    }
  } finally {
    travador?.close();
    c.limpar();
  }
});

test('qualquer outro método que não GET, fora da rota nova, continua 404', async () => {
  const c = cenario();
  try {
    const { id: inquilinoId, acervo } = c.novoInquilino('Leia');
    acervo.fechar();
    const registro = abrirRegistro(c.raiz);
    const chave = emitirChaveDeAcesso(registro, inquilinoId);
    registro.fechar();

    const porta = await portaLivre();
    const srv = criarServidor({ dados: c.raiz, porta });
    await new Promise<void>((r) => srv.listen(porta, '127.0.0.1', r));
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/conversas`, {
        method: 'POST',
        headers: { authorization: `Bearer ${chave.valor}` },
      });
      assert.equal(r.status, 404, 'a excecao de metodo e so para a rota de solicitacao');
    } finally {
      srv.close();
    }
  } finally {
    c.limpar();
  }
});
