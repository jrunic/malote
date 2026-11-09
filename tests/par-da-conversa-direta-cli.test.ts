import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { COMANDOS_DE_REDE, executar } from '../src/cli/index.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { abrirAcervo, abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarIdentificador, registrarMensagem } from '../src/nucleo/escrita.js';
import { listarOperacoesCruas } from '../src/nucleo/trilha.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';

// #1439, Plano 2: `malote identidade aprender-pares-da-conversa-direta`. Ensaio por padrao; a escrita pede --com-efeito --confirmo.

const OPACO_A = '100000000000031@lid';
const OPACO_B = '100000000000032@lid';
const TEL_A = '5565999991111@s.whatsapp.net'; // celular sem Identificador: nasce tambem o par das duas formas
const TEL_B = '14155550123@s.whatsapp.net'; // outro pais: so o par do opaco
const OPACO_C = '100000000000033@lid'; // ja tem par com outro numero: conflito
const TEL_C = '556599993333@s.whatsapp.net';
const TEL_C_GRAVADO = '556599994444@s.whatsapp.net';
const AGORA = 1_790_000_000_000;

function instalacao(): { raiz: string; inquilino: string; limpar: () => void } {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const inquilino = criarInquilino(registro, { titularNome: 'Teste' });
  registro.fechar();
  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino as never);
  for (const [n, [opaco, tel]] of [[OPACO_A, TEL_A], [OPACO_B, TEL_B], [OPACO_C, TEL_C]].entries()) {
    const conversaId = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: opaco!, coletiva: false, configuracao: CFG_WHATSAPP });
    registrarMensagem(acervo, {
      origemDaChegada: 'ao-vivo',
      direcao: 'recebida',
      conversaId,
      fonte: 'whatsapp',
      idExterno: `m${n}`,
      autorId: registrarIdentificador(acervo, { fonte: 'whatsapp', valor: opaco! }).id,
      ocorridaEm: AGORA - 100 + n,
      agora: AGORA,
      bruto: JSON.stringify({ key: { remoteJid: opaco, fromMe: false, id: `K${n}`, senderPn: tel } }),
    });
  }
  aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: OPACO_C, canonico: TEL_C_GRAVADO });
  acervo.fechar();
  return { raiz, inquilino, limpar };
}

function rodar(raiz: string, args: string[]): { codigo: number; saida: string } {
  const linhas: string[] = [];
  const codigo = executar(args, { dados: raiz, estado: raiz, escrever: (l: string) => linhas.push(l) }) as number;
  return { codigo, saida: linhas.join('\n') };
}

const lerPares = (raiz: string, inquilino: string): number => {
  const a = abrirAcervoSomenteLeitura(join(raiz, 'acervos'), inquilino as never);
  try {
    return (a.preparar('SELECT COUNT(*) AS n FROM correspondencias_de_endereco').get() as { n: number }).n;
  } finally {
    a.fechar();
  }
};

const BASE = (inquilino: string): string[] => ['identidade', 'aprender-pares-da-conversa-direta', '--inquilino', inquilino];

/** O texto fixo do que o `desfazer` cobre e nao cobre (criterio 6 da spec). */
const COBRE =
  'O `operacao desfazer` remove os pares que esta Operacao criou (do opaco e do celular). Ele NAO impede o ouvinte de reaprender o par na proxima Mensagem recebida do contato, as Mensagens gravadas entretanto ficam na Conversa por telefone, e o que `identidade resolver-enderecos` repontar depois do estoque nao volta com ele.';
const INQUILINO_INTEIRO =
  'O par vale para o Inquilino inteiro: a Conversa opaca de todas as Configuracoes deixa de receber, e as Mensagens novas do contato vao para a Conversa por telefone (uma nova, se ainda nao existe).';

test('o ensaio diz o que criaria, em contagens, o que o desfazer cobre, e nao escreve', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const r = rodar(raiz, BASE(inquilino));
    assert.equal(r.codigo, 0, r.saida);
    assert.match(
      r.saida,
      /^Ensaio: 2 par\(es\) do opaco e 1 do celular a criar \(3 Conversa\(s\) direta\(s\) por forma opaca examinada\(s\), 3 com Mensagem recebida\)\.$/m,
    );
    assert.match(r.saida, new RegExp(`^  2 Conversa\\(s\\) opaca\\(s\\) deixam de receber na Configuracao ${CFG_WHATSAPP.id}\\.$`, 'm'));
    assert.match(r.saida, /^ {2}1 conflito\(s\) par-existente-com-outro-canonico: achado, sem par \(--json traz a lista\)\.$/m);
    assert.ok(r.saida.includes(INQUILINO_INTEIRO), r.saida);
    assert.ok(r.saida.includes(COBRE), r.saida);
    assert.match(r.saida, /Nada foi escrito\. Repita com --com-efeito --confirmo\./);
    assert.doesNotMatch(r.saida, /@lid|whatsapp\.net|5565999|14155|10000000000003/, 'o texto so traz contagens, nunca o endereco');
    assert.equal(lerPares(raiz, inquilino), 1, 'so o par que ja existia');
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
    assert.equal(lerPares(raiz, inquilino), 1);
  } finally {
    limpar();
  }
});

test('--com-efeito --confirmo cria as duas especies, abre UMA Operacao e diz como desfazer e o que isso cobre', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const r = rodar(raiz, [...BASE(inquilino), '--com-efeito', '--confirmo']);
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /^Aprendido: 2 par\(es\) do opaco e 1 do celular criado\(s\)\.$/m);
    assert.match(r.saida, /^Para desfazer: malote operacao desfazer \S+ --inquilino \S+ --chave <valor> --com-efeito --confirmo$/m);
    assert.ok(r.saida.includes(COBRE));
    assert.equal(lerPares(raiz, inquilino), 1 + 3);
    const a = abrirAcervoSomenteLeitura(join(raiz, 'acervos'), inquilino as never);
    try {
      assert.equal(listarOperacoesCruas(a).filter((o) => o.natureza === 'aprender-pares-da-conversa-direta').length, 1);
    } finally {
      a.fechar();
    }
  } finally {
    limpar();
  }
});

test('--json traz o relatorio inteiro e o que o desfazer cobre, e so isso', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const r = rodar(raiz, [...BASE(inquilino), '--json']);
    const corpo = JSON.parse(r.saida) as Record<string, unknown>;
    assert.equal(corpo['paresDoOpacoACriar'], 2);
    assert.equal(corpo['paresDoCelularACriar'], 1);
    assert.deepEqual(corpo['criados'], { doOpaco: 0, doCelular: 0 });
    assert.deepEqual(corpo['conflitos'], [{ opaco: OPACO_C, motivo: 'par-existente-com-outro-canonico', telefones: [TEL_C_GRAVADO, TEL_C] }]);
    assert.equal(corpo['gravou'], false);
    assert.equal(corpo['oQueODesfazerCobre'], COBRE);
  } finally {
    limpar();
  }
});

test('--limite e --tamanho-do-lote invalidos ou sem valor saem 2, sem escrever; o limite corta os pares do opaco', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    for (const ruim of [['--limite', '0'], ['--limite', 'abc'], ['--tamanho-do-lote', '-1'], ['--limite']]) {
      const r = rodar(raiz, [...BASE(inquilino), ...ruim]);
      assert.equal(r.codigo, 2, ruim.join(' '));
    }
    assert.equal(rodar(raiz, [...BASE(inquilino), '--limite']).saida, 'A flag --limite pede um valor.');
    const r = rodar(raiz, [...BASE(inquilino), '--limite', '1', '--com-efeito', '--confirmo']);
    assert.equal(r.codigo, 0, r.saida);
    assert.equal(lerPares(raiz, inquilino), 1 + 2, 'o primeiro opaco (o celular) e o par das duas formas dele');
  } finally {
    limpar();
  }
});

test('a ajuda lista o comando, e ele e so do modo local', () => {
  const linhas: string[] = [];
  assert.equal(executar(['--ajuda'], { dados: '/nao/usado', estado: '/nao/usado', escrever: (t: string) => linhas.push(t) }), 0);
  assert.match(linhas.join('\n'), /malote identidade aprender-pares-da-conversa-direta --inquilino <id> \[--limite <n>\] \[--tamanho-do-lote <n>\] \[--com-efeito --confirmo\] \[--json\]/);
  assert.equal(COMANDOS_DE_REDE.has('identidade'), false);
});
