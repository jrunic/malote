import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executar } from '../src/cli/index.js';
import { executarExportarLocal, executarExportarRede, lerPedidoDeExport } from '../src/cli/exportar.js';
import { cenarioDeRede } from './ajuda/rede.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { registrarMensagem } from '../src/nucleo/escrita.js';
import { semearIdentidade, subirCenaDeIdentidade, BRUNO_LID, PRECEDENCIA } from './ajuda/identidade.js';
import { semearMidia } from './ajuda/midia.js';

const INDEX = join(import.meta.dirname, '..', 'src', 'cli', 'index.ts');
const pasta = (): string => mkdtempSync(join(tmpdir(), 'exportar-cli-'));

interface Pagina {
  status?: number;
  mensagens?: unknown[];
  proximo?: string;
}

/** Servidor de mentira que serve as paginas em ordem e grava cada URL pedida. */
async function servidorDePaginas(paginas: Pagina[]): Promise<{ url: string; pedidos: string[]; parar: () => void }> {
  const pedidos: string[] = [];
  let n = 0;
  const srv: Server = createServer((req, res) => {
    pedidos.push(req.url ?? '');
    if ((req.url ?? '').includes('/autores')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ autores: [{ identificadorId: 'i1', valor: '111@s.whatsapp.net', nome: 'Ana' }] }));
      return;
    }
    const p = paginas[n] ?? { mensagens: [] };
    n += 1;
    res.writeHead(p.status ?? 200, { 'content-type': 'application/json' });
    res.end(
      p.status !== undefined && p.status >= 400
        ? ''
        : JSON.stringify({ mensagens: p.mensagens ?? [], ...(p.proximo !== undefined ? { proximo: p.proximo } : {}) }),
    );
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const porta = (srv.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${porta}`,
    pedidos,
    parar: () => {
      srv.closeAllConnections();
      srv.close();
    },
  };
}

const m = (id: string, t: number, conteudo: string) => ({
  id,
  conversaId: 'c1',
  fonte: 'whatsapp',
  autorId: 'i1',
  conteudo,
  ocorridaEm: t,
  direcao: 'recebida',
  anexos: [],
});

function rede(url: string) {
  const dados: string[] = [];
  const erros: string[] = [];
  return {
    dados,
    erros,
    dep: {
      servidor: url,
      chave: 'k' as string | undefined,
      escrever: (t: string) => dados.push(t),
      erro: (t: string) => erros.push(t),
      aguardarEscoamento: async () => undefined,
    },
  };
}

test('o export manda ordem=cronologica em TODA pagina, devolve o cursor recebido e junta sem repetir nem pular (#1129)', async () => {
  const T = Date.parse('2026-06-01T12:00:00Z');
  const s = await servidorDePaginas([
    { mensagens: [m('a', T, 'um'), m('b', T, 'dois')], proximo: 'tok1' },
    { mensagens: [m('c', T, 'tres'), m('d', T + 1000, 'quatro')], proximo: 'tok2' },
    { mensagens: [m('e', T + 2000, 'cinco')] },
  ]);
  try {
    const r = rede(s.url);
    assert.equal(await executarExportarRede(['exportar', '--conversa', 'c1'], r.dep), 0);
    assert.deepEqual(
      r.dados.filter((l) => !l.startsWith('    ')).map((l) => l.split(': ')[1]),
      ['um', 'dois', 'tres', 'quatro', 'cinco'],
    );
    const paginas = s.pedidos.filter((u) => u.includes('/mensagens'));
    assert.equal(paginas.length, 3);
    for (const u of paginas) assert.match(u, /ordem=cronologica/, `toda pagina leva a ordem: ${u}`);
    assert.doesNotMatch(paginas[0]!, /antes=/);
    assert.match(paginas[1]!, /antes=tok1/);
    assert.match(paginas[2]!, /antes=tok2/);
    assert.match(paginas[0]!, /limite=500/);
  } finally {
    s.parar();
  }
});

test('filtros vao ao servidor: remetente, desde e ate (#1129)', async () => {
  const s = await servidorDePaginas([{ mensagens: [] }]);
  try {
    const r = rede(s.url);
    await executarExportarRede(
      ['exportar', '--conversa', 'c1', '--remetente', '999@lid', '--desde', '2026-06-01', '--ate', '2026-06-02'],
      r.dep,
    );
    const u = s.pedidos.find((x) => x.includes('/mensagens'))!;
    assert.match(u, /remetente=999%40lid/);
    assert.match(u, /desde=2026-06-01/);
    assert.match(u, /ate=2026-06-02/);
  } finally {
    s.parar();
  }
});

test('falha na pagina 2 com --saida: sai 5, nao deixa o arquivo e deixa o parcial (#1129)', async () => {
  const s = await servidorDePaginas([{ mensagens: [m('a', 1, 'um')], proximo: 'tok1' }, { status: 500 }]);
  const saida = join(pasta(), 'conversa.txt');
  try {
    const r = rede(s.url);
    assert.equal(await executarExportarRede(['exportar', '--conversa', 'c1', '--saida', saida], r.dep), 5);
    assert.ok(!existsSync(saida), 'nao ha arquivo que pareca completo');
    assert.ok(existsSync(`${saida}.parcial`));
    assert.match(r.erros.join('\n'), /Arquivo parcial:/);
  } finally {
    s.parar();
  }
});

test('falha na pagina 2 SEM --saida: o codigo de saida e o sinal, e nunca 0 (#1129)', async () => {
  const s = await servidorDePaginas([{ mensagens: [m('a', 1, 'um')], proximo: 'tok1' }, { status: 500 }]);
  try {
    const r = rede(s.url);
    assert.equal(await executarExportarRede(['exportar', '--conversa', 'c1'], r.dep), 5);
    assert.ok(r.dados.length > 0, 'o que ja foi escrito foi escrito: so o codigo avisa que esta truncado');
  } finally {
    s.parar();
  }
});

test('o servidor que repete o cursor interrompe o export em vez de girar (#1129)', async () => {
  const s = await servidorDePaginas([
    { mensagens: [m('a', 1, 'um')], proximo: 'tok' },
    { mensagens: [m('b', 2, 'dois')], proximo: 'tok' },
  ]);
  try {
    const r = rede(s.url);
    assert.equal(await executarExportarRede(['exportar', '--conversa', 'c1'], r.dep), 1);
    assert.match(r.erros.join('\n'), /mesmo cursor/);
  } finally {
    s.parar();
  }
});

test('uso errado por rede: --inquilino, sem chave, formato invalido, --saida existente (#1129)', async () => {
  const s = await servidorDePaginas([]);
  try {
    const saida = join(pasta(), 'ja.txt');
    writeFileSync(saida, 'antigo');
    const r = rede(s.url);
    assert.equal(await executarExportarRede(['exportar', '--conversa', 'c1', '--inquilino', 'x'], r.dep), 2);
    assert.equal(await executarExportarRede(['exportar', '--conversa', 'c1'], { ...r.dep, chave: undefined }), 2);
    assert.equal(await executarExportarRede(['exportar', '--conversa', 'c1', '--formato', 'html'], r.dep), 2);
    assert.equal(await executarExportarRede(['exportar', '--conversa', 'c1', '--saida', saida], r.dep), 2);
    assert.equal(readFileSync(saida, 'utf8'), 'antigo', 'a recusa nao tocou o arquivo');
    assert.equal(s.pedidos.length, 0, 'nenhuma recusa tocou a rede');
  } finally {
    s.parar();
  }
});

test('contra o servidor real: nomes, remetente por valor alternativo, json valido e Conversa inexistente (#1129)', async () => {
  const cena = await subirCenaDeIdentidade({ semearMais: semearMidia });
  try {
    const r = rede(cena.url);
    r.dep.chave = cena.chave.valor;
    assert.equal(await executarExportarRede(['exportar', '--conversa', cena.s.grupo], r.dep), 0);
    const txt = r.dados.join('\n');
    assert.match(txt, /Bruno Contato: texto 4/, 'nome corrente do autor, pela precedencia');
    assert.match(txt, /Ana WhatsApp: texto 7/);
    assert.match(txt, /\[document nunca-obtido \S+ contrato\.pdf\]/);
    assert.match(txt, /Dani: texto 5/, 'Dani so escreve e nao consta de participantes: o nome vem dos autores');
    assert.doesNotMatch(txt, /remetente desconhecido/);

    const so = rede(cena.url);
    so.dep.chave = cena.chave.valor;
    assert.equal(
      await executarExportarRede(['exportar', '--conversa', cena.s.grupo, '--remetente', BRUNO_LID], so.dep),
      0,
    );
    const bruno = so.dados.filter((l) => /^\d{4}-/.test(l));
    assert.equal(bruno.length, 1 + 2, 'so o que o Bruno escreveu no grupo');
    assert.ok(bruno.every((l) => l.includes('Bruno Contato')));

    const json = rede(cena.url);
    json.dep.chave = cena.chave.valor;
    assert.equal(await executarExportarRede(['exportar', '--conversa', cena.s.grupo, '--json'], json.dep), 0);
    const doc = JSON.parse(json.dados.join('\n'));
    assert.equal(doc.mensagens.length, 5 + 4, 'as cinco de texto do grupo mais as quatro com Anexo');

    const nada = rede(cena.url);
    nada.dep.chave = cena.chave.valor;
    assert.equal(await executarExportarRede(['exportar', '--conversa', 'nao-existe'], nada.dep), 6);
  } finally {
    cena.encerrar();
  }
});

test('exportar LOCAL: txt e json com o conteudo da rede, --saida existente recusada, Conversa desconhecida (#1129)', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const inquilino = criarInquilino(registro, { titularNome: 'Titular' });
    registro.fechar();
    const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
    const s = semearIdentidade(acervo);
    semearMidia(acervo, s);
    acervo.fechar();
    const amb = (saida: string[]) => ({ dados: raiz, estado: raiz, escrever: (t: string) => saida.push(t) });

    const txt: string[] = [];
    assert.equal(executar(['exportar', '--inquilino', inquilino, '--conversa', s.grupo], amb(txt)), 0);
    assert.match(txt.join('\n'), /Bruno Contato: texto 4/);
    assert.match(txt.join('\n'), /Dani: texto 5/);

    const arquivo = join(pasta(), 'local.json');
    const aviso: string[] = [];
    assert.equal(
      executar(['exportar', '--inquilino', inquilino, '--conversa', s.grupo, '--json', '--saida', arquivo], amb(aviso)),
      0,
    );
    assert.equal(JSON.parse(readFileSync(arquivo, 'utf8')).mensagens.length, 9);
    assert.match(aviso.join('\n'), /Exportadas 9 Mensagem\(ns\)/);
    assert.equal(
      executar(['exportar', '--inquilino', inquilino, '--conversa', s.grupo, '--saida', arquivo], amb([])),
      2,
      'ja existe',
    );
    assert.equal(executar(['exportar', '--inquilino', inquilino, '--conversa', 'nao-existe'], amb([])), 2);
    assert.equal(executar(['exportar', '--inquilino', inquilino], amb([])), 2);
  } finally {
    limpar();
  }
});

/** O executavel REAL por pipe, com saida de ~1,5 MB: passa do buffer do socketpair do Linux (#1125). */
function rodar(
  env: Record<string, string>,
  argumentos: string[],
): Promise<{ codigo: number; stdout: string; stderr: string }> {
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

test('o executavel exporta por rede uma Conversa de mais de 1 MB inteira por pipe (#1129)', async () => {
  const c = await cenarioDeRede();
  try {
    const acervo = abrirAcervo(join(c.raiz, 'acervos'), c.inquilinoA as never);
    try {
      for (let i = 0; i < 150; i += 1) {
        registrarMensagem(acervo, {
          conversaId: c.conversaDeA,
          fonte: 'whatsapp',
          idExterno: `exp-${i}`,
          conteudo: `MSG-${String(i).padStart(4, '0')} ${'x'.repeat(10_000)}`,
          ocorridaEm: Date.parse('2026-06-02T12:00:00Z') + i * 1000,
          agora: Date.now(),
          direcao: 'recebida',
        });
      }
    } finally {
      acervo.fechar();
    }
    const chave = c.emitir(c.inquilinoA);
    const r = await rodar(
      { MALOTE_SERVIDOR: `http://${c.endereco}:${c.porta}`, MALOTE_CHAVE_DE_ACESSO: chave.valor },
      ['exportar', '--conversa', c.conversaDeA],
    );
    assert.equal(r.codigo, 0, r.stderr);
    assert.ok(Buffer.byteLength(r.stdout) > 1_000_000, `a saida devia passar de 1 MB, veio ${Buffer.byteLength(r.stdout)}`);
    assert.equal((r.stdout.match(/MSG-\d{4}/g) ?? []).length, 150, 'as 150 Mensagens, nenhuma cortada no pipe');
    const ordem = [...r.stdout.matchAll(/MSG-(\d{4})/g)].map((x) => Number(x[1]));
    assert.deepEqual(ordem, [...ordem].sort((a, b) => a - b), 'em ordem cronologica');
  } finally {
    await c.parar();
  }
});

test('exportar LOCAL atravessa paginas: com pagina de 2, as nove Mensagens saem todas, uma vez, em ordem (#1129)', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const inquilino = criarInquilino(registro, { titularNome: 'Titular' });
    registro.fechar();
    const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
    const s = semearIdentidade(acervo);
    semearMidia(acervo, s);
    try {
      const esperado = (
        acervo.preparar('SELECT conteudo FROM mensagens WHERE conversa_id = ? ORDER BY ocorrida_em, id').all(s.grupo) as Array<{
          conteudo: string;
        }>
      ).map((l) => l.conteudo);
      assert.equal(esperado.length, 9);
      for (const limite of [2, 4, 9, 100]) {
        const saida: string[] = [];
        const pedido = (lerPedidoDeExport(['exportar', '--conversa', s.grupo]) as { pedido: never }).pedido;
        assert.equal(
          executarExportarLocal(acervo, PRECEDENCIA, pedido, { escrever: (t) => saida.push(t), erro: (t) => saida.push(t) }, limite),
          0,
        );
        const textos = saida.filter((l) => /^\d{4}-/.test(l)).map((l) => l.split(': ').slice(1).join(': '));
        assert.deepEqual(textos, esperado, `pagina de ${limite}`);
      }
    } finally {
      acervo.fechar();
    }
  } finally {
    limpar();
  }
});
