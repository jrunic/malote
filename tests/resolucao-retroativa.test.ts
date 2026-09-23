import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { instalacaoTemporaria, instalacaoComChave, rodar } from './ajuda/instalacao.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { join } from 'node:path';
import { contarTudo } from './ajuda/reconciliacao.js';
import {
  TABELAS_QUE_APONTAM_PARA_IDENTIFICADOR,
  resolverRetroativamente,
} from '../src/nucleo/resolucao-retroativa.js';
import {
  registrarIdentificador,
  registrarConversa,
  registrarMensagem,
  registrarTransicao,
  registrarParticipacao,
  registrarCartaoDeCatalogo,
} from '../src/nucleo/escrita.js';
import { criarPessoa, vincularIdentificador, lerVinculo } from '../src/nucleo/identidade.js';
import {
  conferirTransicoesEmDuasFormas,
  conferirTransicoesRepetidas,
} from '../src/nucleo/integridade.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { CFG_CONTATOS, CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = 1_756_000_000_000;

test('o inventario de tabelas que apontam para Identificador esta completo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular de Teste');
    // Pergunta ao BANCO, nao a uma lista escrita a mao: e o que fica vermelho
    // quando alguem acrescentar tabela sem tratar aqui.
    const tabelas = acervo.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const apontam = new Set<string>();
    for (const { name } of tabelas) {
      const fks = acervo.db.prepare(`PRAGMA foreign_key_list("${name}")`).all() as Array<{
        table: string;
      }>;
      if (fks.some((f) => f.table === 'identificadores')) apontam.add(name);
    }
    assert.deepEqual(
      [...apontam].sort(),
      [...TABELAS_QUE_APONTAM_PARA_IDENTIFICADOR].sort(),
      'tabela nova aponta para identificadores e nao foi tratada na resolucao retroativa',
    );
  } finally {
    c.limpar();
  }
});

test('mensagem gravada na forma alternativa passa a responder pela canonica', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular de Teste');
    // A ordem AQUI e a do defeito real: grava primeiro, aprende depois.
    const alt = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '111@alt' });
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'c1',
      coletiva: false, configuracao: CFG_WHATSAPP,
    });
    registrarMensagem(acervo, {
      direcao: 'recebida',
      conversaId: conversa,
      fonte: 'whatsapp',
      idExterno: 'm1',
      autorId: alt.id,
      ocorridaEm: AGORA - 1_000,
      agora: AGORA,
    });
    aprenderCorrespondencia(acervo, {
      fonte: 'whatsapp',
      alternativo: '111@alt',
      canonico: '111@canon',
    });

    const r = resolverRetroativamente(acervo, { comEfeito: true });

    assert.equal(r.paresReconciliados, 1);
    // registrarIdentificador e idempotente: chamado depois, devolve o que a
    // resolucao criou. E assim que o teste obtem o id canonico sem auxiliar novo.
    const canon = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '111@canon' });
    assert.equal(canon.criado, false, 'a resolucao nao criou o Identificador canonico');
    const autor = acervo.db
      .prepare('SELECT autor_id FROM mensagens WHERE fonte = ? AND id_externo = ?')
      .get('whatsapp', 'm1') as { autor_id: string };
    assert.equal(autor.autor_id, canon.id, 'a Mensagem continua no endereco antigo');
    // O alternativo PERMANECE: o produto nunca apaga Identificador.
    const sobrou = acervo.db
      .prepare('SELECT COUNT(*) AS n FROM identificadores WHERE valor = ?')
      .get('111@alt') as { n: number };
    assert.equal(sobrou.n, 1);
  } finally {
    c.limpar();
  }
});

test('as tres tabelas que colidem fundem na linha do canonico, e os detectores zeram', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular de Teste');
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'g1',
      coletiva: true,
    });
    const alt = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '222@alt' });
    const canon = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '222@canon' });
    // O MESMO evento, a MESMA Conversa e o MESMO cartao, nas duas formas.
    for (const quem of [alt.id, canon.id]) {
      registrarTransicao(acervo, {
        conversaId: conversa,
        identificadorId: quem,
        fonte: 'whatsapp',
        idExterno: 'ev1',
        natureza: 'entrou',
        codigoDaFonte: '27',
        ocorridaEm: AGORA - 5_000,
      });
      registrarParticipacao(acervo, {
        conversaId: conversa,
        identificadorId: quem,
        observadaEm: new Date(AGORA).toISOString(),
      });
      registrarCartaoDeCatalogo(
        acervo, quem, 'cartao-1', CFG_CONTATOS.id, new Date(AGORA).toISOString(),
      );
    }
    aprenderCorrespondencia(acervo, {
      fonte: 'whatsapp',
      alternativo: '222@alt',
      canonico: '222@canon',
    });

    // A fixture PRODUZ o defeito antes de medir a correcao. Detector que ja
    // estava em zero nao prova nada — e a licao de 01/09: verde por vacuidade.
    assert.equal(conferirTransicoesEmDuasFormas(acervo), 1, 'a fixture nao criou o defeito');

    resolverRetroativamente(acervo, { comEfeito: true });

    assert.equal(conferirTransicoesEmDuasFormas(acervo), 0);
    assert.equal(conferirTransicoesRepetidas(acervo), 0);
    for (const [tabela, onde, valor] of [
      ['transicoes_de_participacao', 'id_externo', 'ev1'],
      ['participacoes', 'conversa_id', conversa],
      ['cartoes_de_catalogo', 'cartao', 'cartao-1'],
    ] as const) {
      const linhas = acervo.db
        .prepare(`SELECT identificador_id FROM "${tabela}" WHERE "${onde}" = ?`)
        .all(valor) as Array<{ identificador_id: string }>;
      assert.equal(linhas.length, 1, `${tabela} ficou com mais de uma linha`);
      assert.equal(linhas[0]?.identificador_id, canon.id, `${tabela} ficou no alternativo`);
    }
  } finally {
    c.limpar();
  }
});

test('par cujas duas formas pertencem a Pessoas diferentes e PULADO e proposto', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular de Teste');
    const alt = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '333@alt' });
    const canon = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '333@canon' });
    // Procedencia HUMANA nos dois lados: e o caso que a regra protege.
    vincularIdentificador(acervo, {
      identificadorId: alt.id,
      pessoaId: criarPessoa(acervo),
      procedencia: 'humano',
    });
    vincularIdentificador(acervo, {
      identificadorId: canon.id,
      pessoaId: criarPessoa(acervo),
      procedencia: 'humano',
    });
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'c2',
      coletiva: false, configuracao: CFG_WHATSAPP,
    });
    registrarMensagem(acervo, {
      direcao: 'recebida',
      conversaId: conversa,
      fonte: 'whatsapp',
      idExterno: 'm2',
      autorId: alt.id,
      ocorridaEm: AGORA - 1_000,
      agora: AGORA,
    });
    aprenderCorrespondencia(acervo, {
      fonte: 'whatsapp',
      alternativo: '333@alt',
      canonico: '333@canon',
    });

    const r = resolverRetroativamente(acervo, { comEfeito: true });

    assert.equal(r.paresReconciliados, 0);
    assert.deepEqual(r.propostasDeMesclagem, [{ alternativo: '333@alt', canonico: '333@canon' }]);
    // A Mensagem NAO se moveu: mover trocaria a Pessoa dela sem mesclagem.
    const autor = acervo.db
      .prepare('SELECT autor_id FROM mensagens WHERE id_externo = ?')
      .get('m2') as { autor_id: string };
    assert.equal(autor.autor_id, alt.id);
  } finally {
    c.limpar();
  }
});

test('quando so o alternativo tem Pessoa, o vinculo MIGRA com a mesma procedencia', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular de Teste');
    const alt = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '444@alt' });
    const pessoa = criarPessoa(acervo);
    vincularIdentificador(acervo, {
      identificadorId: alt.id,
      pessoaId: pessoa,
      procedencia: 'humano',
    });
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'c3',
      coletiva: false, configuracao: CFG_WHATSAPP,
    });
    registrarMensagem(acervo, {
      direcao: 'recebida',
      conversaId: conversa,
      fonte: 'whatsapp',
      idExterno: 'm3',
      autorId: alt.id,
      ocorridaEm: AGORA - 1_000,
      agora: AGORA,
    });
    aprenderCorrespondencia(acervo, {
      fonte: 'whatsapp',
      alternativo: '444@alt',
      canonico: '444@canon',
    });

    const r = resolverRetroativamente(acervo, { comEfeito: true });

    assert.equal(r.vinculosMigrados, 1);
    const canon = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '444@canon' });
    const vinculo = lerVinculo(acervo, canon.id);
    assert.equal(vinculo?.pessoaId, pessoa, 'a afirmacao humana ficou orfa no alternativo');
    assert.equal(vinculo?.procedencia, 'humano', 'a procedencia foi rebaixada');
  } finally {
    c.limpar();
  }
});

test('resolver duas vezes nao produz segunda linha em tabela de dado nenhuma', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular de Teste');
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'g5',
      coletiva: true,
    });
    const alt = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '555@alt' });
    const canon = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '555@canon' });
    registrarMensagem(acervo, {
      direcao: 'recebida',
      conversaId: conversa,
      fonte: 'whatsapp',
      idExterno: 'm5',
      autorId: alt.id,
      ocorridaEm: AGORA - 1_000,
      agora: AGORA,
    });
    for (const quem of [alt.id, canon.id]) {
      registrarParticipacao(acervo, {
        conversaId: conversa,
        identificadorId: quem,
        observadaEm: new Date(AGORA).toISOString(),
      });
    }
    aprenderCorrespondencia(acervo, {
      fonte: 'whatsapp',
      alternativo: '555@alt',
      canonico: '555@canon',
    });

    const primeira = resolverRetroativamente(acervo, { comEfeito: true });
    assert.equal(primeira.paresReconciliados, 1, 'a primeira passagem nao fez nada');
    const contagens = contarTudo(acervo);

    const segunda = resolverRetroativamente(acervo, { comEfeito: true });

    assert.equal(segunda.paresReconciliados, 0, 'a segunda passagem achou trabalho');
    const depois = contarTudo(acervo);
    for (const [tabela, n] of Object.entries(contagens)) {
      // `operacoes` e `linhas_de_efeito` crescem de proposito: a segunda
      // passagem tambem e um ato, e a trilha registra ATOS, nao mudancas.
      if (tabela === 'operacoes' || tabela === 'linhas_de_efeito') continue;
      assert.equal(depois[tabela], n, `${tabela} mudou na segunda passagem`);
    }
  } finally {
    c.limpar();
  }
});

test('o comando ensaia por padrao e nao escreve nada', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, chave } = instalacaoComChave(raiz);
    const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'g7',
      coletiva: false, configuracao: CFG_WHATSAPP,
    });
    const alt = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '777@alt' });
    registrarMensagem(acervo, {
      direcao: 'recebida',
      conversaId: conversa,
      fonte: 'whatsapp',
      idExterno: 'm7',
      autorId: alt.id,
      ocorridaEm: AGORA - 1_000,
      agora: AGORA,
    });
    aprenderCorrespondencia(acervo, {
      fonte: 'whatsapp',
      alternativo: '777@alt',
      canonico: '777@canon',
    });
    const antes = contarTudo(acervo);
    acervo.fechar();

    const r = rodar(raiz, [
      'identidade',
      'resolver-enderecos',
      '--inquilino',
      inquilino,
      '--chave',
      chave,
    ]);

    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /Ensaio/);
    assert.match(r.saida, /--com-efeito --confirmo/);
    const conferencia = abrirAcervo(join(raiz, 'acervos'), inquilino);
    assert.deepEqual(contarTudo(conferencia), antes, 'o ensaio escreveu');
    conferencia.fechar();
  } finally {
    limpar();
  }
});

test('o comando com efeito exige --confirmo e entao reconcilia', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, chave } = instalacaoComChave(raiz);
    const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'g6',
      coletiva: false, configuracao: CFG_WHATSAPP,
    });
    const alt = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '666@alt' });
    registrarMensagem(acervo, {
      direcao: 'recebida',
      conversaId: conversa,
      fonte: 'whatsapp',
      idExterno: 'm6',
      autorId: alt.id,
      ocorridaEm: AGORA - 1_000,
      agora: AGORA,
    });
    aprenderCorrespondencia(acervo, {
      fonte: 'whatsapp',
      alternativo: '666@alt',
      canonico: '666@canon',
    });
    acervo.fechar();

    const base = ['identidade', 'resolver-enderecos', '--inquilino', inquilino, '--chave', chave];
    const semConfirmo = rodar(raiz, [...base, '--com-efeito']);
    assert.notEqual(semConfirmo.codigo, 0, 'escreveu sem --confirmo');
    assert.match(semConfirmo.saida, /--confirmo/);

    const comEfeito = rodar(raiz, [...base, '--com-efeito', '--confirmo']);
    assert.equal(comEfeito.codigo, 0, comEfeito.saida);

    const conferencia = abrirAcervo(join(raiz, 'acervos'), inquilino);
    const canon = registrarIdentificador(conferencia, { fonte: 'whatsapp', valor: '666@canon' });
    assert.equal(canon.criado, false, 'o comando nao reconciliou');
    const autor = conferencia.db
      .prepare('SELECT autor_id FROM mensagens WHERE id_externo = ?')
      .get('m6') as { autor_id: string };
    assert.equal(autor.autor_id, canon.id);
    conferencia.fechar();
  } finally {
    limpar();
  }
});
