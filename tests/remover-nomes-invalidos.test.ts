import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cenario } from './ajuda/acervo.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import {
  nomesDoIdentificador,
  removerNomesInvalidos,
} from '../src/nucleo/identidade.js';
import { listarOperacoesCruas, linhasDaOperacao } from '../src/nucleo/trilha.js';
import type { Acervo } from '../src/nucleo/acervo.js';

const LRE = '\u202A';
const PDF = '\u202C';
const NBSP = '\u00A0';

// GUARDA DE VACUIDADE: escape errado virando string vazia faria as fixtures
// com marca e sem marca serem a MESMA string, e os testes passariam sem
// exercitar nada.
test('as fixtures com marca sao mesmo diferentes das sem marca', () => {
  assert.notEqual(LRE + 'Ana Prado' + PDF, 'Ana Prado');
  assert.notEqual('Ana' + NBSP + 'Prado', 'Ana Prado');
});

/** Grava direto, para montar o estado que producao ja tem. */
function atribuicao(acervo: Acervo, identificadorId: string, nome: string): void {
  acervo.db
    .prepare(
      `INSERT INTO atribuicoes_de_nome
         (id, pessoa_id, identificador_id, origem, configuracao_id, nome,
          atribuido_em, ultimo_avistamento, autoridade)
       VALUES (?, NULL, ?, 'whatsapp', NULL, ?, '2026-01-01T00:00:00.000Z',
               '2026-01-01T00:00:00.000Z', NULL)`,
    )
    .run(randomUUID(), identificadorId, nome);
}

function comIdentificador(acervo: Acervo, valor: string): string {
  return registrarIdentificador(acervo, { fonte: 'whatsapp', valor }).id;
}

test('remove nome que repete o proprio endereco', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const id = comIdentificador(acervo, '5511999990001@s.whatsapp.net');
    atribuicao(acervo, id, '+55 11 99999-0001');

    const r = removerNomesInvalidos(acervo, { comEfeito: true });

    assert.equal(r.repetemOEndereco, 1);
    assert.equal(nomesDoIdentificador(acervo, id).length, 0);
  } finally {
    c.limpar();
  }
});

test('remove a duplicata por marca invisivel, PRESERVANDO a linha sem marca', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const id = comIdentificador(acervo, '5511999990002@s.whatsapp.net');
    atribuicao(acervo, id, 'Ana Prado');
    atribuicao(acervo, id, LRE + 'Ana Prado' + PDF);

    const r = removerNomesInvalidos(acervo, { comEfeito: true });

    assert.equal(r.duplicamPorMarca, 1);
    const restam = nomesDoIdentificador(acervo, id);
    assert.equal(restam.length, 1);
    assert.equal(restam[0]?.nome, 'Ana Prado', 'sobra a SEM marca');
  } finally {
    c.limpar();
  }
});

test('DUAS linhas com marca e nenhuma limpa: todas ficam', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const id = comIdentificador(acervo, '5511999990009@s.whatsapp.net');
    // Mesma chave, as duas com marca, nenhuma limpa. Sem a regra da irma a
    // porta apagaria as DUAS, e o endereco ficaria sem nome nenhum — o oposto
    // do que ela existe para fazer.
    atribuicao(acervo, id, LRE + 'Ana Prado' + PDF);
    atribuicao(acervo, id, 'Ana' + NBSP + 'Prado');

    const r = removerNomesInvalidos(acervo, { comEfeito: true });

    assert.equal(r.duplicamPorMarca, 0);
    assert.equal(nomesDoIdentificador(acervo, id).length, 2);
  } finally {
    c.limpar();
  }
});

test('linha com marca SEM irma nao e removida — e a unica afirmacao que existe', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const id = comIdentificador(acervo, '5511999990003@s.whatsapp.net');
    atribuicao(acervo, id, LRE + 'Ana Prado' + PDF);

    const r = removerNomesInvalidos(acervo, { comEfeito: true });

    assert.equal(r.duplicamPorMarca, 0);
    assert.equal(nomesDoIdentificador(acervo, id).length, 1);
  } finally {
    c.limpar();
  }
});

test('linha que e AS DUAS coisas e removida, e nao segura a irma', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const id = comIdentificador(acervo, '5511999990004@s.whatsapp.net');
    // As duas repetem o endereco, e uma e duplicata da outra por marca. Se a
    // regra da marca rodasse primeiro, cada uma seguraria a outra como irma e
    // nenhuma sairia — sao 595 linhas assim no Acervo real.
    atribuicao(acervo, id, '+55 11 99999-0004');
    atribuicao(acervo, id, LRE + '+55 11 99999-0004' + PDF);

    const r = removerNomesInvalidos(acervo, { comEfeito: true });

    assert.equal(r.repetemOEndereco, 2);
    // A CONTAGEM POR MOTIVO e o criterio: com a ordem invertida as duas
    // entrariam tambem no agrupamento por marca, e a mesma linha seria contada
    // em dois motivos. Total certo, atribuicao errada.
    assert.equal(r.duplicamPorMarca, 0, 'nenhuma e contada como duplicata');
    assert.equal(nomesDoIdentificador(acervo, id).length, 0);
  } finally {
    c.limpar();
  }
});

test('nao remove nome humano nenhum', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const id = comIdentificador(acervo, '5511999990005@s.whatsapp.net');
    atribuicao(acervo, id, 'Ana Prado');
    atribuicao(acervo, id, 'Ana P. Prado');

    const r = removerNomesInvalidos(acervo, { comEfeito: true });

    assert.equal(r.repetemOEndereco, 0);
    assert.equal(r.duplicamPorMarca, 0);
    assert.equal(nomesDoIdentificador(acervo, id).length, 2);
  } finally {
    c.limpar();
  }
});

test('o ENSAIO e o padrao: conta e nao apaga', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const id = comIdentificador(acervo, '5511999990006@s.whatsapp.net');
    atribuicao(acervo, id, '+55 11 99999-0006');

    const r = removerNomesInvalidos(acervo, { comEfeito: false });

    assert.equal(r.ensaio, true);
    assert.equal(r.repetemOEndereco, 1, 'conta');
    assert.equal(nomesDoIdentificador(acervo, id).length, 1, 'e NAO apaga');
  } finally {
    c.limpar();
  }
});

test('a remocao grava Operacao com uma linha de efeito por Atribuicao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const id = comIdentificador(acervo, '5511999990007@s.whatsapp.net');
    atribuicao(acervo, id, '+55 11 99999-0007');
    atribuicao(acervo, id, 'Ana Prado');
    atribuicao(acervo, id, LRE + 'Ana Prado' + PDF);

    removerNomesInvalidos(acervo, { comEfeito: true });

    const op = listarOperacoesCruas(acervo).filter(
      (o) => o.natureza === 'remover-nomes-invalidos',
    )[0];
    assert.ok(op !== undefined, 'a Operacao existe');
    assert.equal(linhasDaOperacao(acervo, op.id).length, 2, 'uma linha por Atribuicao removida');
  } finally {
    c.limpar();
  }
});

test('o ensaio NAO grava Operacao — ler nao e escrever', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const id = comIdentificador(acervo, '5511999990008@s.whatsapp.net');
    atribuicao(acervo, id, '+55 11 99999-0008');

    removerNomesInvalidos(acervo, { comEfeito: false });

    const ops = listarOperacoesCruas(acervo).filter(
      (o) => o.natureza === 'remover-nomes-invalidos',
    );
    assert.equal(ops.length, 0);
  } finally {
    c.limpar();
  }
});

// --- o comando da CLI ---

import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { executar } from '../src/cli/index.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';

function rodar(raiz: string, argumentos: string[]): { codigo: number; saida: string } {
  const linhas: string[] = [];
  const codigo = executar(argumentos, { dados: raiz, estado: raiz, escrever: (texto: string) => linhas.push(texto) });
  return { codigo, saida: linhas.join('\n') };
}

/** Instalacao com um Inquilino e uma Atribuicao que repete o proprio endereco. */
function cenarioDeCli(raiz: string): { inquilino: string } {
  const chave = /valor:\s*(\S+)/.exec(rodar(raiz, ['operador', 'chave', 'criar']).saida)?.[1];
  assert.ok(chave);
  const criacao = rodar(raiz, ['inquilino', 'criar', '--chave', chave, '--titular', 'Leia Organa']);
  const inquilino = /id:\s*(\S+)/.exec(criacao.saida)?.[1];
  assert.ok(inquilino);

  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
  const id = comIdentificador(acervo, '5511999990020@s.whatsapp.net');
  atribuicao(acervo, id, '+55 11 99999-0020');
  atribuicao(acervo, id, 'Ana Prado');
  atribuicao(acervo, id, LRE + 'Ana Prado' + PDF);
  acervo.fechar();
  return { inquilino };
}

test('pela CLI, sem --com-efeito o comando CONTA e nao apaga', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino } = cenarioDeCli(raiz);

    const r = rodar(raiz, ['pessoa', 'remover-nomes-invalidos', '--inquilino', inquilino]);
    assert.equal(r.codigo, 0);
    assert.match(r.saida, /Ensaio/);
    // OS DOIS MOTIVOS, separados: total sozinho nao permite conferir contra a
    // linha de base, que e o criterio.
    assert.match(r.saida, /repetem o endereço:\s*1/);
    assert.match(r.saida, /duplicam por marca invisível:\s*1/);

    const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
    try {
      const n = acervo.db
        .prepare('SELECT COUNT(*) AS n FROM atribuicoes_de_nome')
        .get() as { n: number };
      assert.equal(n.n, 3, 'nada foi apagado');
    } finally {
      acervo.fechar();
    }
  } finally {
    limpar();
  }
});

test('pela CLI, --com-efeito sem --confirmo RECUSA', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino } = cenarioDeCli(raiz);
    const r = rodar(raiz, [
      'pessoa',
      'remover-nomes-invalidos',
      '--inquilino',
      inquilino,
      '--com-efeito',
    ]);
    assert.notEqual(r.codigo, 0);
    // A AJUDA tambem contem "--confirmo": sem a recusa abaixo, este teste
    // passaria com o comando INEXISTENTE, que e o que ele estava fazendo.
    assert.doesNotMatch(r.saida, /Uso:/, 'nao e a ajuda de comando desconhecido');
    assert.match(r.saida, /Repita o comando com --confirmo/);

    const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
    try {
      const n = acervo.db
        .prepare('SELECT COUNT(*) AS n FROM atribuicoes_de_nome')
        .get() as { n: number };
      assert.equal(n.n, 3, 'e nada foi apagado');
    } finally {
      acervo.fechar();
    }
  } finally {
    limpar();
  }
});

test('pela CLI, --com-efeito --confirmo remove e sobra o nome humano limpo', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino } = cenarioDeCli(raiz);
    const r = rodar(raiz, [
      'pessoa',
      'remover-nomes-invalidos',
      '--inquilino',
      inquilino,
      '--com-efeito',
      '--confirmo',
    ]);
    assert.equal(r.codigo, 0);

    const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
    try {
      const restam = acervo.db
        .prepare('SELECT nome FROM atribuicoes_de_nome')
        .all() as { nome: string }[];
      assert.equal(restam.length, 1);
      assert.equal(restam[0]?.nome, 'Ana Prado');
    } finally {
      acervo.fechar();
    }
  } finally {
    limpar();
  }
});
