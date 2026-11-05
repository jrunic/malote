import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { desfazerOperacao } from '../src/nucleo/desfazer.js';
import { registrarConversa, registrarIdentificador, registrarMensagem } from '../src/nucleo/escrita.js';
import { resolverRetroativamente } from '../src/nucleo/resolucao-retroativa.js';
import { linhasDaOperacao, listarOperacoesCruas } from '../src/nucleo/trilha.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { aprenderFormasDoCelular, EstoqueInterrompidoError } from '../src/adaptadores/whatsapp/aprender-formas-do-celular.js';
import { resolverEnderecoDeWhatsapp, situacaoNoEstoque } from '../src/adaptadores/whatsapp/resolver-celular.js';
import { emOperacao } from '../src/nucleo/trilha.js';

// #1376, Plano 4: o estoque aprende o par das duas formas do celular. Numeros sinteticos; cada um e um caso.

const SO_SEM = '556599991111@s.whatsapp.net'; // gravado sem o 9: nasce o par da forma com o 9
const SO_SEM_ALT = '5565999991111@s.whatsapp.net';
const SO_COM = '5548999492222@s.whatsapp.net'; // gravado com o 9 (DDD 48): nasce o par da forma sem o 9
const SO_COM_ALT = '554899492222@s.whatsapp.net';
const DUAS_A = '556599995555@s.whatsapp.net'; // as duas formas gravadas: sem par
const DUAS_B = '5565999995555@s.whatsapp.net';
const RESPEITA = '556599996666@s.whatsapp.net'; // canonico de um par LID: o par segue a forma dele
const RESPEITA_ALT = '5565999996666@s.whatsapp.net';
const LEGADO_GRAVADO = '5565999997777@s.whatsapp.net'; // gravado, mas o par LID aponta para a outra forma
const LEGADO_CANONICO = '556599997777@s.whatsapp.net';
const JA = '556599998888@s.whatsapp.net'; // ja tem par
const JA_ALT = '5565999998888@s.whatsapp.net';
const FIXO = '556532221234@s.whatsapp.net';
const NOVE_E_UM = '5565912341234@s.whatsapp.net'; // 13 digitos com 9 seguido de 1: nao e celular
const ESTRANGEIRO = '14155550123@s.whatsapp.net';
const LID_R = '100000000000001@lid';
const LID_L = '100000000000002@lid';
const LID_J = '100000000000003@lid';
const AGORA = 1_790_000_000_000;

/** O Acervo do estoque: um caso para cada resposta do ensaio. */
function comEstoque(corpo: (acervo: Acervo) => void): void {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const id = (valor: string): string => registrarIdentificador(acervo, { fonte: 'whatsapp', valor }).id;
    const conversa = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: SO_SEM, coletiva: false, configuracao: CFG_WHATSAPP });
    let n = 0;
    const mensagem = (autor: string): void => {
      n += 1;
      registrarMensagem(acervo, {
        origemDaChegada: 'importacao',
        direcao: 'recebida',
        conversaId: conversa,
        fonte: 'whatsapp',
        idExterno: `m${n}`,
        autorId: autor,
        ocorridaEm: AGORA - n,
        agora: AGORA,
      });
    };
    mensagem(id(SO_SEM));
    id(SO_COM);
    mensagem(id(DUAS_A));
    mensagem(id(DUAS_B));
    mensagem(id(DUAS_B));
    id(RESPEITA);
    mensagem(id(LEGADO_GRAVADO));
    id(JA);
    id(FIXO);
    id(NOVE_E_UM);
    id(ESTRANGEIRO);
    registrarIdentificador(acervo, { fonte: 'instagram', valor: 'fulano_de_tal' });
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno: DUAS_A, coletiva: false, configuracao: CFG_WHATSAPP });
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno: DUAS_B, coletiva: false, configuracao: CFG_WHATSAPP });
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID_R, canonico: RESPEITA });
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID_L, canonico: LEGADO_CANONICO });
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: JA_ALT, canonico: JA });
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID_J, canonico: JA });
    corpo(acervo);
  } finally {
    c.limpar();
  }
}

const pares = (acervo: Acervo): Array<{ alternativo: string; canonico: string }> =>
  acervo.db
    .prepare('SELECT alternativo, canonico FROM correspondencias_de_endereco ORDER BY alternativo')
    .all() as Array<{ alternativo: string; canonico: string }>;

const TABELAS = ['correspondencias_de_endereco', 'operacoes', 'linhas_de_efeito', 'identificadores', 'conversas', 'mensagens', 'chegadas'];
const contagens = (acervo: Acervo): Record<string, number> =>
  Object.fromEntries(
    TABELAS.map((t) => [t, (acervo.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]),
  );

/** Em ordem de `alternativo`, que e a do `pares()`. */
const OS_QUATRO = [
  { alternativo: SO_COM_ALT, canonico: SO_COM },
  { alternativo: SO_SEM_ALT, canonico: SO_SEM },
  { alternativo: RESPEITA_ALT, canonico: RESPEITA },
  { alternativo: LEGADO_GRAVADO, canonico: LEGADO_CANONICO },
];

test('o ensaio relata os pares a criar, as duas formas, o que nao e celular e os canonicos respeitados, e nao escreve nada', () => {
  comEstoque((acervo) => {
    const antes = contagens(acervo);
    const r = aprenderFormasDoCelular(acervo, { comEfeito: false });
    assert.deepEqual(contagens(acervo), antes, 'o ensaio nao escreve: nem par, nem Operacao, nem Chegada');
    assert.equal(r.candidatos, 10);
    assert.equal(r.naoCelular, 3, 'o fixo, o 13 digitos com 9 seguido de 1 e o numero de outro pais');
    assert.equal(r.celulares, 6);
    assert.equal(r.aCriar, 4);
    assert.equal(r.respeitados, 2, 'o canonico de par LID (nas duas formas em que ele pode estar)');
    assert.equal(r.legados, 1, 'dos respeitados, o em que o canonico do par LID e a forma nao gravada');
    assert.equal(r.jaResolvidos, 1);
    assert.equal(r.conflitos, 0);
    assert.equal(r.criados, 0);
    assert.equal(r.operacaoId, null);
    assert.equal(r.gravou, false);
  });
});

test('o ensaio lista os numeros com as duas formas gravadas, com as Mensagens e as Conversas de cada forma', () => {
  comEstoque((acervo) => {
    const r = aprenderFormasDoCelular(acervo, { comEfeito: false });
    assert.deepEqual(r.duasFormas, [{ formas: [DUAS_A, DUAS_B], mensagens: [1, 2], conversas: [1, 1] }]);
    assert.deepEqual(r.conversasDuplicadas, [{ formas: [DUAS_A, DUAS_B], configuracaoId: CFG_WHATSAPP.id }]);
  });
});

test('com efeito, a Operacao cria so os pares dos numeros de uma forma so, e os que ja existiam ficam como estavam', () => {
  comEstoque((acervo) => {
    const antes = pares(acervo);
    const r = aprenderFormasDoCelular(acervo, { comEfeito: true });
    assert.equal(r.criados, 4);
    assert.equal(r.gravou, true);

    const depois = pares(acervo);
    for (const p of antes) assert.ok(depois.some((d) => d.alternativo === p.alternativo && d.canonico === p.canonico), `par antigo intacto: ${p.alternativo}`);
    assert.deepEqual(
      depois.filter((d) => !antes.some((a) => a.alternativo === d.alternativo)),
      OS_QUATRO,
    );
    assert.ok(!depois.some((d) => d.alternativo === DUAS_A || d.alternativo === DUAS_B), 'as duas formas gravadas: sem par');

    const operacoes = listarOperacoesCruas(acervo).filter((o) => o.natureza === 'aprender-formas-do-celular');
    assert.equal(operacoes.length, 1);
    assert.equal(operacoes[0]?.reversibilidade, 'por-efeito');
    assert.equal(r.operacaoId, operacoes[0]?.id);
    const linhas = linhasDaOperacao(acervo, operacoes[0]?.id as string);
    assert.equal(linhas.length, 4);
    assert.ok(linhas.every((l) => l.tabela === 'correspondencias_de_endereco'), 'nenhum efeito registrado em outra tabela');
  });
});

test('repetir o comando nao cria nada e nao abre outra Operacao', () => {
  comEstoque((acervo) => {
    aprenderFormasDoCelular(acervo, { comEfeito: true });
    const antes = contagens(acervo);
    const r = aprenderFormasDoCelular(acervo, { comEfeito: true });
    assert.equal(r.aCriar, 0);
    assert.equal(r.criados, 0);
    assert.equal(r.operacaoId, null);
    assert.equal(r.jaResolvidos, 5);
    assert.deepEqual(contagens(acervo), antes);
  });
});

test('em lotes de um, o resultado e o mesmo, e o limite corta o numero de pares criados', () => {
  comEstoque((acervo) => {
    const r = aprenderFormasDoCelular(acervo, { comEfeito: true, tamanhoDoLote: 1, limite: 2 });
    assert.equal(r.criados, 2);
    assert.equal(r.aCriar, 2);
    assert.equal(pares(acervo).length, 4 + 2);
    const resto = aprenderFormasDoCelular(acervo, { comEfeito: true, tamanhoDoLote: 1 });
    assert.equal(resto.criados, 2);
    assert.equal(pares(acervo).length, 4 + 4);
  });
});

test('cada lote e uma transacao: o gancho de fim de lote ve os tamanhos', () => {
  comEstoque((acervo) => {
    const lotes: number[] = [];
    aprenderFormasDoCelular(acervo, { comEfeito: true, tamanhoDoLote: 3, aoTerminarLote: (n) => lotes.push(n) });
    assert.deepEqual(lotes, [3, 1]);
  });
});

test('o desfazer remove so os pares da Operacao: o par que ja existia e o que a recepcao aprendeu depois ficam', () => {
  comEstoque((acervo) => {
    const antes = pares(acervo);
    const r = aprenderFormasDoCelular(acervo, { comEfeito: true });
    const depoisDoEstoque = '5511999990000@s.whatsapp.net';
    const doEstoque = '551199990000@s.whatsapp.net';
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: doEstoque });
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: depoisDoEstoque, canonico: doEstoque });

    desfazerOperacao(acervo, r.operacaoId as string);

    assert.deepEqual(
      pares(acervo),
      [...antes, { alternativo: depoisDoEstoque, canonico: doEstoque }].sort((a, b) => (a.alternativo < b.alternativo ? -1 : 1)),
    );
  });
});

test('depois do desfazer, a recepcao reaprende o par na primeira Mensagem da forma alternativa', () => {
  comEstoque((acervo) => {
    const r = aprenderFormasDoCelular(acervo, { comEfeito: true });
    desfazerOperacao(acervo, r.operacaoId as string);
    assert.ok(!pares(acervo).some((p) => p.alternativo === SO_SEM_ALT));

    receberEvento(
      acervo,
      [{ key: { remoteJid: SO_SEM_ALT, id: 'RESP1111', fromMe: false }, messageTimestamp: 1_791_300_000, message: { conversation: 'oi' } }],
      { origemDaChegada: 'ao-vivo', agora: 1_791_300_000_000, configuracao: CFG_WHATSAPP },
    );
    assert.ok(pares(acervo).some((p) => p.alternativo === SO_SEM_ALT && p.canonico === SO_SEM));
    const ids = acervo.db.prepare('SELECT valor FROM identificadores WHERE valor IN (?, ?)').all(SO_SEM, SO_SEM_ALT) as Array<{ valor: string }>;
    assert.deepEqual(ids.map((l) => l.valor), [SO_SEM], 'a Mensagem da forma alternativa nao cria Identificador novo');
  });
});

test('logo depois do efeito, o ensaio da resolucao retroativa nao acha nada a reapontar nos pares novos', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const conversa = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: SO_SEM, coletiva: false, configuracao: CFG_WHATSAPP });
    for (const [n, valor] of [SO_SEM, SO_COM].entries()) {
      registrarMensagem(acervo, {
        origemDaChegada: 'importacao',
        direcao: 'recebida',
        conversaId: conversa,
        fonte: 'whatsapp',
        idExterno: `m${n}`,
        autorId: registrarIdentificador(acervo, { fonte: 'whatsapp', valor }).id,
        ocorridaEm: AGORA - n,
        agora: AGORA,
      });
    }
    assert.equal(aprenderFormasDoCelular(acervo, { comEfeito: true }).criados, 2);
    const r = resolverRetroativamente(acervo, { comEfeito: false });
    assert.deepEqual(r.linhasRepontadas, {});
    assert.deepEqual(r.linhasFundidas, {});
    assert.deepEqual(r.propostasDeMesclagem, []);
  } finally {
    c.limpar();
  }
});

test('o caso legado e a EXCECAO: a retroativa acha as Mensagens da forma gravada que viram alternativa, e so elas', () => {
  comEstoque((acervo) => {
    aprenderFormasDoCelular(acervo, { comEfeito: true });
    const r = resolverRetroativamente(acervo, { comEfeito: false });
    assert.deepEqual(r.linhasRepontadas, { mensagens: 1 }, 'a Mensagem do LEGADO_GRAVADO; nenhuma outra');
  });
});

test('par que aponta para outro lugar e achado: o ensaio o conta, e o efeito nao lanca nem cria par para ele', () => {
  comEstoque((acervo) => {
    const outro = '556599990001@s.whatsapp.net';
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: outro });
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: '5565999990001@s.whatsapp.net', canonico: '556599990002@s.whatsapp.net' });
    const ensaio = aprenderFormasDoCelular(acervo, { comEfeito: false });
    assert.equal(ensaio.conflitos, 1);
    assert.equal(ensaio.aCriar, 4);
    const r = aprenderFormasDoCelular(acervo, { comEfeito: true });
    assert.equal(r.criados, 4);
  });
});

test('a situacao de cada endereco no estoque', () => {
  comEstoque((acervo) => {
    assert.equal(situacaoNoEstoque(acervo, SO_SEM), 'cria');
    assert.equal(situacaoNoEstoque(acervo, SO_COM), 'cria');
    assert.equal(situacaoNoEstoque(acervo, RESPEITA), 'cria-respeitando-canonico');
    assert.equal(situacaoNoEstoque(acervo, LEGADO_GRAVADO), 'cria-legado');
    assert.equal(situacaoNoEstoque(acervo, DUAS_A), 'duas-formas');
    assert.equal(situacaoNoEstoque(acervo, DUAS_B), 'duas-formas');
    assert.equal(situacaoNoEstoque(acervo, JA), 'ja-resolvido');
    assert.equal(situacaoNoEstoque(acervo, JA_ALT), 'ja-resolvido');
    for (const e of [FIXO, NOVE_E_UM, ESTRANGEIRO, LID_R]) assert.equal(situacaoNoEstoque(acervo, e), 'nao-celular');
  });
});

test('Conversas diretas de Configuracoes diferentes nao sao duplicata', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SO_SEM });
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno: SO_SEM, coletiva: false, configuracao: CFG_WHATSAPP });
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno: SO_SEM_ALT, coletiva: false, configuracao: { id: 'configuracao-dois', fonte: 'whatsapp' } });
    assert.deepEqual(aprenderFormasDoCelular(acervo, { comEfeito: false }).conversasDuplicadas, []);
  } finally {
    c.limpar();
  }
});

test('a situacao de um endereco prediz exatamente se o resolvedor cria o par (o ensaio e o efeito sao a mesma decisao)', () => {
  const enderecos = [SO_SEM, SO_SEM_ALT, SO_COM, SO_COM_ALT, DUAS_A, DUAS_B, RESPEITA, RESPEITA_ALT, LEGADO_GRAVADO, LEGADO_CANONICO, JA, JA_ALT, FIXO, NOVE_E_UM, ESTRANGEIRO, LID_R];
  for (const endereco of enderecos) {
    comEstoque((acervo) => {
      const situacao = situacaoNoEstoque(acervo, endereco);
      const antes = pares(acervo).length;
      emOperacao(acervo, { natureza: 'aprender-formas-do-celular', reversibilidade: 'por-efeito' }, (op) => {
        resolverEnderecoDeWhatsapp(acervo, endereco, op);
      });
      const criou = pares(acervo).length - antes;
      assert.equal(criou === 1, situacao.startsWith('cria'), `${endereco}: ${situacao} criou ${criou}`);
      assert.ok(criou <= 1);
    });
  }
});

test('o par entre as duas formas gravadas e o alternativo de outro endereco nao sao "ja resolvido"', () => {
  comEstoque((acervo) => {
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: DUAS_B, canonico: DUAS_A });
    assert.equal(situacaoNoEstoque(acervo, DUAS_B), 'duas-formas');
    assert.equal(situacaoNoEstoque(acervo, DUAS_A), 'duas-formas');
    const outro = '556599990001@s.whatsapp.net';
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: outro });
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: outro, canonico: '556599990002@s.whatsapp.net' });
    assert.equal(situacaoNoEstoque(acervo, outro), 'conflito');
    assert.equal(situacaoNoEstoque(acervo, '5565999990001@s.whatsapp.net'), 'conflito');
  });
});

test('um lote que falha deixa a Operacao com o que ja entrou, e o erro traz o id e a contagem', () => {
  comEstoque((acervo) => {
    let erro: unknown;
    try {
      aprenderFormasDoCelular(acervo, {
        comEfeito: true,
        tamanhoDoLote: 2,
        aoTerminarLote: () => {
          throw new Error('banco ocupado');
        },
      });
    } catch (e) {
      erro = e;
    }
    assert.ok(erro instanceof EstoqueInterrompidoError);
    assert.equal(erro.criados, 2, 'o primeiro lote ja estava gravado');
    assert.equal(pares(acervo).length, 4 + 2);
    assert.equal(linhasDaOperacao(acervo, erro.operacaoId).length, 2);

    desfazerOperacao(acervo, erro.operacaoId);
    assert.equal(pares(acervo).length, 4, 'o desfazer da Operacao parcial remove o que ela criou');
  });
});

test('se o ouvinte aprende todos os pares entre o plano e os lotes, nada foi criado e nenhuma Operacao e devolvida', () => {
  comEstoque((acervo) => {
    const r = aprenderFormasDoCelular(acervo, {
      comEfeito: true,
      ganchoDeTeste: {
        antesDosLotes: () => {
          for (const p of OS_QUATRO) aprenderCorrespondencia(acervo, { fonte: 'whatsapp', ...p });
        },
      },
    });
    assert.equal(r.aCriar, 4);
    assert.equal(r.criados, 0);
    assert.equal(r.operacaoId, null, 'nao ha o que desfazer');
    assert.equal(r.gravou, false);
  });
});

test('o ouvinte aprende um par no meio dos lotes: o estoque o conta como zero e nao lanca', () => {
  comEstoque((acervo) => {
    const r = aprenderFormasDoCelular(acervo, {
      comEfeito: true,
      tamanhoDoLote: 1,
      aoTerminarLote: (() => {
        let lotes = 0;
        return () => {
          lotes += 1;
          if (lotes === 1) aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: SO_SEM_ALT, canonico: SO_SEM });
        };
      })(),
    });
    assert.equal(r.criados, 3, 'um dos quatro foi aprendido pelo ouvinte, na mesma forma, e nao e do estoque');
    assert.equal(pares(acervo).length, 4 + 4);
    assert.equal(linhasDaOperacao(acervo, r.operacaoId as string).length, 3);
  });
});
