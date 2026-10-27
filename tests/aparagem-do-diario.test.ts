import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { instalacaoTemporaria, rodar } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { abrirAcervo, type Acervo } from '../src/nucleo/acervo.js';
import {
  apararDiario,
  codificarMarcador,
  decodificarMarcador,
  LOTE_DA_APARAGEM,
  lerChegadas,
  MarcadorExpiradoError,
  pontoDePartida,
  registrarChegada,
  RETENCAO_PADRAO_DO_DIARIO_EM_DIAS,
} from '../src/nucleo/chegada.js';
import { executarConsultaRede } from '../src/cli/index.js';

const DIA = 86_400_000;
const T = Date.UTC(2026, 9, 26, 12);

function gravar(acervo: Acervo, n: number): number[] {
  const seqs: number[] = [];
  for (let i = 0; i < n; i += 1) {
    seqs.push(registrarChegada(acervo, { tipo: 'mensagem', origem: 'ao-vivo', criadoEm: T, ocorridaEm: 1, alvoId: `m${String(i)}` }));
  }
  return seqs;
}

/** Fixa o instante de gravacao de cada Chegada existente, na ordem do numero (a `inicio-do-diario` e a primeira). */
function fixar(acervo: Acervo, criados: number[]): number[] {
  const seqs = (acervo.db.prepare('SELECT seq FROM chegadas ORDER BY seq').all() as Array<{ seq: number }>).map((x) => x.seq);
  assert.equal(seqs.length, criados.length, 'um instante por Chegada');
  seqs.forEach((seq, i) => acervo.db.prepare('UPDATE chegadas SET criado_em = ? WHERE seq = ?').run(criados[i], seq));
  return seqs;
}

function restantes(acervo: Acervo): number[] {
  return (acervo.db.prepare('SELECT seq FROM chegadas ORDER BY seq').all() as Array<{ seq: number }>).map((x) => x.seq);
}

function operacoesDeAparagem(acervo: Acervo): Array<{ reversibilidade: string }> {
  return acervo.db
    .prepare("SELECT reversibilidade FROM operacoes WHERE natureza = 'aparar-chegadas'")
    .all() as Array<{ reversibilidade: string }>;
}

function piso(acervo: Acervo): number {
  return (acervo.db.prepare('SELECT piso FROM diario_de_chegadas').get() as { piso: number }).piso;
}

function epoca(acervo: Acervo): string {
  return (acervo.db.prepare('SELECT epoca FROM diario_de_chegadas').get() as { epoca: string }).epoca;
}

test('os padroes: 30 dias de retencao e lotes de 5.000', () => {
  assert.equal(RETENCAO_PADRAO_DO_DIARIO_EM_DIAS, 30);
  assert.equal(LOTE_DA_APARAGEM, 5000);
});

test('nada a aparar: nada removido, o Piso fica, e NENHUMA Operacao e gravada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    gravar(acervo, 3);
    fixar(acervo, [T - 2 * DIA, T - DIA, T - DIA, T]);
    const antes = restantes(acervo);
    const r = apararDiario(acervo, { agora: T });
    assert.deepEqual(r, { removidas: 0, piso: piso(acervo), restam: antes.length });
    assert.deepEqual(restantes(acervo), antes);
    assert.equal(piso(acervo), 1);
    assert.equal(operacoesDeAparagem(acervo).length, 0, 'o tique que nao remove nada nao deixa rastro');
  } finally {
    c.limpar();
  }
});

test('remove o prefixo mais antigo que a retencao, sobe o Piso, grava UMA Operacao irreversivel; o Marcador no Piso vale e o de antes expira', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    gravar(acervo, 4);
    const seqs = fixar(acervo, [T - 40 * DIA, T - 35 * DIA, T - 31 * DIA, T - DIA, T - 3_600_000]);
    const r = apararDiario(acervo, { agora: T });
    assert.deepEqual(r, { removidas: 3, piso: seqs[2], restam: 2 });
    assert.deepEqual(restantes(acervo), [seqs[3], seqs[4]]);
    assert.equal(piso(acervo), seqs[2]);
    assert.deepEqual(operacoesDeAparagem(acervo), [{ reversibilidade: 'irreversivel' }]);

    // A passada seguinte, com o Piso ja no limite e a proxima Chegada dentro da retencao, nao remove nada e nao deixa Operacao.
    assert.deepEqual(apararDiario(acervo, { agora: T }), { removidas: 0, piso: seqs[2], restam: 2 });
    assert.equal(operacoesDeAparagem(acervo).length, 1);

    const e = epoca(acervo);
    assert.deepEqual(
      lerChegadas(acervo, { depois: codificarMarcador({ epoca: e, seq: seqs[2]! }) }).chegadas.map((x) => x.seq),
      [seqs[3], seqs[4]],
      'o Marcador igual ao Piso le da proxima em diante',
    );
    assert.throws(
      () => lerChegadas(acervo, { depois: codificarMarcador({ epoca: e, seq: seqs[2]! - 1 }) }),
      (erro: unknown) => erro instanceof MarcadorExpiradoError && erro.motivo === 'abaixo-do-piso',
    );
  } finally {
    c.limpar();
  }
});

test('o limite da retencao: a Chegada exatamente no corte fica, e a um milissegundo antes sai', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    gravar(acervo, 3);
    const seqs = fixar(acervo, [T - 31 * DIA, T - 30 * DIA - 1, T - 30 * DIA, T]);
    const r = apararDiario(acervo, { agora: T });
    assert.equal(r.removidas, 2, 'a de T-30d-1ms sai; a de T-30d (no corte) fica');
    assert.deepEqual(restantes(acervo), [seqs[2], seqs[3]]);
  } finally {
    c.limpar();
  }
});

test('NUNCA remove a Chegada de maior numero, mesmo velha: o ponto de partida sobrevive a um Diario parado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    gravar(acervo, 4);
    const seqs = fixar(acervo, [T - 90 * DIA, T - 80 * DIA, T - 70 * DIA, T - 60 * DIA, T - 50 * DIA]);
    const r = apararDiario(acervo, { agora: T });
    assert.equal(r.removidas, 4);
    assert.deepEqual(restantes(acervo), [seqs[4]]);
    const partida = pontoDePartida(acervo);
    assert.equal(decodificarMarcador(partida)!.seq, seqs[4]);
    assert.deepEqual(lerChegadas(acervo, { depois: partida }).chegadas, []);
    assert.equal(apararDiario(acervo, { agora: T }).removidas, 0);
    assert.equal(operacoesDeAparagem(acervo).length, 1, 'a segunda passada nao removeu nada e nao deixou Operacao');
  } finally {
    c.limpar();
  }
});

test('o lote limita a passada, e repetir esvazia o que e removivel', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    gravar(acervo, 12);
    fixar(acervo, Array.from({ length: 13 }, (_, i) => T - 100 * DIA + i));
    const lote = 5;
    const passadas = [1, 2, 3, 4].map(() => apararDiario(acervo, { agora: T, lote }).removidas);
    assert.deepEqual(passadas, [5, 5, 2, 0], '12 removiveis (13 menos a ultima): 5, 5, 2 e nada mais');
    assert.equal(restantes(acervo).length, 1);
    assert.equal(operacoesDeAparagem(acervo).length, 3);
  } finally {
    c.limpar();
  }
});

test('e um PREFIXO da ordem de gravacao: para na primeira Chegada dentro da retencao, mesmo que depois haja outra mais velha (relogio que andou para tras)', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    gravar(acervo, 3);
    const seqs = fixar(acervo, [T - 40 * DIA, T - DIA, T - 50 * DIA, T - 45 * DIA]);
    const r = apararDiario(acervo, { agora: T });
    assert.equal(r.removidas, 1);
    assert.deepEqual(restantes(acervo), [seqs[1], seqs[2], seqs[3]]);
    assert.equal(piso(acervo), seqs[0], 'o Piso diz "tudo ate aqui saiu": nao pode pular a Chegada recente');
  } finally {
    c.limpar();
  }
});

test('o ensaio conta o que removeria, sem remover, sem subir o Piso e sem Operacao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    gravar(acervo, 4);
    fixar(acervo, [T - 40 * DIA, T - 35 * DIA, T - 31 * DIA, T - DIA, T]);
    const antes = restantes(acervo);
    const r = apararDiario(acervo, { agora: T, comEfeito: false });
    assert.deepEqual(r, { removidas: 3, piso: 1, restam: 2 });
    assert.deepEqual(restantes(acervo), antes);
    assert.equal(piso(acervo), 1);
    assert.equal(operacoesDeAparagem(acervo).length, 0);
  } finally {
    c.limpar();
  }
});

test('a retencao e parametro: com 1 dia sai o que passou de 1 dia', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    gravar(acervo, 3);
    fixar(acervo, [T - 10 * DIA, T - 2 * DIA, T - 3_600_000, T]);
    assert.equal(apararDiario(acervo, { agora: T, dias: 30 }).removidas, 0);
    assert.equal(apararDiario(acervo, { agora: T, dias: 1 }).removidas, 2);
  } finally {
    c.limpar();
  }
});

function instalar(): { raiz: string; id: string; limpar: () => void } {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const id = criarInquilino(registro, { titularNome: 'Padme' });
  registro.fechar();
  const acervo = abrirAcervo(join(raiz, 'acervos'), id);
  try {
    gravar(acervo, 3);
    // Tudo velho: o que existe foi gravado ha 40 dias.
    acervo.db.prepare('UPDATE chegadas SET criado_em = ?').run(Date.now() - 40 * DIA);
  } finally {
    acervo.fechar();
  }
  return { raiz, id, limpar };
}

function contar(raiz: string, id: string): number {
  const acervo = abrirAcervo(join(raiz, 'acervos'), id);
  try {
    return restantes(acervo).length;
  } finally {
    acervo.fechar();
  }
}

test('chegadas aparar local: ensaio por padrao, --com-efeito exige --confirmo, e aplicar remove e deixa a Operacao', () => {
  const { raiz, id, limpar } = instalar();
  try {
    const ensaio = rodar(raiz, ['chegadas', 'aparar', '--inquilino', id]);
    assert.equal(ensaio.codigo, 0);
    assert.match(ensaio.saida, /Ensaio: 3 Chegada\(s\) a remover/);
    assert.match(ensaio.saida, /Nada foi escrito/);
    assert.equal(contar(raiz, id), 4);

    assert.equal(rodar(raiz, ['chegadas', 'aparar', '--inquilino', id, '--com-efeito']).codigo, 1, 'sem --confirmo nao executa');
    assert.equal(contar(raiz, id), 4);

    const aplicado = rodar(raiz, ['chegadas', 'aparar', '--inquilino', id, '--com-efeito', '--confirmo']);
    assert.equal(aplicado.codigo, 0);
    assert.match(aplicado.saida, /Aparado: 3 Chegada\(s\) removida\(s\)/);
    assert.equal(contar(raiz, id), 1, 'a ultima fica');
    const acervo = abrirAcervo(join(raiz, 'acervos'), id);
    try {
      assert.deepEqual(
        acervo.db.prepare("SELECT ator, reversibilidade FROM operacoes WHERE natureza = 'aparar-chegadas'").all(),
        [{ ator: 'local', reversibilidade: 'irreversivel' }],
        'o Ator do comando e local, nunca indeterminado',
      );
    } finally {
      acervo.fechar();
    }

    const json = rodar(raiz, ['chegadas', 'aparar', '--inquilino', id, '--json']);
    assert.equal(json.codigo, 0);
    assert.deepEqual(
      (JSON.parse(json.saida) as { removidas: number; comEfeito: boolean }).removidas,
      0,
      'nada mais a remover',
    );
  } finally {
    limpar();
  }
});

test('chegadas aparar local: --dias e --limite invalidos saem 2, e --limite corta a passada', () => {
  const { raiz, id, limpar } = instalar();
  try {
    for (const args of [['--dias', '0'], ['--dias', 'abc'], ['--limite', '0'], ['--limite', '1.5']]) {
      assert.equal(rodar(raiz, ['chegadas', 'aparar', '--inquilino', id, ...args]).codigo, 2, args.join(' '));
    }
    const corta = rodar(raiz, ['chegadas', 'aparar', '--inquilino', id, '--limite', '2', '--com-efeito', '--confirmo']);
    assert.equal(corta.codigo, 0);
    assert.match(corta.saida, /2 Chegada\(s\) removida\(s\)/);
    assert.match(corta.saida, /O limite foi atingido: repita para continuar/);
    assert.equal(contar(raiz, id), 2);
  } finally {
    limpar();
  }
});

test('chegadas aparar nao existe por rede: sai 2 sem pedir nada', async () => {
  const saidas: string[] = [];
  const codigo = await executarConsultaRede(['chegadas', 'aparar'], {
    servidor: 'http://127.0.0.1:1',
    chave: 'qualquer',
    escrever: (t) => saidas.push(t),
  });
  assert.equal(codigo, 2);
  assert.match(saidas.join('\n'), /so existe local/);
});
