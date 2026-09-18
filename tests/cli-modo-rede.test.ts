import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { executar } from '../src/cli/index.js';

function rodarComEnv(
  dados: string,
  vars: Record<string, string>,
  argumentos: string[],
): { codigo: number; saida: string } {
  const linhas: string[] = [];
  const codigo = executar(argumentos, {
    dados,
    estado: dados,
    escrever: (t: string) => linhas.push(t),
    ...(vars.MALOTE_SERVIDOR !== undefined || vars.MALOTE_CHAVE_DE_ACESSO !== undefined
      ? { servidor: vars.MALOTE_SERVIDOR, chave: vars.MALOTE_CHAVE_DE_ACESSO }
      : {}),
  } as Parameters<typeof executar>[1]);
  return { codigo, saida: linhas.join('\n') };
}

test('escrita com modo rede recusa ANTES de abrir base e sem efeito em disco', () => {
  const dados = mkdtempSync(join(tmpdir(), 'malote-modo-'));
  try {
    const r = rodarComEnv(dados, { MALOTE_SERVIDOR: 'http://x', MALOTE_CHAVE_DE_ACESSO: 'k' },
      ['inquilino', 'criar', '--chave', 'v', '--titular', 'T']);
    assert.equal(r.codigo, 2);
    assert.match(r.saida, /LOCAL/);
    assert.equal(existsSync(join(dados, 'registro.db')), false, 'a invocacao abriu base');
  } finally {
    rmSync(dados, { recursive: true, force: true });
  }
});

test('sem servidor declarado, o modo e local — byte a byte como hoje', () => {
  const dados = mkdtempSync(join(tmpdir(), 'malote-modo-'));
  try {
    const r = rodarComEnv(dados, {}, ['buscar']);
    // `buscar` sem --inquilino recusa no modo local: e o comportamento de
    // hoje, e e ele que prova que nada de rede interferiu.
    assert.equal(r.codigo, 1);
    assert.match(r.saida, /--inquilino/);
  } finally {
    rmSync(dados, { recursive: true, force: true });
  }
});

test('mensagens por rede, ponta a ponta: subprocesso consulta o servidor real', async () => {
  const { cenario } = await import('./ajuda/acervo.js');
  const cena = cenario();
  try {
    const { acervo } = cena.novoInquilino('Ahsoka');
    const { registrarConversa, registrarMensagem } = await import('../src/nucleo/escrita.js');
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'a@s.whatsapp.net',
      coletiva: false,
      configuracao: { id: 'cfg-1', fonte: 'whatsapp' },
    });
    registrarMensagem(acervo, {
      conversaId,
      fonte: 'whatsapp',
      idExterno: 'm1',
      ocorridaEm: 1789506000000,
      agora: 1789506100000,
      conteudo: 'primeira',
    });
    acervo.fechar();

    // Servidor de consulta real sobre o Acervo de fixture.
    const { criarServidor } = await import('../src/rede/servidor.js');
    const srv = criarServidor({ dados: cena.raiz, porta: 0 });
    const http = srv.listen(0, '127.0.0.1');
    await new Promise<void>((r) => http.once('listening', r));
    const porta = (http.address() as { port: number }).port;

    // Chave de Acesso no Registro: criar via CLI local.
    const k = rodarComEnv(cena.raiz, {}, ['operador', 'chave', 'criar']);
    const chaveOp = /valor:\s*(\S+)/.exec(k.saida)?.[1] ?? '';
    const criacao = rodarComEnv(cena.raiz, {}, [
      'acesso', 'chave', 'emitir', '--chave', chaveOp, '--inquilino',
      (await import('../src/registro/registro.js')).listarInquilinos(
        (await import('../src/registro/registro.js')).abrirRegistro(cena.raiz),
      )[0]!.id,
    ]);
    const chaveAcesso = /valor:\s*(\S+)/.exec(criacao.saida)?.[1] ?? '';

    // ASYNC de proposito: o servidor de teste vive NESTE processo — spawnSync
    // bloquearia o event loop e o pedido do filho nunca seria atendido
    // (medido: filho sai 7, timeout do cliente).
    const saida = await new Promise<{ codigo: number | null; stdout: string; stderr: string }>(
      (resolver) => {
        const filho = spawn(
          process.execPath,
          ['--import', 'tsx', join(import.meta.dirname, '..', 'src', 'cli', 'index.ts'),
            'mensagens', '--conversa', conversaId],
          { env: { ...process.env,
              MALOTE_HOME: cena.raiz,
              MALOTE_SERVIDOR: `http://127.0.0.1:${porta}`,
              MALOTE_CHAVE_DE_ACESSO: chaveAcesso } },
        );
        let stdout = '';
        let stderr = '';
        filho.stdout.on('data', (d) => (stdout += d));
        filho.stderr.on('data', (d) => (stderr += d));
        filho.on('close', (codigo) => resolver({ codigo: codigo ?? -1, stdout, stderr }));
      },
    );
    assert.equal(saida.codigo, 0, `stdout=${saida.stdout}\nstderr=${saida.stderr}`);
    const corpo = JSON.parse(saida.stdout) as { mensagens: Array<{ conteudo: string }> };
    assert.equal(corpo.mensagens[0]!.conteudo, 'primeira');
    http.close();
  } finally {
    cena.limpar();
  }
});

test('malote configuracao listar em modo rede: subprocesso consulta o servidor real', async () => {
  const { cenario } = await import('./ajuda/acervo.js');
  const cena = cenario();
  try {
    const { id: inquilinoId } = cena.novoInquilino('Ahsoka');
    const { resolverConfiguracao } = await import('../src/registro/configuracao-adaptador.js');
    resolverConfiguracao(cena.registro, inquilinoId, 'whatsapp', 'orlando');

    const { criarServidor } = await import('../src/rede/servidor.js');
    const srv = criarServidor({ dados: cena.raiz, porta: 0 });
    const http = srv.listen(0, '127.0.0.1');
    await new Promise<void>((r) => http.once('listening', r));
    const porta = (http.address() as { port: number }).port;

    const k = rodarComEnv(cena.raiz, {}, ['operador', 'chave', 'criar']);
    const chaveOp = /valor:\s*(\S+)/.exec(k.saida)?.[1] ?? '';
    const criacao = rodarComEnv(cena.raiz, {}, [
      'acesso', 'chave', 'emitir', '--chave', chaveOp, '--inquilino', inquilinoId,
    ]);
    const chaveAcesso = /valor:\s*(\S+)/.exec(criacao.saida)?.[1] ?? '';

    const saida = await new Promise<{ codigo: number | null; stdout: string; stderr: string }>(
      (resolver) => {
        const filho = spawn(
          process.execPath,
          ['--import', 'tsx', join(import.meta.dirname, '..', 'src', 'cli', 'index.ts'),
            'configuracao', 'listar'],
          { env: { ...process.env,
              MALOTE_HOME: cena.raiz,
              MALOTE_SERVIDOR: `http://127.0.0.1:${porta}`,
              MALOTE_CHAVE_DE_ACESSO: chaveAcesso } },
        );
        let stdout = '';
        let stderr = '';
        filho.stdout.on('data', (d) => (stdout += d));
        filho.stderr.on('data', (d) => (stderr += d));
        filho.on('close', (codigo) => resolver({ codigo: codigo ?? -1, stdout, stderr }));
      },
    );
    assert.equal(saida.codigo, 0, `stdout=${saida.stdout}\nstderr=${saida.stderr}`);
    const corpo = JSON.parse(saida.stdout) as { configuracoes: Array<{ apelido: string; fonte: string }> };
    assert.deepEqual(corpo.configuracoes, [{ apelido: 'orlando', fonte: 'whatsapp' }]);
    http.close();
  } finally {
    cena.limpar();
  }
});

test('malote conversas --fixada em modo rede: subprocesso encaminha fixada e configuracao', async () => {
  const { cenario } = await import('./ajuda/acervo.js');
  const cena = cenario();
  try {
    const { id: inquilinoId, acervo } = cena.novoInquilino('Ahsoka');
    const { resolverConfiguracao } = await import('../src/registro/configuracao-adaptador.js');
    const cfg = resolverConfiguracao(cena.registro, inquilinoId, 'whatsapp', 'orlando');
    const { registrarConversa } = await import('../src/nucleo/escrita.js');
    const { marcarConversa } = await import('../src/nucleo/marca-do-titular.js');
    const marcadaId = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: '444@s.whatsapp.net', coletiva: false,
      configuracao: { id: cfg.id, fonte: 'whatsapp' },
    });
    registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: '555@s.whatsapp.net', coletiva: false,
      configuracao: { id: cfg.id, fonte: 'whatsapp' },
    });
    marcarConversa(acervo, {
      conversaId: marcadaId, marca: 'fixada', configuracaoId: cfg.id, observadaEm: Date.now(),
    });
    acervo.fechar();

    const { criarServidor } = await import('../src/rede/servidor.js');
    const srv = criarServidor({ dados: cena.raiz, porta: 0 });
    const http = srv.listen(0, '127.0.0.1');
    await new Promise<void>((r) => http.once('listening', r));
    const porta = (http.address() as { port: number }).port;

    const k = rodarComEnv(cena.raiz, {}, ['operador', 'chave', 'criar']);
    const chaveOp = /valor:\s*(\S+)/.exec(k.saida)?.[1] ?? '';
    const criacao = rodarComEnv(cena.raiz, {}, [
      'acesso', 'chave', 'emitir', '--chave', chaveOp, '--inquilino', inquilinoId,
    ]);
    const chaveAcesso = /valor:\s*(\S+)/.exec(criacao.saida)?.[1] ?? '';

    const saida = await new Promise<{ codigo: number | null; stdout: string; stderr: string }>(
      (resolver) => {
        const filho = spawn(
          process.execPath,
          ['--import', 'tsx', join(import.meta.dirname, '..', 'src', 'cli', 'index.ts'),
            'conversas', '--fixada', 'true', '--configuracao', 'orlando', '--json'],
          { env: { ...process.env,
              MALOTE_HOME: cena.raiz,
              MALOTE_SERVIDOR: `http://127.0.0.1:${porta}`,
              MALOTE_CHAVE_DE_ACESSO: chaveAcesso } },
        );
        let stdout = '';
        let stderr = '';
        filho.stdout.on('data', (d) => (stdout += d));
        filho.stderr.on('data', (d) => (stderr += d));
        filho.on('close', (codigo) => resolver({ codigo: codigo ?? -1, stdout, stderr }));
      },
    );
    assert.equal(saida.codigo, 0, `stdout=${saida.stdout}\nstderr=${saida.stderr}`);
    const corpo = JSON.parse(saida.stdout) as { conversas: Array<{ id: string }> };
    assert.deepEqual(corpo.conversas.map((c) => c.id), [marcadaId]);
    http.close();
  } finally {
    cena.limpar();
  }
});
