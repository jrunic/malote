import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { criarServidor } from '../src/rede/servidor.js';
import { cenario } from './ajuda/acervo.js';
import { emitirChaveDeAcesso } from '../src/registro/chave-de-acesso.js';
import { abrirRegistro } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';

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
