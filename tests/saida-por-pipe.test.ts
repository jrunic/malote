import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { cenarioDeRede, type CenarioDeRede } from './ajuda/rede.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { registrarMensagem } from '../src/nucleo/escrita.js';

const INDEX = join(import.meta.dirname, '..', 'src', 'cli', 'index.ts');

/**
 * A saida do executavel REAL por PIPE — que e como todo agente a consome. O `process.exit`
 * logo depois do `console.log` deixava no pipe so os primeiros 65.536 bytes (o buffer do
 * pipe): o resto, enfileirado e ainda nao entregue, morria com o processo (#1125). Arquivo
 * e terminal escondiam o defeito, porque a escrita neles e sincrona.
 */
function rodar(
  env: Record<string, string>,
  argumentos: string[],
): Promise<{ codigo: number; stdout: string; stderr: string }> {
  return new Promise((resolver) => {
    const base = { ...process.env };
    delete base['MALOTE_SERVIDOR'];
    delete base['MALOTE_CHAVE_DE_ACESSO'];
    delete base['MALOTE_CHAVE_DE_ACESSO_AGENTE'];
    const filho = spawn(process.execPath, ['--import', 'tsx', INDEX, ...argumentos], {
      env: { ...base, ...env },
    });
    let stdout = '';
    let stderr = '';
    filho.stdout.on('data', (d) => (stdout += d));
    filho.stderr.on('data', (d) => (stderr += d));
    filho.on('close', (codigo) => resolver({ codigo: codigo ?? -1, stdout, stderr }));
  });
}

const QUANTAS = 150;

/**
 * Mensagens grandes o bastante para a saida passar de QUALQUER buffer: ~1,5 MB.
 *
 * O stdio de um filho do Node e um socketpair (Unix), e nao um pipe(2): o buffer de envio do
 * Linux e de ~208 KB, e 170 KB de saida cabiam nele em parte das execucoes — o filho nao
 * bloqueava, o teste do teto saiu em 0,35 s na CI e os outros dois teriam passado MESMO COM o
 * defeito. Medido: a falha apareceu em 1 de 2 execucoes do mesmo commit. A saida precisa
 * ultrapassar o buffer com folga, ou o teste mede a sorte do kernel.
 */
function semearMensagensGrandes(c: CenarioDeRede): void {
  const acervo = abrirAcervo(join(c.raiz, 'acervos'), c.inquilinoA as never);
  try {
    for (let i = 0; i < QUANTAS; i += 1) {
      registrarMensagem(acervo, {
        conversaId: c.conversaDeA,
        fonte: 'whatsapp',
        idExterno: `grande-${i}`,
        conteudo: `MSG-${String(i).padStart(4, '0')} ${'x'.repeat(10_000)}`,
        ocorridaEm: Date.parse('2026-06-02T12:00:00Z') + i * 1000,
        agora: Date.now(),
        direcao: 'recebida',
      });
    }
  } finally {
    acervo.fechar();
  }
}

const contarMarcas = (texto: string): number => (texto.match(/MSG-\d{4}/g) ?? []).length;

test('modo REDE: a saida de mais de 64 KB chega inteira por pipe (#1125)', async () => {
  const c = await cenarioDeRede();
  try {
    semearMensagensGrandes(c);
    const chave = c.emitir(c.inquilinoA);
    const r = await rodar(
      { MALOTE_SERVIDOR: `http://${c.endereco}:${c.porta}`, MALOTE_CHAVE_DE_ACESSO: chave.valor },
      ['mensagens', '--conversa', c.conversaDeA, '--limite', '1000'],
    );
    assert.equal(r.codigo, 0, r.stderr);
    assert.ok(Buffer.byteLength(r.stdout) > 1_000_000, `a saida devia passar de 1 MB, veio ${Buffer.byteLength(r.stdout)}`);
    const corpo = JSON.parse(r.stdout) as { mensagens: unknown[] };
    assert.equal(corpo.mensagens.length, QUANTAS + 1, 'as 150 semeadas mais a do cenario');
    assert.equal(contarMarcas(r.stdout), QUANTAS);
  } finally {
    await c.parar();
  }
});

test('modo LOCAL com --json: a saida de mais de 64 KB chega inteira por pipe (#1125)', async () => {
  const c = await cenarioDeRede();
  try {
    semearMensagensGrandes(c);
    const r = await rodar(
      { MALOTE_HOME: c.raiz },
      ['mensagens', '--inquilino', c.inquilinoA, '--conversa', c.conversaDeA, '--limite', '1000', '--json'],
    );
    assert.equal(r.codigo, 0, r.stderr);
    assert.ok(Buffer.byteLength(r.stdout) > 1_000_000, `a saida devia passar de 1 MB, veio ${Buffer.byteLength(r.stdout)}`);
    // --json e UMA escrita so, maior que o buffer do pipe: e o caso que o texto, linha a linha, esconde.
    assert.equal((JSON.parse(r.stdout) as unknown[]).length, QUANTAS + 1);
    assert.equal(contarMarcas(r.stdout), QUANTAS);
  } finally {
    await c.parar();
  }
});

test('o codigo de saida sobrevive a espera do flush (#1125)', async () => {
  const r = await rodar({}, ['comando-que-nao-existe']);
  assert.notEqual(r.codigo, 0);
  const versao = await rodar({}, ['--versao']);
  assert.equal(versao.codigo, 0);
  assert.match(versao.stdout, /^\d+\.\d+\.\d+/);
});

test('leitor que nunca esvazia o pipe nao pendura o processo: sai pelo teto de tempo (#1125)', { timeout: 30_000 }, async () => {
  const c = await cenarioDeRede();
  try {
    semearMensagensGrandes(c);
    const chave = c.emitir(c.inquilinoA);
    const base = { ...process.env };
    delete base['MALOTE_SERVIDOR'];
    delete base['MALOTE_CHAVE_DE_ACESSO'];
    const inicio = Date.now();
    const filho = spawn(
      process.execPath,
      ['--import', 'tsx', INDEX, 'mensagens', '--conversa', c.conversaDeA, '--limite', '1000'],
      {
        env: {
          ...base,
          MALOTE_SERVIDOR: `http://${c.endereco}:${c.porta}`,
          MALOTE_CHAVE_DE_ACESSO: chave.valor,
        },
      },
    );
    // Nao le o stdout: o pipe enche em 64 KB e o filho fica esperando por um leitor que nao vem.
    filho.stdout.pause();
    const codigo = await new Promise<number>((resolver) => filho.on('exit', (c2) => resolver(c2 ?? -1)));
    const segundos = (Date.now() - inicio) / 1000;
    assert.equal(codigo, 0, 'sai com o codigo do comando, nao pendurado');
    assert.ok(segundos >= 9, `devia esperar o teto de 10 s antes de desistir, saiu em ${segundos}s`);
    assert.ok(segundos < 25, `saiu em ${segundos}s`);
  } finally {
    await c.parar();
  }
});
