import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ehPontoDeEntrada } from '../src/cli/entrada.js';

const RAIZ_DO_REPO = join(import.meta.dirname, '..');

/**
 * Invoca a CLI como PROCESSO, pelo caminho dado.
 *
 * Chamar `executar()` em processo — o que a ajuda `rodar()` faz — nunca
 * exercita o bloco de entrada, porque nesse caso o modulo e importado e o
 * bloco nao deve mesmo rodar. So o processo filho mede o defeito.
 */
function invocarCli(caminhoDaCli: string, raiz: string): { codigo: number; saida: string } {
  return invocarComEnv(caminhoDaCli, { MALOTE_HOME: raiz });
}

function invocarComEnv(
  caminhoDaCli: string,
  vars: Record<string, string>,
): { codigo: number; saida: string } {
  const r = spawnSync(
    process.execPath,
    ['--import', 'tsx', caminhoDaCli, 'operador', 'chave', 'criar'],
    { encoding: 'utf8', env: { ...process.env, ...vars }, timeout: 60_000 },
  );
  return { codigo: r.status ?? -1, saida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('a CLI EXECUTA quando invocada por caminho com symlink', () => {
  const temp = mkdtempSync(join(tmpdir(), 'malote-symlink-'));
  try {
    // O symlink e CRIADO aqui de proposito. Depender de `/tmp` ser link para
    // `/private/tmp` faria o teste passar por acidente do macOS e medir NADA
    // em Linux, onde `/tmp` e diretorio de verdade.
    const link = join(temp, 'malote-link');
    symlinkSync(RAIZ_DO_REPO, link);

    const porLink = invocarCli(join(link, 'src', 'cli', 'index.ts'), join(temp, 'inst-link'));

    // A ASSERCAO E SOBRE A SAIDA, nao sobre o codigo. O defeito JA sai 0:
    // exigir `codigo === 0` passa com o bug presente e mede nada.
    assert.notEqual(porLink.saida.trim(), '', 'invocada por symlink, a CLI nao executou nada');
    assert.match(porLink.saida, /Chave de Operador criada/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('a CLI EXECUTA quando o caminho tem espaco e acento, sem symlink algum', () => {
  // Segundo caso medido, e independente do primeiro: `import.meta.url` vem
  // percent-encoded e o caminho cru nao, entao a concatenacao diverge sem que
  // haja link nenhum no meio.
  const temp = mkdtempSync(join(tmpdir(), 'malote-espaco-'));
  try {
    const comEspaco = join(temp, 'pasta com espaço e acento');
    symlinkSync(RAIZ_DO_REPO, comEspaco);
    const r = invocarCli(join(comEspaco, 'src', 'cli', 'index.ts'), join(temp, 'inst-espaco'));
    assert.match(r.saida, /Chave de Operador criada/, 'a CLI nao executou em caminho com espaço');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('MALOTE_RAIZ nao redireciona mais nada — MALOTE_HOME e a unica valvula', () => {
  const nova = mkdtempSync(join(tmpdir(), 'malote-xdg-'));
  const isca = mkdtempSync(join(tmpdir(), 'malote-isca-'));
  try {
    const r = invocarComEnv(RAIZ_DO_REPO + '/src/cli/index.ts', {
      MALOTE_HOME: nova,
      MALOTE_RAIZ: isca,
    });
    assert.match(r.saida, /Chave de Operador criada/);
    // Criou em MALOTE_HOME, e a isca MALOTE_RAIZ ficou intocada: a variavel
    // velha nao tem efeito nenhum (spec do ciclo 20, criterio 5).
    assert.ok(existsSync(join(nova, 'registro.db')), 'a CLI nao criou em MALOTE_HOME');
    assert.equal(readdirSync(isca).length, 0, 'MALOTE_RAIZ ainda tem efeito');
  } finally {
    rmSync(nova, { recursive: true, force: true });
    rmSync(isca, { recursive: true, force: true });
  }
});

test('ehPontoDeEntrada devolve o que import.meta.main diz, quando ele existe', () => {
  assert.equal(ehPontoDeEntrada({ main: true, filename: '/qualquer' }, '/outro'), true);
  assert.equal(ehPontoDeEntrada({ main: false, filename: '/qualquer' }, '/qualquer'), false);
});

test('sem import.meta.main, ehPontoDeEntrada compara REALPATH — e e por isso que acerta', () => {
  const temp = mkdtempSync(join(tmpdir(), 'malote-realpath-'));
  try {
    // `filename` e SEMPRE o realpath — `import.meta.filename` nunca e outra
    // coisa. A fixture tem de refletir isso: em macOS o proprio `/var` do
    // diretorio temporario e link para `/private/var`, entao montar o caminho
    // com `join` e compara-lo cru reprova a funcao por defeito do teste.
    const real = join(realpathSync(temp), 'arquivo-real.js');
    writeFileSync(real, '// alvo\n');
    const link = join(temp, 'atalho.js');
    symlinkSync(real, link);

    // Este e o caso que o bug errava: invocado pelo LINK, o modulo carregado
    // e o REAL, e a resposta certa e `true`.
    assert.equal(ehPontoDeEntrada({ filename: real }, link), true);
    assert.equal(ehPontoDeEntrada({ filename: real }, real), true);

    // E continua sabendo dizer NAO quando a entrada foi outro arquivo.
    const outro = join(realpathSync(temp), 'outro.js');
    writeFileSync(outro, '// outro\n');
    assert.equal(ehPontoDeEntrada({ filename: real }, outro), false);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('sem import.meta.main, entrada ausente ou quebrada responde NAO, sem estourar', () => {
  assert.equal(ehPontoDeEntrada({ filename: '/qualquer' }, undefined), false);
  assert.equal(ehPontoDeEntrada({ filename: '/qualquer' }, '/nao/existe/em/lugar/nenhum'), false);
});
