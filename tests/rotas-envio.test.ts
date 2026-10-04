import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { criarServidor } from '../src/rede/servidor.js';
import { cenario } from './ajuda/acervo.js';
import { emitirChaveDeAcesso } from '../src/registro/chave-de-acesso.js';
import { abrirRegistro } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { subirCenaDeEnvio } from './ajuda/servidor-de-envio.js';

async function portaLivre(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const porta = (srv.address() as { port: number }).port;
  await new Promise<void>((r) => srv.close(() => r()));
  return porta;
}

test('POST /envios/solicitar com texto aceita, com 202, e grava o Ator certo', async () => {
  const c = cenario();
  try {
    const { id: inquilinoId, acervo } = c.novoInquilino('Leia');
    acervo.fechar();
    const registro = abrirRegistro(c.raiz);
    resolverConfiguracao(registro, inquilinoId, 'whatsapp', 'padrao');
    const chave = emitirChaveDeAcesso(registro, inquilinoId);
    registro.fechar();

    const porta = await portaLivre();
    const srv = criarServidor({ dados: c.raiz, porta });
    await new Promise<void>((r) => srv.listen(porta, '127.0.0.1', r));
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/envios/solicitar`, {
        method: 'POST',
        headers: { authorization: `Bearer ${chave.valor}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          configuracao: 'padrao',
          para: '5511999990000@s.whatsapp.net',
          tipo: 'texto',
          texto: 'oi pela rede',
        }),
      });
      assert.equal(r.status, 202);
      const corpo = (await r.json()) as { aceita: boolean; envioId: string };
      assert.equal(corpo.aceita, true);
      assert.ok(corpo.envioId.length > 0);
    } finally {
      srv.close();
    }

    const conferencia = abrirAcervoSomenteLeitura(`${c.raiz}/acervos`, inquilinoId);
    try {
      const linha = conferencia
        .preparar('SELECT estado, conteudo_tipo, conteudo_texto FROM envios')
        .get() as { estado: string; conteudo_tipo: string; conteudo_texto: string };
      assert.equal(linha.estado, 'pendente');
      assert.equal(linha.conteudo_tipo, 'texto');
      assert.equal(linha.conteudo_texto, 'oi pela rede');

      // O Ator atravessa o fire-and-forget da rota: mesma prova do teste de
      // /transcricoes/solicitar.
      const operacao = conferencia.db
        .prepare(`SELECT ator FROM operacoes WHERE natureza = 'solicitar-envio'`)
        .get() as { ator: string } | undefined;
      assert.equal(operacao?.ator, `acesso:${chave.id}`);
    } finally {
      conferencia.fechar();
    }
  } finally {
    c.limpar();
  }
});

// Task 2: testes de REGRESSAO sobre comportamento que a rota ja tem — nao sao
// RED->GREEN. Cada um e verificado por mutacao no fim do plano.

async function comServidor(raiz: string, fn: (url: string) => Promise<void>): Promise<void> {
  const porta = await portaLivre();
  const srv = criarServidor({ dados: raiz, porta });
  await new Promise<void>((r) => srv.listen(porta, '127.0.0.1', r));
  try {
    await fn(`http://127.0.0.1:${porta}/envios/solicitar`);
  } finally {
    srv.close();
  }
}

test('POST /envios/solicitar com Chave de outro Inquilino nao alcanca a Configuracao', async () => {
  const c = cenario();
  try {
    const { id: inquilinoA, acervo: acervoA } = c.novoInquilino('Leia');
    const { id: inquilinoB, acervo: acervoB } = c.novoInquilino('Han');
    acervoA.fechar();
    acervoB.fechar();
    const registro = abrirRegistro(c.raiz);
    resolverConfiguracao(registro, inquilinoA, 'whatsapp', 'padrao');
    const chaveDeB = emitirChaveDeAcesso(registro, inquilinoB);
    registro.fechar();

    await comServidor(c.raiz, async (url) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${chaveDeB.valor}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          configuracao: 'padrao', // existe em A, nao em B
          para: '5511999990000@s.whatsapp.net',
          tipo: 'texto',
          texto: 'oi',
        }),
      });
      // Igual a "Configuracao nao existe em lugar nenhum": distinguir vazaria
      // que ela existe no Inquilino A.
      assert.equal(r.status, 404);
      assert.equal(await r.text(), '');
    });
  } finally {
    c.limpar();
  }
});

test('POST /envios/solicitar recusa corpo sem configuracao ou para', async () => {
  const c = cenario();
  try {
    const { id: inquilinoId, acervo } = c.novoInquilino('Leia');
    acervo.fechar();
    const registro = abrirRegistro(c.raiz);
    const chave = emitirChaveDeAcesso(registro, inquilinoId);
    registro.fechar();

    await comServidor(c.raiz, async (url) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${chave.valor}`, 'content-type': 'application/json' },
        body: JSON.stringify({ texto: 'sem destino' }),
      });
      assert.equal(r.status, 400);
    });
  } finally {
    c.limpar();
  }
});

test('POST /envios/solicitar recusa fonte que nao suporta Envio', async () => {
  const c = cenario();
  try {
    const { id: inquilinoId, acervo } = c.novoInquilino('Leia');
    acervo.fechar();
    const registro = abrirRegistro(c.raiz);
    const chave = emitirChaveDeAcesso(registro, inquilinoId);
    registro.fechar();

    await comServidor(c.raiz, async (url) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${chave.valor}`, 'content-type': 'application/json' },
        body: JSON.stringify({ fonte: 'instagram', configuracao: 'x', para: 'y@z', texto: 'oi' }),
      });
      assert.equal(r.status, 400);
    });
  } finally {
    c.limpar();
  }
});

// Task 3

test('POST /envios/solicitar com imagem em base64 grava o staging e o Envio', async () => {
  const c = cenario();
  try {
    const { id: inquilinoId, acervo } = c.novoInquilino('Leia');
    acervo.fechar();
    const registro = abrirRegistro(c.raiz);
    resolverConfiguracao(registro, inquilinoId, 'whatsapp', 'padrao');
    const chave = emitirChaveDeAcesso(registro, inquilinoId);
    registro.fechar();

    await comServidor(c.raiz, async (url) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${chave.valor}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          configuracao: 'padrao',
          para: '5511999990000@s.whatsapp.net',
          tipo: 'imagem',
          arquivoBase64: Buffer.from('bytes-da-imagem-pela-rede').toString('base64'),
          mimetype: 'image/jpeg',
          texto: 'legenda pela rede',
        }),
      });
      assert.equal(r.status, 202);
    });

    const conferencia = abrirAcervoSomenteLeitura(`${c.raiz}/acervos`, inquilinoId);
    try {
      const linha = conferencia
        .preparar(
          'SELECT conteudo_tipo, conteudo_caminho_arquivo, conteudo_mimetype, conteudo_texto FROM envios',
        )
        .get() as {
        conteudo_tipo: string;
        conteudo_caminho_arquivo: string;
        conteudo_mimetype: string;
        conteudo_texto: string;
      };
      assert.equal(linha.conteudo_tipo, 'imagem');
      assert.equal(linha.conteudo_mimetype, 'image/jpeg');
      assert.equal(linha.conteudo_texto, 'legenda pela rede');
      assert.equal(
        readFileSync(linha.conteudo_caminho_arquivo).toString(),
        'bytes-da-imagem-pela-rede',
      );
    } finally {
      conferencia.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('POST /envios/solicitar com documento exige nomeDeArquivo e nao deixa staging', async () => {
  const c = cenario();
  try {
    const { id: inquilinoId, acervo } = c.novoInquilino('Leia');
    acervo.fechar();
    const registro = abrirRegistro(c.raiz);
    resolverConfiguracao(registro, inquilinoId, 'whatsapp', 'padrao');
    const chave = emitirChaveDeAcesso(registro, inquilinoId);
    registro.fechar();

    await comServidor(c.raiz, async (url) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${chave.valor}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          configuracao: 'padrao',
          para: '5511999990000@s.whatsapp.net',
          tipo: 'documento',
          arquivoBase64: Buffer.from('pdf').toString('base64'),
          mimetype: 'application/pdf',
        }),
      });
      assert.equal(r.status, 400);
    });
    assert.equal(existsSync(`${c.raiz}/envios-pendentes`), false, 'recusa nao pode deixar arquivo');
  } finally {
    c.limpar();
  }
});

test('POST /envios/solicitar recusa corpo acima do limite, sem deixar staging', async () => {
  const c = cenario();
  try {
    const { id: inquilinoId, acervo } = c.novoInquilino('Leia');
    acervo.fechar();
    const registro = abrirRegistro(c.raiz);
    resolverConfiguracao(registro, inquilinoId, 'whatsapp', 'padrao');
    const chave = emitirChaveDeAcesso(registro, inquilinoId);
    registro.fechar();

    await comServidor(c.raiz, async (url) => {
      // Limite (8 MB) + 1 KB: estoura sem alocar muito alem do necessario.
      const enorme = Buffer.alloc(8 * 1024 * 1024 + 1024, 'x').toString('base64');
      const r = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${chave.valor}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          configuracao: 'padrao',
          para: '5511999990000@s.whatsapp.net',
          tipo: 'imagem',
          arquivoBase64: enorme,
          mimetype: 'image/jpeg',
        }),
      });
      assert.equal(r.status, 400);
    });
    const pasta = `${c.raiz}/envios-pendentes`;
    assert.deepEqual(existsSync(pasta) ? readdirSync(pasta) : [], []);
  } finally {
    c.limpar();
  }
});

const IDENT = '3f2b8c1e-5d4a-4e7b-9c10-1a2b3c4d5e6f';
const BASE_TEXTO = {
  configuracao: 'hera',
  para: '5511999990000@s.whatsapp.net',
  tipo: 'texto',
  texto: 'oi',
};

async function postar(cena: { url: string }, chave: string, corpo: object) {
  const r = await fetch(`${cena.url}/envios/solicitar`, {
    method: 'POST',
    headers: { authorization: `Bearer ${chave}`, 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return { status: r.status, corpo: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

test('identificador que nao e UUID responde 400 e nada e gravado (#1117)', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const r = await postar(cena, cena.chave.valor, {
      ...BASE_TEXTO,
      identificadorDeEnvio: 'qualquer-coisa',
    });
    assert.equal(r.status, 400);
    const naoString = await postar(cena, cena.chave.valor, {
      ...BASE_TEXTO,
      identificadorDeEnvio: 42,
    });
    assert.equal(naoString.status, 400);
    assert.equal(cena.lerEnvios().length, 0);
  } finally {
    cena.encerrar();
  }
});

test('o mesmo pedido com o mesmo identificador: 202 e depois 200 repetido, com um Envio e uma Operacao (#1117)', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const um = await postar(cena, cena.chave.valor, { ...BASE_TEXTO, identificadorDeEnvio: IDENT });
    const dois = await postar(cena, cena.chave.valor, {
      ...BASE_TEXTO,
      identificadorDeEnvio: IDENT,
    });
    assert.equal(um.status, 202);
    assert.equal(dois.status, 200);
    assert.equal(dois.corpo['repetido'], true);
    assert.equal(dois.corpo['envioId'], um.corpo['envioId']);
    assert.equal(um.corpo['identificadorDeEnvio'], IDENT, 'o servidor ecoa o identificador');
    assert.equal(dois.corpo['identificadorDeEnvio'], IDENT);
    assert.equal(cena.lerEnvios().length, 1);
    assert.equal(cena.operacoesDeSolicitacao(), 1);
  } finally {
    cena.encerrar();
  }
});

test('sem identificador o contrato e o de hoje: dois pedidos, dois Envios, e a resposta traz o identificador gerado', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const um = await postar(cena, cena.chave.valor, BASE_TEXTO);
    const dois = await postar(cena, cena.chave.valor, BASE_TEXTO);
    assert.equal(um.status, 202);
    assert.equal(dois.status, 202);
    assert.equal(cena.lerEnvios().length, 2);
    assert.equal(typeof um.corpo['identificadorDeEnvio'], 'string');
  } finally {
    cena.encerrar();
  }
});

test('mesmo identificador com pedido diferente: 409 e nada muda (#1117)', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    await postar(cena, cena.chave.valor, { ...BASE_TEXTO, identificadorDeEnvio: IDENT });
    const antes = cena.operacoesDeSolicitacao();
    for (const outro of [
      { ...BASE_TEXTO, texto: 'outro' },
      { ...BASE_TEXTO, para: '5511888880000@s.whatsapp.net' },
      {
        ...BASE_TEXTO,
        tipo: 'documento',
        arquivoBase64: Buffer.from('x').toString('base64'),
        mimetype: 'text/plain',
        nomeDeArquivo: 'a.txt',
      },
    ]) {
      const r = await postar(cena, cena.chave.valor, { ...outro, identificadorDeEnvio: IDENT });
      assert.equal(r.status, 409);
    }
    assert.equal(cena.lerEnvios().length, 1);
    assert.equal(cena.operacoesDeSolicitacao(), antes);
    assert.equal(cena.arquivosEmStaging(), 0, 'o 409 do documento nao deixa staging');
  } finally {
    cena.encerrar();
  }
});

test('repeticao de imagem: nao deixa arquivo em staging alem do primeiro (#1117)', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const corpo = {
      configuracao: 'hera',
      para: '5511999990000@s.whatsapp.net',
      tipo: 'imagem',
      arquivoBase64: Buffer.from('bytes-da-imagem').toString('base64'),
      mimetype: 'image/png',
      identificadorDeEnvio: IDENT,
    };
    await postar(cena, cena.chave.valor, corpo);
    assert.equal(cena.arquivosEmStaging(), 1);
    const repetido = await postar(cena, cena.chave.valor, corpo);
    assert.equal(repetido.status, 200);
    assert.equal(cena.arquivosEmStaging(), 1, 'a repeticao nao escreveu um segundo arquivo');
    assert.equal(cena.lerEnvios().length, 1);
  } finally {
    cena.encerrar();
  }
});

test('o identificador e do Inquilino: outro Inquilino, com Configuracao propria, repete o identificador e cria o SEU Envio (#1117)', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const dela = await postar(cena, cena.chave.valor, {
      ...BASE_TEXTO,
      identificadorDeEnvio: IDENT,
    });
    const dele = await postar(cena, cena.chaveDeOutroComHera.valor, {
      ...BASE_TEXTO,
      identificadorDeEnvio: IDENT,
    });
    assert.equal(dele.status, 202, 'o Acervo e por Inquilino: nao e repeticao do Envio alheio');
    assert.notEqual(dele.corpo['envioId'], dela.corpo['envioId']);
    assert.equal(cena.lerEnvios().length, 1, 'o Envio da Hera segue sendo um so');
    assert.equal(cena.lerEnviosDeOutroComHera().length, 1);
  } finally {
    cena.encerrar();
  }
});

test('o perdedor da corrida (outro processo gravou entre o exame e o registro) responde 200 e limpa o proprio staging (#1117)', async () => {
  const cena = await subirCenaDeEnvio({
    entreOExameEORegistro: (inserirComoVencedor) => inserirComoVencedor(),
  });
  try {
    const corpo = {
      configuracao: 'hera',
      para: '5511999990000@s.whatsapp.net',
      tipo: 'imagem',
      arquivoBase64: Buffer.from('bytes').toString('base64'),
      mimetype: 'image/png',
      identificadorDeEnvio: IDENT,
    };
    const r = await postar(cena, cena.chave.valor, corpo);
    assert.equal(r.status, 200);
    assert.equal(cena.lerEnvios().length, 1);
    assert.equal(
      cena.arquivosEmStaging(),
      1,
      'sobra so o staging do vencedor, referenciado pelo unico Envio',
    );
  } finally {
    cena.encerrar();
  }
});

test('o perdedor da corrida com pedido DIFERENTE responde 409 e limpa o proprio staging (#1117)', async () => {
  const cena = await subirCenaDeEnvio({
    entreOExameEORegistro: (inserirComoVencedor) => inserirComoVencedor('image/jpeg'),
  });
  try {
    const r = await postar(cena, cena.chave.valor, {
      configuracao: 'hera',
      para: '5511999990000@s.whatsapp.net',
      tipo: 'imagem',
      arquivoBase64: Buffer.from('bytes').toString('base64'),
      mimetype: 'image/png',
      identificadorDeEnvio: IDENT,
    });
    assert.equal(r.status, 409);
    assert.equal(cena.lerEnvios().length, 1);
    assert.equal(cena.arquivosEmStaging(), 1, 'sobra so o staging do vencedor');
  } finally {
    cena.encerrar();
  }
});

async function pegar(cena: { url: string }, caminho: string, chave?: string) {
  const r = await fetch(`${cena.url}${caminho}`, { headers: chave ? { authorization: `Bearer ${chave}` } : {} });
  return { status: r.status, texto: await r.text() };
}

test('GET /envios/<identificador> devolve o estado, sem texto nem caminho (#1117)', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const feito = await postar(cena, cena.chave.valor, {
      ...BASE_TEXTO,
      texto: 'segredo-do-texto',
      identificadorDeEnvio: IDENT,
    });
    const porIdentificador = await pegar(cena, `/envios/${IDENT}`, cena.chave.valor);
    assert.equal(porIdentificador.status, 200);
    const corpo = JSON.parse(porIdentificador.texto) as Record<string, unknown>;
    assert.equal(corpo['estado'], 'pendente');
    assert.equal(corpo['tentativas'], 0);
    assert.equal(corpo['tipo'], 'texto');
    assert.equal(corpo['configuracao'], 'hera');
    assert.equal(corpo['envioId'], feito.corpo['envioId']);
    assert.equal(corpo['identificadorDeEnvio'], IDENT);
    assert.equal(corpo['motivoFalha'], null);
    assert.ok(!porIdentificador.texto.includes('segredo-do-texto'), 'o texto do Envio nao sai por esta rota');
    const porId = await pegar(cena, `/envios/${feito.corpo['envioId'] as string}`, cena.chave.valor);
    assert.equal(porId.status, 200);
  } finally {
    cena.encerrar();
  }
});

test('Envio inexistente e Envio de outro Inquilino respondem igual: 404 vazio (#1117)', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    await postar(cena, cena.chave.valor, { ...BASE_TEXTO, identificadorDeEnvio: IDENT });
    const alheio = await pegar(cena, `/envios/${IDENT}`, cena.chaveDoOutro.valor);
    const inventado = await pegar(cena, '/envios/00000000-0000-4000-8000-000000000000', cena.chave.valor);
    assert.equal(alheio.status, 404);
    assert.equal(alheio.texto, '');
    assert.equal(inventado.status, 404);
    assert.equal(inventado.texto, '');
  } finally {
    cena.encerrar();
  }
});

test('GET /envios/contagem devolve os tres estados, e nao e lido como identificador (#1117)', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const vazio = await pegar(cena, '/envios/contagem', cena.chave.valor);
    assert.equal(vazio.status, 200);
    assert.deepEqual(JSON.parse(vazio.texto), { pendente: 0, enviado: 0, falhou: 0 });
    await postar(cena, cena.chave.valor, { ...BASE_TEXTO, identificadorDeEnvio: IDENT });
    const um = await pegar(cena, '/envios/contagem', cena.chave.valor);
    assert.deepEqual(JSON.parse(um.texto), { pendente: 1, enviado: 0, falhou: 0 });
  } finally {
    cena.encerrar();
  }
});

test('GET /envios/solicitar e 404 (e nao um identificador), sem credencial e 401 (#1117)', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    assert.equal((await pegar(cena, '/envios/solicitar', cena.chave.valor)).status, 404);
    assert.equal((await pegar(cena, '/envios/contagem')).status, 401);
    assert.equal((await pegar(cena, `/envios/${IDENT}`)).status, 401);
  } finally {
    cena.encerrar();
  }
});

test('as rotas de leitura do Envio nao gravam Operacao (#1117)', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    await postar(cena, cena.chave.valor, { ...BASE_TEXTO, identificadorDeEnvio: IDENT });
    const antes = cena.operacoesDeSolicitacao();
    await pegar(cena, `/envios/${IDENT}`, cena.chave.valor);
    await pegar(cena, '/envios/contagem', cena.chave.valor);
    assert.equal(cena.operacoesDeSolicitacao(), antes);
  } finally {
    cena.encerrar();
  }
});
