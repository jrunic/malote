import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErroDoRemoto, configuracaoDoRclone, iniciarRclone, type Remoto } from '../src/cli/motor-de-armazenamento.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';

const FALSO_NO_REPO = join(import.meta.dirname, 'ajuda', 'rclone-falso.mjs');

function portaLivre(): Promise<number> {
  return new Promise((resolver, rejeitar) => {
    const servidor = createServer();
    servidor.once('error', rejeitar);
    servidor.listen(0, '127.0.0.1', () => {
      const { port } = servidor.address() as AddressInfo;
      servidor.close(() => resolver(port));
    });
  });
}

/** Copia o rclone falso para uma pasta temporaria e o torna executavel: o arquivo do repo nao muda de modo. */
function prepararFalso(raiz: string): { binario: string; remotoDeTeste: string; env: Record<string, string> } {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-rclone-falso-'));
  const binario = join(pasta, 'rclone');
  copyFileSync(FALSO_NO_REPO, binario);
  chmodSync(binario, 0o755);
  const remotoDeTeste = join(raiz, 'nuvem');
  mkdirSync(remotoDeTeste, { recursive: true });
  return { binario, remotoDeTeste, env: { PATH: process.env['PATH'] ?? '', RCLONE_FALSO_RAIZ: remotoDeTeste } };
}

async function comFalso(
  usar: (r: { remoto: Remoto; raizLocal: string; remotoDeTeste: string; porta: number }) => Promise<void>,
  falhas?: Record<string, unknown>,
): Promise<void> {
  const { raiz, limpar } = instalacaoTemporaria();
  let remoto: Remoto | undefined;
  try {
    const { binario, remotoDeTeste, env } = prepararFalso(raiz);
    if (falhas !== undefined) writeFileSync(join(remotoDeTeste, '.falhas.json'), JSON.stringify(falhas));
    const porta = await portaLivre();
    const raizLocal = join(raiz, 'local');
    mkdirSync(join(raizLocal, 'ab'), { recursive: true });
    remoto = await iniciarRclone({ binario, porta }, env);
    await usar({ remoto, raizLocal, remotoDeTeste, porta });
  } finally {
    await remoto?.parar();
    limpar();
  }
}

test('configuracaoDoRclone: sem o binario declarado o armazenamento fica parado; a porta tem padrao e e validada', () => {
  assert.equal(configuracaoDoRclone({}), undefined);
  assert.equal(configuracaoDoRclone({ MALOTE_RCLONE_BINARIO: '' }), undefined);
  assert.deepEqual(configuracaoDoRclone({ MALOTE_RCLONE_BINARIO: '/x/rclone' }), { binario: '/x/rclone', porta: 5599 });
  assert.deepEqual(configuracaoDoRclone({ MALOTE_RCLONE_BINARIO: '/x/rclone', MALOTE_RCLONE_PORTA: '6000' }), {
    binario: '/x/rclone',
    porta: 6000,
  });
  for (const ruim of ['80', '70000', 'abc', '5599.5']) {
    assert.equal(configuracaoDoRclone({ MALOTE_RCLONE_BINARIO: '/x', MALOTE_RCLONE_PORTA: ruim })?.porta, 5599, ruim);
  }
});

test('copiar, conferir (hash e identificador), listar e apagar contra o rcd', async () => {
  await comFalso(async ({ remoto, raizLocal, remotoDeTeste }) => {
    const conteudo = Buffer.from('conteudo de um anexo de teste');
    writeFileSync(join(raizLocal, 'ab', 'arquivo.jpg'), conteudo);
    const alvo = { remoto: 'remoto_de_teste', pasta: 'malote', relativo: 'inq/image/ab/cdarquivo.jpg' };

    assert.equal(await remoto.statArquivo(alvo), null, 'antes de copiar nao existe');
    await remoto.copiarArquivo({ raiz: raizLocal, relativo: 'ab/arquivo.jpg' }, alvo, conteudo.length);
    assert.equal(readFileSync(join(remotoDeTeste, 'remoto_de_teste', 'malote', alvo.relativo)).toString(), conteudo.toString());

    const item = await remoto.statArquivo(alvo);
    assert.equal(item?.tamanho, conteudo.length);
    assert.equal(item?.sha256, createHash('sha256').update(conteudo).digest('hex'));
    assert.ok(item?.id, 'o remoto deu o identificador do arquivo');

    const lista = await remoto.listarArquivos({ ...alvo, relativo: 'inq' });
    assert.deepEqual(
      lista.map((i) => i.caminho),
      ['inq/image/ab/cdarquivo.jpg'],
      'o caminho e relativo a pasta-base, como o rclone devolve',
    );
    assert.equal(lista[0]?.sha256, item?.sha256);

    await remoto.apagarArquivo(alvo);
    assert.equal(await remoto.statArquivo(alvo), null);
    await assert.rejects(
      () => remoto.apagarArquivo(alvo),
      (e: unknown) => e instanceof ErroDoRemoto && e.status === 404 && !e.limiteDeCota,
    );
  });
});

test('a senha do rcd nunca vai por argumento de linha de comando', async () => {
  await comFalso(async ({ remotoDeTeste, porta }) => {
    const argv = JSON.parse(readFileSync(join(remotoDeTeste, '.argv.json'), 'utf8')) as string[];
    assert.deepEqual(argv, ['rcd', '--rc-addr', `127.0.0.1:${porta}`]);
  });
});

test('origem inexistente vira ErroDoRemoto 404, sem ser limite de cota', async () => {
  await comFalso(async ({ remoto, raizLocal }) => {
    await assert.rejects(
      () =>
        remoto.copiarArquivo({ raiz: raizLocal, relativo: 'nao/existe.jpg' }, { remoto: 'remoto_de_teste', pasta: '', relativo: 'x.jpg' }, 1),
      (e: unknown) => e instanceof ErroDoRemoto && e.status === 404 && !e.limiteDeCota,
    );
  });
});

test('o limite de cota da API e reconhecido; outro erro 5xx nao e', async () => {
  await comFalso(
    async ({ remoto, raizLocal }) => {
      writeFileSync(join(raizLocal, 'ab', 'a.bin'), 'a');
      const alvo = { remoto: 'remoto_de_teste', pasta: 'malote', relativo: 'a.bin' };
      const origem = { raiz: raizLocal, relativo: 'ab/a.bin' };
      await assert.rejects(
        () => remoto.copiarArquivo(origem, alvo, 1),
        (e: unknown) => e instanceof ErroDoRemoto && e.limiteDeCota && e.status === 403,
      );
      await assert.rejects(
        () => remoto.copiarArquivo(origem, alvo, 1),
        (e: unknown) => e instanceof ErroDoRemoto && !e.limiteDeCota && e.status === 500,
      );
      await remoto.copiarArquivo(origem, alvo, 1);
      assert.ok(await remoto.statArquivo(alvo));
    },
    { copyfile_cota: 1, copyfile_erro: 1 },
  );
});

test('Drive CHEIO (storageQuotaExceeded, 403) nao e limite de ritmo: e erro comum, com a mensagem do remoto', async () => {
  await comFalso(
    async ({ remoto, raizLocal }) => {
      writeFileSync(join(raizLocal, 'ab', 'a.bin'), 'a');
      await assert.rejects(
        () =>
          remoto.copiarArquivo({ raiz: raizLocal, relativo: 'ab/a.bin' }, { remoto: 'remoto_de_teste', pasta: 'malote', relativo: 'a.bin' }, 1),
        (e: unknown) => e instanceof ErroDoRemoto && e.status === 403 && !e.limiteDeCota && /storageQuotaExceeded/.test(e.message),
      );
    },
    { copyfile_drive_cheio: 1 },
  );
});

test('outro rcd na mesma porta (sem autenticacao) NAO e aceito como o do servico', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { binario, env } = prepararFalso(raiz);
    const porta = await portaLivre();
    // Um "rcd alheio": responde 200 a tudo, inclusive `core/version`, e diz que o pid e outro.
    const { createServer: criarHttp } = await import('node:http');
    const alheio = criarHttp((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ pid: 1, version: 'alheio' }));
    });
    await new Promise<void>((r) => alheio.listen(porta, '127.0.0.1', () => r()));
    try {
      await assert.rejects(
        () => iniciarRclone({ binario, porta }, env),
        (e: unknown) => e instanceof ErroDoRemoto && /ja responde por outro processo/.test(e.message),
      );
    } finally {
      await new Promise<void>((r) => alheio.close(() => r()));
    }
  } finally {
    limpar();
  }
});

test('o remoto que nao entrega o hash vem com sha256 nulo', async () => {
  await comFalso(
    async ({ remoto, raizLocal }) => {
      writeFileSync(join(raizLocal, 'ab', 'a.bin'), 'a');
      const alvo = { remoto: 'remoto_de_teste', pasta: 'malote', relativo: 'a.bin' };
      await remoto.copiarArquivo({ raiz: raizLocal, relativo: 'ab/a.bin' }, alvo, 1);
      assert.equal((await remoto.statArquivo(alvo))?.sha256, null);
    },
    { stat_sem_hash: true },
  );
});

test('binario inexistente e binario que sai logo falham alto, com a razao', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    await assert.rejects(
      () => iniciarRclone({ binario: join(raiz, 'nao-existe', 'rclone'), porta: portaAleatoria() }, {}),
      (e: unknown) => e instanceof ErroDoRemoto && /nao executou/.test(e.message),
    );

    const quebrado = join(raiz, 'rclone-quebrado');
    writeFileSync(quebrado, '#!/bin/sh\necho "falha de teste" >&2\nexit 3\n');
    chmodSync(quebrado, 0o755);
    await assert.rejects(
      async () => iniciarRclone({ binario: quebrado, porta: portaAleatoria() }, {}),
      (e: unknown) => e instanceof ErroDoRemoto && /encerrou ao subir \(codigo 3\).*falha de teste/.test(e.message),
    );
  } finally {
    limpar();
  }
});

test('depois de parar, o rcd nao responde mais', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { binario, env } = prepararFalso(raiz);
    const remoto = await iniciarRclone({ binario, porta: portaAleatoria() }, env);
    await remoto.parar();
    await assert.rejects(
      () => remoto.statArquivo({ remoto: 'r', pasta: '', relativo: 'x' }),
      (e: unknown) => e instanceof ErroDoRemoto && /nao respondeu/.test(e.message),
    );
  } finally {
    limpar();
  }
});

/** Uma porta alta e aleatoria: bastam para os testes que falham antes de escutar ou que sobem e param em seguida. */
function portaAleatoria(): number {
  return 20_000 + Math.floor(Math.random() * 20_000);
}
