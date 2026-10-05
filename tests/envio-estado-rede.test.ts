import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executarEnvioEstadoRede } from '../src/cli/envio-estado-rede.js';
import { subirCenaDeEnvio, subirServidorContador } from './ajuda/servidor-de-envio.js';

const ID = '3f2b8c1e-5d4a-4e7b-9c10-1a2b3c4d5e6f';

async function semear(cena: Awaited<ReturnType<typeof subirCenaDeEnvio>>) {
  await fetch(`${cena.url}/envios/solicitar`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cena.chave.valor}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      configuracao: 'agente',
      para: '5511999990000@s.whatsapp.net',
      tipo: 'texto',
      texto: 'oi',
      identificadorDeEnvio: ID,
    }),
  });
}

function executor(url: string, chave: string | undefined, env: Record<string, string | undefined> = {}) {
  const linhas: string[] = [];
  return {
    rede: { servidor: url, chave, env, escrever: (t: string) => linhas.push(t) },
    saida: () => linhas.join('\n'),
  };
}

test('sem identificador: a contagem por estado, com os tres estados (#1117)', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    await semear(cena);
    const r = executor(cena.url, cena.chave.valor);
    assert.equal(await executarEnvioEstadoRede(['envio', 'estado'], r.rede), 0);
    assert.match(r.saida(), /pendente: 1/);
    assert.match(r.saida(), /enviado: 0/);
    assert.match(r.saida(), /falhou: 0/);
  } finally {
    cena.encerrar();
  }
});

test('a contagem em --json e o corpo da API (#1117)', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const r = executor(cena.url, cena.chave.valor);
    assert.equal(await executarEnvioEstadoRede(['envio', 'estado', '--json'], r.rede), 0);
    assert.deepEqual(JSON.parse(r.saida()), { enviado: 0, falhou: 0, pendente: 0 });
  } finally {
    cena.encerrar();
  }
});

test('com identificador: o estado do Envio, em texto e em --json (#1117)', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    await semear(cena);
    const texto = executor(cena.url, cena.chave.valor);
    assert.equal(await executarEnvioEstadoRede(['envio', 'estado', ID], texto.rede), 0);
    assert.match(texto.saida(), /pendente/);
    assert.match(texto.saida(), new RegExp(ID));
    const json = executor(cena.url, cena.chave.valor);
    assert.equal(await executarEnvioEstadoRede(['envio', 'estado', ID, '--json'], json.rede), 0);
    assert.equal((JSON.parse(json.saida()) as { estado: string }).estado, 'pendente');
  } finally {
    cena.encerrar();
  }
});

test('Envio que nao existe para a chave: exit 6 com mensagem que nao distingue alheio de inexistente (#1117)', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    await semear(cena);
    const r = executor(cena.url, cena.chaveDoOutro.valor);
    assert.equal(await executarEnvioEstadoRede(['envio', 'estado', ID], r.rede), 6);
    assert.match(r.saida(), /nao existe neste Inquilino, ou a chave nao o alcanca/);
  } finally {
    cena.encerrar();
  }
});

test('--chave-em escolhe a chave do agente sem trocar a padrao, e o identificador vem depois dela (#1117)', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    await semear(cena);
    const ok = executor(cena.url, cena.chaveDoOutro.valor, { CHAVE_AGENTE: cena.chave.valor });
    assert.equal(await executarEnvioEstadoRede(['envio', 'estado', '--chave-em', 'CHAVE_AGENTE', ID], ok.rede), 0, ok.saida());
    assert.match(ok.saida(), /pendente/);
    const antes = executor(cena.url, cena.chaveDoOutro.valor, { CHAVE_AGENTE: cena.chave.valor });
    assert.equal(await executarEnvioEstadoRede(['envio', 'estado', ID, '--chave-em', 'CHAVE_AGENTE'], antes.rede), 0);
  } finally {
    cena.encerrar();
  }
});

test('--chave-em com variavel vazia recusa sem rede e nao cai na chave padrao (#1117)', async () => {
  const contador = await subirServidorContador();
  try {
    const r = executor(contador.url, 'chave-padrao-valida', { CHAVE_AGENTE: '  ' });
    assert.equal(await executarEnvioEstadoRede(['envio', 'estado', '--chave-em', 'CHAVE_AGENTE'], r.rede), 2);
    assert.equal(contador.requisicoes(), 0);
  } finally {
    contador.fechar();
  }
});

test('sem chave nenhuma: exit 2 e nenhuma requisicao (#1117)', async () => {
  const contador = await subirServidorContador();
  try {
    const r = executor(contador.url, undefined);
    assert.equal(await executarEnvioEstadoRede(['envio', 'estado'], r.rede), 2);
    assert.equal(contador.requisicoes(), 0);
  } finally {
    contador.fechar();
  }
});

test('--inquilino no modo rede e recusado, exit 2, sem rede (#1117)', async () => {
  const contador = await subirServidorContador();
  try {
    const r = executor(contador.url, 'k');
    assert.equal(await executarEnvioEstadoRede(['envio', 'estado', '--inquilino', 'x'], r.rede), 2);
    assert.match(r.saida(), /env -u MALOTE_SERVIDOR/);
    assert.equal(contador.requisicoes(), 0);
  } finally {
    contador.fechar();
  }
});
