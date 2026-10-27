import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cenarioDeRede, type CenarioDeRede } from './ajuda/rede.js';
import { instalacaoTemporaria, rodar } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { registrarEtiqueta, registrarIdentificador, registrarMensagem } from '../src/nucleo/escrita.js';
import { codificarMarcador, decodificarMarcador } from '../src/nucleo/chegada.js';
import { executarConsultaRede } from '../src/cli/index.js';
import { umaColetiva } from './ajuda/etiqueta.js';

const AGORA = Date.now();
const OCORRIDA = AGORA - 60_000;
const MEMBRO = '5565911110001@s.whatsapp.net';
const OUTRO = '5565911110002@s.whatsapp.net';

interface Corpo {
  chegadas: Array<{ seq: number; tipo: string; origem: string | null; conversaId: string | null; autorId: string | null; conteudo?: { conteudo: string | null } | null }>;
  proximo: string;
  ultima: boolean;
}

/** Grava uma Mensagem (e a Chegada dela) no Acervo do Inquilino, por fora do servidor. */
function gravar(
  raiz: string,
  inquilino: string,
  mensagens: Array<{ id: string; texto: string; autor?: string; origem?: 'ao-vivo' | 'importacao' | 'reprocesso' }>,
  conversaExistente?: string,
  enderecoDoGrupo?: string,
): string {
  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
  try {
    const conversaId = conversaExistente ?? umaColetiva(acervo, enderecoDoGrupo);
    for (const m of mensagens) {
      registrarMensagem(acervo, {
        origemDaChegada: m.origem ?? 'ao-vivo',
        conversaId,
        fonte: 'whatsapp',
        idExterno: m.id,
        autorId: registrarIdentificador(acervo, { fonte: 'whatsapp', valor: m.autor ?? MEMBRO }).id,
        conteudo: m.texto,
        ocorridaEm: OCORRIDA,
        agora: AGORA,
        direcao: 'recebida',
      });
    }
    return conversaId;
  } finally {
    acervo.fechar();
  }
}

async function partida(c: CenarioDeRede, chave: string): Promise<string> {
  const r = await c.pedir('/chegadas?ponto-de-partida=1', chave);
  assert.equal(r.status, 200);
  return (JSON.parse(r.corpo) as Corpo).proximo;
}

test('GET /chegadas: o ponto de partida, a leitura depois dele, o Inquilino da chave e a recusa sem chave', async () => {
  const c = await cenarioDeRede();
  try {
    const chaveA = c.emitir(c.inquilinoA).valor;
    const inicio = await partida(c, chaveA);
    const vazio = await c.pedir(`/chegadas?depois=${encodeURIComponent(inicio)}`, chaveA);
    assert.equal(vazio.status, 200);
    assert.deepEqual(JSON.parse(vazio.corpo), { chegadas: [], proximo: inicio, ultima: true });

    gravar(c.raiz, c.inquilinoA, [{ id: 'A1', texto: 'texto-de-A' }]);
    gravar(c.raiz, c.inquilinoB, [{ id: 'B1', texto: 'texto-de-B' }]);
    const r = await c.pedir(`/chegadas?depois=${encodeURIComponent(inicio)}`, chaveA);
    assert.equal(r.status, 200);
    const corpo = JSON.parse(r.corpo) as Corpo;
    assert.equal(corpo.chegadas.length, 1, 'so o que o Inquilino da chave gravou');
    assert.equal(corpo.chegadas[0]!.tipo, 'mensagem');
    assert.equal(corpo.chegadas[0]!.origem, 'ao-vivo');
    assert.equal(r.corpo.includes('texto-de-B'), false);
    assert.equal(r.corpo.includes('texto-de-A'), false, 'sem conteudo, o texto nao vai');

    // O Inquilino enviado pelo chamador e IGNORADO.
    const alvo = await c.pedir(`/chegadas?depois=${encodeURIComponent(inicio)}&inquilino=${c.inquilinoB}`, chaveA);
    assert.equal(JSON.parse(alvo.corpo).chegadas.length, 1);
    assert.equal(alvo.corpo.includes('B1'), false);

    const seguinte = await c.pedir(`/chegadas?depois=${encodeURIComponent(corpo.proximo)}`, chaveA);
    assert.deepEqual((JSON.parse(seguinte.corpo) as Corpo).chegadas, []);

    const sem = await c.pedir('/chegadas?ponto-de-partida=1');
    assert.equal(sem.status, 401);
    assert.equal(sem.corpo, '');
    const metodo = await fetch(`http://${c.endereco}:${c.porta}/chegadas?ponto-de-partida=1`, {
      method: 'POST',
      headers: { authorization: `Bearer ${chaveA}` },
    });
    assert.equal(metodo.status, 404);
  } finally {
    await c.parar();
  }
});

test('GET /chegadas com conteudo=1 traz a Mensagem; sem ele, nao', async () => {
  const c = await cenarioDeRede();
  try {
    const chave = c.emitir(c.inquilinoA).valor;
    const inicio = await partida(c, chave);
    gravar(c.raiz, c.inquilinoA, [{ id: 'A1', texto: 'texto-de-A' }]);
    const com = JSON.parse((await c.pedir(`/chegadas?depois=${encodeURIComponent(inicio)}&conteudo=1`, chave)).corpo) as Corpo;
    assert.equal(com.chegadas[0]!.conteudo?.conteudo, 'texto-de-A');
    const sem = JSON.parse((await c.pedir(`/chegadas?depois=${encodeURIComponent(inicio)}`, chave)).corpo) as Corpo;
    assert.equal('conteudo' in sem.chegadas[0]!, false);
  } finally {
    await c.parar();
  }
});

test('GET /chegadas: filtros por tipo, origem, Conversa, remetente e sem-remetente', async () => {
  const c = await cenarioDeRede();
  try {
    const chave = c.emitir(c.inquilinoA).valor;
    const inicio = await partida(c, chave);
    const conversa = gravar(c.raiz, c.inquilinoA, [
      { id: 'A1', texto: 'um', autor: MEMBRO },
      { id: 'A2', texto: 'dois', autor: OUTRO, origem: 'importacao' },
    ]);
    const outraConversa = gravar(c.raiz, c.inquilinoA, [{ id: 'A3', texto: 'tres', autor: MEMBRO }], undefined, '120363000000000002@g.us');
    assert.notEqual(outraConversa, conversa);
    const acervo = abrirAcervo(join(c.raiz, 'acervos'), c.inquilinoA);
    try {
      registrarEtiqueta(acervo, {
        origemDaChegada: 'ao-vivo',
        conversaId: conversa,
        identificadorId: registrarIdentificador(acervo, { fonte: 'whatsapp', valor: MEMBRO }).id,
        texto: 'Torre A',
        ocorridaEm: OCORRIDA,
        fonte: 'whatsapp',
        idExterno: 'E1',
      });
    } finally {
      acervo.fechar();
    }
    const lidas = async (consulta: string): Promise<string[]> => {
      const r = await c.pedir(`/chegadas?depois=${encodeURIComponent(inicio)}&${consulta}`, chave);
      assert.equal(r.status, 200, consulta);
      return (JSON.parse(r.corpo) as Corpo).chegadas.map((x) => `${x.tipo}:${x.origem ?? '-'}`);
    };
    assert.equal((await lidas('tipo=mensagem')).length, 3);
    assert.deepEqual(await lidas('tipo=etiqueta'), ['etiqueta:ao-vivo']);
    assert.deepEqual(await lidas('origem=importacao'), ['mensagem:importacao']);
    assert.equal((await lidas(`conversa=${conversa}`)).length, 3, 'A1, A2 e a Etiqueta');
    assert.equal((await lidas(`conversa=${outraConversa}`)).length, 1);
    assert.equal((await lidas(`remetente=${MEMBRO}&tipo=mensagem`)).length, 2);
    assert.deepEqual(await lidas(`sem-remetente=${MEMBRO}`), ['mensagem:importacao']);
    assert.equal((await lidas(`sem-remetente=${MEMBRO},${OUTRO}`)).length, 0);
    assert.equal((await lidas('direcao=enviada')).length, 0);
    assert.equal((await lidas('limite=1')).length, 1);
  } finally {
    await c.parar();
  }
});

test('GET /chegadas: 400 por uso errado, 404 por Conversa inexistente, e os 400 nao revelam existencia', async () => {
  const c = await cenarioDeRede();
  try {
    const chave = c.emitir(c.inquilinoA).valor;
    const inicio = encodeURIComponent(await partida(c, chave));
    const ruins = [
      '',
      `depois=${inicio}&ponto-de-partida=1`,
      'ponto-de-partida=2',
      'ponto-de-partida=1&limite=5',
      'ponto-de-partida=1&conteudo=1',
      `depois=${inicio}&limite=0`,
      `depois=${inicio}&limite=abc`,
      `depois=${inicio}&limite=501`,
      `depois=${inicio}&direcao=lateral`,
      `depois=${inicio}&tipo=revogacao`,
      `depois=${inicio}&tipo=mensagem,`,
      `depois=${inicio}&origem=pendentes`,
      `depois=${inicio}&conteudo=2`,
      `depois=${inicio}&remetente=`,
      `depois=${inicio}&sem-remetente=`,
      `depois=${inicio}&sem-remetente=${MEMBRO},`,
      `depois=${inicio}&configuracao=nao-existe`,
      'depois=lixo',
    ];
    for (const ruim of ruins) {
      assert.equal((await c.pedir(`/chegadas?${ruim}`, chave)).status, 400, ruim);
    }
    assert.equal((await c.pedir(`/chegadas?depois=${inicio}&conversa=nao-existe`, chave)).status, 404);
    // A Conversa de OUTRO Inquilino responde igual a uma que nao existe.
    assert.equal((await c.pedir(`/chegadas?depois=${inicio}&conversa=${c.conversaDeB}`, chave)).status, 404);
  } finally {
    await c.parar();
  }
});

test('GET /chegadas: Marcador expirado e 410, com o motivo, e distinto do 400', async () => {
  const c = await cenarioDeRede();
  try {
    const chave = c.emitir(c.inquilinoA).valor;
    const atual = decodificarMarcador(await partida(c, chave))!;
    gravar(c.raiz, c.inquilinoA, [{ id: 'A1', texto: 'um' }]);
    const motivo = async (m: string): Promise<{ status: number; motivo?: string }> => {
      const r = await c.pedir(`/chegadas?depois=${encodeURIComponent(m)}`, chave);
      return { status: r.status, ...(r.status === 410 ? { motivo: (JSON.parse(r.corpo) as { motivo: string }).motivo } : {}) };
    };
    assert.deepEqual(await motivo(codificarMarcador({ epoca: 'outra', seq: atual.seq })), { status: 410, motivo: 'outra-epoca' });
    assert.deepEqual(await motivo(codificarMarcador({ epoca: atual.epoca, seq: 0 })), { status: 410, motivo: 'abaixo-do-piso' });
    assert.deepEqual(await motivo(codificarMarcador({ epoca: atual.epoca, seq: atual.seq + 100 })), {
      status: 410,
      motivo: 'acima-da-ultima',
    });
    assert.deepEqual(await motivo(codificarMarcador({ epoca: atual.epoca, seq: atual.seq })), { status: 200 });
  } finally {
    await c.parar();
  }
});

test('o cliente de rede: chegadas por HTTP, 8 no Marcador expirado, e o uso errado sai 2 sem pedir nada', async () => {
  const c = await cenarioDeRede();
  try {
    const chave = c.emitir(c.inquilinoA).valor;
    const servidor = `http://${c.endereco}:${c.porta}`;
    const saidas: string[] = [];
    const rede = (): { servidor: string; chave: string; escrever: (t: string) => void } => ({
      servidor,
      chave,
      escrever: (t) => saidas.push(t),
    });
    const marcadorDaSaida = (): string => /# proximo (\S+)/.exec(saidas.join('\n'))![1]!;

    assert.equal(await executarConsultaRede(['chegadas', '--ponto-de-partida'], rede()), 0);
    const inicio = marcadorDaSaida();
    saidas.length = 0;

    gravar(c.raiz, c.inquilinoA, [{ id: 'A1', texto: 'texto-do-cliente' }]);
    assert.equal(await executarConsultaRede(['chegadas', '--depois', inicio, '--com-conteudo'], rede()), 0);
    assert.match(saidas.join('\n'), /mensagem {2}ao-vivo/);
    assert.match(saidas.join('\n'), /texto-do-cliente/);

    saidas.length = 0;
    assert.equal(await executarConsultaRede(['chegadas', '--depois', inicio, '--json'], rede()), 0);
    assert.equal((JSON.parse(saidas.join('\n')) as Corpo).chegadas.length, 1);

    saidas.length = 0;
    const atual = decodificarMarcador(inicio)!;
    const expirado = codificarMarcador({ epoca: atual.epoca, seq: 0 });
    assert.equal(await executarConsultaRede(['chegadas', '--depois', expirado], rede()), 8);
    assert.match(saidas.join('\n'), /expirado/);

    saidas.length = 0;
    assert.equal(await executarConsultaRede(['chegadas', '--depois', 'lixo'], rede()), 6, 'malformado e uso errado da API');

    // Uso errado: sai 2 sem fazer requisicao.
    for (const args of [
      ['chegadas'],
      ['chegadas', '--depois'],
      ['chegadas', '--depois', inicio, '--ponto-de-partida'],
      ['chegadas', '--ponto-de-partida', '--conversa', 'c1'],
      ['chegadas', '--ponto-de-partida', '--com-conteudo'],
      ['chegadas', '--depois', inicio, '--direcao', 'lateral'],
      ['chegadas', '--depois', inicio, '--tipo', 'revogacao'],
      ['chegadas', '--depois', inicio, '--origem', 'pendentes'],
      ['chegadas', '--depois', inicio, '--limite', '501'],
      ['chegadas', '--inquilino', c.inquilinoA, '--depois', inicio],
    ]) {
      assert.equal(await executarConsultaRede(args, rede()), 2, args.join(' '));
    }
  } finally {
    await c.parar();
  }
});

function instalar(): { raiz: string; id: string; limpar: () => void } {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const id = criarInquilino(registro, { titularNome: 'Padme' });
  registro.fechar();
  abrirAcervo(join(raiz, 'acervos'), id).fechar();
  return { raiz, id, limpar };
}

test('chegadas local: ponto de partida, leitura, filtros e os codigos de saida', () => {
  const { raiz, id, limpar } = instalar();
  try {
    const partidaLocal = rodar(raiz, ['chegadas', '--inquilino', id, '--ponto-de-partida']);
    assert.equal(partidaLocal.codigo, 0);
    const inicio = /# proximo (\S+)/.exec(partidaLocal.saida)![1]!;

    const conversa = gravar(raiz, id, [{ id: 'A1', texto: 'texto-local' }]);
    gravar(raiz, id, [{ id: 'A2', texto: 'outro', origem: 'importacao' }], conversa);

    const texto = rodar(raiz, ['chegadas', '--inquilino', id, '--depois', inicio, '--com-conteudo']);
    assert.equal(texto.codigo, 0);
    assert.match(texto.saida, /texto-local/);
    assert.match(texto.saida, /# proximo /);

    const json = rodar(raiz, ['chegadas', '--inquilino', id, '--depois', inicio, '--origem', 'importacao', '--conversa', conversa, '--json']);
    assert.equal(json.codigo, 0);
    const corpo = JSON.parse(json.saida) as Corpo;
    assert.deepEqual(
      corpo.chegadas.map((x) => x.origem),
      ['importacao'],
    );

    const vazio = rodar(raiz, ['chegadas', '--inquilino', id, '--depois', corpo.proximo]);
    assert.equal(vazio.codigo, 0, 'sem Chegada nova e resposta legitima');

    // Codigos de saida.
    assert.equal(rodar(raiz, ['chegadas', '--inquilino', id]).codigo, 2, 'nem --depois nem --ponto-de-partida');
    assert.equal(rodar(raiz, ['chegadas', '--inquilino', id, '--depois']).codigo, 2, 'flag sem valor');
    assert.equal(rodar(raiz, ['chegadas', '--inquilino', id, '--depois', 'lixo']).codigo, 2, 'Marcador malformado e uso errado');
    assert.equal(rodar(raiz, ['chegadas', '--inquilino', id, '--depois', inicio, '--conversa', 'nao-existe']).codigo, 2);
    assert.equal(rodar(raiz, ['chegadas', '--inquilino', id, '--depois', inicio, '--configuracao', 'nao-existe']).codigo, 2);
    const atual = decodificarMarcador(inicio)!;
    const expirado = rodar(raiz, ['chegadas', '--inquilino', id, '--depois', codificarMarcador({ epoca: atual.epoca, seq: 0 })]);
    assert.equal(expirado.codigo, 8);
    assert.match(expirado.saida, /expirado/);
  } finally {
    limpar();
  }
});
