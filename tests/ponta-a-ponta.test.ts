import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { materialInstagramFalso } from './ajuda/material-instagram-falso.js';
import { executar } from '../src/cli/index.js';

const EM_USO = '2021-06-15T10:00:00Z';

function rodar(raiz: string, argumentos: string[]): { codigo: number; saida: string } {
  const linhas: string[] = [];
  const codigo = executar(argumentos, { dados: raiz, estado: raiz, escrever: (t: string) => linhas.push(t) });
  return { codigo, saida: linhas.join('\n') };
}

/** Instalação com Chave, Inquilino e Destino já apontados. */
function instalacaoPronta(raiz: string): { chave: string; inquilino: string } {
  const criada = rodar(raiz, ['operador', 'chave', 'criar']);
  const chave = /valor:\s*(\S+)/.exec(criada.saida)?.[1] ?? '';
  const novo = rodar(raiz, ['inquilino', 'criar', '--titular', 'Leia Organa', '--chave', chave]);
  const inquilino = /id:\s*(\S+)/.exec(novo.saida)?.[1] ?? '';
  rodar(raiz, [
    'inquilino', 'destino', '--inquilino', inquilino,
    '--endereco', join(raiz, 'midia'), '--chave', chave,
  ]);
  return { chave, inquilino };
}

test('ponta a ponta: material entra pela CLI e sai pela consulta', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: '5511900000001@s.whatsapp.net', nome: 'Leia', tipoDeSessao: 0 }],
    mensagens: [
      { stanzaId: 'm1', chatSessionPk: 1, texto: 'relatorio de bordo', dataCoreData: paraCoreData(EM_USO) },
      { stanzaId: 'm2', chatSessionPk: 1, texto: 'mando hoje', dataCoreData: paraCoreData(EM_USO) },
    ],
  });
  try {
    const { inquilino } = instalacaoPronta(raiz);

    const importacao = rodar(raiz, [
      'importar', '--configuracao', 'teste', '--inquilino', inquilino, '--fonte', 'whatsapp', '--material', b.raiz,
    ]);
    assert.equal(importacao.codigo, 0, importacao.saida);
    assert.match(importacao.saida, /2 mensagens/);

    const conversas = rodar(raiz, ['conversas', '--inquilino', inquilino]);
    assert.equal(conversas.codigo, 0);
    assert.match(conversas.saida, /direta/);

    const busca = rodar(raiz, ['buscar', '--inquilino', inquilino, '--texto', 'relatorio', '--json']);
    assert.equal(busca.codigo, 0);
    const achadas = JSON.parse(busca.saida) as Array<{ conteudo: string }>;
    assert.equal(achadas.length, 1);
    assert.match(achadas[0]?.conteudo ?? '', /relatorio/);
  } finally {
    b.limpar();
    limpar();
  }
});

test('comando de Titular NÃO exige Chave de Operador', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'x@s.whatsapp.net', nome: null, tipoDeSessao: 0 }],
    mensagens: [{ stanzaId: 'm1', chatSessionPk: 1, texto: 'oi', dataCoreData: paraCoreData(EM_USO) }],
  });
  try {
    const { inquilino } = instalacaoPronta(raiz);
    // Existe Chave no Registro, e mesmo assim importar e consultar rodam sem
    // apresentar nenhuma: até o ciclo 6 não há rede, e o acesso à máquina é a
    // raiz de confiança para operar o próprio Acervo.
    assert.equal(
      rodar(raiz, ['importar', '--configuracao', 'teste', '--inquilino', inquilino, '--fonte', 'whatsapp', '--material', b.raiz]).codigo,
      0,
    );
    assert.equal(rodar(raiz, ['conversas', '--inquilino', inquilino]).codigo, 0);
  } finally {
    b.limpar();
    limpar();
  }
});

test('importar para Inquilino inexistente é recusado antes de abrir Acervo', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const b = backupFalso({ conversas: [], mensagens: [] });
  try {
    instalacaoPronta(raiz);
    const r = rodar(raiz, [
      'importar', '--configuracao', 'teste', '--inquilino', 'nao-existe', '--fonte', 'whatsapp', '--material', b.raiz,
    ]);
    assert.notEqual(r.codigo, 0);
    assert.match(r.saida, /Inquilino desconhecido/);
  } finally {
    b.limpar();
    limpar();
  }
});

test('o relatório da CLI declara as rejeições por motivo, nunca em silêncio', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'x@s.whatsapp.net', nome: null, tipoDeSessao: 0 }],
    mensagens: [
      { stanzaId: 'boa', chatSessionPk: 1, texto: 'com data', dataCoreData: paraCoreData(EM_USO) },
      { stanzaId: 'ruim', chatSessionPk: 1, texto: 'sem data', dataCoreData: null },
    ],
  });
  try {
    const { inquilino } = instalacaoPronta(raiz);
    const r = rodar(raiz, [
      'importar', '--configuracao', 'teste', '--inquilino', inquilino, '--fonte', 'whatsapp', '--material', b.raiz,
    ]);
    assert.equal(r.codigo, 0);
    assert.match(r.saida, /1 rejeitada/);
    assert.match(r.saida, /instante/, 'o motivo tem de aparecer, não só a contagem');
  } finally {
    b.limpar();
    limpar();
  }
});

test('a ajuda cita os comandos de Titular, e eles existem', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const ajuda = rodar(raiz, ['--ajuda']);
    for (const comando of ['importar', 'conversas', 'buscar']) {
      assert.match(ajuda.saida, new RegExp(`malote ${comando}`), `ajuda nao cita ${comando}`);
    }
    // Assertar contra o MUNDO: comando citado na ajuda que não existe é a
    // suíte defendendo uma promessa falsa.
    const { inquilino } = instalacaoPronta(raiz);
    assert.equal(rodar(raiz, ['conversas', '--inquilino', inquilino]).codigo, 0);
    assert.equal(rodar(raiz, ['buscar', '--inquilino', inquilino, '--texto', 'x']).codigo, 0);
  } finally {
    limpar();
  }
});

test('a CLI despacha por Fonte e exige --titular no Instagram', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const i = materialInstagramFalso([
    {
      slug: 'joanaprado',
      numero: '111111111111111',
      title: 'Joana Prado',
      participants: ['Joana Prado', 'Leia Organa'],
      messages: [{ sender_name: 'Joana Prado', timestamp_ms: 1_700_000_000_000, content: 'oi' }],
    },
  ]);
  try {
    const { inquilino } = instalacaoPronta(raiz);

    const semTitular = rodar(raiz, [
      'importar', '--configuracao', 'teste', '--inquilino', inquilino, '--fonte', 'instagram', '--material', i.raiz,
    ]);
    assert.notEqual(semTitular.codigo, 0);
    // Assertar o SUCESSO do ramo, não só que houve erro: sem esta linha, um
    // defeito qualquer passaria igual.
    assert.ok(semTitular.saida.includes('--titular'), semTitular.saida);

    const comTitular = rodar(raiz, [
      'importar', '--configuracao', 'teste', '--inquilino', inquilino, '--fonte', 'instagram',
      '--material', i.raiz, '--titular', 'Leia Organa',
    ]);
    assert.equal(comTitular.codigo, 0, comTitular.saida);
    assert.ok(comTitular.saida.includes('Importacao concluida.'));
  } finally {
    i.limpar();
    limpar();
  }
});

test('as duas Fontes convivem no mesmo Acervo e na mesma consulta', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: '5511900000001@s.whatsapp.net', nome: 'Leia', tipoDeSessao: 0 }],
    mensagens: [
      { stanzaId: 'm1', chatSessionPk: 1, texto: 'veio do whatsapp', dataCoreData: paraCoreData(EM_USO) },
    ],
  });
  const i = materialInstagramFalso([
    {
      slug: 'joanaprado',
      numero: '111111111111111',
      title: 'Joana Prado',
      participants: ['Joana Prado', 'Leia Organa'],
      messages: [
        { sender_name: 'Joana Prado', timestamp_ms: 1_700_000_000_000, content: 'veio do instagram' },
      ],
    },
  ]);
  try {
    const { inquilino } = instalacaoPronta(raiz);

    const dw = rodar(raiz, ['importar', '--configuracao', 'teste', '--inquilino', inquilino, '--fonte', 'whatsapp', '--material', b.raiz]);
    assert.equal(dw.codigo, 0, dw.saida);
    const di = rodar(raiz, [
      'importar', '--configuracao', 'teste', '--inquilino', inquilino, '--fonte', 'instagram',
      '--material', i.raiz, '--titular', 'Leia Organa',
    ]);
    assert.equal(di.codigo, 0, di.saida);

    // Uma consulta só, sem dizer de que Fonte.
    const lista = rodar(raiz, ['conversas', '--inquilino', inquilino, '--json']);
    assert.equal(lista.codigo, 0, lista.saida);
    const conversas = JSON.parse(lista.saida) as { fonte: string }[];
    assert.deepEqual(
      [...new Set(conversas.map((c) => c.fonte))].sort(),
      ['instagram', 'whatsapp'],
      'um Acervo, não dois',
    );

    // E o conteúdo das duas atravessa a mesma busca.
    const doInsta = rodar(raiz, ['buscar', '--inquilino', inquilino, '--texto', 'instagram', '--json']);
    assert.equal((JSON.parse(doInsta.saida) as unknown[]).length, 1);
    const doWhats = rodar(raiz, ['buscar', '--inquilino', inquilino, '--texto', 'whatsapp', '--json']);
    assert.equal((JSON.parse(doWhats.saida) as unknown[]).length, 1);
  } finally {
    b.limpar();
    i.limpar();
    limpar();
  }
});
