import { test } from 'node:test';
import { createServer, type Server } from 'node:http';
import assert from 'node:assert/strict';
import { executarExportarLocal, executarExportarRede, criarExportador, lerPedidoDeExport } from '../src/cli/exportar.js';
import { registrarMetadadosDeColetiva } from '../src/nucleo/escrita.js';
import { acervoDeIdentidade, subirCenaDeIdentidade, PRECEDENCIA } from './ajuda/identidade.js';

// #1203: o documento do `exportar --formato json` abre com a Conversa, os filtros e o instante; a coletiva ganha a
// DESCRICAO nessa abertura. A direta, o texto e a listagem nao mudam.

const base = { conversaId: 'c1', filtros: {}, exportadoEm: '2026-10-16T12:00:00.000Z', autores: [] };

function documento(extra: { descricao?: string | null }, formato: 'json' | 'txt' = 'json'): string[] {
  const linhas: string[] = [];
  const e = criarExportador({ ...base, formato, escrever: (t) => linhas.push(t), ...extra });
  e.concluir();
  return linhas;
}

test('o formatador: a coletiva leva a descricao (ou null), a direta nao leva a chave', () => {
  assert.match(documento({ descricao: 'Avisos' }).join('\n'), /"exportadoEm":"2026-10-16T12:00:00.000Z","descricao":"Avisos","mensagens":\[/);
  assert.match(documento({ descricao: null }).join('\n'), /"descricao":null,"mensagens"/);
  assert.doesNotMatch(documento({}).join('\n'), /descricao/);
  assert.deepEqual(JSON.parse(documento({ descricao: 'Avisos' }).join('')), {
    conversa: 'c1',
    filtros: {},
    exportadoEm: '2026-10-16T12:00:00.000Z',
    descricao: 'Avisos',
    mensagens: [],
  });
});

test('o texto nao muda: a descricao nao entra no export em txt', () => {
  assert.deepEqual(documento({ descricao: 'Avisos' }, 'txt'), []);
});

test('export LOCAL: a coletiva leva a descricao; a direta, nenhuma chave nova', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    registrarMetadadosDeColetiva(acervo, s.grupo, { descricao: 'Avisos da familia' });
    const exportar = (conversa: string): string => {
      const saida: string[] = [];
      const lido = lerPedidoDeExport(['exportar', '--conversa', conversa, '--formato', 'json']);
      assert.ok('pedido' in lido);
      assert.equal(executarExportarLocal(acervo, PRECEDENCIA, lido.pedido, { escrever: (t) => saida.push(t), erro: (t) => saida.push(t) }), 0);
      return saida.join('\n');
    };
    assert.equal(JSON.parse(exportar(s.grupo)).descricao, 'Avisos da familia');
    assert.doesNotMatch(exportar(s.diretaDeBruno), /descricao/);
  } finally {
    limpar();
  }
});

test('export por REDE: a coletiva leva a descricao; a direta, nenhuma chave nova', async () => {
  const cena = await subirCenaDeIdentidade({
    semearMais: (acervo, s) => {
      registrarMetadadosDeColetiva(acervo, s.grupo, { descricao: 'Avisos da familia' });
    },
  });
  try {
    const exportar = async (conversa: string): Promise<string> => {
      const dados: string[] = [];
      const dep = {
        servidor: cena.url,
        chave: cena.chave.valor,
        escrever: (t: string) => dados.push(t),
        erro: (t: string) => dados.push(t),
        aguardarEscoamento: async () => undefined,
      };
      assert.equal(await executarExportarRede(['exportar', '--conversa', conversa, '--formato', 'json'], dep), 0);
      return dados.join('\n');
    };
    assert.equal(JSON.parse(await exportar(cena.s.grupo)).descricao, 'Avisos da familia');
    assert.doesNotMatch(await exportar(cena.s.diretaDeBruno), /descricao/);
  } finally {
    cena.encerrar();
  }
});

test('erro do servidor (500) no detalhe interrompe o export: nao se exporta calado sem a descricao', async () => {
  const srv: Server = createServer((req, res) => {
    const url = req.url ?? '';
    res.writeHead(url.includes('/detalhe') ? 500 : 200, { 'content-type': 'application/json' });
    res.end(url.includes('/detalhe') ? '' : url.includes('/autores') ? '{"autores":[]}' : '{"mensagens":[]}');
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const dados: string[] = [];
    const dep = {
      servidor: url,
      chave: 'k',
      escrever: (t: string) => dados.push(t),
      erro: (t: string) => dados.push(t),
      aguardarEscoamento: async () => undefined,
    };
    assert.equal(await executarExportarRede(['exportar', '--conversa', 'c1', '--formato', 'json'], dep), 5);
    assert.doesNotMatch(dados.join('\n'), /"mensagens"/, 'nada foi exportado');
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});
