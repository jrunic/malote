import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { cenario, type Cenario } from './ajuda/acervo.js';
import { RemotoEmMemoria } from './ajuda/remoto-em-memoria.js';
import { configurarDestinoDeMidia } from '../src/registro/destino-midia.js';
import { PADROES_DO_DESTINO_REMOTO, configurarDestinoRemotoDeMidia } from '../src/registro/destino-remoto.js';
import { listarAnexosPresentes } from '../src/nucleo/anexos-presentes.js';
import { passadaDeEnvio, type DependenciasDoServico } from '../src/cli/servico-de-armazenamento.js';
import { caminhoDoSoquete, iniciarServidorDoServico } from '../src/cli/servidor-do-servico.js';
import { criarBuscadorDeMidiaRemota } from '../src/cli/cliente-do-armazenamento.js';

function montar(c: Cenario) {
  const { id, acervo, destino } = c.inquilinoComArquivos();
  configurarDestinoDeMidia(c.registro, id, { natureza: 'local', endereco: destino });
  configurarDestinoRemotoDeMidia(c.registro, id, { remoto: 'remoto_de_teste', ...PADROES_DO_DESTINO_REMOTO });
  const remoto = new RemotoEmMemoria();
  let n = 0;
  const base = Date.now() + 11 * 60 * 1000;
  const saidas: string[] = [];
  const dep: DependenciasDoServico = {
    dados: c.raiz, estado: c.raiz, remoto, agora: () => base + 1_000 * n++, dormir: () => Promise.resolve(), escrever: (l) => saidas.push(l),
  };
  const imagem = listarAnexosPresentes(acervo, { limite: 10 }).find((a) => a.tipo === 'image') as { id: string };
  return { id, dep, remoto, saidas, imagem };
}

test('o soquete fica numa pasta 0700, com permissao 0600, e some quando o servico para', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    const servidor = await iniciarServidorDoServico(m.dep);
    const caminho = caminhoDoSoquete(c.raiz);
    assert.equal(statSync(caminho).mode & 0o777, 0o600);
    assert.equal(statSync(caminho.replace(/\/servico\.sock$/, '')).mode & 0o777, 0o700);
    await servidor.fechar();
    assert.throws(() => statSync(caminho), 'o soquete saiu');
  } finally {
    c.limpar();
  }
});

test('pelo soquete: bytes do Anexo enviado, 404 do que nao tem Localizacao, 413 acima do maximo, 502 do que o remoto nao entrega', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    const buscar = criarBuscadorDeMidiaRemota(c.raiz);
    const servidor = await iniciarServidorDoServico(m.dep, { tamanhoMaximo: 1024 * 1024 });
    try {
      const pedido = { inquilinoId: m.id, anexoId: m.imagem.id, prazoMs: 5_000 };
      assert.deepEqual(await buscar(pedido), { tipo: 'sem-localizacao' }, 'ainda nao enviado');
      await passadaDeEnvio(m.dep, m.id);
      const ok = await buscar(pedido);
      assert.equal(ok.tipo, 'bytes');
      m.remoto.conteudoTrocado = Buffer.from('x');
      const ruim = await buscar(pedido);
      assert.ok(ruim.tipo === 'inacessivel' && ruim.motivo.length > 0);
      m.remoto.conteudoTrocado = undefined;
    } finally {
      await servidor.fechar();
    }
    const pequeno = await iniciarServidorDoServico(m.dep, { tamanhoMaximo: 3 });
    try {
      const r = await buscar({ inquilinoId: m.id, anexoId: m.imagem.id, prazoMs: 5_000 });
      assert.ok(r.tipo === 'grande-demais' && r.maximo === 3, JSON.stringify(r));
    } finally {
      await pequeno.fechar();
    }
    assert.ok(m.saidas.every((l) => !/@|\/home\//.test(l)), 'o log leva so identificadores do produto');
  } finally {
    c.limpar();
  }
});

test('servico fora do ar: o resultado e "servico-fora", nunca "sem-localizacao"', async () => {
  const c = cenario();
  try {
    const buscar = criarBuscadorDeMidiaRemota(c.raiz);
    assert.deepEqual(await buscar({ inquilinoId: 'x', anexoId: 'y', prazoMs: 2_000 }), { tipo: 'servico-fora' });
  } finally {
    c.limpar();
  }
});

test('o pedido com identificador fora da forma e recusado antes de qualquer leitura', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    const servidor = await iniciarServidorDoServico(m.dep);
    try {
      const buscar = criarBuscadorDeMidiaRemota(c.raiz);
      const r = await buscar({ inquilinoId: m.id, anexoId: '../../etc/passwd', prazoMs: 2_000 });
      assert.equal(r.tipo, 'inacessivel');
      assert.ok(!m.remoto.chamadas.includes('read'));
    } finally {
      await servidor.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('entregas demais em voo: 503 ("ocupado" para quem pede); o cliente que vai embora aborta a leitura no remoto', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    await passadaDeEnvio(m.dep, m.id);
    m.remoto.leituraEmEspera = true;
    const servidor = await iniciarServidorDoServico(m.dep, { entregasEmVoo: 1 });
    try {
      const buscar = criarBuscadorDeMidiaRemota(c.raiz);
      const abandono = new AbortController();
      const primeira = buscar({ inquilinoId: m.id, anexoId: m.imagem.id, prazoMs: 10_000, sinal: abandono.signal });
      for (let i = 0; i < 100 && !m.remoto.chamadas.includes('read'); i += 1) await new Promise((r) => setTimeout(r, 10));
      assert.ok(m.remoto.chamadas.includes('read'), 'a primeira leitura comecou');

      const segunda = await buscar({ inquilinoId: m.id, anexoId: m.imagem.id, prazoMs: 2_000 });
      assert.equal(segunda.tipo, 'ocupado', 'o limite de entregas em voo recusa a segunda, e isso NAO e "servico fora"');

      abandono.abort();
      assert.equal((await primeira).tipo, 'inacessivel');
      for (let i = 0; i < 100 && !m.remoto.leituraAbortada; i += 1) await new Promise((r) => setTimeout(r, 10));
      assert.ok(m.remoto.leituraAbortada, 'o abandono chegou ao remoto');
    } finally {
      await servidor.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('o prazo que o pedido traz nunca passa do teto do Servico', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    await passadaDeEnvio(m.dep, m.id);
    const servidor = await iniciarServidorDoServico(m.dep, { prazoMaximoMs: 2_000 });
    try {
      const buscar = criarBuscadorDeMidiaRemota(c.raiz);
      assert.equal((await buscar({ inquilinoId: m.id, anexoId: m.imagem.id, prazoMs: 600_000 })).tipo, 'bytes');
      assert.equal(m.remoto.ultimoPrazoMs, 2_000, 'o remoto recebeu o teto, nao os 600 s do pedido');
      assert.equal((await buscar({ inquilinoId: m.id, anexoId: m.imagem.id, prazoMs: 500 })).tipo, 'bytes');
      assert.equal(m.remoto.ultimoPrazoMs, 500, 'um prazo menor que o teto vale');
    } finally {
      await servidor.fechar();
    }
  } finally {
    c.limpar();
  }
});
