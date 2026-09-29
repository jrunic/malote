import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { criarServidor } from '../src/rede/servidor.js';
import { pedirGet } from '../src/cli/cliente.js';
import { cenario } from './ajuda/acervo.js';
import { registrarConversa, registrarMensagem, registrarAnexo } from '../src/nucleo/escrita.js';
import { emitirChaveDeAcesso } from '../src/registro/chave-de-acesso.js';
import { abrirRegistro } from '../src/registro/registro.js';
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
