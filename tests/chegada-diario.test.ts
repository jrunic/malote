import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { registrarConversa } from '../src/nucleo/escrita.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import {
  lerChegadas,
  pontoDePartida,
  registrarChegada,
  type EntradaDeChegada,
  type FiltroDeChegadas,
} from '../src/nucleo/chegada.js';
import type { Acervo } from '../src/nucleo/acervo.js';

function chegada(sobre: Partial<EntradaDeChegada> = {}): EntradaDeChegada {
  return {
    tipo: 'mensagem',
    origem: 'ao-vivo',
    criadoEm: 2_000,
    ocorridaEm: 1_000,
    alvoId: 'alvo',
    ...sobre,
  };
}

function contarChegadas(acervo: Acervo): number {
  return (acervo.db.prepare('SELECT COUNT(*) AS n FROM chegadas').get() as { n: number }).n;
}

function ler(acervo: Acervo, depois: string, resto: Partial<FiltroDeChegadas> = {}) {
  return lerChegadas(acervo, { depois, ...resto });
}

test('o Acervo nasce com o Diario semeado: uma Chegada inicio-do-diario, sem origem, e o Piso no numero dela', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const linhas = acervo.db.prepare('SELECT seq, tipo, origem, conversa_id FROM chegadas').all();
    assert.deepEqual(linhas, [{ seq: 1, tipo: 'inicio-do-diario', origem: null, conversa_id: null }]);
    const controle = acervo.db.prepare('SELECT epoca, piso FROM diario_de_chegadas').get() as { epoca: string; piso: number };
    assert.equal(controle.piso, 1);
    assert.ok(controle.epoca.length > 0);
  } finally {
    c.limpar();
  }
});

test('abrir o Acervo de novo nao semeia outra vez nem muda a epoca', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Padme');
    const antes = acervo.db.prepare('SELECT epoca FROM diario_de_chegadas').get();
    acervo.fechar();
    const reaberto = abrirAcervo(join(c.raiz, 'acervos'), id);
    try {
      assert.deepEqual(reaberto.db.prepare('SELECT epoca FROM diario_de_chegadas').get(), antes);
      assert.equal(contarChegadas(reaberto), 1);
    } finally {
      reaberto.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('a leitura a partir do ponto de partida devolve so o que chegou depois, em ordem de gravacao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const inicio = pontoDePartida(acervo);
    assert.deepEqual(ler(acervo, inicio).chegadas, [], 'o ponto de partida nao devolve Chegada');
    const a = registrarChegada(acervo, chegada({ alvoId: 'a' }));
    const b = registrarChegada(acervo, chegada({ alvoId: 'b' }));
    const pagina = ler(acervo, inicio);
    assert.deepEqual(
      pagina.chegadas.map((x) => x.seq),
      [a, b],
    );
    assert.ok(b > a);
    assert.equal(pagina.ultima, true);
    assert.deepEqual(ler(acervo, pagina.proximo).chegadas, [], 'o proximo nao repete nada');
  } finally {
    c.limpar();
  }
});

test('entrega atrasada, com instante do fato antigo, aparece na leitura seguinte (o caso do Cursor por tempo)', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    registrarChegada(acervo, chegada({ alvoId: 'recente', ocorridaEm: 9_000_000 }));
    const marcador = pontoDePartida(acervo);
    registrarChegada(acervo, chegada({ alvoId: 'atrasada', ocorridaEm: 10, criadoEm: 9_500_000 }));
    const seguinte = ler(acervo, marcador);
    assert.deepEqual(
      seguinte.chegadas.map((x) => x.alvoId),
      ['atrasada'],
    );
    assert.equal(seguinte.chegadas[0]!.ocorridaEm, 10);
    assert.equal(seguinte.chegadas[0]!.criadoEm, 9_500_000);
  } finally {
    c.limpar();
  }
});

test('a paginacao nao repete nem pula, e o proximo da ultima pagina e a ultima Chegada gravada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const inicio = pontoDePartida(acervo);
    const gravadas = [1, 2, 3, 4, 5, 6, 7].map((n) => registrarChegada(acervo, chegada({ alvoId: `m${String(n)}` })));
    const vistas: number[] = [];
    let marcador = inicio;
    const paginas: boolean[] = [];
    for (;;) {
      const p = ler(acervo, marcador, { limite: 3 });
      vistas.push(...p.chegadas.map((x) => x.seq));
      paginas.push(p.ultima);
      marcador = p.proximo;
      if (p.ultima) break;
    }
    assert.deepEqual(vistas, gravadas);
    assert.deepEqual(paginas, [false, false, true]);
    assert.equal(marcador, pontoDePartida(acervo));
  } finally {
    c.limpar();
  }
});

test('o limite padrao e o maximo e a pagina nunca passa de 500', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const inicio = pontoDePartida(acervo);
    acervo.db.transaction(() => {
      for (let i = 0; i < 520; i += 1) registrarChegada(acervo, chegada({ alvoId: `m${String(i)}` }));
    })();
    assert.equal(ler(acervo, inicio).chegadas.length, 500);
    assert.equal(ler(acervo, inicio, { limite: 9999 }).chegadas.length, 500);
    assert.equal(ler(acervo, inicio, { limite: 520 }).chegadas.length, 500);
  } finally {
    c.limpar();
  }
});

test('leitura durante gravacao concorrente (outra conexao) nao repete nem pula', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Padme');
    const outra = abrirAcervo(join(c.raiz, 'acervos'), id);
    try {
      const inicio = pontoDePartida(acervo);
      const a = registrarChegada(acervo, chegada({ alvoId: 'a' }));
      const primeira = ler(outra, inicio, { limite: 1 });
      assert.deepEqual(
        primeira.chegadas.map((x) => x.seq),
        [a],
      );
      const b = registrarChegada(acervo, chegada({ alvoId: 'b' }));
      const d = registrarChegada(acervo, chegada({ alvoId: 'd' }));
      const segunda = ler(outra, primeira.proximo);
      assert.deepEqual(
        segunda.chegadas.map((x) => x.seq),
        [b, d],
      );
      assert.deepEqual(ler(outra, segunda.proximo).chegadas, []);
    } finally {
      outra.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('o numero de sequencia nunca e reaproveitado, nem apagando a ultima Chegada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const a = registrarChegada(acervo, chegada({ alvoId: 'a' }));
    acervo.db.prepare('DELETE FROM chegadas WHERE seq = ?').run(a);
    const b = registrarChegada(acervo, chegada({ alvoId: 'b' }));
    assert.ok(b > a, `a nova (${String(b)}) reaproveitou o numero da apagada (${String(a)})`);
  } finally {
    c.limpar();
  }
});

test('filtros: tipo, origem, direcao, autor (incluir e excluir) e Conversa', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const grupo = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '120363000000000001@g.us', coletiva: true });
    const outro = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '120363000000000002@g.us', coletiva: true });
    const inicio = pontoDePartida(acervo);
    registrarChegada(acervo, chegada({ alvoId: 'm1', conversaId: grupo, autorId: 'ana', direcao: 'recebida' }));
    registrarChegada(acervo, chegada({ alvoId: 'm2', conversaId: grupo, autorId: 'agente', direcao: 'enviada' }));
    registrarChegada(
      acervo,
      chegada({ alvoId: 'm3', conversaId: outro, autorId: 'ana', direcao: 'recebida', origem: 'importacao' }),
    );
    registrarChegada(acervo, chegada({ alvoId: 'e1', tipo: 'edicao', conversaId: grupo, autorId: 'ana', direcao: 'recebida' }));
    registrarChegada(acervo, chegada({ alvoId: 't1', tipo: 'transicao-de-participacao', conversaId: grupo }));
    const alvos = (f: Partial<FiltroDeChegadas>) => ler(acervo, inicio, f).chegadas.map((x) => x.alvoId);

    assert.deepEqual(alvos({}), ['m1', 'm2', 'm3', 'e1', 't1']);
    assert.deepEqual(alvos({ tipos: ['edicao'] }), ['e1']);
    assert.deepEqual(alvos({ origens: ['importacao'] }), ['m3']);
    assert.deepEqual(alvos({ direcao: 'enviada' }), ['m2']);
    assert.deepEqual(alvos({ conversaId: grupo }), ['m1', 'm2', 'e1', 't1']);
    assert.deepEqual(alvos({ autorIds: ['ana'] }), ['m1', 'm3', 'e1']);
    assert.deepEqual(alvos({ autorIds: [] }), [], 'lista vazia de autores nao casa nada');
    assert.deepEqual(alvos({ semAutorIds: ['agente'] }), ['m1', 'm3', 'e1', 't1'], 'excluir nao tira a Chegada sem autor');
    assert.deepEqual(alvos({ semAutorIds: [] }), ['m1', 'm2', 'm3', 'e1', 't1'], 'lista vazia de exclusao nao exclui');
    assert.deepEqual(alvos({ conversaId: grupo, semAutorIds: ['agente'], tipos: ['mensagem'] }), ['m1']);
  } finally {
    c.limpar();
  }
});

test('o filtro de Configuracao alcanca so Conversa direta, como as demais leituras', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const direta = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: '5565911110001@s.whatsapp.net',
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    const grupo = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '120363000000000001@g.us', coletiva: true });
    const inicio = pontoDePartida(acervo);
    registrarChegada(acervo, chegada({ alvoId: 'd1', conversaId: direta }));
    registrarChegada(acervo, chegada({ alvoId: 'g1', conversaId: grupo }));
    const alvos = ler(acervo, inicio, { configuracaoId: CFG_WHATSAPP.id }).chegadas.map((x) => x.alvoId);
    assert.deepEqual(alvos, ['d1']);
  } finally {
    c.limpar();
  }
});

test('o Diario nao guarda conteudo de Mensagem: as colunas sao so referencias e instantes', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const colunas = (acervo.db.prepare('PRAGMA table_info(chegadas)').all() as Array<{ name: string }>).map((x) => x.name);
    assert.deepEqual(colunas, [
      'seq',
      'tipo',
      'origem',
      'criado_em',
      'ocorrida_em',
      'conversa_id',
      'mensagem_id',
      'autor_id',
      'direcao',
      'alvo_id',
    ]);
  } finally {
    c.limpar();
  }
});

test('o schema recusa Chegada fora do contrato: inicio com origem, fato sem origem, tipo e origem desconhecidos', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const gravar = (tipo: string, origem: string | null) =>
      acervo.db.prepare('INSERT INTO chegadas (tipo, origem, criado_em) VALUES (?, ?, 1)').run(tipo, origem);
    assert.throws(() => gravar('inicio-do-diario', 'ao-vivo'), /CHECK/);
    assert.throws(() => gravar('mensagem', null), /CHECK/);
    assert.throws(() => gravar('revogacao', 'ao-vivo'), /CHECK/);
    assert.throws(() => gravar('mensagem', 'pendentes'), /CHECK/);
  } finally {
    c.limpar();
  }
});

test('com filtro, o proximo salta para a ultima Chegada gravada: o que o filtro descartou depois da ultima devolvida nao e relido', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const inicio = pontoDePartida(acervo);
    registrarChegada(acervo, chegada({ alvoId: 'e1', tipo: 'edicao' }));
    registrarChegada(acervo, chegada({ alvoId: 'm1' }));
    registrarChegada(acervo, chegada({ alvoId: 'm2' }));
    const pagina = ler(acervo, inicio, { tipos: ['edicao'] });
    assert.deepEqual(
      pagina.chegadas.map((x) => x.alvoId),
      ['e1'],
    );
    assert.equal(pagina.ultima, true);
    assert.equal(pagina.proximo, pontoDePartida(acervo), 'o proximo parou na ultima devolvida e vai reler m1 e m2 a cada consulta');
    assert.deepEqual(ler(acervo, pagina.proximo, { tipos: ['edicao'] }).chegadas, []);
  } finally {
    c.limpar();
  }
});
