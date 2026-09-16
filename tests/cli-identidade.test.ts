import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { executar } from '../src/cli/index.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';

function rodar(raiz: string, argumentos: string[]): { codigo: number; saida: string } {
  const linhas: string[] = [];
  const codigo = executar(argumentos, { dados: raiz, estado: raiz, escrever: (texto: string) => linhas.push(texto) });
  return { codigo, saida: linhas.join('\n') };
}

/** Instalação com um Inquilino e dois Identificadores soltos no Acervo. */
function cenarioDeCli(raiz: string): { inquilino: string; noWhats: string; noInsta: string } {
  const chave = /valor:\s*(\S+)/.exec(rodar(raiz, ['operador', 'chave', 'criar']).saida)?.[1];
  assert.ok(chave);
  const criacao = rodar(raiz, ['inquilino', 'criar', '--chave', chave, '--titular', 'Leia Organa']);
  const inquilino = /id:\s*(\S+)/.exec(criacao.saida)?.[1];
  assert.ok(inquilino);

  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
  const { id: noWhats } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000001' });
  const { id: noInsta } = registrarIdentificador(acervo, { fonte: 'instagram', valor: 'conversa:42' });
  acervo.fechar();
  return { inquilino, noWhats, noInsta };
}

test('vincular pela CLI cria a Pessoa e o vínculo nasce com procedência humana', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, noWhats } = cenarioDeCli(raiz);

    const r = rodar(raiz, [
      'pessoa',
      'vincular',
      '--inquilino',
      inquilino,
      '--identificador',
      noWhats,
      '--nome',
      'Han Solo',
    ]);

    assert.equal(r.codigo, 0);
    assert.match(r.saida, /humano/);
    const pessoa = /Pessoa:\s*(\S+)/.exec(r.saida)?.[1];
    assert.ok(pessoa);

    const vista = rodar(raiz, ['pessoa', 'ver', '--inquilino', inquilino, '--pessoa', pessoa]);
    assert.match(vista.saida, /Han Solo/);
    assert.match(vista.saida, /5565900000001/);
  } finally {
    limpar();
  }
});

test('o conflito é APRESENTADO, com as duas Pessoas nomeadas e a saída de mesclar', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, noWhats, noInsta } = cenarioDeCli(raiz);

    const primeira = rodar(raiz, [
      'pessoa', 'vincular', '--inquilino', inquilino, '--identificador', noWhats, '--nome', 'Han',
    ]);
    const pessoaA = /Pessoa:\s*(\S+)/.exec(primeira.saida)?.[1];
    assert.ok(pessoaA);
    const segunda = rodar(raiz, [
      'pessoa', 'vincular', '--inquilino', inquilino, '--identificador', noInsta, '--nome', 'Han Solo',
    ]);
    const pessoaB = /Pessoa:\s*(\S+)/.exec(segunda.saida)?.[1];
    assert.ok(pessoaB);

    // Tentar pendurar o Identificador da B na A: conflito.
    const conflito = rodar(raiz, [
      'pessoa', 'vincular', '--inquilino', inquilino, '--identificador', noInsta, '--pessoa', pessoaA,
    ]);

    assert.notEqual(conflito.codigo, 0);
    assert.match(conflito.saida, /ja pertence a Pessoa/);
    assert.ok(conflito.saida.includes(pessoaB), 'a saída nomeia a Pessoa que já tem o endereço');
    assert.match(conflito.saida, /pessoa mesclar/, 'a saída diz qual é a operação certa');
  } finally {
    limpar();
  }
});

test('mesclar pela CLI junta as duas e a absorvida some da listagem', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, noWhats, noInsta } = cenarioDeCli(raiz);
    const pessoaA = /Pessoa:\s*(\S+)/.exec(
      rodar(raiz, ['pessoa', 'vincular', '--inquilino', inquilino, '--identificador', noWhats, '--nome', 'Han']).saida,
    )?.[1];
    const pessoaB = /Pessoa:\s*(\S+)/.exec(
      rodar(raiz, ['pessoa', 'vincular', '--inquilino', inquilino, '--identificador', noInsta, '--nome', 'Han Solo']).saida,
    )?.[1];
    assert.ok(pessoaA);
    assert.ok(pessoaB);

    const r = rodar(raiz, [
      'pessoa', 'mesclar', '--inquilino', inquilino,
      '--pessoa', pessoaA, '--pessoa', pessoaB, '--mestre', pessoaA,
    ]);
    assert.equal(r.codigo, 0);
    assert.match(r.saida, /regra de mestre: indicacao-explicita/);

    const lista = rodar(raiz, ['pessoa', 'listar', '--inquilino', inquilino]);
    assert.ok(lista.saida.includes(pessoaA));
    assert.ok(!lista.saida.includes(pessoaB), 'a absorvida sai da listagem viva');

    const comAbsorvidas = rodar(raiz, [
      'pessoa', 'listar', '--inquilino', inquilino, '--incluir-absorvidas',
    ]);
    assert.ok(comAbsorvidas.saida.includes(pessoaB));
  } finally {
    limpar();
  }
});

test('desvincular pela CLI mostra que a Pessoa continua e o que foi desfeito', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, noWhats } = cenarioDeCli(raiz);
    const pessoa = /Pessoa:\s*(\S+)/.exec(
      rodar(raiz, ['pessoa', 'vincular', '--inquilino', inquilino, '--identificador', noWhats, '--nome', 'Han']).saida,
    )?.[1];
    assert.ok(pessoa);

    const r = rodar(raiz, [
      'pessoa', 'desvincular', '--inquilino', inquilino, '--identificador', noWhats,
    ]);
    assert.equal(r.codigo, 0);

    const vista = rodar(raiz, ['pessoa', 'ver', '--inquilino', inquilino, '--pessoa', pessoa]);
    assert.match(vista.saida, /Han/, 'a Pessoa continua, com o nome que tinha');
    assert.match(vista.saida, /desfeito/i, 'e mostra o que foi desfeito');
    assert.match(vista.saida, /5565900000001/);
  } finally {
    limpar();
  }
});

test('a ajuda não diz sobrevivente, e anuncia desfazer e conferir', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const ajuda = rodar(raiz, ['--ajuda']).saida;
    // O glossário aprovado em 29/08/2026 lista "sobrevivente" como sinônimo a
    // evitar, e a regra do repo é que termo de domínio no código é o do glossário.
    assert.doesNotMatch(ajuda, /sobrevivente/i);
    assert.match(ajuda, /pessoa mesclar.*--pessoa <id> --pessoa <id>/);
    assert.match(ajuda, /pessoa desfazer-mesclagem/);
    assert.match(ajuda, /pessoa conferir/);
  } finally {
    limpar();
  }
});

test('a CLI desfaz uma mesclagem, e conferir diz que está íntegra', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, noWhats, noInsta } = cenarioDeCli(raiz);
    const pessoaA = /Pessoa:\s*(\S+)/.exec(
      rodar(raiz, ['pessoa', 'vincular', '--inquilino', inquilino, '--identificador', noWhats, '--nome', 'Han']).saida,
    )?.[1];
    const pessoaB = /Pessoa:\s*(\S+)/.exec(
      rodar(raiz, ['pessoa', 'vincular', '--inquilino', inquilino, '--identificador', noInsta, '--nome', 'Han Solo']).saida,
    )?.[1];
    assert.ok(pessoaA);
    assert.ok(pessoaB);

    const m = rodar(raiz, ['pessoa', 'mesclar', '--inquilino', inquilino, '--pessoa', pessoaA, '--pessoa', pessoaB]);
    assert.equal(m.codigo, 0);
    assert.match(m.saida, /regra de mestre: ordem-de-chamada/);

    const integra = rodar(raiz, ['pessoa', 'conferir', '--inquilino', inquilino]);
    assert.equal(integra.codigo, 0);
    assert.match(integra.saida, /integra/i);

    const d = rodar(raiz, ['pessoa', 'desfazer-mesclagem', '--inquilino', inquilino, '--pessoa', pessoaB]);
    assert.equal(d.codigo, 0);
    assert.match(d.saida, /desfeita/i);
    assert.match(d.saida, /nunca apaga/i);

    // As duas voltam a aparecer como Pessoas vivas.
    const lista = rodar(raiz, ['pessoa', 'listar', '--inquilino', inquilino]).saida;
    assert.ok(lista.includes(pessoaA) && lista.includes(pessoaB));
  } finally {
    limpar();
  }
});

test('pessoa propostas lista com o produtor e a evidência, e NÃO escreve', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    // `cenarioDeCli` ja registra o endereco de WhatsApp 5565900000001.
    const { inquilino } = cenarioDeCli(raiz);
    const arquivo = join(raiz, 'cat.vcf');
    writeFileSync(
      arquivo,
      ['BEGIN:VCARD', 'FN:Joana Prado', 'TEL:+55 65 90000-0001', 'END:VCARD'].join('\r\n'),
    );
    const antes = rodar(raiz, ['pessoa', 'listar', '--inquilino', inquilino]).saida;
    rodar(raiz, [
      'importar', '--configuracao', 'teste', '--inquilino', inquilino, '--fonte', 'contatos', '--material', arquivo,
    ]);

    const r = rodar(raiz, ['pessoa', 'propostas', '--inquilino', inquilino]);
    assert.equal(r.codigo, 0);
    assert.match(r.saida, /telefone/);

    // A prova do criterio 10: listar nao mexeu em nada.
    const depois = rodar(raiz, ['pessoa', 'listar', '--inquilino', inquilino]).saida;
    assert.equal(depois, antes);
  } finally {
    limpar();
  }
});

test('pessoa propostas --produtor filtra', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino } = cenarioDeCli(raiz);
    const arquivo = join(raiz, 'cat2.vcf');
    writeFileSync(
      arquivo,
      [
        'BEGIN:VCARD',
        'FN:Bruno Salles',
        'TEL:+55 11 90000-0001',
        'TEL:+55 11 90000-0002',
        'END:VCARD',
      ].join('\r\n'),
    );
    rodar(raiz, [
      'importar', '--configuracao', 'teste', '--inquilino', inquilino, '--fonte', 'contatos', '--material', arquivo,
    ]);
    const r = rodar(raiz, [
      'pessoa', 'propostas', '--inquilino', inquilino, '--produtor', 'multiplos-enderecos',
    ]);
    assert.equal(r.codigo, 0);
    assert.match(r.saida, /2 enderecos no mesmo contato/);
  } finally {
    limpar();
  }
});

test('pessoa propostas --produtor desconhecido recusa e diz quais existem', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino } = cenarioDeCli(raiz);
    const r = rodar(raiz, ['pessoa', 'propostas', '--inquilino', inquilino, '--produtor', 'chute']);
    assert.notEqual(r.codigo, 0);
    assert.match(r.saida, /telefone/);
  } finally {
    limpar();
  }
});

test('propostas aplicar sem --com-efeito é ensaio: não escreve', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino } = cenarioDeCli(raiz);
    const arquivo = join(raiz, 'cat3.vcf');
    writeFileSync(
      arquivo,
      ['BEGIN:VCARD', 'FN:Joana Prado', 'TEL:+55 65 90000-0001', 'END:VCARD'].join('\r\n'),
    );
    rodar(raiz, [
      'importar', '--configuracao', 'teste', '--inquilino', inquilino, '--fonte', 'contatos', '--material', arquivo,
    ]);
    const antes = rodar(raiz, ['pessoa', 'listar', '--inquilino', inquilino]).saida;

    const r = rodar(raiz, ['pessoa', 'propostas', 'aplicar', '--inquilino', inquilino]);
    assert.equal(r.codigo, 0);
    assert.match(r.saida, /ensaio/i);
    assert.equal(rodar(raiz, ['pessoa', 'listar', '--inquilino', inquilino]).saida, antes);
  } finally {
    limpar();
  }
});

test('propostas aplicar --com-efeito --confirmo cria a Pessoa e o vínculo', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino } = cenarioDeCli(raiz);
    const arquivo = join(raiz, 'cat4.vcf');
    writeFileSync(
      arquivo,
      ['BEGIN:VCARD', 'FN:Joana Prado', 'TEL:+55 65 90000-0001', 'END:VCARD'].join('\r\n'),
    );
    rodar(raiz, [
      'importar', '--configuracao', 'teste', '--inquilino', inquilino, '--fonte', 'contatos', '--material', arquivo,
    ]);

    const r = rodar(raiz, [
      'pessoa', 'propostas', 'aplicar', '--inquilino', inquilino, '--com-efeito', '--confirmo',
    ]);
    assert.equal(r.codigo, 0);
    assert.match(r.saida, /1 vinculo|2 vinculos/);
    // A Pessoa nasceu com os DOIS enderecos e ja se chama pelo nome do
    // catalogo — que e o ponto do ciclo inteiro.
    const listagem = rodar(raiz, ['pessoa', 'listar', '--inquilino', inquilino]).saida;
    assert.match(listagem, /Joana Prado/);
    assert.match(listagem, /2 endereco/);
    assert.match(
      rodar(raiz, ['pessoa', 'propostas', '--inquilino', inquilino]).saida,
      /^0 proposta/m,
    );
  } finally {
    limpar();
  }
});

test('propostas aplicar --json devolve a lista do que foi feito — critério 20', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino } = cenarioDeCli(raiz);
    const arquivo = join(raiz, 'cat5.vcf');
    writeFileSync(
      arquivo,
      ['BEGIN:VCARD', 'FN:Joana Prado', 'TEL:+55 65 90000-0001', 'END:VCARD'].join('\r\n'),
    );
    rodar(raiz, [
      'importar', '--configuracao', 'teste', '--inquilino', inquilino, '--fonte', 'contatos', '--material', arquivo,
    ]);
    const r = rodar(raiz, [
      'pessoa', 'propostas', 'aplicar', '--inquilino', inquilino,
      '--com-efeito', '--confirmo', '--json',
    ]);
    assert.equal(r.codigo, 0);
    const bloco = r.saida.slice(r.saida.indexOf('{'));
    const relatorio = JSON.parse(bloco) as {
      feito: Array<{ vinculos: Array<{ identificadorId: string; pessoaId: string }> }>;
    };
    // A lista tem o PAR de cada vinculo, que e o que desfazer consome.
    assert.ok(relatorio.feito.length >= 1);
    assert.ok(relatorio.feito[0]?.vinculos[0]?.identificadorId);
    assert.ok(relatorio.feito[0]?.vinculos[0]?.pessoaId);
  } finally {
    limpar();
  }
});

test('propostas aplicar --com-efeito sem --confirmo recusa', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino } = cenarioDeCli(raiz);
    const r = rodar(raiz, [
      'pessoa', 'propostas', 'aplicar', '--inquilino', inquilino, '--com-efeito',
    ]);
    assert.notEqual(r.codigo, 0);
    assert.match(r.saida, /--confirmo/);
  } finally {
    limpar();
  }
});

test('o produto responde consulta útil com o catálogo desligado', () => {
  // Criterio 23: nenhuma operacao existente passa a exigir catalogo.
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, noWhats } = cenarioDeCli(raiz);
    // Acervo SEM nenhum material de catalogo importado.
    assert.equal(rodar(raiz, ['conversas', '--inquilino', inquilino]).codigo, 0);
    assert.equal(rodar(raiz, ['pessoa', 'listar', '--inquilino', inquilino]).codigo, 0);
    assert.equal(rodar(raiz, ['acervo', 'relatar', '--inquilino', inquilino]).codigo, 0);
    const props = rodar(raiz, ['pessoa', 'propostas', '--inquilino', inquilino]);
    assert.equal(props.codigo, 0);
    assert.match(props.saida, /^0 proposta/m);
    const v = rodar(raiz, [
      'pessoa', 'vincular', '--inquilino', inquilino, '--identificador', noWhats, '--nome', 'Leia',
    ]);
    assert.equal(v.codigo, 0);
  } finally {
    limpar();
  }
});

test('emitir imprime o valor UMA vez, e listar nunca o mostra', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const linhas: string[] = [];
    const escrever = (t: string) => linhas.push(t);
    executar(['operador', 'chave', 'criar'], { dados: raiz, estado: raiz, escrever });
    const chaveOp = linhas.join('\n').match(/valor: (\S+)/)?.[1] ?? '';
    linhas.length = 0;
    executar(['inquilino', 'criar', '--chave', chaveOp, '--titular', 'Ahsoka'], { dados: raiz, estado: raiz, escrever });
    const inq = linhas.join('\n').match(/id: (\S+)/)?.[1] ?? '';

    linhas.length = 0;
    const codigo = executar(
      ['acesso', 'chave', 'emitir', '--chave', chaveOp, '--inquilino', inq],
      { dados: raiz, estado: raiz, escrever },
    );
    assert.equal(codigo, 0);
    const emitido = linhas.join('\n').match(/valor: (\S+)/)?.[1];
    assert.ok(emitido !== undefined && emitido.length >= 32);

    linhas.length = 0;
    executar(['acesso', 'chave', 'listar', '--chave', chaveOp, '--inquilino', inq], {
      dados: raiz, estado: raiz,
      escrever,
    });
    assert.ok(!linhas.join('\n').includes(emitido), 'listar NUNCA mostra o valor');
  } finally {
    limpar();
  }
});

test('emitir Chave de Acesso exige Chave de Operador', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const linhas: string[] = [];
    const escrever = (t: string) => linhas.push(t);
    executar(['operador', 'chave', 'criar'], { dados: raiz, estado: raiz, escrever });
    const chaveOp = linhas.join('\n').match(/valor: (\S+)/)?.[1] ?? '';
    linhas.length = 0;
    executar(['inquilino', 'criar', '--chave', chaveOp, '--titular', 'Bail'], { dados: raiz, estado: raiz, escrever });
    const inq = linhas.join('\n').match(/id: (\S+)/)?.[1] ?? '';

    linhas.length = 0;
    // O modelo diz que Chave de Acesso e emitida POR Chave de Operador, nunca
    // por outra Chave de Acesso. Sem credencial, e ato administrativo negado.
    const codigo = executar(['acesso', 'chave', 'emitir', '--inquilino', inq], { dados: raiz, estado: raiz, escrever });
    assert.notEqual(codigo, 0);
    // `Recusado:` e a palavra da RECUSA, e nao do texto de ajuda. Medido em
    // 03/09/2026: com `/Chave de Operador/`, este teste passava ANTES de o
    // comando existir — comando desconhecido imprime a ajuda, e a ajuda cita
    // Chave de Operador. Assercao que casa com a ajuda nao mede autorizacao.
    assert.match(linhas.join('\n'), /Recusado: Chave de Operador ausente/);
    assert.doesNotMatch(linhas.join('\n'), /Comando desconhecido/);
  } finally {
    limpar();
  }
});
