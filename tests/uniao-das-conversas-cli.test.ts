import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { COMANDOS_DE_REDE, executar } from '../src/cli/index.js';
import { instalacaoComChave, instalacaoTemporaria, rodar } from './ajuda/instalacao.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { fotografar, montarAcervoDaUniao } from './ajuda/uniao-das-conversas.js';
import { abrirAcervo, abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { listarOperacoesCruas } from '../src/nucleo/trilha.js';

// #1440, Plano 2: `malote identidade unir-conversas-do-contato`. Ensaio por padrao; a escrita pede --com-efeito --confirmo.

const BASE = (inquilino: string): string[] => ['identidade', 'unir-conversas-do-contato', '--inquilino', inquilino];

/** O texto fixo do que o `desfazer` cobre e nao cobre (criterio 8 e Assumption 6 da spec). */
const COBRE =
  'O `operacao desfazer` devolve cada Mensagem movida a Conversa opaca, a marca levada e o endereco opaco da Conversa promovida, e remove o Identificador do numero que esta Operacao registrou, cada um so enquanto o valor ainda e o que ela gravou (o resto e recusado, com a causa). Ele NAO devolve o que chegou depois: a Mensagem nova do contato fica na Conversa do numero ou na promovida, e a promovida desfeita que ja recebeu Mensagens do numero fica com elas sob o endereco opaco, e a Mensagem seguinte do numero abre uma Conversa nova.';

/** Nada de endereco, numero nem texto de Mensagem na saida. */
const VAZAMENTO = /@lid|whatsapp\.net|10000000000004|55659999|opaca um|Contato Promovido/;

function instalacao(): { raiz: string; inquilino: string; chave: string; limpar: () => void } {
  const { raiz, limpar } = instalacaoTemporaria();
  const { inquilino, chave } = instalacaoComChave(raiz);
  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino as never);
  try {
    montarAcervoDaUniao(acervo);
  } finally {
    acervo.fechar();
  }
  return { raiz, inquilino, chave, limpar };
}

function foto(raiz: string, inquilino: string): ReturnType<typeof fotografar> {
  const a = abrirAcervoSomenteLeitura(join(raiz, 'acervos'), inquilino as never);
  try {
    return fotografar(a);
  } finally {
    a.fechar();
  }
}

test('o ensaio diz o que faria, em contagens, por Configuracao, o que o desfazer cobre, e nao escreve', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const antes = foto(raiz, inquilino);
    const r = rodar(raiz, BASE(inquilino));
    assert.equal(r.codigo, 0, r.saida);
    assert.match(
      r.saida,
      /^Ensaio: 2 Conversa\(s\) a mover \(4 Mensagem\(ns\)\) e 2 a promover \(3 Mensagem\(ns\)\), de 8 Conversa\(s\) direta\(s\) por forma opaca com par\.$/m,
    );
    assert.ok(r.saida.includes(`  Configuracao ${CFG_WHATSAPP.id}: 2 a mover, 2 a promover, 3 conflito(s).`), r.saida);
    assert.match(r.saida, /^ {2}2 Identificador\(es\) do numero a registrar; 1 promovida\(s\) perdem o nome que a listagem mostra hoje/m);
    assert.match(r.saida, /^ {2}1 marca\(s\) de Conversa a levar ao alvo\.$/m);
    assert.match(r.saida, /^ {2}2 conflito\(s\) varias-opacas-para-o-numero: nada e tocado \(--json traz os ids\)\.$/m);
    assert.match(r.saida, /^ {2}1 conflito\(s\) alvo-ambiguo: nada e tocado \(--json traz os ids\)\.$/m);
    assert.ok(r.saida.includes(COBRE), r.saida);
    assert.match(r.saida, /Nada foi escrito\. Repita com --com-efeito --confirmo\./);
    assert.doesNotMatch(r.saida, VAZAMENTO);
    assert.deepEqual(foto(raiz, inquilino), antes);
  } finally {
    limpar();
  }
});

test('--com-efeito sem --confirmo recusa, e nada e escrito', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const antes = foto(raiz, inquilino);
    const r = rodar(raiz, [...BASE(inquilino), '--com-efeito']);
    assert.notEqual(r.codigo, 0);
    assert.match(r.saida, /Repita o comando com --confirmo/);
    assert.deepEqual(foto(raiz, inquilino), antes);
  } finally {
    limpar();
  }
});

test('--json traz o relatorio inteiro, so com ids de Conversa, e o que o desfazer cobre', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const r = rodar(raiz, [...BASE(inquilino), '--json']);
    assert.equal(r.codigo, 0, r.saida);
    const corpo = JSON.parse(r.saida) as Record<string, unknown>;
    assert.deepEqual(corpo['aMover'], { conversas: 2, mensagens: 4 });
    assert.deepEqual(corpo['aPromover'], { conversas: 2, mensagens: 3, identificadoresARegistrar: 2, perdemONome: 1 });
    assert.equal((corpo['conflitos'] as unknown[]).length, 3);
    assert.equal(corpo['gravou'], false);
    assert.equal(corpo['oQueODesfazerCobre'], COBRE);
    assert.doesNotMatch(r.saida, VAZAMENTO);
  } finally {
    limpar();
  }
});

test('desfazer ponta a ponta pelo comando: --com-efeito --confirmo une, e `operacao desfazer` devolve o estado inicial por hash', () => {
  const { raiz, inquilino, chave, limpar } = instalacao();
  try {
    const inicial = foto(raiz, inquilino);
    const r = rodar(raiz, [...BASE(inquilino), '--com-efeito', '--confirmo']);
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /^Unido: 2 Conversa\(s\) movida\(s\) \(4 Mensagem\(ns\)\) e 2 promovida\(s\); 2 Identificador\(es\) do numero registrado\(s\); 1 marca\(s\) levada\(s\)\.$/m);
    assert.ok(r.saida.includes(COBRE));
    assert.doesNotMatch(r.saida, VAZAMENTO);
    const operacao = /^Para desfazer: malote operacao desfazer (\S+) --inquilino \S+ --chave <valor> --com-efeito --confirmo$/m.exec(r.saida)?.[1];
    assert.ok(operacao, r.saida);
    assert.notDeepEqual(foto(raiz, inquilino), inicial);
    const a = abrirAcervoSomenteLeitura(join(raiz, 'acervos'), inquilino as never);
    try {
      assert.equal(listarOperacoesCruas(a).filter((o) => o.natureza === 'unir-conversas-do-contato').length, 1);
    } finally {
      a.fechar();
    }

    const d = rodar(raiz, ['operacao', 'desfazer', operacao, '--inquilino', inquilino, '--chave', chave, '--com-efeito', '--confirmo']);
    assert.equal(d.codigo, 0, d.saida);
    assert.match(d.saida, /^ {2}9 linha\(s\) revertida\(s\), 0 recusada\(s\)$/m);
    assert.deepEqual(foto(raiz, inquilino), inicial);

    const segundo = rodar(raiz, [...BASE(inquilino), '--json']);
    assert.deepEqual((JSON.parse(segundo.saida) as { aMover: unknown }).aMover, { conversas: 2, mensagens: 4 }, 'desfeito, o ensaio volta a ver o mesmo');
  } finally {
    limpar();
  }
});

test('--limite invalido sai 2, sem escrever; e o comando so roda no modo local', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const antes = foto(raiz, inquilino);
    for (const ruim of [['--limite', '0'], ['--limite', 'abc'], ['--limite', '-1'], ['--limite', '1.5'], ['--limite']]) {
      assert.equal(rodar(raiz, [...BASE(inquilino), ...ruim, '--com-efeito', '--confirmo']).codigo, 2, ruim.join(' '));
    }
    const linhas: string[] = [];
    const codigo = executar([...BASE(inquilino), '--com-efeito', '--confirmo'], {
      dados: raiz,
      estado: raiz,
      servidor: 'http://127.0.0.1:9',
      escrever: (t: string) => linhas.push(t),
    });
    assert.equal(codigo, 2);
    assert.match(linhas.join('\n'), /e uma operacao LOCAL/);
    assert.deepEqual(foto(raiz, inquilino), antes);
  } finally {
    limpar();
  }
});

test('a ajuda lista o comando, e ele nao esta na lista do modo rede', () => {
  const linhas: string[] = [];
  assert.equal(executar(['--ajuda'], { dados: '/nao/usado', estado: '/nao/usado', escrever: (t: string) => linhas.push(t) }), 0);
  assert.match(linhas.join('\n'), /malote identidade unir-conversas-do-contato --inquilino <id> \[--limite <n>\] \[--com-efeito --confirmo\] \[--json\]/);
  assert.equal(COMANDOS_DE_REDE.has('identidade'), false);
});
