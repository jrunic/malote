import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import { aprenderCorrespondencia, resolverEndereco } from '../src/nucleo/correspondencia.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import { emOperacao, linhasDaOperacao, listarOperacoesCruas } from '../src/nucleo/trilha.js';
import { resolverEnderecoDeWhatsapp } from '../src/adaptadores/whatsapp/resolver-celular.js';

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
