import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import {
  aprenderCorrespondencia,
  resolverEndereco,
  CorrespondenciaEmConflitoError,
} from '../src/nucleo/correspondencia.js';
import { gravarMaterialLido } from '../src/adaptadores/whatsapp/importar.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

test('endereco sem correspondencia resolve para ele mesmo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    // Nao ter correspondencia NAO e erro: e o caso comum. Resolver para o
    // proprio valor deixa o chamador escrever sem ramo condicional.
    assert.equal(resolverEndereco(acervo, 'whatsapp', 'valor-a'), 'valor-a');
  } finally {
    c.limpar();
  }
});

test('depois de aprender, o alternativo resolve para o canonico', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    aprenderCorrespondencia(acervo, {
      fonte: 'whatsapp',
      alternativo: 'forma-nova',
      canonico: 'forma-do-material',
    });
    assert.equal(resolverEndereco(acervo, 'whatsapp', 'forma-nova'), 'forma-do-material');
    // E o canonico continua resolvendo para ele mesmo — traduzir e idempotente.
    assert.equal(
      resolverEndereco(acervo, 'whatsapp', 'forma-do-material'),
      'forma-do-material',
    );
  } finally {
    c.limpar();
  }
});

test('aprender duas vezes o mesmo par nao duplica nem falha', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Chewbacca');
    const par = { fonte: 'whatsapp' as const, alternativo: 'a', canonico: 'b' };
    aprenderCorrespondencia(acervo, par);
    aprenderCorrespondencia(acervo, par);
    const n = acervo.db
      .prepare('SELECT COUNT(*) AS n FROM correspondencias_de_endereco')
      .get() as { n: number };
    assert.equal(n.n, 1);
  } finally {
    c.limpar();
  }
});

test('a correspondencia e por Fonte — nao vaza entre Fontes', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Lando');
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: 'x', canonico: 'y' });
    assert.equal(resolverEndereco(acervo, 'instagram', 'x'), 'x', 'outra Fonte não enxerga');
  } finally {
    c.limpar();
  }
});

test('reaprender com canonico diferente NAO sobrescreve em silencio', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: 'a', canonico: 'b' });
    // Um endereco alternativo designa UM destinatario. Se a Fonte disser outra
    // coisa depois, isso e achado — nao dado novo. Sobrescrever apagaria a
    // evidencia de que houve conflito, e o produto passaria a afirmar a ultima
    // coisa que ouviu como se fosse a verdade.
    assert.throws(
      () =>
        aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: 'a', canonico: 'c' }),
      CorrespondenciaEmConflitoError,
    );
    assert.equal(resolverEndereco(acervo, 'whatsapp', 'a'), 'b', 'o primeiro permanece');
  } finally {
    c.limpar();
  }
});

test('a importacao aprende o par que o material declara, e nao duplica a pessoa', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const TELEFONE = '5565911110001@s.whatsapp.net';
    const ALTERNATIVA = '109876543210987@lid';

    // O material declara as DUAS formas para a mesma pessoa — e ate 02/09/2026
    // o adaptador lia so uma coluna, criando duas identidades. Medido no
    // material real: 4.882 linhas com o par, e 18.653 Identificadores na forma
    // alternativa que nasciam separados de quem ja estava la pelo telefone.
    gravarMaterialLido(
      acervo,
      {
        conversas: [
          { idExterno: TELEFONE, nome: 'Alguem', coletiva: false, participantesConhecidos: [], bruto: '{}' },
          { idExterno: ALTERNATIVA, nome: 'Alguem', coletiva: false, participantesConhecidos: [], bruto: '{}' },
        ],
        mensagens: [],
        descartes: { mensagens: {}, eventos: {} },
    linhasRepetidasNoMaterial: 0,
        fechar: () => {},
        eventos: [],
        correspondencias: [{ alternativo: ALTERNATIVA, canonico: TELEFONE }],
      },
      { agora: Date.now(), configuracao: CFG_WHATSAPP },
    );

    const conversas = acervo.db
      .prepare("SELECT id_externo FROM conversas WHERE fonte = 'whatsapp'")
      .all() as { id_externo: string }[];
    assert.equal(conversas.length, 1, 'as duas formas viraram UMA Conversa');
    assert.equal(conversas[0]?.id_externo, TELEFONE, 'na forma canônica');

    const ids = acervo.db
      .prepare("SELECT valor FROM identificadores WHERE fonte = 'whatsapp'")
      .all() as { valor: string }[];
    assert.ok(!ids.some((i) => i.valor.includes('@lid')), 'nenhum Identificador na forma alternativa');
  } finally {
    c.limpar();
  }
});
