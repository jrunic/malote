import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_CONTATOS, CFG_CONTATOS_SEGUNDA } from './ajuda/configuracao.js';
import { registrarCartaoDeCatalogo, registrarIdentificador } from '../src/nucleo/escrita.js';
import { criarPessoa, registrarNome, vincularIdentificador } from '../src/nucleo/identidade.js';
import { aplicarConjunto } from '../src/nucleo/aplicacao.js';
import { aplicarLote } from '../src/adaptadores/contatos/lote.js';

const QUANDO = '2026-09-12T12:00:00Z';

test('o Cartão diz de qual catálogo veio', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const { id } = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5565900000001' });
    registrarCartaoDeCatalogo(acervo, id, 'cartao-1', CFG_CONTATOS.id, QUANDO);
    const l = acervo.db
      .prepare('SELECT configuracao_id FROM cartoes_de_catalogo WHERE identificador_id = ?')
      .get(id) as { configuracao_id: string };
    assert.equal(l.configuracao_id, CFG_CONTATOS.id);
  } finally {
    c.limpar();
  }
});

test('a Atribuição de Nome diz de qual catálogo veio', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const { id } = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5565900000001' });
    registrarNome(acervo, { autoridade: 'terceiro',
      identificadorId: id,
      origem: 'contatos',
      configuracaoId: CFG_CONTATOS.id,
      nome: 'Leia Organa',
    });
    const l = acervo.db
      .prepare('SELECT origem, configuracao_id FROM atribuicoes_de_nome WHERE identificador_id = ?')
      .get(id) as { origem: string; configuracao_id: string };
    assert.equal(l.origem, 'contatos', 'a origem continua sendo a FONTE');
    assert.equal(l.configuracao_id, CFG_CONTATOS.id);
  } finally {
    c.limpar();
  }
});

test('nome de plataforma continua SEM Configuração, e a unicidade dele sobrevive', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const { id } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000001' });
    // O ramo IS NULL dos índices parciais. O SQLite trata NULL como distinto de
    // NULL: sem esse ramo, reimportar o mesmo material de plataforma duplicaria
    // as atribuições em silêncio — e produção tem 11.948 delas.
    assert.equal(registrarNome(acervo, { autoridade: 'terceiro', identificadorId: id, origem: 'whatsapp', nome: 'Leia' }), true);
    assert.equal(registrarNome(acervo, { autoridade: 'terceiro', identificadorId: id, origem: 'whatsapp', nome: 'Leia' }), false);
    const n = acervo.db
      .prepare('SELECT COUNT(*) AS n FROM atribuicoes_de_nome WHERE identificador_id = ?')
      .get(id) as { n: number };
    assert.equal(n.n, 1);
  } finally {
    c.limpar();
  }
});

test('o mesmo nome vindo de DUAS bases convive — a Configuração desempata', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const { id } = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5565900000001' });
    const comum = { identificadorId: id, origem: 'contatos', nome: 'Leia Organa' } as const;
    assert.equal(registrarNome(acervo, { autoridade: 'terceiro', ...comum, configuracaoId: CFG_CONTATOS.id }), true);
    assert.equal(
      registrarNome(acervo, { autoridade: 'terceiro', ...comum, configuracaoId: CFG_CONTATOS_SEGUNDA.id }), true,
      'outra base é outra evidência, e não duplicata',
    );
    assert.equal(registrarNome(acervo, { autoridade: 'terceiro', ...comum, configuracaoId: CFG_CONTATOS.id }), false);
  } finally {
    c.limpar();
  }
});

test('o vínculo grava a Configuração quando ela é ÚNICA', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const { id } = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5565900000001' });
    const pessoa = criarPessoa(acervo);
    vincularIdentificador(acervo, {
      identificadorId: id,
      pessoaId: pessoa,
      procedencia: 'catalogo',
      configuracaoId: CFG_CONTATOS.id,
    });
    const l = acervo.db
      .prepare('SELECT configuracao_id FROM identificadores WHERE id = ?')
      .get(id) as { configuracao_id: string | null };
    assert.equal(l.configuracao_id, CFG_CONTATOS.id);
  } finally {
    c.limpar();
  }
});

test('o vínculo grava NULO quando a evidência vem de duas bases', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const a = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5565900000001' }).id;
    const b = registrarIdentificador(acervo, { fonte: 'contatos', valor: 'leia@exemplo.test' }).id;
    // Sem `configuracaoId`: quem aplica não tem UMA Configuração a declarar,
    // porque a Proposta atravessa duas. Escolher a primeira em ordem estável
    // diria uma coisa que não é verdade.
    aplicarConjunto(acervo, [a, b], {});
    const linhas = acervo.db
      .prepare('SELECT configuracao_id FROM identificadores WHERE id IN (?, ?)')
      .all(a, b) as Array<{ configuracao_id: string | null }>;
    assert.deepEqual(linhas.map((l) => l.configuracao_id), [null, null]);
  } finally {
    c.limpar();
  }
});

test('aplicar com UMA Configuração declara-a nos vínculos que cria', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const a = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5565900000001' }).id;
    const b = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5565900000002' }).id;
    aplicarConjunto(acervo, [a, b], { configuracaoId: CFG_CONTATOS.id });
    const linhas = acervo.db
      .prepare('SELECT configuracao_id FROM identificadores WHERE id IN (?, ?)')
      .all(a, b) as Array<{ configuracao_id: string | null }>;
    assert.deepEqual(linhas.map((l) => l.configuracao_id), [CFG_CONTATOS.id, CFG_CONTATOS.id]);
  } finally {
    c.limpar();
  }
});

test('o LOTE declara a Configuração só quando a Proposta tem uma', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const a = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5565900000001' }).id;
    const b = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5565900000002' }).id;
    const x = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5565900000003' }).id;
    const y = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5565900000004' }).id;

    aplicarLote(acervo, [
      {
        produtor: 'multiplos-enderecos',
        identificadores: [a, b],
        evidencia: 'uma base',
        configuracoes: [CFG_CONTATOS.id],
      },
      {
        produtor: 'email',
        identificadores: [x, y],
        evidencia: 'duas bases',
        configuracoes: [CFG_CONTATOS.id, CFG_CONTATOS_SEGUNDA.id],
      },
    ]);

    const ler = (id: string): string | null =>
      (
        acervo.db.prepare('SELECT configuracao_id FROM identificadores WHERE id = ?').get(id) as {
          configuracao_id: string | null;
        }
      ).configuracao_id;

    assert.equal(ler(a), CFG_CONTATOS.id, 'uma base: o vínculo a declara');
    assert.equal(ler(b), CFG_CONTATOS.id);
    // Este é o par que o mutante pega: pegar `configuracoes[0]` sem checar o
    // tamanho faria o vínculo afirmar uma base que não sustenta a evidência
    // sozinha — e é afirmação de auditoria, não rótulo de conveniência.
    assert.equal(ler(x), null, 'duas bases: nenhuma delas sustenta o vínculo sozinha');
    assert.equal(ler(y), null);
  } finally {
    c.limpar();
  }
});

const T1 = '2026-09-01T00:00:00Z';
const T2 = '2026-09-10T00:00:00Z';

test('reavistar move o último avistamento no Cartão E na Atribuição', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const { id } = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5565900000001' });
    const nome = { identificadorId: id, origem: 'contatos', configuracaoId: CFG_CONTATOS.id,
      nome: 'Leia Organa' } as const;

    registrarCartaoDeCatalogo(acervo, id, 'cartao-1', CFG_CONTATOS.id, T1);
    registrarNome(acervo, { autoridade: 'terceiro', ...nome, atribuidoEm: T1 });

    // RELÓGIO INJETADO e comparação ESTRITA. Dois processamentos com o mesmo
    // relógio passariam sem avanço, e o teste mediria nada — é o que a spec
    // avisou: contar linhas passa hoje, sem nenhuma mudança.
    registrarCartaoDeCatalogo(acervo, id, 'cartao-1', CFG_CONTATOS.id, T2);
    registrarNome(acervo, { autoridade: 'terceiro', ...nome, atribuidoEm: T2 });

    const cartao = acervo.db
      .prepare('SELECT visto_em, ultimo_avistamento FROM cartoes_de_catalogo WHERE identificador_id = ?')
      .get(id) as { visto_em: string; ultimo_avistamento: string };
    assert.equal(cartao.ultimo_avistamento, T2, 'o Cartão avançou');
    assert.equal(cartao.visto_em, T1, 'a PRIMEIRA vez continua sendo a primeira');

    const atribuicao = acervo.db
      .prepare('SELECT atribuido_em, ultimo_avistamento FROM atribuicoes_de_nome WHERE identificador_id = ?')
      .get(id) as { atribuido_em: string; ultimo_avistamento: string };
    assert.equal(atribuicao.ultimo_avistamento, T2, 'a Atribuição avançou');
    // Mover `atribuido_em` faria re-avistar um nome antigo trazê-lo de volta ao
    // topo do desempate por recência — mudança de comportamento observável que
    // ninguém pediu.
    assert.equal(atribuicao.atribuido_em, T1);
  } finally {
    c.limpar();
  }
});

test('reavistar NÃO cria linha nova', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const { id } = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5565900000001' });
    const nome = { identificadorId: id, origem: 'contatos', configuracaoId: CFG_CONTATOS.id,
      nome: 'Leia Organa' } as const;

    registrarCartaoDeCatalogo(acervo, id, 'cartao-1', CFG_CONTATOS.id, T1);
    assert.equal(registrarNome(acervo, { autoridade: 'terceiro', ...nome, atribuidoEm: T1 }), true);
    registrarCartaoDeCatalogo(acervo, id, 'cartao-1', CFG_CONTATOS.id, T2);
    assert.equal(
      registrarNome(acervo, { autoridade: 'terceiro', ...nome, atribuidoEm: T2 }), false,
      'reavistar não é nome novo, e o relatório não pode contá-lo como criação',
    );

    const n = (tabela: string): number =>
      (acervo.db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number }).n;
    assert.equal(n('cartoes_de_catalogo'), 1);
    assert.equal(n('atribuicoes_de_nome'), 1);
  } finally {
    c.limpar();
  }
});

test('reavistar DESFAZ a marca de ausência', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const { id } = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5565900000001' });
    registrarCartaoDeCatalogo(acervo, id, 'cartao-1', CFG_CONTATOS.id, T1);
    acervo.db
      .prepare('UPDATE cartoes_de_catalogo SET ausente_em = ? WHERE identificador_id = ?')
      .run(T1, id);

    registrarCartaoDeCatalogo(acervo, id, 'cartao-1', CFG_CONTATOS.id, T2);

    const l = acervo.db
      .prepare('SELECT ausente_em FROM cartoes_de_catalogo WHERE identificador_id = ?')
      .get(id) as { ausente_em: string | null };
    // O critério 18 inteiro, e ele é ATÔMICO com o reavistamento que o causa:
    // reaparecer desfaz a marca na mesma escrita, sem um segundo comando que
    // alguém possa esquecer de chamar.
    assert.equal(l.ausente_em, null);
  } finally {
    c.limpar();
  }
});
