import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import {
  instalacaoComChave,
  instalacaoComInquilino,
  instalacaoTemporaria,
  rodar,
} from './ajuda/instalacao.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import Database from 'better-sqlite3';

test('criar Inquilino antes de existir Chave de Operador é recusado com instrução', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const r = rodar(raiz, ['inquilino', 'criar', '--titular', 'Leia Organa']);
    assert.notEqual(r.codigo, 0);
    assert.match(r.saida, /nenhuma Chave de Operador/);
    assert.match(r.saida, /operador chave criar/, 'a mensagem tem de dizer o que fazer');
  } finally {
    limpar();
  }
});

test('o comando citado pela mensagem de recusa existe de fato na CLI', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const r = rodar(raiz, ['inquilino', 'criar', '--titular', 'Leia Organa']);
    const citado = /`?malote (operador chave criar)`?/.exec(r.saida)?.[1];
    assert.ok(citado, 'a mensagem precisa citar um comando');

    // Assertar contra o MUNDO, não contra a string: mensagem que manda rodar
    // comando inexistente é a suíte defendendo uma promessa falsa.
    const executado = rodar(raiz, citado.split(' '));
    assert.equal(executado.codigo, 0, `o comando citado (${citado}) precisa existir e rodar`);
  } finally {
    limpar();
  }
});

test('fluxo de bootstrap: cria Chave, cria Inquilino com ela, aponta Destino', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const chave = rodar(raiz, ['operador', 'chave', 'criar']);
    assert.equal(chave.codigo, 0);
    const valor = /valor:\s*(\S+)/.exec(chave.saida)?.[1];
    assert.ok(valor, 'a criação tem de imprimir o valor uma vez');

    const semChave = rodar(raiz, ['inquilino', 'criar', '--titular', 'Leia Organa']);
    assert.notEqual(semChave.codigo, 0);
    assert.match(semChave.saida, /Chave de Operador ausente/);

    const comChave = rodar(raiz, [
      'inquilino',
      'criar',
      '--titular',
      'Leia Organa',
      '--chave',
      valor,
    ]);
    assert.equal(comChave.codigo, 0);
    const inquilinoId = /id:\s*(\S+)/.exec(comChave.saida)?.[1];
    assert.ok(inquilinoId);

    const destino = rodar(raiz, [
      'inquilino',
      'destino',
      '--inquilino',
      inquilinoId,
      '--endereco',
      join(raiz, 'midia'),
      '--chave',
      valor,
    ]);
    assert.equal(destino.codigo, 0);

    const lista = rodar(raiz, ['inquilino', 'listar', '--chave', valor]);
    assert.equal(lista.codigo, 0);
    assert.match(lista.saida, /Leia Organa/);
  } finally {
    limpar();
  }
});

test('a saída estruturada devolve JSON válido', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const chave = rodar(raiz, ['operador', 'chave', 'criar']);
    const valor = /valor:\s*(\S+)/.exec(chave.saida)?.[1] ?? '';
    rodar(raiz, ['inquilino', 'criar', '--titular', 'Leia Organa', '--chave', valor]);

    const r = rodar(raiz, ['inquilino', 'listar', '--chave', valor, '--json']);
    const dados = JSON.parse(r.saida) as Array<{ titularNome: string }>;
    assert.equal(dados.length, 1);
    assert.equal(dados[0]?.titularNome, 'Leia Organa');
  } finally {
    limpar();
  }
});

test('o valor da Chave nunca aparece na saída de listagem', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const chave = rodar(raiz, ['operador', 'chave', 'criar']);
    const valor = /valor:\s*(\S+)/.exec(chave.saida)?.[1] ?? '';

    const lista = rodar(raiz, ['operador', 'chave', 'listar', '--chave', valor]);
    assert.equal(lista.codigo, 0);
    assert.ok(!lista.saida.includes(valor), 'listar vazou o valor da Chave');
  } finally {
    limpar();
  }
});

test('a importacao declara a conta, e configuracao listar a mostra', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'a@s.whatsapp.net', nome: 'Ana', tipoDeSessao: 0 }],
    mensagens: [
      {
        stanzaId: 'a1',
        chatSessionPk: 1,
        texto: 'um',
        dataCoreData: paraCoreData('2026-01-10T12:00:00.000Z'),
      },
    ],
    contas: [
      {
        dominio: 'AppDomainGroup-group.net.whatsapp.WhatsAppSMB.shared',
        conversas: [{ pk: 1, endereco: 'b@s.whatsapp.net', nome: 'Bea', tipoDeSessao: 0 }],
        mensagens: [
          {
            stanzaId: 'b1',
            chatSessionPk: 1,
            texto: 'dois',
            dataCoreData: paraCoreData('2026-01-11T12:00:00.000Z'),
          },
        ],
      },
    ],
  });
  try {
    const chave = /valor: (\S+)/.exec(rodar(raiz, ['operador', 'chave', 'criar']).saida)?.[1];
    assert.ok(chave);
    const inquilino = /id: (\S+)/.exec(
      rodar(raiz, ['inquilino', 'criar', '--chave', chave, '--titular', 'Leia Organa']).saida,
    )?.[1];
    assert.ok(inquilino);

    const imp = rodar(raiz, [
      'importar', '--configuracao', 'teste', '--inquilino', inquilino, '--fonte', 'whatsapp',
      '--material', b.raiz, '--conta', 'business',
    ]);
    assert.equal(imp.codigo, 0);
    assert.match(imp.saida, /conversas novas,.*ja existentes/, 'a saída separa novas de existentes');

    const lista = rodar(raiz, ['configuracao', 'listar', '--inquilino', inquilino]);
    assert.equal(lista.codigo, 0);
    // Asserção que só passa se o comando RODOU: texto que a mensagem de erro
    // genérica jamais produziria. Casar com /configuracao/ passaria verde
    // contra "Comando desconhecido".
    assert.match(lista.saida, /whatsapp\/teste\s+conta: business/);
  } finally {
    b.limpar();
    limpar();
  }
});

test('trazer sem Destino configurado recusa, e a mensagem diz o que fazer', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const chave = /valor: (\S+)/.exec(rodar(raiz, ['operador', 'chave', 'criar']).saida)?.[1];
    assert.ok(chave);
    const inq = /id: (\S+)/.exec(
      rodar(raiz, ['inquilino', 'criar', '--chave', chave, '--titular', 'Leia Organa']).saida,
    )?.[1];
    assert.ok(inq);

    const r = rodar(raiz, ['midia', 'trazer', '--inquilino', inq, '--material', '/tmp/qualquer']);
    assert.notEqual(r.codigo, 0);
    assert.match(r.saida, /Destino de Midia nao configurado/);
    // Asserção contra o MUNDO: o comando citado precisa existir de verdade.
    assert.match(r.saida, /malote inquilino destino/, 'a mensagem cita o comando que resolve');
  } finally {
    limpar();
  }
});

test('operador espaco lista Inquilino sem Acervo como zero, sem estourar', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'a@s.whatsapp.net', nome: 'Ana', tipoDeSessao: 0 }],
    mensagens: [
      {
        stanzaId: 'a1',
        chatSessionPk: 1,
        texto: 'oi',
        dataCoreData: paraCoreData('2026-01-10T12:00:00.000Z'),
      },
    ],
  });
  try {
    const chave = /valor: (\S+)/.exec(rodar(raiz, ['operador', 'chave', 'criar']).saida)?.[1];
    assert.ok(chave);
    const comAcervo = /id: (\S+)/.exec(
      rodar(raiz, ['inquilino', 'criar', '--chave', chave, '--titular', 'Leia']).saida,
    )?.[1];
    assert.ok(comAcervo);
    // Este NUNCA importa: nao tem arquivo de Acervo, e o readonly do SQLite
    // lanca SQLITE_CANTOPEN. Reportar zero e a resposta certa.
    const semAcervo = /id: (\S+)/.exec(
      rodar(raiz, ['inquilino', 'criar', '--chave', chave, '--titular', 'Han']).saida,
    )?.[1];
    assert.ok(semAcervo);
    rodar(raiz, ['importar', '--configuracao', 'teste', '--inquilino', comAcervo, '--fonte', 'whatsapp', '--material', b.raiz]);

    const r = rodar(raiz, ['operador', 'espaco', '--chave', chave]);
    assert.equal(r.codigo, 0, 'um Inquilino sem Acervo não pode derrubar o consolidado');
    assert.match(r.saida, new RegExp(comAcervo));
    assert.match(r.saida, new RegExp(semAcervo));
  } finally {
    b.limpar();
    limpar();
  }
});

test('Acervo de outra versao degrada a linha, e nao o consolidado inteiro', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'a@s.whatsapp.net', nome: 'Ana', tipoDeSessao: 0 }],
    mensagens: [
      {
        stanzaId: 'a1',
        chatSessionPk: 1,
        texto: 'oi',
        dataCoreData: paraCoreData('2026-01-10T12:00:00.000Z'),
      },
    ],
  });
  try {
    const chave = /valor: (\S+)/.exec(rodar(raiz, ['operador', 'chave', 'criar']).saida)?.[1];
    assert.ok(chave);
    const bom = /id: (\S+)/.exec(
      rodar(raiz, ['inquilino', 'criar', '--chave', chave, '--titular', 'Leia']).saida,
    )?.[1];
    const velho = /id: (\S+)/.exec(
      rodar(raiz, ['inquilino', 'criar', '--chave', chave, '--titular', 'Han']).saida,
    )?.[1];
    assert.ok(bom && velho);
    rodar(raiz, ['importar', '--configuracao', 'teste', '--inquilino', bom, '--fonte', 'whatsapp', '--material', b.raiz]);
    rodar(raiz, ['importar', '--configuracao', 'teste', '--inquilino', velho, '--fonte', 'whatsapp', '--material', b.raiz]);

    // Envelhece o Acervo de um deles por fora.
    const db = new Database(join(raiz, 'acervos', `${velho}.db`));
    db.prepare('UPDATE versao_schema SET versao = 1').run();
    db.close();

    const r = rodar(raiz, ['operador', 'espaco', '--chave', chave]);
    assert.equal(r.codigo, 0, 'o consolidado inteiro NÃO pode cair por um Inquilino desatualizado');
    assert.match(r.saida, new RegExp(`${bom}\\s+\\d+ anexos`), 'o Inquilino bom continua reportado');
    assert.match(r.saida, /Acervo de outra versao/, 'e o desatualizado aparece nomeado');
  } finally {
    b.limpar();
    limpar();
  }
});

test('acervo relatar em Inquilino sem Acervo diz que está vazio, e não estoura', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const chave = /valor: (\S+)/.exec(rodar(raiz, ['operador', 'chave', 'criar']).saida)?.[1];
    assert.ok(chave);
    const inq = /id: (\S+)/.exec(
      rodar(raiz, ['inquilino', 'criar', '--chave', chave, '--titular', 'Leia']).saida,
    )?.[1];
    assert.ok(inq);

    const r = rodar(raiz, ['acervo', 'relatar', '--inquilino', inq]);
    assert.equal(r.codigo, 0, 'Inquilino sem material não é erro');
    assert.match(r.saida, /Acervo vazio/);
    // Asserção contra o defeito real: o erro cru do driver não pode vazar.
    assert.doesNotMatch(r.saida, /Cannot open database/);
  } finally {
    limpar();
  }
});

test('retencao definir devolve a projeção e não descarta nada', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const r = rodar(raiz, ['retencao', 'definir', '--inquilino', inquilino, '--tipos', 'video']);
    assert.equal(r.codigo, 0);
    assert.match(r.saida, /nada foi descartado/i);
  } finally {
    limpar();
  }
});

test('retencao definir sem critério algum recusa e instrui', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const r = rodar(raiz, ['retencao', 'definir', '--inquilino', inquilino]);
    assert.equal(r.codigo, 1);
    assert.match(r.saida, /pelo menos um criterio/i);
    assert.match(r.saida, /--mais-velho-que-dias/);
  } finally {
    limpar();
  }
});

test('retencao aplicar sem --com-efeito anuncia ensaio', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    rodar(raiz, ['retencao', 'definir', '--inquilino', inquilino, '--tipos', 'video']);
    const r = rodar(raiz, ['retencao', 'aplicar', '--inquilino', inquilino]);
    assert.equal(r.codigo, 0);
    assert.match(r.saida, /ensaio/i);
    assert.match(r.saida, /--com-efeito/);
  } finally {
    limpar();
  }
});

test('retencao aplicar --com-efeito exige --confirmo e sai 2 sem ela', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, chave } = instalacaoComChave(raiz);
    rodar(raiz, ['inquilino', 'destino', '--chave', chave, '--inquilino', inquilino,
      '--endereco', join(raiz, 'midia')]);
    rodar(raiz, ['retencao', 'definir', '--inquilino', inquilino, '--tipos', 'video']);
    const r = rodar(raiz, ['retencao', 'aplicar', '--inquilino', inquilino, '--com-efeito']);
    assert.equal(r.codigo, 2);
    assert.match(r.saida, /DEFINITIVO/);
  } finally {
    limpar();
  }
});

test('retencao ver com --com-efeito NÃO descarta: a bandeira só vale em aplicar', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    rodar(raiz, ['retencao', 'definir', '--inquilino', inquilino, '--tipos', 'video']);
    const r = rodar(raiz, ['retencao', 'ver', '--inquilino', inquilino, '--com-efeito', '--confirmo']);
    assert.equal(r.codigo, 0);
    // Comando de leitura capaz de destruir é a classe de erro que esta guarda mata.
    assert.doesNotMatch(r.saida, /Descartados:/);
  } finally {
    limpar();
  }
});

test('retencao aplicar sem Política definida instrui, em vez de estourar', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const r = rodar(raiz, ['retencao', 'aplicar', '--inquilino', inquilino]);
    assert.equal(r.codigo, 1);
    assert.match(r.saida, /retencao definir/);
    assert.doesNotMatch(r.saida, /Cannot open database/);
  } finally {
    limpar();
  }
});

test('importar --fonte contatos lê o vCard e relata', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const inquilino = instalacaoComInquilino(raiz);
  const arquivo = join(raiz, 'catalogo.vcf');
  writeFileSync(
    arquivo,
    ['BEGIN:VCARD', 'FN:Joana Prado', 'TEL:+55 (11) 91234-5678', 'END:VCARD'].join('\r\n'),
  );
  const r = rodar(raiz, [
    'importar', '--configuracao', 'teste', '--inquilino', inquilino, '--fonte', 'contatos', '--material', arquivo,
  ]);
  assert.equal(r.codigo, 0);
  assert.match(r.saida, /1 cartoes lidos/);
  assert.match(r.saida, /1 identificadores novos/);
  limpar();
});

test('importar --fonte contatos NÃO exige --titular', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const inquilino = instalacaoComInquilino(raiz);
  const arquivo = join(raiz, 'vazio.vcf');
  writeFileSync(arquivo, ['BEGIN:VCARD', 'FN:Ninguem', 'END:VCARD'].join('\r\n'));
  const r = rodar(raiz, [
    'importar', '--configuracao', 'teste', '--inquilino', inquilino, '--fonte', 'contatos', '--material', arquivo,
  ]);
  assert.equal(r.codigo, 0);
  assert.doesNotMatch(r.saida, /titular/i);
  limpar();
});
