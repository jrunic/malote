import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { executar, executarConsultaRede } from '../src/cli/index.js';
import { avisoDeCorteDeConversas } from '../src/cli/aviso-de-corte.js';
import { validarBandeiras } from '../src/cli/bandeiras.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { semearIdentidade, subirCenaDeIdentidade } from './ajuda/identidade.js';

// #1202: `conversas` pagina nos dois modos. Sem cursor, a primeira pagina; ha mais, a CLI AVISA (na saida de erro
// com --json, para o JSON da saida padrao seguir parseavel); `--tudo` percorre as paginas e entrega a lista inteira.

const INDEX = join(import.meta.dirname, '..', 'src', 'cli', 'index.ts');

function instalacao(): { raiz: string; inquilino: string; limpar: () => void } {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const inquilino = criarInquilino(registro, { titularNome: 'Titular' });
  registro.fechar();
  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
  semearIdentidade(acervo);
  acervo.fechar();
  return { raiz, inquilino, limpar };
}

function rodarLocal(raiz: string, argumentos: string[]): { codigo: number; saida: string[]; erro: string[] } {
  const saida: string[] = [];
  const erro: string[] = [];
  const codigo = executar(argumentos, { dados: raiz, estado: raiz, escrever: (t) => saida.push(t), erro: (t) => erro.push(t) });
  return { codigo, saida, erro };
}

const idsDe = (saida: string[]): string[] => (JSON.parse(saida.join('\n')) as Array<{ id: string }>).map((c) => c.id);

test('o aviso diz quantas mostrou, traz o proximo para colar em --antes e lembra o --tudo', () => {
  const a = avisoDeCorteDeConversas(500, 'TOKEN');
  assert.match(a, /500/);
  assert.match(a, /--antes TOKEN/);
  assert.match(a, /--tudo/);
});

test('--tudo e uma bandeira (sem valor), e --antes pede valor', () => {
  assert.equal(validarBandeiras(['conversas', '--tudo', '--json']), undefined);
  assert.match(validarBandeiras(['conversas', '--antes']) ?? '', /pede um valor/);
});

test('LOCAL: uma lista que cabe na pagina sai inteira, sem aviso', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const r = rodarLocal(raiz, ['conversas', '--inquilino', inquilino, '--json']);
    assert.equal(r.codigo, 0);
    assert.equal(idsDe(r.saida).length, 4);
    assert.deepEqual(r.erro, []);
  } finally {
    limpar();
  }
});

test('LOCAL --json: a primeira pagina e o array, e o aviso com o proximo vai para a SAIDA DE ERRO', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const r = rodarLocal(raiz, ['conversas', '--inquilino', inquilino, '--limite', '2', '--json']);
    assert.equal(r.codigo, 0);
    assert.equal(idsDe(r.saida).length, 2, 'o JSON da saida padrao segue sendo um array parseavel');
    assert.equal(r.erro.length, 1);
    const proximo = /--antes (\S+)/.exec(r.erro[0] ?? '')?.[1];
    assert.ok(proximo !== undefined);

    const seguinte = rodarLocal(raiz, ['conversas', '--inquilino', inquilino, '--limite', '2', '--antes', proximo, '--json']);
    assert.equal(seguinte.codigo, 0);
    assert.equal(idsDe(seguinte.saida).length, 2);
    assert.deepEqual(seguinte.erro, [], 'a ultima pagina nao avisa');
    const todas = idsDe(rodarLocal(raiz, ['conversas', '--inquilino', inquilino, '--json']).saida);
    assert.deepEqual([...idsDe(r.saida), ...idsDe(seguinte.saida)], todas);
  } finally {
    limpar();
  }
});

test('LOCAL em texto: o aviso sai na saida padrao, depois das linhas', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const r = rodarLocal(raiz, ['conversas', '--inquilino', inquilino, '--limite', '3']);
    assert.equal(r.codigo, 0);
    assert.equal(r.saida.length, 4, 'tres linhas e o aviso');
    assert.match(r.saida[3] ?? '', /--tudo/);
    assert.deepEqual(r.erro, []);
  } finally {
    limpar();
  }
});

test('LOCAL --tudo percorre as paginas e entrega a lista inteira, sem aviso; o limite e o tamanho da pagina', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const todas = idsDe(rodarLocal(raiz, ['conversas', '--inquilino', inquilino, '--json']).saida);
    const r = rodarLocal(raiz, ['conversas', '--inquilino', inquilino, '--tudo', '--limite', '1', '--json']);
    assert.equal(r.codigo, 0);
    assert.deepEqual(idsDe(r.saida), todas);
    assert.deepEqual(r.erro, []);
  } finally {
    limpar();
  }
});

test('LOCAL: --tudo com --antes e erro de uso (2), e cursor invalido tambem; nada vira primeira pagina', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const a = rodarLocal(raiz, ['conversas', '--inquilino', inquilino, '--tudo', '--antes', 'x']);
    assert.equal(a.codigo, 2);
    assert.match(a.saida.join('\n'), /--tudo e --antes se contradizem/);
    const b = rodarLocal(raiz, ['conversas', '--inquilino', inquilino, '--antes', 'lixo']);
    assert.equal(b.codigo, 2);
    assert.match(b.saida.join('\n'), /Cursor invalido/);
  } finally {
    limpar();
  }
});

test('REDE: a primeira pagina e o corpo com proximo; o aviso vai para a saida de erro', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const saida: string[] = [];
    const erro: string[] = [];
    const rede = { servidor: cena.url, chave: cena.chave.valor, escrever: (t: string) => saida.push(t), erro: (t: string) => erro.push(t) };
    assert.equal(await executarConsultaRede(['conversas', '--limite', '2'], rede), 0);
    const corpo = JSON.parse(saida.join('\n'));
    assert.equal(corpo.conversas.length, 2);
    assert.equal(typeof corpo.proximo, 'string');
    assert.equal(erro.length, 1);
    assert.match(erro[0] ?? '', new RegExp(`--antes ${corpo.proximo}`));
  } finally {
    cena.encerrar();
  }
});

test('REDE --tudo: a lista inteira num corpo so, sem proximo; com --antes e erro de uso, sem tocar a rede', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const todas = JSON.parse(await (async () => { const s: string[] = []; await executarConsultaRede(['conversas'], { servidor: cena.url, chave: cena.chave.valor, escrever: (t) => s.push(t) }); return s.join('\n'); })()).conversas;
    const saida: string[] = [];
    const rede = { servidor: cena.url, chave: cena.chave.valor, escrever: (t: string) => saida.push(t), erro: () => undefined };
    assert.equal(await executarConsultaRede(['conversas', '--tudo', '--limite', '1'], rede), 0);
    const corpo = JSON.parse(saida.join('\n'));
    assert.deepEqual(corpo.conversas, todas);
    assert.equal('proximo' in corpo, false);

    const recusa: string[] = [];
    assert.equal(await executarConsultaRede(['conversas', '--tudo', '--antes', 'x'], { servidor: 'http://127.0.0.1:1', chave: 'k', escrever: (t) => recusa.push(t) }), 2);
    assert.match(recusa.join('\n'), /--tudo e --antes se contradizem/);
  } finally {
    cena.encerrar();
  }
});

test('REDE --tudo: o servidor que repete o cursor interrompe em vez de girar para sempre', async () => {
  const srv: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ conversas: [{ id: 'c1' }], proximo: 'sempre-o-mesmo' }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const saida: string[] = [];
    const codigo = await executarConsultaRede(['conversas', '--tudo'], { servidor: url, chave: 'k', escrever: (t) => saida.push(t) });
    assert.equal(codigo, 1);
    assert.match(saida.join('\n'), /mesmo cursor duas vezes/);
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});

test('o executavel por REDE: o JSON na saida padrao e o aviso na de erro, separados', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const base = { ...process.env };
    delete base['MALOTE_SERVIDOR'];
    delete base['MALOTE_CHAVE_DE_ACESSO'];
    const env = { ...base, MALOTE_HOME: cena.raiz, MALOTE_SERVIDOR: cena.url, MALOTE_CHAVE_DE_ACESSO: cena.chave.valor };
    const r = await new Promise<{ codigo: number; stdout: string; stderr: string }>((resolver) => {
      const filho = spawn(process.execPath, ['--import', 'tsx', INDEX, 'conversas', '--limite', '2'], { env });
      let stdout = '';
      let stderr = '';
      filho.stdout.on('data', (d) => (stdout += d));
      filho.stderr.on('data', (d) => (stderr += d));
      filho.on('close', (codigo) => resolver({ codigo: codigo ?? -1, stdout, stderr }));
    });
    assert.equal(r.codigo, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).conversas.length, 2, 'a saida padrao e so o JSON');
    assert.match(r.stderr, /--antes/);
  } finally {
    cena.encerrar();
  }
});

test('o executavel LOCAL com --json: a saida padrao e so o array e o aviso chega na saida de erro de verdade', async () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const base = { ...process.env };
    delete base['MALOTE_SERVIDOR'];
    delete base['MALOTE_CHAVE_DE_ACESSO'];
    const env = { ...base, MALOTE_HOME: raiz };
    const r = await new Promise<{ codigo: number; stdout: string; stderr: string }>((resolver) => {
      const filho = spawn(process.execPath, ['--import', 'tsx', INDEX, 'conversas', '--inquilino', inquilino, '--limite', '2', '--json'], { env });
      let stdout = '';
      let stderr = '';
      filho.stdout.on('data', (d) => (stdout += d));
      filho.stderr.on('data', (d) => (stderr += d));
      filho.on('close', (codigo) => resolver({ codigo: codigo ?? -1, stdout, stderr }));
    });
    assert.equal(r.codigo, 0, r.stderr);
    assert.equal((JSON.parse(r.stdout) as unknown[]).length, 2, 'a saida padrao e so o JSON');
    assert.match(r.stderr, /--antes/);
  } finally {
    limpar();
  }
});
