import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import { aprenderCorrespondencia, resolverEndereco } from '../src/nucleo/correspondencia.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import { emOperacao, linhasDaOperacao, listarOperacoesCruas } from '../src/nucleo/trilha.js';
import {
  consultarDestinoDeWhatsapp,
  destinoDeEnvioDeWhatsapp,
  resolverEnderecoDeWhatsapp,
} from '../src/adaptadores/whatsapp/resolver-celular.js';

const SEM_NOVE = '556599991234@s.whatsapp.net';
const COM_NOVE = '5565999991234@s.whatsapp.net';
const TERCEIRO = '556599990000@s.whatsapp.net';
const LID = '100000000000001@lid';

function comAcervo(corpo: (acervo: Acervo) => void): void {
  const c = cenario();
  try {
    corpo(c.novoInquilino('Teste').acervo);
  } finally {
    c.limpar();
  }
}

const pares = (acervo: Acervo): Array<{ alternativo: string; canonico: string }> =>
  acervo.db
    .prepare('SELECT alternativo, canonico FROM correspondencias_de_endereco ORDER BY alternativo')
    .all() as Array<{ alternativo: string; canonico: string }>;

const id = (acervo: Acervo, valor: string): void => {
  registrarIdentificador(acervo, { fonte: 'whatsapp', valor });
};

test('numero novo: a forma que chegou vira a canonica e a outra, a alternativa', () => {
  comAcervo((acervo) => {
    assert.equal(resolverEnderecoDeWhatsapp(acervo, COM_NOVE), COM_NOVE);
    assert.deepEqual(pares(acervo), [{ alternativo: SEM_NOVE, canonico: COM_NOVE }]);
    // E a partir dai a outra forma resolve para a primeira que foi vista.
    assert.equal(resolverEnderecoDeWhatsapp(acervo, SEM_NOVE), COM_NOVE);
    assert.equal(pares(acervo).length, 1, 'idempotente: nao cria segundo par');
  });
});

test('forma gravada vence a que chegou', () => {
  comAcervo((acervo) => {
    id(acervo, SEM_NOVE);
    assert.equal(resolverEnderecoDeWhatsapp(acervo, COM_NOVE), SEM_NOVE);
    assert.deepEqual(pares(acervo), [{ alternativo: COM_NOVE, canonico: SEM_NOVE }]);
  });
});

test('canonico de par LID sem Identificador vence a que chegou (sem cadeia)', () => {
  comAcervo((acervo) => {
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID, canonico: SEM_NOVE });
    assert.equal(resolverEnderecoDeWhatsapp(acervo, COM_NOVE), SEM_NOVE);
    const todos = pares(acervo);
    assert.deepEqual(todos, [
      { alternativo: LID, canonico: SEM_NOVE },
      { alternativo: COM_NOVE, canonico: SEM_NOVE },
    ]);
    const alternativos = new Set(todos.map((p) => p.alternativo));
    assert.equal(
      todos.filter((p) => alternativos.has(p.canonico)).length,
      0,
      'nenhum canonico pode ser alternativo de outro par',
    );
    assert.equal(resolverEndereco(acervo, 'whatsapp', LID), SEM_NOVE);
  });
});

test('canonico de par LID na forma que chegou: ela e a canonica', () => {
  comAcervo((acervo) => {
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID, canonico: COM_NOVE });
    assert.equal(resolverEnderecoDeWhatsapp(acervo, COM_NOVE), COM_NOVE);
    assert.equal(resolverEnderecoDeWhatsapp(acervo, SEM_NOVE), COM_NOVE);
    assert.deepEqual(pares(acervo), [
      { alternativo: LID, canonico: COM_NOVE },
      { alternativo: SEM_NOVE, canonico: COM_NOVE },
    ]);
  });
});

test('as duas formas ja sao Identificadores: sem par, cada uma resolve para si (achado)', () => {
  comAcervo((acervo) => {
    id(acervo, SEM_NOVE);
    id(acervo, COM_NOVE);
    assert.equal(resolverEnderecoDeWhatsapp(acervo, SEM_NOVE), SEM_NOVE);
    assert.equal(resolverEnderecoDeWhatsapp(acervo, COM_NOVE), COM_NOVE);
    assert.deepEqual(pares(acervo), []);
  });
});

test('as duas formas sao Identificadores e uma delas e canonica de par LID: ainda sem par (criterio 5)', () => {
  comAcervo((acervo) => {
    id(acervo, SEM_NOVE);
    id(acervo, COM_NOVE);
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID, canonico: SEM_NOVE });
    assert.equal(resolverEnderecoDeWhatsapp(acervo, COM_NOVE), COM_NOVE);
    assert.equal(resolverEnderecoDeWhatsapp(acervo, SEM_NOVE), SEM_NOVE);
    assert.deepEqual(pares(acervo), [{ alternativo: LID, canonico: SEM_NOVE }]);
  });
});

test('as duas formas sao canonicas de pares LID distintos: sem par (achado)', () => {
  comAcervo((acervo) => {
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID, canonico: SEM_NOVE });
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: '100000000000002@lid', canonico: COM_NOVE });
    assert.equal(resolverEnderecoDeWhatsapp(acervo, COM_NOVE), COM_NOVE);
    assert.equal(pares(acervo).length, 2);
  });
});

test('canonico de par LID na forma NAO gravada, com a outra gravada: o par segue o LID (caso legado, 0 medido)', () => {
  comAcervo((acervo) => {
    id(acervo, SEM_NOVE);
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID, canonico: COM_NOVE });
    assert.equal(resolverEnderecoDeWhatsapp(acervo, SEM_NOVE), COM_NOVE);
    assert.deepEqual(pares(acervo), [
      { alternativo: LID, canonico: COM_NOVE },
      { alternativo: SEM_NOVE, canonico: COM_NOVE },
    ]);
  });
});

test('canonico de par LID na forma que CHEGOU, com a outra gravada: a que chegou e a canonica, sem cadeia', () => {
  comAcervo((acervo) => {
    id(acervo, SEM_NOVE);
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID, canonico: COM_NOVE });
    assert.equal(resolverEnderecoDeWhatsapp(acervo, COM_NOVE), COM_NOVE);
    const todos = pares(acervo);
    assert.deepEqual(todos, [
      { alternativo: LID, canonico: COM_NOVE },
      { alternativo: SEM_NOVE, canonico: COM_NOVE },
    ]);
    const alternativos = new Set(todos.map((p) => p.alternativo));
    assert.equal(todos.filter((p) => alternativos.has(p.canonico)).length, 0, 'nenhum canonico pode ser alternativo de outro par');
  });
});

test('so com evidencia, nenhuma forma gravada: devolve o endereco como veio, sem par e sem Operacao', () => {
  comAcervo((acervo) => {
    assert.equal(resolverEnderecoDeWhatsapp(acervo, COM_NOVE, undefined, { soComEvidencia: true }), COM_NOVE);
    assert.deepEqual(pares(acervo), []);
    assert.equal(listarOperacoesCruas(acervo).length, 0);
  });
});

test('so com evidencia, com a outra forma gravada como Identificador: usa a gravada e aprende o par', () => {
  comAcervo((acervo) => {
    id(acervo, SEM_NOVE);
    assert.equal(resolverEnderecoDeWhatsapp(acervo, COM_NOVE, undefined, { soComEvidencia: true }), SEM_NOVE);
    assert.deepEqual(pares(acervo), [{ alternativo: COM_NOVE, canonico: SEM_NOVE }]);
  });
});

test('so com evidencia, a forma que chegou JA e Identificador: a gravada e a evidencia, e o par e aprendido', () => {
  comAcervo((acervo) => {
    id(acervo, COM_NOVE);
    assert.equal(resolverEnderecoDeWhatsapp(acervo, COM_NOVE, undefined, { soComEvidencia: true }), COM_NOVE);
    assert.deepEqual(pares(acervo), [{ alternativo: SEM_NOVE, canonico: COM_NOVE }]);
  });
});

test('so com evidencia, com a outra forma canonica de um par LID: usa-a e aprende o par', () => {
  comAcervo((acervo) => {
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID, canonico: SEM_NOVE });
    assert.equal(resolverEnderecoDeWhatsapp(acervo, COM_NOVE, undefined, { soComEvidencia: true }), SEM_NOVE);
    assert.deepEqual(pares(acervo), [
      { alternativo: LID, canonico: SEM_NOVE },
      { alternativo: COM_NOVE, canonico: SEM_NOVE },
    ]);
  });
});

test('o endereco que ja e alternativo de um par resolve para o canonico sem aprender nada', () => {
  comAcervo((acervo) => {
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: COM_NOVE, canonico: SEM_NOVE });
    assert.equal(resolverEnderecoDeWhatsapp(acervo, COM_NOVE), SEM_NOVE);
    assert.equal(resolverEnderecoDeWhatsapp(acervo, SEM_NOVE), SEM_NOVE);
    assert.equal(pares(acervo).length, 1);
  });
});

test('a outra forma e alternativa de um TERCEIRO: nao lanca e nao aprende (o conflito e achado)', () => {
  comAcervo((acervo) => {
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: COM_NOVE, canonico: TERCEIRO });
    assert.doesNotThrow(() => resolverEnderecoDeWhatsapp(acervo, SEM_NOVE));
    assert.equal(resolverEnderecoDeWhatsapp(acervo, SEM_NOVE), SEM_NOVE);
    assert.deepEqual(pares(acervo), [{ alternativo: COM_NOVE, canonico: TERCEIRO }]);
  });
});

test('o que nao e celular brasileiro nao ganha par: fixo, 13 com 9 e 0 a 5, outro pais, LID, grupo', () => {
  comAcervo((acervo) => {
    for (const e of [
      '556532221234@s.whatsapp.net',
      '5565905551234@s.whatsapp.net',
      '14155550123@s.whatsapp.net',
      LID,
      '120363000000000001@g.us',
    ]) {
      assert.equal(resolverEnderecoDeWhatsapp(acervo, e), e);
    }
    assert.deepEqual(pares(acervo), []);
  });
});

test('o par LID existente continua resolvendo como antes', () => {
  comAcervo((acervo) => {
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID, canonico: SEM_NOVE });
    assert.equal(resolverEnderecoDeWhatsapp(acervo, LID), SEM_NOVE);
  });
});

test('com op, o par vira UMA linha de efeito da Operacao do chamador', () => {
  comAcervo((acervo) => {
    const opId = emOperacao(acervo, { natureza: 'teste-do-estoque', reversibilidade: 'por-efeito' }, (op) => {
      resolverEnderecoDeWhatsapp(acervo, COM_NOVE, op);
      return op.id;
    });
    const linhas = linhasDaOperacao(acervo, opId);
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0]?.tabela, 'correspondencias_de_endereco');
    assert.equal(linhas[0]?.depois, COM_NOVE);
  });
});

test('sem op dentro de Operacao por-efeito, o par nasce SEM linha de efeito (por isso o ponto por-efeito passa op)', () => {
  comAcervo((acervo) => {
    const semOp = emOperacao(acervo, { natureza: 'externa-sem-op', reversibilidade: 'por-efeito' }, (op) => {
      resolverEnderecoDeWhatsapp(acervo, COM_NOVE);
      return op.id;
    });
    assert.equal(linhasDaOperacao(acervo, semOp).length, 0, 'a reentrancia junta o trabalho a Operacao de fora');
    assert.equal(listarOperacoesCruas(acervo).length, 1, 'nenhum envelope proprio foi aberto');
    assert.equal(pares(acervo).length, 1, 'o par foi aprendido mesmo assim');
  });
});

test('sem op e sem Operacao aberta, aprender abre o envelope irreversivel UMA vez, e nao abre quando nao ha o que aprender', () => {
  comAcervo((acervo) => {
    const naturezas = (): string[] => listarOperacoesCruas(acervo).map((o) => o.natureza);
    resolverEnderecoDeWhatsapp(acervo, COM_NOVE);
    assert.deepEqual(naturezas(), ['aprender-endereco-ao-vivo']);
    const op = listarOperacoesCruas(acervo)[0];
    assert.equal(op?.reversibilidade, 'irreversivel');
    assert.equal(linhasDaOperacao(acervo, op?.id as string).length, 0);

    resolverEnderecoDeWhatsapp(acervo, COM_NOVE);
    resolverEnderecoDeWhatsapp(acervo, SEM_NOVE);
    resolverEnderecoDeWhatsapp(acervo, '556532221234@s.whatsapp.net');
    assert.deepEqual(naturezas(), ['aprender-endereco-ao-vivo'], 'sem o que aprender, nenhuma Operacao nova');
  });
});

test('consultar o destino: a forma que o Acervo guarda no lugar da pedida, sem escrever nada', () => {
  comAcervo((acervo) => {
    id(acervo, SEM_NOVE);
    const antes = listarOperacoesCruas(acervo).length;
    assert.deepEqual(consultarDestinoDeWhatsapp(acervo, COM_NOVE), { usado: SEM_NOVE, situacao: 'redirecionado' });
    assert.deepEqual(pares(acervo), [], 'consultar nao aprende o par');
    assert.equal(listarOperacoesCruas(acervo).length, antes, 'nem abre Operacao');
  });
});

test('consultar o destino: a forma gravada pedida como esta e conhecida, e a gravada na forma improvavel vence a provavel', () => {
  comAcervo((acervo) => {
    id(acervo, COM_NOVE);
    assert.deepEqual(consultarDestinoDeWhatsapp(acervo, COM_NOVE), { usado: COM_NOVE, situacao: 'conhecido' });
    assert.deepEqual(consultarDestinoDeWhatsapp(acervo, SEM_NOVE), { usado: COM_NOVE, situacao: 'redirecionado' });
  });
});

test('consultar o destino: a alternativa de um par, que o Acervo ja aprendeu, vai ao canonico', () => {
  comAcervo((acervo) => {
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: COM_NOVE, canonico: SEM_NOVE });
    assert.deepEqual(consultarDestinoDeWhatsapp(acervo, COM_NOVE), { usado: SEM_NOVE, situacao: 'redirecionado' });
    assert.deepEqual(consultarDestinoDeWhatsapp(acervo, SEM_NOVE), { usado: SEM_NOVE, situacao: 'conhecido' });
  });
});

test('consultar o destino: numero que o Acervo nao conhece em nenhuma das duas formas e desconhecido, e sai como foi pedido', () => {
  comAcervo((acervo) => {
    assert.deepEqual(consultarDestinoDeWhatsapp(acervo, COM_NOVE), { usado: COM_NOVE, situacao: 'desconhecido' });
    assert.deepEqual(consultarDestinoDeWhatsapp(acervo, '556532221234@s.whatsapp.net'), {
      usado: '556532221234@s.whatsapp.net',
      situacao: 'desconhecido',
    });
    assert.deepEqual(pares(acervo), []);
  });
});

test('o destino de um Envio so resolve telefone: grupo e opaco (mesmo com par) saem como foram pedidos, sem aviso', () => {
  comAcervo((acervo) => {
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID, canonico: SEM_NOVE });
    for (const e of ['120363000000000001@g.us', LID]) {
      assert.deepEqual(consultarDestinoDeWhatsapp(acervo, e), { usado: e, situacao: 'nao-se-aplica' });
      assert.equal(destinoDeEnvioDeWhatsapp(acervo, e), e);
    }
  });
});

test('consultar o destino concorda com o destino que o Envio usa, em todos os cenarios', () => {
  const cenas: Array<(acervo: Acervo) => void> = [
    () => undefined,
    (a) => id(a, SEM_NOVE),
    (a) => id(a, COM_NOVE),
    (a) => aprenderCorrespondencia(a, { fonte: 'whatsapp', alternativo: COM_NOVE, canonico: SEM_NOVE }),
    (a) => aprenderCorrespondencia(a, { fonte: 'whatsapp', alternativo: LID, canonico: SEM_NOVE }),
    (a) => {
      id(a, SEM_NOVE);
      id(a, COM_NOVE);
    },
  ];
  for (const preparar of cenas) {
    for (const pedido of [SEM_NOVE, COM_NOVE, LID]) {
      comAcervo((acervo) => {
        preparar(acervo);
        const consultado = consultarDestinoDeWhatsapp(acervo, pedido).usado;
        assert.equal(destinoDeEnvioDeWhatsapp(acervo, pedido), consultado);
      });
    }
  }
});

test('o destino de um Envio aprende o par quando o Acervo tem a evidencia, e nao inventa canonica quando nao tem', () => {
  comAcervo((acervo) => {
    assert.equal(destinoDeEnvioDeWhatsapp(acervo, COM_NOVE), COM_NOVE);
    assert.deepEqual(pares(acervo), [], 'numero desconhecido: nenhum par (#1364)');
    id(acervo, SEM_NOVE);
    assert.equal(destinoDeEnvioDeWhatsapp(acervo, COM_NOVE), SEM_NOVE);
    assert.deepEqual(pares(acervo), [{ alternativo: COM_NOVE, canonico: SEM_NOVE }]);
  });
});

test('consultar o destino: a outra forma ja e alternativa de outro endereco, entao o Acervo conhece o numero e o pedido sai como veio', () => {
  comAcervo((acervo) => {
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: SEM_NOVE, canonico: TERCEIRO });
    assert.deepEqual(consultarDestinoDeWhatsapp(acervo, COM_NOVE), { usado: COM_NOVE, situacao: 'conhecido' });
    assert.deepEqual(pares(acervo), [{ alternativo: SEM_NOVE, canonico: TERCEIRO }], 'e nada novo e aprendido');
  });
});

test('consultar o destino: telefone que e o canonico de um par LID, sem Identificador, e conhecido', () => {
  comAcervo((acervo) => {
    const FIXO = '556532221234@s.whatsapp.net';
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID, canonico: FIXO });
    assert.deepEqual(consultarDestinoDeWhatsapp(acervo, FIXO), { usado: FIXO, situacao: 'conhecido' });
  });
});
