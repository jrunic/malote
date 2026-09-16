import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import {
  criarPessoa,
  desfazerMesclagem,
  mesclarPessoas,
  registrarNome,
  vincularIdentificador,
} from '../src/nucleo/identidade.js';
import { conferirMesclagem } from '../src/nucleo/integridade.js';
import { desfazerOperacao } from '../src/nucleo/desfazer.js';
import { lerOperacao, listarOperacoes } from '../src/nucleo/trilha.js';
import { propor } from '../src/adaptadores/contatos/propostas.js';
import { listarIdentificadores } from '../src/nucleo/inventario.js';
import { aplicarLote } from '../src/adaptadores/contatos/lote.js';
import { listarOperacoesCruas, linhasDaOperacao } from '../src/nucleo/trilha.js';

/**
 * Dez trios que o produtor por nome junta.
 *
 * O trio precisa de um Identificador de `contatos`: o produtor por nome exige
 * exatamente um lado no catalogo e um em cada outra Fonte — sem catalogo, ele
 * nao oferece nada, e o cenario mede o vazio.
 */
function dezPropostas(acervo: Acervo): void {
  for (let i = 0; i < 10; i += 1) {
    const nome = `Pessoa ${i}`;
    const cat = registrarIdentificador(acervo, { fonte: 'contatos', valor: `55659001${1000 + i}` });
    const wa = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: `55659000${1000 + i}` });
    const ig = registrarIdentificador(acervo, { fonte: 'instagram', valor: `perfil-${i}` });
    for (const alvo of [cat, wa, ig]) {
      registrarNome(acervo, { autoridade: 'terceiro', identificadorId: alvo.id, origem: 'contatos', nome });
    }
    // Cada lado ja pertence a uma Pessoa DIFERENTE. Sem isto o lote so cria
    // Pessoa e vincula — zero mesclagens, zero linhas de referencia — e a
    // guarda de ato obsoleto nunca e exercida. Medido em 29/08/2026: a versao
    // sem este trecho passava com a guarda REMOVIDA, ou seja, sem poder.
    vincularIdentificador(acervo, {
      identificadorId: wa.id,
      pessoaId: criarPessoa(acervo),
      procedencia: 'material',
    });
    vincularIdentificador(acervo, {
      identificadorId: ig.id,
      pessoaId: criarPessoa(acervo),
      procedencia: 'material',
    });
  }
}

test('o lote grava UMA Operação, não uma por Proposta', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    dezPropostas(acervo);

    const propostas = propor(listarIdentificadores(acervo));
    assert.ok(propostas.length >= 5, `esperava propostas, obtive ${propostas.length}`);

    const antes = listarOperacoesCruas(acervo).length;
    const r = aplicarLote(acervo, propostas);
    assert.ok(r.aplicadas > 0, 'o lote aplicou algo');

    const todas = listarOperacoesCruas(acervo);
    const novas = todas.length - antes;
    assert.equal(novas, 1, `uma Operação para o lote inteiro, obtive ${novas}`);
    assert.equal(todas[0]?.natureza, 'aplicar-propostas');

    // E as linhas de efeito são as do lote inteiro.
    const linhas = linhasDaOperacao(acervo, todas[0]?.id ?? '');
    assert.ok(linhas.length >= r.vinculosCriados, 'os vínculos entraram como efeito');
  } finally {
    c.limpar();
  }
});

test('desfazer o lote RECUSA o item cujo ato foi desfeito e a Pessoa remesclada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    dezPropostas(acervo);
    const r = aplicarLote(acervo, propor(listarIdentificadores(acervo)));
    assert.ok(r.mesclagensFeitas > 0, `precisa de mesclagens, obtive ${r.mesclagensFeitas}`);

    const doLote = listarOperacoes(acervo)[0]?.id ?? '';
    assert.equal(listarOperacoes(acervo)[0]?.natureza, 'aplicar-propostas');

    // O conflito de verdade: desfazer À MÃO uma das mesclagens do lote e
    // remesclar a mesma Pessoa. Agora existe um ato NOVO e ativo para ela, e
    // o ato que o lote gravou está inativo. Sem a guarda, desfazer o lote
    // chamaria `desfazerMesclagem` pela Pessoa e desfaria o ato NOVO — que é
    // trabalho de outra sessão, não o que a trilha registrou.
    const umaAbsorvida = r.feito.flatMap((f) => f.mesclagens)[0]?.absorvidaId ?? '';
    assert.notEqual(umaAbsorvida, '', 'o lote precisa ter absorvido alguém');
    const mestreDela = (
      acervo.db.prepare('SELECT absorvida_por FROM pessoas WHERE id = ?').get(umaAbsorvida) as {
        absorvida_por: string;
      }
    ).absorvida_por;

    desfazerMesclagem(acervo, { absorvidaId: umaAbsorvida });
    const novo = mesclarPessoas(acervo, { pessoaA: mestreDela, pessoaB: umaAbsorvida });

    const res = desfazerOperacao(acervo, doLote);
    assert.ok(
      res.recusados.some((x) => /nao esta ativa/i.test(x.causa)),
      `esperava recusa por ato inativo, obtive ${JSON.stringify(res.recusados)}`,
    );

    // E o ato NOVO continua de pé: o desfazer não tocou no trabalho alheio.
    const aindaMesclada = acervo.db
      .prepare('SELECT absorvida_por FROM pessoas WHERE id = ?')
      .get(novo.absorvidaId) as { absorvida_por: string | null };
    assert.notEqual(aindaMesclada.absorvida_por, null, 'a mesclagem NOVA sobreviveu ao desfazer');

    assert.equal(conferirMesclagem(acervo).length, 0, 'estrela íntegra');
    assert.equal(lerOperacao(acervo, doLote)?.desfeitaPor, res.desfazerId);
  } finally {
    c.limpar();
  }
});

test('desfazer pelo caminho da trilha produz o mesmo que desfazer por fora', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    const a = criarPessoa(acervo);
    const b = criarPessoa(acervo);
    const { absorvidaId } = mesclarPessoas(acervo, { pessoaA: a, pessoaB: b });
    const daMesclagem = listarOperacoes(acervo).find((o) => o.natureza === 'mesclar')?.id ?? '';

    desfazerOperacao(acervo, daMesclagem);

    // Mesmo estado que `pessoa desfazer-mesclagem` produz: a absorvida volta a raiz.
    const linha = acervo.db
      .prepare('SELECT absorvida_por FROM pessoas WHERE id = ?')
      .get(absorvidaId) as { absorvida_por: string | null };
    assert.equal(linha.absorvida_por, null);
    assert.equal(conferirMesclagem(acervo).length, 0);
  } finally {
    c.limpar();
  }
});
