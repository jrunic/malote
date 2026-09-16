import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoTemporaria, instalacaoComInquilino, rodar } from './ajuda/instalacao.js';
import { abrirRegistro } from '../src/registro/registro.js';
import { escreverMaterialInstagramEm } from './ajuda/material-instagram-falso.js';
import { varrer } from '../src/cli/varredura.js';
import { abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';

/** vCard SINTETICO — ADR 20260811-dado-de-exemplo-sintetico-em-repo-publico. */
const VCARD_DE_DOIS = [
  ['BEGIN:VCARD', 'FN:Leia Organa', 'TEL;TYPE=cell:+5565900000001', 'END:VCARD'].join('\r\n'),
  ['BEGIN:VCARD', 'FN:Han Solo', 'TEL;TYPE=cell:+5565900000002', 'END:VCARD'].join('\r\n'),
].join('\r\n');

/**
 * Seis e cinco cartoes: o tamanho e DELIBERADO. A guarda proporcional aborta
 * acima de 20% de ausencia, e com tres cartoes um ausente ja e 33% — o caso
 * feliz nao caberia. Um de seis e 17%, e cabe.
 */
const nCartoes = (n: number): string =>
  Array.from({ length: n }, (_, i) =>
    ['BEGIN:VCARD', 'VERSION:3.0', `FN:Pessoa ${i}`, `TEL;TYPE=CELL:+55659000001${i}`, 'END:VCARD'].join('\n'),
  ).join('\n');

const VCARD_DE_SEIS = nCartoes(6);
const VCARD_DE_CINCO = nCartoes(5);

const VCARD_DE_TRES = [
  VCARD_DE_DOIS,
  ['BEGIN:VCARD', 'FN:Chewbacca', 'TEL;TYPE=cell:+5565900000003', 'END:VCARD'].join('\r\n'),
].join('\r\n');

/** Uma Conversa direta em que o Titular declarado aparece. */
function conversasComTitular(titular: string) {
  return [
    {
      slug: 'contraparte',
      numero: '111',
      title: 'Contraparte',
      participants: ['Contraparte', titular],
      messages: [{ sender_name: titular, timestamp_ms: 1_700_000_000_000, content: 'ola' }],
    },
  ];
}

/**
 * Declara a Pasta de Entrada pela CLI, e nao pela porta.
 *
 * De proposito: e o caminho que producao vai tomar, e exercita os dois de uma
 * vez. A porta ja tem teste proprio em pasta-de-entrada.test.ts.
 */
function declararEntrada(
  raiz: string,
  inquilino: string,
  fonte: string,
  apelido: string,
  pasta: string,
  natureza: 'completo' | 'parcial',
  titularNaFonte?: string,
): void {
  const r = rodar(raiz, [
    'entrada', 'declarar',
    '--inquilino', inquilino, '--fonte', fonte, '--configuracao', apelido,
    '--pasta', pasta, '--natureza', natureza,
    ...(titularNaFonte === undefined ? [] : ['--titular-na-fonte', titularNaFonte]),
  ]);
  assert.equal(r.codigo, 0, r.saida);
}

function varrerCom(raiz: string, inquilino: string, agora?: number) {
  const registro = abrirRegistro(raiz);
  try {
    return varrer(registro, {
      dados: raiz,
      inquilinoId: inquilino,
      ...(agora !== undefined ? { agora } : {}),
    });
  } finally {
    registro.fechar();
  }
}

test('varre uma pasta de catalogo, importa e move para processados', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const entrada = join(raiz, 'entrada-contatos');
    mkdirSync(entrada, { recursive: true });
    writeFileSync(join(entrada, 'contatos.vcf'), VCARD_DE_DOIS);
    declararEntrada(raiz, inquilino, 'contatos', 'catalogo', entrada, 'completo');

    const r = varrerCom(raiz, inquilino);

    assert.equal(r.configuracoes.length, 1);
    assert.equal(r.configuracoes[0]?.processados, 1, (r.configuracoes[0]?.motivos ?? []).join('; '));
    assert.equal(r.configuracoes[0]?.recusados, 0);
    assert.equal(r.configuracoes[0]?.falhas, 0);
    assert.equal(r.configuracoes[0]?.itensLidos, 2, 'os dois cartoes foram lidos');
    assert.equal(existsSync(join(entrada, 'contatos.vcf')), false, 'saiu da Pasta de Entrada');
    assert.equal(
      existsSync(join(entrada, 'processados', 'contatos.vcf')), true, 'esta em processados',
    );
  } finally {
    limpar();
  }
});

test('varre uma pasta de Instagram, e o Titular vem da Configuracao', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const entrada = join(raiz, 'entrada-ig');
    const lote = join(entrada, 'export-2026-09');
    mkdirSync(lote, { recursive: true });
    escreverMaterialInstagramEm(lote, conversasComTitular('Leia Organa'));
    declararEntrada(raiz, inquilino, 'instagram', 'conta-a', entrada, 'parcial', 'Leia Organa');

    // A INVOCACAO nao recebe o nome do Titular. Se ele nao viesse da
    // Configuracao, a importacao recusaria por TitularAusenteError — e o
    // criterio 9 e exatamente isto.
    const r = varrerCom(raiz, inquilino);

    assert.equal(r.configuracoes[0]?.processados, 1, (r.configuracoes[0]?.motivos ?? []).join('; '));
    assert.equal(r.configuracoes[0]?.itensLidos, 1);
    assert.equal(existsSync(lote), false, 'o lote saiu da Pasta de Entrada');
    assert.equal(existsSync(join(entrada, 'processados', 'export-2026-09')), true);
  } finally {
    limpar();
  }
});

test('varrer de novo nao processa nada, porque a Pasta de Entrada esvaziou', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const entrada = join(raiz, 'entrada-contatos');
    mkdirSync(entrada, { recursive: true });
    writeFileSync(join(entrada, 'contatos.vcf'), VCARD_DE_DOIS);
    declararEntrada(raiz, inquilino, 'contatos', 'catalogo', entrada, 'completo');

    varrerCom(raiz, inquilino);
    const segunda = varrerCom(raiz, inquilino);
    assert.equal(segunda.configuracoes[0]?.processados, 0);
    assert.equal(segunda.configuracoes[0]?.recusados, 0, 'pasta vazia nao e recusa');
  } finally {
    limpar();
  }
});

test('a subpasta processados NAO e candidata — senao a varredura se come', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const entrada = join(raiz, 'entrada-contatos');
    mkdirSync(entrada, { recursive: true });
    writeFileSync(join(entrada, 'contatos.vcf'), VCARD_DE_DOIS);
    declararEntrada(raiz, inquilino, 'contatos', 'catalogo', entrada, 'completo');

    varrerCom(raiz, inquilino);
    const segunda = varrerCom(raiz, inquilino);
    // Sem o filtro, `processados/` seria vista como um lote e a varredura
    // tentaria move-la para dentro de si mesma.
    assert.deepEqual(readdirSync(join(entrada, 'processados')), ['contatos.vcf']);
    assert.equal(segunda.configuracoes[0]?.falhas, 0);
  } finally {
    limpar();
  }
});

test('arquivo devolvido a Pasta de Entrada e REPROCESSADO, nao pulado', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const entrada = join(raiz, 'entrada-contatos');
    mkdirSync(entrada, { recursive: true });
    writeFileSync(join(entrada, 'contatos.vcf'), VCARD_DE_DOIS);
    declararEntrada(raiz, inquilino, 'contatos', 'catalogo', entrada, 'completo');

    const primeira = varrerCom(raiz, inquilino);
    assert.equal(primeira.configuracoes[0]?.itensLidos, 2);

    // Devolve o MESMO arquivo: mesmo nome, mesmo tamanho, logo a MESMA
    // Impressao de Material, ja registrada em `materiais`.
    renameSync(join(entrada, 'processados', 'contatos.vcf'), join(entrada, 'contatos.vcf'));
    const segunda = varrerCom(raiz, inquilino);

    // O que prova que rodou nao e a contagem no Acervo — que nao muda, por
    // idempotencia — e sim o material ter sido LIDO de novo.
    assert.equal(
      segunda.configuracoes[0]?.itensLidos, 2,
      'devolveu "ja registrado" em vez de reprocessar',
    );
    assert.equal(segunda.configuracoes[0]?.processados, 1);
  } finally {
    limpar();
  }
});

test('dois materiais de mesmo nome preservam os dois em processados', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const entrada = join(raiz, 'entrada-contatos');
    mkdirSync(entrada, { recursive: true });
    declararEntrada(raiz, inquilino, 'contatos', 'catalogo', entrada, 'completo');

    writeFileSync(join(entrada, 'contatos.vcf'), VCARD_DE_DOIS);
    varrerCom(raiz, inquilino);

    writeFileSync(join(entrada, 'contatos.vcf'), VCARD_DE_TRES);
    const segunda = varrerCom(raiz, inquilino);
    assert.equal(
      segunda.configuracoes[0]?.processados, 1,
      (segunda.configuracoes[0]?.motivos ?? []).join('; '),
    );

    const emProcessados = readdirSync(join(entrada, 'processados')).sort();
    assert.equal(
      emProcessados.length, 2,
      `o produto nao apaga nada; vi ${emProcessados.join(', ')}`,
    );
    assert.ok(
      emProcessados.includes('contatos.vcf'),
      'o primeiro mantem o nome original — quem desambigua e o que chega depois',
    );
  } finally {
    limpar();
  }
});

test('material recusado NAO sai da Pasta de Entrada', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const entrada = join(raiz, 'entrada-ig');
    const lote = join(entrada, 'export-2026-09');
    mkdirSync(lote, { recursive: true });
    // O Titular declarado NAO participa desta Conversa direta.
    escreverMaterialInstagramEm(lote, conversasComTitular('Outra Pessoa'));
    declararEntrada(raiz, inquilino, 'instagram', 'conta-a', entrada, 'parcial', 'Leia Organa');

    const r = varrerCom(raiz, inquilino);
    assert.equal(r.configuracoes[0]?.processados, 0);
    assert.equal(r.configuracoes[0]?.recusados, 1);
    assert.ok(
      r.configuracoes[0]?.motivos.some((m) => /titular/i.test(m)),
      `o motivo tem de nomear o Titular; veio: ${(r.configuracoes[0]?.motivos ?? []).join('; ')}`,
    );
    assert.equal(existsSync(lote), true, 'o material recusado continua na Pasta de Entrada');
    assert.equal(existsSync(join(entrada, 'processados')), false, 'nada foi movido');
  } finally {
    limpar();
  }
});

test('pasta inexistente relata a falha e NAO impede as demais', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);

    const boa = join(raiz, 'entrada-boa');
    mkdirSync(boa, { recursive: true });
    writeFileSync(join(boa, 'contatos.vcf'), VCARD_DE_DOIS);
    declararEntrada(raiz, inquilino, 'contatos', 'google-a', boa, 'completo');
    declararEntrada(raiz, inquilino, 'contatos', 'google-b', join(raiz, 'nao-existe'), 'completo');

    const r = varrerCom(raiz, inquilino);
    const porApelido = new Map(r.configuracoes.map((c) => [c.apelido, c] as const));
    assert.equal(porApelido.get('google-a')?.processados, 1, 'a boa processou');
    assert.equal(porApelido.get('google-b')?.falhas, 1, 'a ruim relatou');
    assert.equal(
      porApelido.get('google-b')?.recusados, 0,
      'falha de pasta nao e recusa de material',
    );
  } finally {
    limpar();
  }
});

test('pasta sem conteudo reconhecivel e RECUSADA, e nao vira Material registrado', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const entrada = join(raiz, 'entrada-ig');
    mkdirSync(join(entrada, 'pasta-qualquer'), { recursive: true });
    declararEntrada(raiz, inquilino, 'instagram', 'conta-a', entrada, 'parcial', 'Leia Organa');

    const r = varrerCom(raiz, inquilino);
    assert.equal(r.configuracoes[0]?.processados, 0);
    assert.equal(r.configuracoes[0]?.recusados, 1);
    assert.equal(existsSync(join(entrada, 'pasta-qualquer')), true, 'nao foi movida');

    // A ASSERCAO FORTE E ESTA. Sem a recusa, `lerMaterial` devolve vazio sem
    // lancar e o importador segue ate `registrarMaterialConcluido`, gravando um
    // Material de impressao CONSTANTE e contagens zero. A linha falsa e o que
    // `material listar` mostra e o que o watchdog de atraso le como "chegou
    // material" — e ela sobrevive a limpeza da pasta, porque esta no Acervo.
    const acervo = abrirAcervoSomenteLeitura(join(raiz, 'acervos'), inquilino);
    try {
      const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM materiais').get() as { n: number };
      assert.equal(n.n, 0, 'conclusao falsa gravada para uma pasta que nao tinha material');
    } finally {
      acervo.fechar();
    }
  } finally {
    limpar();
  }
});

test('arquivo de catalogo sem cartao algum e recusado', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const entrada = join(raiz, 'entrada-contatos');
    mkdirSync(entrada, { recursive: true });
    writeFileSync(join(entrada, 'vazio.vcf'), '');
    declararEntrada(raiz, inquilino, 'contatos', 'catalogo', entrada, 'completo');

    const r = varrerCom(raiz, inquilino);
    assert.equal(
      r.configuracoes[0]?.recusados, 1,
      (r.configuracoes[0]?.motivos ?? []).join('; '),
    );
    assert.equal(existsSync(join(entrada, 'vazio.vcf')), true, 'fica onde esta');
  } finally {
    limpar();
  }
});

test('cada material processado grava UMA Operacao, e o ator distingue a varredura', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const entrada = join(raiz, 'entrada-contatos');
    mkdirSync(entrada, { recursive: true });
    writeFileSync(join(entrada, 'a.vcf'), VCARD_DE_DOIS);
    writeFileSync(join(entrada, 'b.vcf'), VCARD_DE_TRES);
    declararEntrada(raiz, inquilino, 'contatos', 'catalogo', entrada, 'completo');

    const r = rodar(raiz, ['material', 'varrer', '--inquilino', inquilino]);
    assert.equal(r.codigo, 0, r.saida);

    const acervo = abrirAcervoSomenteLeitura(join(raiz, 'acervos'), inquilino);
    try {
      const ops = acervo.db
        .prepare(
          `SELECT ator, COUNT(*) AS c FROM operacoes
            WHERE natureza = 'importar-material' GROUP BY ator`,
        )
        .all() as { ator: string; c: number }[];
      assert.equal(ops.length, 1, `um so ator; vi ${JSON.stringify(ops)}`);
      assert.equal(ops[0]?.ator, 'servico:varredura');
      assert.equal(ops[0]?.c, 2, 'uma Operacao por MATERIAL — nem uma so, nem uma por cartao');
    } finally {
      acervo.fechar();
    }
  } finally {
    limpar();
  }
});

test('importar a mao NAO se passa por varredura', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const material = join(raiz, 'avulso.vcf');
    writeFileSync(material, VCARD_DE_DOIS);
    const r = rodar(raiz, [
      'importar', '--inquilino', inquilino, '--fonte', 'contatos',
      '--material', material, '--configuracao', 'catalogo',
    ]);
    assert.equal(r.codigo, 0, r.saida);

    const acervo = abrirAcervoSomenteLeitura(join(raiz, 'acervos'), inquilino);
    try {
      const ops = acervo.db
        .prepare("SELECT ator FROM operacoes WHERE natureza = 'importar-material'")
        .all() as { ator: string }[];
      assert.deepEqual(ops.map((o) => o.ator), ['local']);
    } finally {
      acervo.fechar();
    }
  } finally {
    limpar();
  }
});

test('material varrer imprime o resultado por Configuracao', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const entrada = join(raiz, 'entrada-contatos');
    mkdirSync(entrada, { recursive: true });
    writeFileSync(join(entrada, 'contatos.vcf'), VCARD_DE_DOIS);
    declararEntrada(raiz, inquilino, 'contatos', 'catalogo', entrada, 'completo');

    const r = rodar(raiz, ['material', 'varrer', '--inquilino', inquilino]);
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /contatos\/catalogo/);
    assert.match(r.saida, /1 processado/);
  } finally {
    limpar();
  }
});

test('material varrer sai com codigo 1 quando alguma Configuracao FALHOU', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    declararEntrada(raiz, inquilino, 'contatos', 'google-a', join(raiz, 'nao-existe'), 'completo');
    const r = rodar(raiz, ['material', 'varrer', '--inquilino', inquilino]);
    // Quem agenda isto le o codigo de saida, e nao a mensagem. "Nada a fazer"
    // e "o caminho sumiu" tem de ser distinguiveis sem parsear texto.
    assert.equal(r.codigo, 1, r.saida);
  } finally {
    limpar();
  }
});

test('recusa NAO sai 1 — material errado na pasta e estado normal', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const entrada = join(raiz, 'entrada-contatos');
    mkdirSync(entrada, { recursive: true });
    writeFileSync(join(entrada, 'vazio.vcf'), '');
    declararEntrada(raiz, inquilino, 'contatos', 'catalogo', entrada, 'completo');
    const r = rodar(raiz, ['material', 'varrer', '--inquilino', inquilino]);
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /1 recusado/);
  } finally {
    limpar();
  }
});

test('varredura sem Configuracao vigiada sai 0 — nada a fazer nao e erro', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const r = rodar(raiz, ['material', 'varrer', '--inquilino', inquilino]);
    assert.equal(r.codigo, 0, r.saida);
  } finally {
    limpar();
  }
});

test('varredura de material COMPLETO marca o que sumiu', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const entrada = join(raiz, 'entrada-contatos');
    mkdirSync(entrada, { recursive: true });
    declararEntrada(raiz, inquilino, 'contatos', 'catalogo', entrada, 'completo');

    writeFileSync(join(entrada, 'c1.vcf'), VCARD_DE_SEIS);
    varrerCom(raiz, inquilino);

    // O segundo traz cinco dos seis: um sumiu. 17%, abaixo do limite de 20% —
    // a guarda nao dispara, e e ela que este caso NAO mede.
    writeFileSync(join(entrada, 'c2.vcf'), VCARD_DE_CINCO);
    const r = varrerCom(raiz, inquilino);
    assert.equal(r.configuracoes[0]?.ausentesMarcados, 1, (r.configuracoes[0]?.motivos ?? []).join('; '));
  } finally {
    limpar();
  }
});

test('varredura de material PARCIAL nunca marca', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const entrada = join(raiz, 'entrada-contatos');
    mkdirSync(entrada, { recursive: true });
    declararEntrada(raiz, inquilino, 'contatos', 'catalogo', entrada, 'parcial');

    writeFileSync(join(entrada, 'c1.vcf'), VCARD_DE_SEIS);
    varrerCom(raiz, inquilino);
    writeFileSync(join(entrada, 'c2.vcf'), VCARD_DE_CINCO);
    const r = varrerCom(raiz, inquilino);
    // Ler ausência como remoção num material parcial marcaria dado bom como
    // sumido, em silêncio. A Natureza vive na Pasta de Entrada, e é ela que
    // decide se ausência significa alguma coisa.
    assert.equal(r.configuracoes[0]?.ausentesMarcados, 0);
  } finally {
    limpar();
  }
});

test('DOIS materiais na mesma passada compartilham o instante — e nenhum marca o outro', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const entrada = join(raiz, 'entrada-contatos');
    mkdirSync(entrada, { recursive: true });
    declararEntrada(raiz, inquilino, 'contatos', 'catalogo', entrada, 'completo');

    // A passada traz dois arquivos, cada um com parte dos cartões. Se a
    // marcação rodasse POR MATERIAL, o primeiro marcaria tudo o que só o
    // segundo traz — e o segundo desmarcaria, ou não, conforme a ordem.
    // A ORDEM IMPORTA, e por isso o maior vem PRIMEIRO: `candidatosEm` ordena
    // por nome, então `a.vcf` (seis cartões) entra antes de `b.vcf` (cinco).
    // Com instante POR MATERIAL, o cartão que só o primeiro traz ficaria com um
    // instante anterior ao do segundo, e a marcação o mataria.
    writeFileSync(join(entrada, 'a.vcf'), VCARD_DE_SEIS);
    writeFileSync(join(entrada, 'b.vcf'), VCARD_DE_CINCO);
    const INSTANTE = Date.parse('2026-09-10T00:00:00Z');
    const r = varrerCom(raiz, inquilino, INSTANTE);
    assert.equal(r.configuracoes[0]?.processados, 2);
    assert.equal(r.configuracoes[0]?.ausentesMarcados, 0, 'a passada é uma só');

    // A ASSERÇÃO QUE NÃO DEPENDE DE CORRIDA. Contar zero marcas basta enquanto
    // os dois relógios diferem — e dois `Date.now()` no mesmo milissegundo
    // fariam o teste passar com a implementação errada. O que não depende de
    // sorte é TODO cartão carregar o instante INJETADO da passada.
    const acervo = abrirAcervoSomenteLeitura(join(raiz, 'acervos'), inquilino);
    try {
      const instantes = (
        acervo.db
          .prepare('SELECT DISTINCT ultimo_avistamento FROM cartoes_de_catalogo')
          .all() as Array<{ ultimo_avistamento: string }>
      ).map((l) => l.ultimo_avistamento);
      assert.deepEqual(instantes, [new Date(INSTANTE).toISOString()]);
    } finally {
      acervo.fechar();
    }
  } finally {
    limpar();
  }
});
