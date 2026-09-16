import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { instalacaoTemporaria, instalacaoComInquilino, rodar } from './ajuda/instalacao.js';
import { abrirRegistro } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { CFG_CONTATOS, CFG_CONTATOS_SEGUNDA } from './ajuda/configuracao.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import { nomeDoIdentificador, registrarNome } from '../src/nucleo/identidade.js';
import { PRECEDENCIA_PADRAO } from '../src/registro/precedencia-de-nome.js';
import type { Acervo } from '../src/nucleo/acervo.js';

const T1 = '2026-09-01T00:00:00Z';
const T2 = '2026-09-10T00:00:00Z';

/** Um endereço com um nome de cada catálogo. O da base A entra PRIMEIRO. */
function comDoisCatalogos(acervo: Acervo): string {
  const { id } = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5565900000001' });
  registrarNome(acervo, { autoridade: 'terceiro',
    identificadorId: id, origem: 'contatos', configuracaoId: CFG_CONTATOS.id,
    nome: 'Leia da base A', atribuidoEm: T1,
  });
  registrarNome(acervo, { autoridade: 'terceiro',
    identificadorId: id, origem: 'contatos', configuracaoId: CFG_CONTATOS_SEGUNDA.id,
    nome: 'Leia da base B', atribuidoEm: T2,
  });
  return id;
}

test('declarar o catálogo preferido troca o nome exibido, NAS DUAS DIREÇÕES', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const id = comDoisCatalogos(acervo);

    // AS DUAS DIREÇÕES importam: numa só, o desempate por recência pode dar o
    // resultado certo pelo motivo errado. A base B é a mais recente, então
    // preferi-la não prova nada sozinha.
    assert.equal(
      nomeDoIdentificador(acervo, id, {
        porOrigem: PRECEDENCIA_PADRAO,
        catalogoPreferido: CFG_CONTATOS.id,
      }),
      'Leia da base A',
      'a preferida vence a mais recente',
    );
    assert.equal(
      nomeDoIdentificador(acervo, id, {
        porOrigem: PRECEDENCIA_PADRAO,
        catalogoPreferido: CFG_CONTATOS_SEGUNDA.id,
      }),
      'Leia da base B',
    );
  } finally {
    c.limpar();
  }
});

test('sem preferência declarada, o desempate entre catálogos continua por recência', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const id = comDoisCatalogos(acervo);
    assert.equal(
      nomeDoIdentificador(acervo, id, {
        porOrigem: PRECEDENCIA_PADRAO,
        catalogoPreferido: null,
      }),
      'Leia da base B',
      'o comportamento de hoje sobrevive quando ninguém declara',
    );
  } finally {
    c.limpar();
  }
});

test('nome de catálogo continua ACIMA de nome de plataforma', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const { id } = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5565900000001' });
    // O de plataforma é o MAIS RECENTE de propósito: se a precedência por
    // origem tivesse caído, a recência o traria ao topo e o teste pegaria.
    registrarNome(acervo, { autoridade: 'terceiro',
      identificadorId: id, origem: 'contatos', configuracaoId: CFG_CONTATOS.id,
      nome: 'Leia Organa', atribuidoEm: T1,
    });
    registrarNome(acervo, { autoridade: 'terceiro',
      identificadorId: id, origem: 'whatsapp', nome: 'leia sp', atribuidoEm: T2,
    });

    // ESTE É O TESTE DE REGRESSÃO DO DESENHO INTEIRO. `melhorNome` faz lookup
    // EXATO por origem: gravar a origem como 'contatos:catalogo' faria o
    // peso cair para ZERO e o nome de catálogo ficar abaixo do whatsapp —
    // inclusive para as 11.948 atribuições de origem `whatsapp` já gravadas em
    // produção. É por isso que a Configuração é COLUNA, e não parte da origem.
    for (const preferido of [null, CFG_CONTATOS.id, CFG_CONTATOS_SEGUNDA.id]) {
      assert.equal(
        nomeDoIdentificador(acervo, id, { porOrigem: PRECEDENCIA_PADRAO, catalogoPreferido: preferido }),
        'Leia Organa',
        `a preferência entre catálogos não pode atravessar Fontes (preferido: ${preferido})`,
      );
    }
  } finally {
    c.limpar();
  }
});

test('a preferência NÃO desempata dentro de uma Fonte que não é catálogo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const { id } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000001' });
    registrarNome(acervo, { autoridade: 'terceiro', identificadorId: id, origem: 'whatsapp', nome: 'antigo', atribuidoEm: T1 });
    registrarNome(acervo, { autoridade: 'terceiro', identificadorId: id, origem: 'whatsapp', nome: 'recente', atribuidoEm: T2 });
    // Nome de plataforma não tem Configuração. Declarar um catálogo preferido
    // não pode mexer no desempate dele — que continua sendo por recência.
    assert.equal(
      nomeDoIdentificador(acervo, id, {
        porOrigem: PRECEDENCIA_PADRAO, catalogoPreferido: CFG_CONTATOS.id,
      }),
      'recente',
    );
  } finally {
    c.limpar();
  }
});

test('pessoa precedencia --catalogo-preferido grava e mostra', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const registro = abrirRegistro(raiz);
    resolverConfiguracao(registro, inquilino, 'contatos', 'catalogo');
    registro.fechar();

    const r = rodar(raiz, [
      'pessoa', 'precedencia', '--inquilino', inquilino, '--catalogo-preferido', 'catalogo',
    ]);
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /catalogo preferido: catalogo/);

    // E persiste: a leitura seguinte, sem a bandeira, continua mostrando.
    const depois = rodar(raiz, ['pessoa', 'precedencia', '--inquilino', inquilino]);
    assert.match(depois.saida, /catalogo preferido: catalogo/);
  } finally {
    limpar();
  }
});

test('apelido que não existe é recusado, e nada fica gravado', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const r = rodar(raiz, [
      'pessoa', 'precedencia', '--inquilino', inquilino, '--catalogo-preferido', 'nao-existe',
    ]);
    assert.notEqual(r.codigo, 0, r.saida);
    const depois = rodar(raiz, ['pessoa', 'precedencia', '--inquilino', inquilino]);
    assert.doesNotMatch(depois.saida, /catalogo preferido/);
  } finally {
    limpar();
  }
});

test('o catálogo preferido NÃO vence uma origem de peso MAIOR', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const { id } = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5565900000001' });
    // O do catálogo preferido é o MAIS ANTIGO de propósito: a lista chega do
    // mais recente para o mais antigo, então o `manual` é visto primeiro. Com
    // o catálogo mais novo, ele seria visto antes e o defeito se esconderia.
    registrarNome(acervo, { autoridade: 'terceiro',
      identificadorId: id, origem: 'contatos', configuracaoId: CFG_CONTATOS.id,
      nome: 'Leia do catálogo', atribuidoEm: T1,
    });
    registrarNome(acervo, { autoridade: 'terceiro',
      identificadorId: id, origem: 'manual', nome: 'Leia à mão', atribuidoEm: T2,
    });

    // ESTE CASO NASCEU DE UM MUTANTE QUE SOBREVIVEU. Sem ele, uma implementação
    // em que a preferência vale para QUALQUER peso — e não só no empate —
    // passava em todos os outros testes: neles o catálogo já era o mais pesado,
    // então vencer por preferência dava o resultado certo pelo motivo errado.
    //
    // A preferência é desempate DENTRO da Fonte, nunca um passe livre.
    assert.equal(
      nomeDoIdentificador(acervo, id, {
        porOrigem: PRECEDENCIA_PADRAO,
        catalogoPreferido: CFG_CONTATOS.id,
      }),
      'Leia à mão',
      'manual pesa 300 e catálogo pesa 200: a preferência não atravessa isso',
    );
  } finally {
    c.limpar();
  }
});
