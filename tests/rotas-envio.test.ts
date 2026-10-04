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

async function comServidor(
  raiz: string,
  fn: (url: string) => Promise<void>,
): Promise<void> {
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
      assert.equal(readFileSync(linha.conteudo_caminho_arquivo).toString(), 'bytes-da-imagem-pela-rede');
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
