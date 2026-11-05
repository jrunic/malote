import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { executar } from '../src/cli/index.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { abrirAcervo, abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { listarOperacoesCruas } from '../src/nucleo/trilha.js';

// #1376, Plano 4: `malote identidade aprender-formas-do-celular`. Ensaio por padrao; a escrita pede --com-efeito --confirmo.

const SEM_NOVE = '556599991111@s.whatsapp.net';
const COM_NOVE = '5548999492222@s.whatsapp.net';
const FIXO = '556532221234@s.whatsapp.net';
const DUAS_A = '556599995555@s.whatsapp.net';
const DUAS_B = '5565999995555@s.whatsapp.net';
const LEGADO_GRAVADO = '5565999997777@s.whatsapp.net';
const LEGADO_CANONICO = '556599997777@s.whatsapp.net';
/** O par que ja existe antes do comando (o canonico do legado e a forma nao gravada). */
const PAR_LID = { alternativo: '100000000000002@lid', canonico: LEGADO_CANONICO };

function instalacao(): { raiz: string; inquilino: string; limpar: () => void } {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const inquilino = criarInquilino(registro, { titularNome: 'Teste' });
  registro.fechar();
  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino as never);
  for (const valor of [SEM_NOVE, COM_NOVE, FIXO, DUAS_A, DUAS_B, LEGADO_GRAVADO]) registrarIdentificador(acervo, { fonte: 'whatsapp', valor });
  aprenderCorrespondencia(acervo, { fonte: 'whatsapp', ...PAR_LID });
  acervo.fechar();
  return { raiz, inquilino, limpar };
}

function rodar(raiz: string, args: string[]): { codigo: number; saida: string } {
  const linhas: string[] = [];
  const codigo = executar(args, { dados: raiz, estado: raiz, escrever: (l: string) => linhas.push(l) }) as number;
  return { codigo, saida: linhas.join('\n') };
}

const lerPares = (raiz: string, inquilino: string): Array<{ alternativo: string; canonico: string }> => {
  const a = abrirAcervoSomenteLeitura(join(raiz, 'acervos'), inquilino as never);
  try {
    return a.preparar('SELECT alternativo, canonico FROM correspondencias_de_endereco ORDER BY alternativo').all() as Array<{
      alternativo: string;
      canonico: string;
    }>;
  } finally {
    a.fechar();
  }
};

const BASE = (inquilino: string): string[] => ['identidade', 'aprender-formas-do-celular', '--inquilino', inquilino];

test('o ensaio diz o que criaria, em contagens, e nao escreve', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const r = rodar(raiz, BASE(inquilino));
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /^Ensaio: 3 par\(es\) a criar em 4 celular\(es\) \(6 Identificador\(es\) de telefone examinado\(s\)\)\./m);
    assert.match(r.saida, /1 deles deixam a forma gravada como alternativa: rode `identidade resolver-enderecos`/);
    assert.match(r.saida, /1 nao e celular/);
    assert.match(r.saida, /1 numero\(s\) com as duas formas gravadas: sem par/);
    assert.match(r.saida, /Nada foi escrito\. Repita com --com-efeito --confirmo\./);
    assert.doesNotMatch(r.saida, /5565999|5548999/, 'o texto so traz contagens, nunca o endereco');
    assert.deepEqual(lerPares(raiz, inquilino), [PAR_LID]);
  } finally {
    limpar();
  }
});

test('--com-efeito sem --confirmo recusa, e nada e escrito', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const r = rodar(raiz, [...BASE(inquilino), '--com-efeito']);
    assert.notEqual(r.codigo, 0);
    assert.match(r.saida, /Repita o comando com --confirmo/);
    assert.deepEqual(lerPares(raiz, inquilino), [PAR_LID]);
  } finally {
    limpar();
  }
});

test('--com-efeito --confirmo cria os pares, abre UMA Operacao e diz como desfazer', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const r = rodar(raiz, [...BASE(inquilino), '--com-efeito', '--confirmo']);
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /^Aprendido: 3 par\(es\) criado\(s\) em 4 celular\(es\)\./m);
    assert.match(r.saida, /malote operacao desfazer \S+ --inquilino /);
    assert.deepEqual(lerPares(raiz, inquilino), [
      PAR_LID,
      { alternativo: '554899492222@s.whatsapp.net', canonico: COM_NOVE },
      { alternativo: '5565999991111@s.whatsapp.net', canonico: SEM_NOVE },
      { alternativo: LEGADO_GRAVADO, canonico: LEGADO_CANONICO },
    ]);
    assert.doesNotMatch(r.saida, /Interrompido/);
    const a = abrirAcervoSomenteLeitura(join(raiz, 'acervos'), inquilino as never);
    try {
      assert.equal(listarOperacoesCruas(a).filter((o) => o.natureza === 'aprender-formas-do-celular').length, 1);
    } finally {
      a.fechar();
    }
  } finally {
    limpar();
  }
});

test('--json traz o relatorio inteiro, e so ele', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const r = rodar(raiz, [...BASE(inquilino), '--json']);
    const corpo = JSON.parse(r.saida) as Record<string, unknown>;
    assert.equal(corpo['aCriar'], 3);
    assert.equal(corpo['legados'], 1);
    assert.equal(corpo['naoCelular'], 1);
    assert.deepEqual(corpo['duasFormas'], [{ formas: [DUAS_A, DUAS_B], mensagens: [0, 0], conversas: [0, 0] }]);
    assert.equal(corpo['gravou'], false);
  } finally {
    limpar();
  }
});

test('--limite e --tamanho-do-lote invalidos saem 2, sem escrever; o limite corta os pares', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    for (const ruim of [['--limite', '0'], ['--limite', 'abc'], ['--tamanho-do-lote', '-1']]) {
      const r = rodar(raiz, [...BASE(inquilino), ...ruim]);
      assert.equal(r.codigo, 2, ruim.join(' '));
    }
    const r = rodar(raiz, [...BASE(inquilino), '--limite', '1', '--com-efeito', '--confirmo']);
    assert.equal(r.codigo, 0, r.saida);
    assert.equal(lerPares(raiz, inquilino).length, 2);
  } finally {
    limpar();
  }
});

test('a ajuda lista o comando', () => {
  const linhas: string[] = [];
  assert.equal(executar(['--ajuda'], { dados: '/nao/usado', estado: '/nao/usado', escrever: (t: string) => linhas.push(t) }), 0);
  assert.match(linhas.join('\n'), /malote identidade aprender-formas-do-celular --inquilino <id>/);
});
