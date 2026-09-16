import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import {
  registrarIdentificador,
  lerPessoaDoIdentificador,
  registrarConversa,
  registrarMensagem,
  InstanteImplausivelError,
  registrarAnexo,
  descartarAnexo,
  conversaJaExiste,
  mensagemJaExiste,
  participacaoJaExiste,
  anexoJaExiste,
  registrarParticipacao,
} from '../src/nucleo/escrita.js';
import {
  criarPessoa,
  desvincularIdentificador,
  vincularIdentificador,
} from '../src/nucleo/identidade.js';
import { lerAnexos } from '../src/nucleo/consulta.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-08-24T12:00:00Z');
const EM_USO = Date.parse('2021-06-15T10:00:00Z');

test('registrar Identificador devolve id interno e não exige Pessoa', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id: id } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '+5565900000001' });

    assert.equal(typeof id, 'string');
    assert.equal(lerPessoaDoIdentificador(acervo, id), null, 'Identificador sem Pessoa é válido');
  } finally {
    c.limpar();
  }
});

test('registrar o mesmo Identificador duas vezes devolve o mesmo id', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id: primeiro } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '+5565900000001' });
    const { id: segundo } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '+5565900000001' });
    assert.equal(primeiro, segundo);

    const total = acervo.db.prepare('SELECT COUNT(*) AS n FROM identificadores').get() as {
      n: number;
    };
    assert.equal(total.n, 1);
  } finally {
    c.limpar();
  }
});

test('o mesmo valor em Fontes diferentes são Identificadores distintos', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id: noWhats } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: 'leia' });
    const { id: noInsta } = registrarIdentificador(acervo, { fonte: 'instagram', valor: 'leia' });
    assert.notEqual(noWhats, noInsta);
  } finally {
    c.limpar();
  }
});

test('vincular Pessoa junta Identificadores de Fontes diferentes sob uma só', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id: noWhats } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '+5565900000002' });
    const { id: noInsta } = registrarIdentificador(acervo, { fonte: 'instagram', valor: 'han' });

    const pessoa = criarPessoa(acervo);
    for (const ident of [noWhats, noInsta]) {
      vincularIdentificador(acervo, {
        identificadorId: ident,
        pessoaId: pessoa,
        procedencia: 'humano',
      });
    }

    assert.equal(lerPessoaDoIdentificador(acervo, noWhats), pessoa);
    assert.equal(lerPessoaDoIdentificador(acervo, noInsta), pessoa);
  } finally {
    c.limpar();
  }
});

test('vincular é reversível e não toca Mensagem nenhuma', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id: ident } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '+5565900000003' });
    const pessoa = criarPessoa(acervo);
    vincularIdentificador(acervo, {
      identificadorId: ident,
      pessoaId: pessoa,
      procedencia: 'humano',
    });
    assert.equal(lerPessoaDoIdentificador(acervo, ident), pessoa);

    desvincularIdentificador(acervo, ident);
    assert.equal(lerPessoaDoIdentificador(acervo, ident), null);

    // A Pessoa continua existindo — desvincular não apaga quem já foi criado.
    const pessoas = acervo.db.prepare('SELECT COUNT(*) AS n FROM pessoas').get() as { n: number };
    assert.equal(pessoas.n, 1);
  } finally {
    c.limpar();
  }
});

test('registrar Conversa devolve identidade própria, não a da Fonte', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const idExterno = 'conversa-na-origem-123';
    const id = registrarConversa(acervo, { fonte: 'whatsapp', idExterno, coletiva: false, configuracao: CFG_WHATSAPP });

    assert.notEqual(id, idExterno, 'a identidade da Conversa nunca é a da Fonte');
    const linha = acervo.db.prepare('SELECT id_externo FROM conversas WHERE id = ?').get(id) as {
      id_externo: string;
    };
    assert.equal(linha.id_externo, idExterno, 'o id da origem vive em coluna própria');
  } finally {
    c.limpar();
  }
});

test('registrar a mesma Conversa duas vezes não duplica', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const a = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: 'x', coletiva: false, configuracao: CFG_WHATSAPP });
    const b = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: 'x', coletiva: false, configuracao: CFG_WHATSAPP });
    assert.equal(a, b);
    const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM conversas').get() as { n: number };
    assert.equal(n.n, 1);
  } finally {
    c.limpar();
  }
});

test('Conversa coletiva guarda metadados; Conversa direta não cria a linha', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'grupo-1',
      coletiva: true,
      metadadosDeColetiva: { assunto: 'Conselho' },
    });
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno: 'direta-1', coletiva: false, configuracao: CFG_WHATSAPP });

    const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM metadados_de_coletiva').get() as {
      n: number;
    };
    assert.equal(n.n, 1, 'Conversa direta não carrega campo de coletiva nulo');
  } finally {
    c.limpar();
  }
});

test('registrar Mensagem exige instante plausível e rejeita o resto', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'x',
      coletiva: false, configuracao: CFG_WHATSAPP,
    });

    const id = registrarMensagem(acervo, {
      conversaId: conversa,
      fonte: 'whatsapp',
      idExterno: 'm1',
      conteudo: 'a Força estará com você',
      ocorridaEm: EM_USO,
      agora: AGORA,
    });
    assert.ok(id);

    assert.throws(
      () =>
        registrarMensagem(acervo, {
          conversaId: conversa,
          fonte: 'whatsapp',
          idExterno: 'm2',
          conteudo: 'de 1969',
          ocorridaEm: 0,
          agora: AGORA,
        }),
      InstanteImplausivelError,
      'instante zero tem de ser recusado por erro próprio, distinguível de qualquer outro',
    );

    const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM mensagens').get() as { n: number };
    assert.equal(n.n, 1, 'a Mensagem implausível não entra no Acervo');
  } finally {
    c.limpar();
  }
});

test('o erro de instante implausível carrega o motivo, para o relatório contar por causa', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'x',
      coletiva: false, configuracao: CFG_WHATSAPP,
    });

    try {
      registrarMensagem(acervo, {
        conversaId: conversa,
        fonte: 'whatsapp',
        idExterno: 'm3',
        conteudo: 'do futuro',
        ocorridaEm: AGORA + 86_400_000,
        agora: AGORA,
      });
      assert.fail('deveria ter lançado');
    } catch (erro) {
      assert.ok(erro instanceof InstanteImplausivelError);
      assert.match(erro.motivo, /no futuro/);
    }
  } finally {
    c.limpar();
  }
});

test('registrar a mesma Mensagem duas vezes não duplica', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'x',
      coletiva: false, configuracao: CFG_WHATSAPP,
    });
    const comum = {
      conversaId: conversa,
      fonte: 'whatsapp' as const,
      idExterno: 'm1',
      conteudo: 'oi',
      ocorridaEm: EM_USO,
      agora: AGORA,
    };
    const a = registrarMensagem(acervo, comum);
    const b = registrarMensagem(acervo, comum);
    assert.equal(a, b);

    const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM mensagens').get() as { n: number };
    assert.equal(n.n, 1);
  } finally {
    c.limpar();
  }
});

test('Mensagem sem autor conhecido é válida', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'x',
      coletiva: false, configuracao: CFG_WHATSAPP,
    });
    const id = registrarMensagem(acervo, {
      conversaId: conversa,
      fonte: 'whatsapp',
      idExterno: 'sem-autor',
      conteudo: 'mensagem de sistema',
      ocorridaEm: EM_USO,
      agora: AGORA,
    });
    const linha = acervo.db.prepare('SELECT autor_id FROM mensagens WHERE id = ?').get(id) as {
      autor_id: string | null;
    };
    assert.equal(linha.autor_id, null);
  } finally {
    c.limpar();
  }
});

/** Cria Conversa e Mensagem descartáveis para pendurar Anexo. */
function conversaComMensagem(acervo: Parameters<typeof registrarAnexo>[0]): string {
  const conversa = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: `conv-${randomUUID()}`,
    coletiva: false, configuracao: CFG_WHATSAPP,
  });
  return registrarMensagem(acervo, {
    conversaId: conversa,
    fonte: 'whatsapp',
    idExterno: `msg-${randomUUID()}`,
    conteudo: 'com anexo',
    ocorridaEm: EM_USO,
    agora: AGORA,
  });
}

test('Anexo cujo arquivo não veio nasce como nunca-obtido, não omitido', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const mensagem = conversaComMensagem(acervo);

    registrarAnexo(acervo, {
      mensagemId: mensagem,
      tipo: 'video',
      tamanho: 41_000_000,
      nomeOriginal: 'trecho.mp4',
      presenca: 'nunca-obtido',
    });

    const anexos = lerAnexos(acervo, mensagem);
    assert.equal(anexos.length, 1);
    assert.equal(anexos[0]?.presenca, 'nunca-obtido');
    assert.equal(anexos[0]?.caminho, null);
    assert.equal(anexos[0]?.tamanho, 41_000_000, 'o Descritor existe mesmo sem o arquivo');
  } finally {
    c.limpar();
  }
});

test('descartar o Anexo preserva o Descritor e registra quando e por qual política', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const mensagem = conversaComMensagem(acervo);
    const anexo = registrarAnexo(acervo, {
      mensagemId: mensagem,
      tipo: 'video',
      tamanho: 41_000_000,
      nomeOriginal: 'trecho.mp4',
      presenca: 'presente',
      caminho: 'videos/ab/cd/ef.mp4',
    });

    descartarAnexo(acervo, anexo, { politica: 'video-de-coletiva-acima-de-30d' });

    const [depois] = lerAnexos(acervo, mensagem);
    assert.equal(depois?.presenca, 'descartado');
    assert.equal(depois?.caminho, null, 'o caminho some junto com o arquivo');
    assert.equal(depois?.tamanho, 41_000_000, 'o Descritor sobrevive ao descarte');
    assert.equal(depois?.nomeOriginal, 'trecho.mp4');
    assert.equal(depois?.descartadoPor, 'video-de-coletiva-acima-de-30d');
    assert.ok(depois?.descartadoEm);

    // A Mensagem continua lá: descartar arquivo nunca apaga Mensagem.
    const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM mensagens').get() as { n: number };
    assert.equal(n.n, 1);
  } finally {
    c.limpar();
  }
});

test('Presenca fora dos três estados é recusada pelo próprio schema', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const mensagem = conversaComMensagem(acervo);
    assert.throws(
      () =>
        acervo.db
          .prepare('INSERT INTO anexos (id, mensagem_id, tipo, presenca) VALUES (?, ?, ?, ?)')
          .run('x', mensagem, 'video', 'rebaixado'),
      /CHECK constraint failed/,
      'rebaixado não é estado: nenhuma operação o produz',
    );
  } finally {
    c.limpar();
  }
});

test('vincular Pessoa não escreve em Mensagem nenhuma', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id: ident } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '+5565900000009' });
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'conversa-do-vinculo',
      coletiva: false, configuracao: CFG_WHATSAPP,
    });
    registrarMensagem(acervo, {
      conversaId: conversa,
      fonte: 'whatsapp',
      idExterno: 'mensagem-do-vinculo',
      autorId: ident,
      conteudo: 'e verdade, tudo isso',
      ocorridaEm: Date.parse('2021-06-15T10:00:00Z'),
      agora: Date.parse('2026-08-27T12:00:00Z'),
    });

    const antes = acervo.db.prepare('SELECT * FROM mensagens ORDER BY id').all();

    const pessoa = criarPessoa(acervo);
    vincularIdentificador(acervo, {
      identificadorId: ident,
      pessoaId: pessoa,
      procedencia: 'humano',
    });

    const depois = acervo.db.prepare('SELECT * FROM mensagens ORDER BY id').all();
    assert.deepEqual(depois, antes, 'a linha inteira da Mensagem é idêntica');
  } finally {
    c.limpar();
  }
});

test('a porta responde existência sem que o Adaptador conheça o schema', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    assert.equal(conversaJaExiste(acervo, 'whatsapp', 'x@s.whatsapp.net'), false);

    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'x@s.whatsapp.net',
      coletiva: false, configuracao: CFG_WHATSAPP,
    });
    assert.equal(conversaJaExiste(acervo, 'whatsapp', 'x@s.whatsapp.net'), true);

    assert.equal(mensagemJaExiste(acervo, 'whatsapp', 'm1'), false);
    const mensagemId = registrarMensagem(acervo, {
      conversaId,
      fonte: 'whatsapp',
      idExterno: 'm1',
      ocorridaEm: Date.parse('2026-01-10T12:00:00.000Z'),
      agora: Date.now(),
    });
    assert.equal(mensagemJaExiste(acervo, 'whatsapp', 'm1'), true);

    const { id: identificadorId } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: 'x@s.whatsapp.net',
    });
    assert.equal(participacaoJaExiste(acervo, conversaId, identificadorId), false);
    registrarParticipacao(acervo, {
      conversaId,
      identificadorId,
      observadaEm: new Date().toISOString(),
    });
    assert.equal(participacaoJaExiste(acervo, conversaId, identificadorId), true);

    assert.equal(anexoJaExiste(acervo, mensagemId), false);
    registrarAnexo(acervo, { mensagemId, tipo: 'image', presenca: 'nunca-obtido' });
    assert.equal(anexoJaExiste(acervo, mensagemId), true);
  } finally {
    c.limpar();
  }
});

test('registrarIdentificador diz se criou ou se já existia', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const a = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511999990000' });
  assert.equal(a.criado, true);
  const b = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511999990000' });
  assert.equal(b.criado, false);
  assert.equal(b.id, a.id);
  c.limpar();
});
