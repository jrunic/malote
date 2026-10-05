import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { subirCenaDeEnvio, subirServidorContador } from './ajuda/servidor-de-envio.js';

const INDEX = join(import.meta.dirname, '..', 'src', 'cli', 'index.ts');

/**
 * ASYNC de proposito: o servidor de teste vive NESTE processo, e spawnSync bloquearia o
 * event loop — o pedido do filho nunca seria atendido (medido nos testes de modo rede).
 */
function rodar(
  env: Record<string, string>,
  argumentos: string[],
): Promise<{ codigo: number; saida: string }> {
  return new Promise((resolver) => {
    // A maquina cliente carrega MALOTE_SERVIDOR/MALOTE_CHAVE_DE_ACESSO em todo shell: o filho parte
    // SEM elas, e so tem as que o teste declara.
    const base = { ...process.env };
    delete base['MALOTE_SERVIDOR'];
    delete base['MALOTE_CHAVE_DE_ACESSO'];
    delete base['MALOTE_CHAVE_DE_ACESSO_AGENTE'];
    const filho = spawn(process.execPath, ['--import', 'tsx', INDEX, ...argumentos], {
      env: { ...base, ...env },
    });
    let saida = '';
    filho.stdout.on('data', (d) => (saida += d));
    filho.stderr.on('data', (d) => (saida += d));
    filho.on('close', (codigo) => resolver({ codigo: codigo ?? -1, saida }));
  });
}

const PARA = '5511999990000@s.whatsapp.net';

test('o executavel, com o servidor no ambiente, envia PELA REDE e o Envio aparece no Acervo', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const r = await rodar(
      { MALOTE_HOME: cena.raiz, MALOTE_SERVIDOR: cena.url, MALOTE_CHAVE_DE_ACESSO: cena.chave.valor },
      ['enviar', '--configuracao', 'agente', '--para', PARA, '--texto', 'pelo binario'],
    );
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /Envio aceito:/);
    const envios = cena.lerEnvios();
    assert.equal(envios.length, 1);
    assert.equal(envios[0]!.conteudo_texto, 'pelo binario');
    assert.equal(cena.atorDoEnvio(), `acesso:${cena.chave.id}`);
  } finally {
    cena.encerrar();
  }
});

test('o executavel com --chave-em usa a chave nomeada, nao a do ambiente padrao', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const r = await rodar(
      {
        MALOTE_HOME: cena.raiz,
        MALOTE_SERVIDOR: cena.url,
        MALOTE_CHAVE_DE_ACESSO: cena.chaveDoOutro.valor, // padrao: Inquilino sem o `agente`
        MALOTE_CHAVE_DE_ACESSO_AGENTE: cena.chave.valor,
      },
      ['enviar', '--configuracao', 'agente', '--para', PARA, '--texto', 'x', '--chave-em', 'MALOTE_CHAVE_DE_ACESSO_AGENTE'],
    );
    assert.equal(r.codigo, 0, r.saida);
    assert.equal(cena.atorDoEnvio(), `acesso:${cena.chave.id}`);
  } finally {
    cena.encerrar();
  }
});

test('o executavel com a chave padrao de OUTRO Inquilino sai 6 e nao grava nada', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const r = await rodar(
      { MALOTE_HOME: cena.raiz, MALOTE_SERVIDOR: cena.url, MALOTE_CHAVE_DE_ACESSO: cena.chaveDoOutro.valor },
      ['enviar', '--configuracao', 'agente', '--para', PARA, '--texto', 'x'],
    );
    assert.equal(r.codigo, 6, r.saida);
    assert.equal(cena.lerEnvios().length, 0);
  } finally {
    cena.encerrar();
  }
});

test('sem o servidor no ambiente, --servidor sozinha NAO liga o modo rede: o executor local recusa', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const r = await rodar(
      { MALOTE_HOME: cena.raiz },
      ['enviar', '--inquilino', cena.inquilinoId, '--configuracao', 'agente', '--para', PARA, '--texto', 'local', '--servidor', cena.url],
    );
    assert.equal(r.codigo, 2, r.saida);
    assert.match(r.saida, /operacao LOCAL/);
    assert.equal(cena.lerEnvios().length, 0);
  } finally {
    cena.encerrar();
  }
});

test('o executavel recusa --identificador malformado: exit 2 e nenhuma requisicao (#1117)', async () => {
  const contador = await subirServidorContador();
  try {
    const r = await rodar(
      { MALOTE_SERVIDOR: contador.url, MALOTE_CHAVE_DE_ACESSO: 'k' },
      ['enviar', '--configuracao', 'agente', '--para', PARA, '--texto', 'x', '--identificador', 'nao-e-uuid'],
    );
    assert.equal(r.codigo, 2, r.saida);
    assert.match(r.saida, /--identificador precisa ser um UUID/);
    assert.equal(contador.requisicoes(), 0);
  } finally {
    contador.fechar();
  }
});

test('o executavel repete o mesmo --identificador e o Acervo fica com um Envio so (#1117)', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const id = '3f2b8c1e-5d4a-4e7b-9c10-1a2b3c4d5e6f';
    const env = { MALOTE_HOME: cena.raiz, MALOTE_SERVIDOR: cena.url, MALOTE_CHAVE_DE_ACESSO: cena.chave.valor };
    const args = ['enviar', '--configuracao', 'agente', '--para', PARA, '--texto', 'pelo binario', '--identificador', id];
    const um = await rodar(env, args);
    const dois = await rodar(env, args);
    assert.equal(um.codigo, 0, um.saida);
    assert.equal(dois.codigo, 0, dois.saida);
    assert.match(dois.saida, /Envio ja registrado/);
    assert.equal(cena.lerEnvios().length, 1);
  } finally {
    cena.encerrar();
  }
});

test('o executavel consulta o estado do Envio pela rede, com a chave nomeada (#1117)', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const id = '3f2b8c1e-5d4a-4e7b-9c10-1a2b3c4d5e6f';
    const env = {
      MALOTE_HOME: cena.raiz,
      MALOTE_SERVIDOR: cena.url,
      MALOTE_CHAVE_DE_ACESSO: cena.chaveDoOutro.valor,
      CHAVE_DO_AGENTE: cena.chave.valor,
    };
    const enviado = await rodar(env, [
      'enviar', '--configuracao', 'agente', '--para', PARA, '--texto', 'oi', '--identificador', id,
      '--chave-em', 'CHAVE_DO_AGENTE',
    ]);
    assert.equal(enviado.codigo, 0, enviado.saida);
    const estado = await rodar(env, ['envio', 'estado', id, '--chave-em', 'CHAVE_DO_AGENTE']);
    assert.equal(estado.codigo, 0, estado.saida);
    assert.match(estado.saida, /estado: pendente/);
    // Contraprova: com a chave padrao (a de OUTRO Inquilino) o Envio nao e alcancado.
    const alheio = await rodar(env, ['envio', 'estado', id]);
    assert.equal(alheio.codigo, 6, alheio.saida);
  } finally {
    cena.encerrar();
  }
});

test('o executavel recusa envio estado --inquilino no modo rede: exit 2 e nenhuma requisicao (#1117)', async () => {
  const contador = await subirServidorContador();
  try {
    const r = await rodar(
      { MALOTE_SERVIDOR: contador.url, MALOTE_CHAVE_DE_ACESSO: 'k' },
      ['envio', 'estado', '--inquilino', 'x'],
    );
    assert.equal(r.codigo, 2, r.saida);
    assert.match(r.saida, /env -u MALOTE_SERVIDOR/);
    assert.equal(contador.requisicoes(), 0);
  } finally {
    contador.fechar();
  }
});

test('envio reprocessar com o servidor declarado continua recusando antes de qualquer rede (#1117)', async () => {
  const contador = await subirServidorContador();
  try {
    const r = await rodar(
      { MALOTE_SERVIDOR: contador.url, MALOTE_CHAVE_DE_ACESSO: 'k' },
      ['envio', 'reprocessar', '--inquilino', 'x'],
    );
    assert.equal(r.codigo, 2, r.saida);
    assert.match(r.saida, /LOCAL/);
    assert.equal(contador.requisicoes(), 0);
  } finally {
    contador.fechar();
  }
});
