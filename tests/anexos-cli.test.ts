import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { executar, executarConsultaRede } from '../src/cli/index.js';
import { formatarAnexos, tipoGuardado } from '../src/cli/anexos-texto.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { semearIdentidade, BRUNO_LID } from './ajuda/identidade.js';
import { semearMidia, subirCenaDeMidia, type SementesDeMidia } from './ajuda/midia.js';

function instalacaoComMidia(): { raiz: string; inquilino: string; grupo: string; m: SementesDeMidia; limpar: () => void } {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const inquilino = criarInquilino(registro, { titularNome: 'Titular' });
  registro.fechar();
  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
  const s = semearIdentidade(acervo);
  const m = semearMidia(acervo, s);
  acervo.fechar();
  return { raiz, inquilino, grupo: s.grupo, m, limpar };
}

const ambiente = (raiz: string, saida: string[]) => ({
  dados: raiz,
  estado: raiz,
  escrever: (t: string) => saida.push(t),
});

test('tipoGuardado traduz os apelidos de enviar e deixa o resto como esta (#1129)', () => {
  assert.equal(tipoGuardado('imagem'), 'image');
  assert.equal(tipoGuardado('documento'), 'document');
  assert.equal(tipoGuardado('image'), 'image');
  assert.equal(tipoGuardado('video'), 'video');
  assert.equal(tipoGuardado('sticker'), 'sticker');
});

test('o texto de um Anexo traz o id para malote midia, o nome original e a presenca (#1129)', () => {
  const linhas = formatarAnexos([
    {
      id: 'anx-1', tipo: 'document', presenca: 'nunca-obtido', tamanho: 2048, nomeOriginal: 'contrato.pdf',
      mensagemId: 'm1', autorId: 'i1', ocorridaEm: Date.parse('2026-06-01T12:30:00Z'),
    } as never,
    {
      id: 'anx-2', tipo: 'image', presenca: 'presente', tamanho: null, nomeOriginal: null,
      mensagemId: 'm2', autorId: null, ocorridaEm: Date.parse('2026-06-01T12:31:00Z'),
    } as never,
  ]);
  assert.match(linhas[0]!, /2026-06-01T12:30:00\.000Z\s+document\s+nunca-obtido\s+2048 bytes\s+contrato\.pdf\s+anx-1/);
  assert.match(linhas[1]!, /image\s+presente\s+\(tamanho desconhecido\)\s+\(sem nome\)\s+anx-2/);
  assert.deepEqual(formatarAnexos([]), ['Nenhum Anexo encontrado com estes filtros.']);
});

test('anexos LOCAL: texto e --json com o mesmo conteudo, e o apelido de tipo (#1129)', () => {
  const { raiz, inquilino, grupo, m, limpar } = instalacaoComMidia();
  try {
    const texto: string[] = [];
    assert.equal(executar(['anexos', '--inquilino', inquilino, '--conversa', grupo], ambiente(raiz, texto)), 0);
    assert.equal(texto.length, 5);
    assert.match(texto.join('\n'), /contrato\.pdf/);
    const json: string[] = [];
    assert.equal(executar(['anexos', '--inquilino', inquilino, '--conversa', grupo, '--json'], ambiente(raiz, json)), 0);
    assert.equal(JSON.parse(json.join('\n')).anexos.length, 5);
    const imagem: string[] = [];
    const apelido: string[] = [];
    assert.equal(
      executar(['anexos', '--inquilino', inquilino, '--conversa', grupo, '--tipo', 'image', '--json'], ambiente(raiz, imagem)),
      0,
    );
    assert.equal(
      executar(['anexos', '--inquilino', inquilino, '--conversa', grupo, '--tipo', 'imagem', '--json'], ambiente(raiz, apelido)),
      0,
    );
    assert.deepEqual(
      JSON.parse(apelido.join('\n')),
      JSON.parse(imagem.join('\n')),
      '--tipo imagem nunca devolve vazio por ser a palavra errada',
    );
    assert.equal(JSON.parse(imagem.join('\n')).anexos.length, 2);
    const remetente: string[] = [];
    assert.equal(
      executar(
        ['anexos', '--inquilino', inquilino, '--conversa', grupo, '--remetente', BRUNO_LID, '--json'],
        ambiente(raiz, remetente),
      ),
      0,
    );
    assert.deepEqual(
      JSON.parse(remetente.join('\n')).anexos.map((a: { id: string }) => a.id).sort(),
      [m.imagemDeBruno, m.documentoDeBruno, m.imagemSoltaDeBruno].sort(),
    );
  } finally {
    limpar();
  }
});

test('anexos LOCAL: pagina com --limite e devolve o token proximo, igual a rota (#1129)', () => {
  const { raiz, inquilino, grupo, limpar } = instalacaoComMidia();
  try {
    const p1: string[] = [];
    executar(['anexos', '--inquilino', inquilino, '--conversa', grupo, '--limite', '2', '--json'], ambiente(raiz, p1));
    const a = JSON.parse(p1.join('\n'));
    assert.equal(a.anexos.length, 2);
    assert.ok(a.proximo);
    const p2: string[] = [];
    executar(
      ['anexos', '--inquilino', inquilino, '--conversa', grupo, '--limite', '2', '--antes', a.proximo, '--json'],
      ambiente(raiz, p2),
    );
    assert.equal(JSON.parse(p2.join('\n')).anexos.length, 2);
  } finally {
    limpar();
  }
});

test('anexos LOCAL: uso errado sai 2 (#1129)', () => {
  const { raiz, inquilino, grupo, limpar } = instalacaoComMidia();
  try {
    const casos: string[][] = [
      ['anexos', '--inquilino', inquilino],
      ['anexos', '--inquilino', inquilino, '--conversa', 'nao-existe'],
      ['anexos', '--inquilino', inquilino, '--conversa', grupo, '--presenca', 'talvez'],
      ['anexos', '--inquilino', inquilino, '--conversa', grupo, '--desde', 'ontem'],
      ['anexos', '--inquilino', inquilino, '--conversa', grupo, '--antes', 'lixo'],
      ['anexos', '--inquilino', inquilino, '--conversa', grupo, '--limite', '0'],
    ];
    for (const c of casos) assert.equal(executar(c, ambiente(raiz, [])), 2, c.join(' '));
  } finally {
    limpar();
  }
});

test('mensagens --remetente LOCAL filtra pelo valor, inclusive o alternativo (#1129)', () => {
  const { raiz, inquilino, limpar } = instalacaoComMidia();
  try {
    const saida: string[] = [];
    assert.equal(
      executar(['mensagens', '--inquilino', inquilino, '--remetente', BRUNO_LID, '--json'], ambiente(raiz, saida)),
      0,
    );
    assert.equal(JSON.parse(saida.join('\n')).length, 4 + 3);
    const nada: string[] = [];
    assert.equal(
      executar(['mensagens', '--inquilino', inquilino, '--remetente', '000@lid', '--json'], ambiente(raiz, nada)),
      0,
    );
    assert.deepEqual(JSON.parse(nada.join('\n')), []);
  } finally {
    limpar();
  }
});

test('anexos por REDE: texto, --json, remetente, e mensagens --remetente (#1129)', async () => {
  const cena = await subirCenaDeMidia();
  try {
    const rede = (saida: string[]) => ({
      servidor: cena.url,
      chave: cena.chave.valor,
      escrever: (t: string) => saida.push(t),
    });
    const texto: string[] = [];
    assert.equal(await executarConsultaRede(['anexos', '--conversa', cena.s.grupo], rede(texto)), 0);
    assert.equal(texto.length, 5);
    assert.match(texto.join('\n'), new RegExp(cena.extra.documentoDeBruno));
    const json: string[] = [];
    assert.equal(
      await executarConsultaRede(['anexos', '--conversa', cena.s.grupo, '--tipo', 'imagem', '--json'], rede(json)),
      0,
    );
    assert.equal(JSON.parse(json.join('\n')).anexos.length, 2, 'o apelido vira image antes de ir ao servidor');
    const msg: string[] = [];
    assert.equal(
      await executarConsultaRede(['mensagens', '--conversa', cena.s.grupo, '--remetente', BRUNO_LID], rede(msg)),
      0,
    );
    assert.equal(JSON.parse(msg.join('\n')).mensagens.length, 1 + 2);
    const pagina: string[] = [];
    assert.equal(await executarConsultaRede(['anexos', '--conversa', cena.s.grupo, '--limite', '2'], rede(pagina)), 0);
    assert.match(pagina.join('\n'), /proximo: \S+ {2}\(use --antes\)/);
  } finally {
    cena.encerrar();
  }
});

test('anexos por REDE: --inquilino e recusado sem tocar a rede, e as classes de falha (#1129)', async () => {
  const cena = await subirCenaDeMidia();
  try {
    const saida: string[] = [];
    const foraDoAr = { servidor: 'http://127.0.0.1:1', chave: 'x', escrever: (t: string) => saida.push(t) };
    assert.equal(await executarConsultaRede(['anexos', '--conversa', cena.s.grupo, '--inquilino', 'x'], foraDoAr), 2);
    assert.match(saida.join('\n'), /--inquilino nao existe no modo rede/);
    assert.equal(await executarConsultaRede(['anexos', '--conversa', cena.s.grupo], foraDoAr), 4, 'servidor fora: conexao');
    const rede = (chave: string) => ({ servidor: cena.url, chave, escrever: (t: string) => saida.push(t) });
    assert.equal(await executarConsultaRede(['anexos', '--conversa', cena.s.grupo], rede('chave-errada')), 3);
    assert.equal(await executarConsultaRede(['anexos', '--conversa', 'nao-existe'], rede(cena.chave.valor)), 6);
    assert.equal(
      await executarConsultaRede(['anexos', '--conversa', cena.s.grupo, '--presenca', 'talvez'], rede(cena.chave.valor)),
      6,
    );
    assert.equal(await executarConsultaRede(['anexos'], rede(cena.chave.valor)), 2, 'sem --conversa');
  } finally {
    cena.encerrar();
  }
});

const INDEX = join(import.meta.dirname, '..', 'src', 'cli', 'index.ts');

function rodarExecutavel(env: Record<string, string>, argumentos: string[]): Promise<{ codigo: number; stdout: string; stderr: string }> {
  return new Promise((resolver) => {
    const base = { ...process.env };
    delete base['MALOTE_SERVIDOR'];
    delete base['MALOTE_CHAVE_DE_ACESSO'];
    const filho = spawn(process.execPath, ['--import', 'tsx', INDEX, ...argumentos], { env: { ...base, ...env } });
    let stdout = '';
    let stderr = '';
    filho.stdout.on('data', (d) => (stdout += d));
    filho.stderr.on('data', (d) => (stderr += d));
    filho.on('close', (codigo) => resolver({ codigo: codigo ?? -1, stdout, stderr }));
  });
}

test('o executavel despacha anexos por REDE: a allowlist de leituras o conhece (#1129)', async () => {
  const cena = await subirCenaDeMidia();
  try {
    const r = await rodarExecutavel(
      { MALOTE_SERVIDOR: cena.url, MALOTE_CHAVE_DE_ACESSO: cena.chave.valor },
      ['anexos', '--conversa', cena.s.grupo, '--tipo', 'imagem'],
    );
    assert.equal(r.codigo, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /operacao LOCAL/);
    assert.equal(r.stdout.trim().split('\n').length, 2, 'as duas imagens do grupo, uma linha cada');
  } finally {
    cena.encerrar();
  }
});
