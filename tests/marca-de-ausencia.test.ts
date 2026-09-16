import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_CONTATOS, CFG_CONTATOS_SEGUNDA } from './ajuda/configuracao.js';
import { registrarCartaoDeCatalogo, registrarIdentificador } from '../src/nucleo/escrita.js';
import { criarPessoa, registrarNome, vincularIdentificador } from '../src/nucleo/identidade.js';
import { marcarAusentes, AusenciaDesproporcionalError } from '../src/nucleo/ausencia.js';
import type { Acervo } from '../src/nucleo/acervo.js';

const T1 = '2026-09-01T00:00:00Z';
const T2 = '2026-09-10T00:00:00Z';
const T3 = '2026-09-20T00:00:00Z';

/** Um endereço com Cartão numa base. Devolve o id do Identificador. */
function endereco(acervo: Acervo, valor: string, cartao: string, cfg: string, quando: string): string {
  const { id } = registrarIdentificador(acervo, { fonte: 'contatos', valor });
  registrarCartaoDeCatalogo(acervo, id, cartao, cfg, quando);
  return id;
}

function ausentes(acervo: Acervo, cfg: string): string[] {
  return (
    acervo.db
      .prepare(
        `SELECT identificador_id FROM cartoes_de_catalogo
          WHERE configuracao_id = ? AND ausente_em IS NOT NULL
          ORDER BY identificador_id`,
      )
      .all(cfg) as Array<{ identificador_id: string }>
  ).map((l) => l.identificador_id);
}

test('material completo IDÊNTICO produz ZERO marcas — e o teste prova que rodou', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const a = endereco(acervo, '5565900000001', 'cartao-1', CFG_CONTATOS.id, T1);
    const b = endereco(acervo, '5565900000002', 'cartao-2', CFG_CONTATOS.id, T1);

    // A segunda passada reavista os DOIS — é o material idêntico.
    registrarCartaoDeCatalogo(acervo, a, 'cartao-1', CFG_CONTATOS.id, T2);
    registrarCartaoDeCatalogo(acervo, b, 'cartao-2', CFG_CONTATOS.id, T2);

    // O PAR OBRIGATÓRIO. Um teste que só verifica "material idêntico não marca"
    // passa numa implementação que NUNCA marca. A prova de que a passada rodou
    // é o instante ter avançado, medida ANTES de contar zero.
    const avancou = acervo.db
      .prepare(
        `SELECT COUNT(*) AS n FROM cartoes_de_catalogo
          WHERE configuracao_id = ? AND ultimo_avistamento = ?`,
      )
      .get(CFG_CONTATOS.id, T2) as { n: number };
    assert.equal(avancou.n, 2, 'os dois foram reavistados');

    const r = marcarAusentes(acervo, { configuracaoId: CFG_CONTATOS.id, instanteDaPassada: T2 });
    assert.equal(r.marcados, 0);
    assert.deepEqual(ausentes(acervo, CFG_CONTATOS.id), []);
  } finally {
    c.limpar();
  }
});

test('um cartão a menos produz EXATAMENTE uma marca, naquele cartão', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const a = endereco(acervo, '5565900000001', 'cartao-1', CFG_CONTATOS.id, T1);
    const b = endereco(acervo, '5565900000002', 'cartao-2', CFG_CONTATOS.id, T1);
    const d = endereco(acervo, '5565900000003', 'cartao-3', CFG_CONTATOS.id, T1);
    const e = endereco(acervo, '5565900000004', 'cartao-4', CFG_CONTATOS.id, T1);
    const f = endereco(acervo, '5565900000005', 'cartao-5', CFG_CONTATOS.id, T1);

    // O segundo material traz todos menos o `b`.
    for (const [id, cartao] of [[a, 'cartao-1'], [d, 'cartao-3'], [e, 'cartao-4'], [f, 'cartao-5']]) {
      registrarCartaoDeCatalogo(acervo, id as string, cartao as string, CFG_CONTATOS.id, T2);
    }

    const r = marcarAusentes(acervo, { configuracaoId: CFG_CONTATOS.id, instanteDaPassada: T2 });
    assert.equal(r.marcados, 1);
    assert.deepEqual(ausentes(acervo, CFG_CONTATOS.id), [b]);
  } finally {
    c.limpar();
  }
});

test('a marcação NÃO alcança outra Configuração', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const daOutra = endereco(acervo, '5565900000009', 'cartao-B', CFG_CONTATOS_SEGUNDA.id, T1);
    const daMinha = endereco(acervo, '5565900000001', 'cartao-1', CFG_CONTATOS.id, T1);
    registrarCartaoDeCatalogo(acervo, daMinha, 'cartao-1', CFG_CONTATOS.id, T2);

    marcarAusentes(acervo, { configuracaoId: CFG_CONTATOS.id, instanteDaPassada: T2 });
    // A base B não foi processada nesta passada, e não sumiu de lugar nenhum.
    assert.deepEqual(ausentes(acervo, CFG_CONTATOS_SEGUNDA.id), [], `${daOutra} não é minha`);
  } finally {
    c.limpar();
  }
});

test('marcar NÃO remove: Cartão legível, vínculo intacto, Atribuição de pé', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const a = endereco(acervo, '5565900000001', 'cartao-1', CFG_CONTATOS.id, T1);
    const b = endereco(acervo, '5565900000002', 'cartao-2', CFG_CONTATOS.id, T1);
    // VINCULADO A UMA PESSOA ANTES da marca — senão o teste passa sobre o caso
    // fácil, em que não havia trabalho humano a perder.
    const pessoa = criarPessoa(acervo);
    vincularIdentificador(acervo, { identificadorId: b, pessoaId: pessoa, procedencia: 'humano' });
    registrarNome(acervo, { autoridade: 'terceiro',
      identificadorId: b, origem: 'contatos', configuracaoId: CFG_CONTATOS.id, nome: 'Han Solo',
    });

    registrarCartaoDeCatalogo(acervo, a, 'cartao-1', CFG_CONTATOS.id, T2);
    // `limite: 1` porque este caso NAO mede a guarda proporcional: com dois
    // Cartoes, um ausente ja e 50% e a guarda — corretamente — abortaria. O
    // que se mede aqui e que marcar nao remove.
    marcarAusentes(acervo, { configuracaoId: CFG_CONTATOS.id, instanteDaPassada: T2, limite: 1 });
    assert.deepEqual(ausentes(acervo, CFG_CONTATOS.id), [b]);

    const cartao = acervo.db
      .prepare('SELECT cartao FROM cartoes_de_catalogo WHERE identificador_id = ?')
      .get(b) as { cartao: string } | undefined;
    assert.equal(cartao?.cartao, 'cartao-2', 'o Cartão continua legível');

    const vinculo = acervo.db
      .prepare('SELECT pessoa_id, procedencia FROM identificadores WHERE id = ?')
      .get(b) as { pessoa_id: string | null; procedencia: string | null };
    assert.equal(vinculo.pessoa_id, pessoa, 'o vínculo continua');
    assert.equal(vinculo.procedencia, 'humano');

    const nome = acervo.db
      .prepare('SELECT COUNT(*) AS n FROM atribuicoes_de_nome WHERE identificador_id = ?')
      .get(b) as { n: number };
    assert.equal(nome.n, 1, 'a Atribuição continua existindo');
  } finally {
    c.limpar();
  }
});

test('reaparecer num material seguinte DESFAZ a marca', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const a = endereco(acervo, '5565900000001', 'cartao-1', CFG_CONTATOS.id, T1);
    const b = endereco(acervo, '5565900000002', 'cartao-2', CFG_CONTATOS.id, T1);

    registrarCartaoDeCatalogo(acervo, a, 'cartao-1', CFG_CONTATOS.id, T2);
    // `limite: 1` pela mesma razao do caso anterior: com dois Cartoes a guarda
    // abortaria, e o que se mede aqui e reaparecer desfazer a marca.
    marcarAusentes(acervo, { configuracaoId: CFG_CONTATOS.id, instanteDaPassada: T2, limite: 1 });
    assert.deepEqual(ausentes(acervo, CFG_CONTATOS.id), [b]);

    // O `b` volta no material seguinte.
    registrarCartaoDeCatalogo(acervo, a, 'cartao-1', CFG_CONTATOS.id, T3);
    registrarCartaoDeCatalogo(acervo, b, 'cartao-2', CFG_CONTATOS.id, T3);
    marcarAusentes(acervo, { configuracaoId: CFG_CONTATOS.id, instanteDaPassada: T3, limite: 1 });
    assert.deepEqual(ausentes(acervo, CFG_CONTATOS.id), [], 'reaparecer desfaz');
  } finally {
    c.limpar();
  }
});

test('a guarda proporcional ABORTA e relata, em vez de marcar em massa', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      ids.push(endereco(acervo, `55659000000${10 + i}`, `cartao-${i}`, CFG_CONTATOS.id, T1));
    }
    // Só UM reavistado: 90% sumiriam. Quem exportou um subconjunto e declarou
    // a Configuração como completa marcaria quase tudo — e a marca é
    // reversível, mas marcar 6.693 cartões de uma vez não é operação que se
    // descubra depois.
    registrarCartaoDeCatalogo(acervo, ids[0] as string, 'cartao-0', CFG_CONTATOS.id, T2);

    assert.throws(
      () => marcarAusentes(acervo, { configuracaoId: CFG_CONTATOS.id, instanteDaPassada: T2 }),
      (erro: unknown) => {
        assert.ok(erro instanceof AusenciaDesproporcionalError);
        return true;
      },
    );
    assert.deepEqual(ausentes(acervo, CFG_CONTATOS.id), [], 'abortou SEM marcar nada');
  } finally {
    c.limpar();
  }
});

test('a guarda NÃO dispara dentro do limite', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      ids.push(endereco(acervo, `55659000000${10 + i}`, `cartao-${i}`, CFG_CONTATOS.id, T1));
    }
    // Nove reavistados: 10% somem, dentro do padrão de 20%. Sem este caso, uma
    // guarda que SEMPRE aborta passaria no teste acima.
    for (let i = 0; i < 9; i += 1) {
      registrarCartaoDeCatalogo(acervo, ids[i] as string, `cartao-${i}`, CFG_CONTATOS.id, T2);
    }
    const r = marcarAusentes(acervo, { configuracaoId: CFG_CONTATOS.id, instanteDaPassada: T2 });
    assert.equal(r.marcados, 1);
  } finally {
    c.limpar();
  }
});

test('o limite é DECLARADO, e sobrescritível por invocação', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      ids.push(endereco(acervo, `55659000000${10 + i}`, `cartao-${i}`, CFG_CONTATOS.id, T1));
    }
    registrarCartaoDeCatalogo(acervo, ids[0] as string, 'cartao-0', CFG_CONTATOS.id, T2);
    // 90% com o limite em 95%: passa. O limite não é implícito.
    const r = marcarAusentes(acervo, {
      configuracaoId: CFG_CONTATOS.id, instanteDaPassada: T2, limite: 0.95,
    });
    assert.equal(r.marcados, 9);
  } finally {
    c.limpar();
  }
});
