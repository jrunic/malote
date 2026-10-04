import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { subirCenaDeEnvio } from './ajuda/servidor-de-envio.js';

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
    // O macbook carrega MALOTE_SERVIDOR/MALOTE_CHAVE_DE_ACESSO em todo shell: o filho parte
    // SEM elas, e so tem as que o teste declara.
    const base = { ...process.env };
    delete base['MALOTE_SERVIDOR'];
    delete base['MALOTE_CHAVE_DE_ACESSO'];
    delete base['MALOTE_CHAVE_DE_ACESSO_HERA'];
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
      ['enviar', '--configuracao', 'hera', '--para', PARA, '--texto', 'pelo binario'],
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
        MALOTE_CHAVE_DE_ACESSO: cena.chaveDoOutro.valor, // padrao: Inquilino sem a `hera`
        MALOTE_CHAVE_DE_ACESSO_HERA: cena.chave.valor,
      },
      ['enviar', '--configuracao', 'hera', '--para', PARA, '--texto', 'x', '--chave-em', 'MALOTE_CHAVE_DE_ACESSO_HERA'],
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
      ['enviar', '--configuracao', 'hera', '--para', PARA, '--texto', 'x'],
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
      ['enviar', '--inquilino', cena.inquilinoId, '--configuracao', 'hera', '--para', PARA, '--texto', 'local', '--servidor', cena.url],
    );
    assert.equal(r.codigo, 2, r.saida);
    assert.match(r.saida, /operacao LOCAL/);
    assert.equal(cena.lerEnvios().length, 0);
  } finally {
    cena.encerrar();
  }
});
