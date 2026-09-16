import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { criarPessoa } from '../src/nucleo/identidade.js';
import { familiaDe, mestreDe } from '../src/nucleo/familia.js';
import { conferirMesclagem } from '../src/nucleo/integridade.js';
import { GUARDAS_DA_ESTRELA } from '../src/nucleo/schema-acervo.js';
import {
  historicoDeNomes,
  identificadoresDaPessoa,
  desfazerMesclagem,
  mesclarPessoas,
  nomeDaPessoa,
  nomesDaPessoa,
  registrarNome,
  vincularIdentificador,
} from '../src/nucleo/identidade.js';
import {
  registrarConversa,
  registrarIdentificador,
  registrarMensagem,
  registrarParticipacao,
} from '../src/nucleo/escrita.js';
import { lerMensagens, listarConversas } from '../src/nucleo/consulta.js';
import { PRECEDENCIA_PADRAO } from '../src/registro/precedencia-de-nome.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

/** Quantas Pessoas existem — o critério 18 se verifica por contagem, não por ausência de DELETE. */
function contarPessoas(acervo: Acervo): number {
  return (acervo.db.prepare('SELECT COUNT(*) AS n FROM pessoas').get() as { n: number }).n;
}

/** Aponta direto na tabela, para exercer a guarda e não o código da aplicação. */
function apontar(acervo: Acervo, quem: string, para: string | null): void {
  acervo.db
    .prepare('UPDATE pessoas SET absorvida_por = ?, absorvida_em = ? WHERE id = ?')
    .run(para, para === null ? null : new Date().toISOString(), quem);
}

test('o Acervo recusa apontar para uma Pessoa que já está absorvida', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const a = criarPessoa(acervo);
    const b = criarPessoa(acervo);
    const d = criarPessoa(acervo);
    apontar(acervo, b, a);
    // A guarda que valida a mestre indicada.
    assert.throws(() => apontar(acervo, d, b), /raiz/i);
  } finally {
    c.limpar();
  }
});

test('o Acervo recusa absorver quem ainda é mestre de outras', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const a = criarPessoa(acervo);
    const b = criarPessoa(acervo);
    const d = criarPessoa(acervo);
    apontar(acervo, b, a);
    // Esta é a guarda que não é óbvia: a escrita é na linha de A, e validar D
    // (que é raiz) nada diz sobre B, que seguia A. Sem ela, B fica apontando
    // para quem deixou de ser raiz — e em silêncio.
    assert.throws(() => apontar(acervo, a, d), /mestre de outras/i);
  } finally {
    c.limpar();
  }
});

test('reapontar um seguidor para outra raiz é permitido', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const a = criarPessoa(acervo);
    const b = criarPessoa(acervo);
    const d = criarPessoa(acervo);
    apontar(acervo, b, a);
    apontar(acervo, b, d); // B já era absorvida: a segunda guarda não se aplica
    apontar(acervo, a, d); // agora A não é mais mestre de ninguém
    const linhas = acervo.db.prepare('SELECT id, absorvida_por FROM pessoas').all() as Array<{
      id: string;
      absorvida_por: string | null;
    }>;
    const mapa = Object.fromEntries(linhas.map((l) => [l.id, l.absorvida_por]));
    assert.equal(mapa[b], d);
    assert.equal(mapa[a], d);
    assert.equal(mapa[d], null);
    assert.equal(contarPessoas(acervo), 3);
  } finally {
    c.limpar();
  }
});

test('a família de uma mestre são ela e todas as absorvidas nela', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const a = criarPessoa(acervo);
    const b = criarPessoa(acervo);
    const d = criarPessoa(acervo);
    apontar(acervo, b, a);
    apontar(acervo, d, a);
    assert.deepEqual(familiaDe(acervo, a).sort(), [a, b, d].sort());
    // A família de uma ABSORVIDA é ela mesma: a leitura dela não redireciona.
    assert.deepEqual(familiaDe(acervo, b), [b]);
    assert.equal(mestreDe(acervo, b), a);
    assert.equal(mestreDe(acervo, a), a);
  } finally {
    c.limpar();
  }
});

/** Cria Conversa, Mensagem e Identificador vinculado à Pessoa; devolve quantas Mensagens criou. */
function mensagensDe(acervo: Acervo, pessoaId: string, marca: string, quantas: number): number {
  const { id: ident } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: `end-${marca}` });
  vincularIdentificador(acervo, { identificadorId: ident, pessoaId, procedencia: 'humano' });
  const conversaId = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: `conversa-${marca}`,
    coletiva: false, configuracao: CFG_WHATSAPP,
  });
  // A Participação é o que `listarConversas` consulta — a Conversa é da Pessoa
  // por ela estar lá, mesmo sem ter falado. Sem isto, o teste mede o vazio.
  registrarParticipacao(acervo, {
    conversaId,
    identificadorId: ident,
    observadaEm: new Date().toISOString(),
  });
  for (let i = 0; i < quantas; i += 1) {
    registrarMensagem(acervo, {
      conversaId,
      fonte: 'whatsapp',
      idExterno: `msg-${marca}-${i}`,
      autorId: ident,
      conteudo: `texto ${marca} ${i}`,
      ocorridaEm: Date.UTC(2026, 0, 1) + i,
      agora: Date.now(),
    });
  }
  return quantas;
}

test('ler a mestre alcança Identificadores e nomes de toda a família', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const a = criarPessoa(acervo);
    const b = criarPessoa(acervo);
    const { id: iA } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511900000001' });
    const { id: iB } = registrarIdentificador(acervo, { fonte: 'instagram', valor: 'perfil-b' });
    vincularIdentificador(acervo, { identificadorId: iA, pessoaId: a, procedencia: 'humano' });
    vincularIdentificador(acervo, { identificadorId: iB, pessoaId: b, procedencia: 'humano' });
    registrarNome(acervo, { autoridade: 'terceiro', pessoaId: b, origem: 'manual', nome: 'Nome da B' });

    apontar(acervo, b, a);

    // Sem canonizar, esta leitura devolve só o Identificador de A.
    const ids = identificadoresDaPessoa(acervo, a).map((i) => i.id).sort();
    assert.deepEqual(ids, [iA, iB].sort(), 'a mestre alcança os endereços da família');
    assert.ok(
      historicoDeNomes(acervo, a).some((n) => n.nome === 'Nome da B'),
      'a mestre alcança os nomes da família',
    );
    assert.equal(nomeDaPessoa(acervo, a, { porOrigem: PRECEDENCIA_PADRAO, catalogoPreferido: null }), 'Nome da B');

    // A absorvida continua com o que sempre teve — nada foi movido.
    assert.deepEqual(identificadoresDaPessoa(acervo, b).map((i) => i.id), [iB]);
  } finally {
    c.limpar();
  }
});

test('consultar Mensagem pela mestre alcança as Mensagens da família', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const a = criarPessoa(acervo);
    const b = criarPessoa(acervo);
    const nA = mensagensDe(acervo, a, 'aa', 3);
    const nB = mensagensDe(acervo, b, 'bb', 2);
    assert.ok(nA > 0 && nB > 0, 'as duas precisam ter Mensagem, senão o teste mede o vazio');
    assert.equal(lerMensagens(acervo, { pessoaId: a }).length, nA, 'antes de mesclar, só as de A');

    apontar(acervo, b, a);

    assert.equal(
      lerMensagens(acervo, { pessoaId: a }).length,
      nA + nB,
      'a soma das duas, sem duplicar',
    );
    assert.equal(listarConversas(acervo, { pessoaId: a }).length, 2, 'as Conversas da família');
  } finally {
    c.limpar();
  }
});

const AGORA = Date.UTC(2026, 7, 29);

test('mesclar não move nem copia: a absorvida mantém o que tinha', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const a = criarPessoa(acervo);
    const b = criarPessoa(acervo);
    const { id: iB } = registrarIdentificador(acervo, { fonte: 'instagram', valor: 'perfil-bb' });
    vincularIdentificador(acervo, { identificadorId: iB, pessoaId: b, procedencia: 'humano' });
    registrarNome(acervo, { autoridade: 'terceiro', pessoaId: b, origem: 'manual', nome: 'Nome da B' });

    const antesIds = identificadoresDaPessoa(acervo, b).map((i) => i.id);
    const antesNomes = nomesDaPessoa(acervo, b).map((n) => n.nome);

    const r = mesclarPessoas(acervo, { pessoaA: a, pessoaB: b, quando: AGORA });

    // Comparação de CONJUNTO, não de contagem: o total do Acervo não muda
    // quando linhas trocam de dono, e contagem passaria verde no desenho errado.
    assert.deepEqual(identificadoresDaPessoa(acervo, b).map((i) => i.id), antesIds);
    assert.deepEqual(nomesDaPessoa(acervo, b).map((n) => n.nome), antesNomes);
    assert.equal(r.mestreId, a);
    assert.equal(r.regra, 'ordem-de-chamada');
    // Critério 18: nenhuma Pessoa é apagada, em nenhum caminho.
    assert.equal(contarPessoas(acervo), 2, 'mesclar não apaga Pessoa');
  } finally {
    c.limpar();
  }
});

test('a preferência de mestre é a Fonte de catálogo, nas duas ordens', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    for (const ordem of [0, 1]) {
      const a = criarPessoa(acervo);
      const b = criarPessoa(acervo);
      const { id: iCat } = registrarIdentificador(acervo, { fonte: 'contatos', valor: `cartao-${ordem}` });
      vincularIdentificador(acervo, { identificadorId: iCat, pessoaId: b, procedencia: 'catalogo' });
      const r =
        ordem === 0
          ? mesclarPessoas(acervo, { pessoaA: a, pessoaB: b, quando: AGORA })
          : mesclarPessoas(acervo, { pessoaA: b, pessoaB: a, quando: AGORA });
      assert.equal(r.mestreId, b, 'quem tem Identificador de catálogo vira mestre');
      assert.equal(r.regra, 'preferencia-de-catalogo');
    }
  } finally {
    c.limpar();
  }
});

test('indicação explícita vence a preferência de catálogo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const a = criarPessoa(acervo);
    const b = criarPessoa(acervo);
    const { id: iCat } = registrarIdentificador(acervo, { fonte: 'contatos', valor: 'cartao-x' });
    vincularIdentificador(acervo, { identificadorId: iCat, pessoaId: b, procedencia: 'catalogo' });
    // Sem indicação, B venceria. Com indicação, A vence — é o que mantém
    // `humano` acima de `catalogo`, como na Procedência de Vínculo.
    const r = mesclarPessoas(acervo, { pessoaA: a, pessoaB: b, mestreId: a, quando: AGORA });
    assert.equal(r.mestreId, a);
    assert.equal(r.regra, 'indicacao-explicita');
  } finally {
    c.limpar();
  }
});

test('unir duas famílias reaponta as absorvidas da que perde o posto', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const a = criarPessoa(acervo);
    const b = criarPessoa(acervo);
    const d = criarPessoa(acervo);
    mesclarPessoas(acervo, { pessoaA: a, pessoaB: b, quando: AGORA }); // B -> A
    const r = mesclarPessoas(acervo, { pessoaA: d, pessoaB: a, quando: AGORA }); // A -> D
    assert.equal(r.mestreId, d);
    assert.equal(r.reapontadas, 1, 'B foi reapontada de A para D');
    assert.deepEqual(familiaDe(acervo, d).sort(), [a, b, d].sort());
    // Nenhuma absorvida aponta para outra absorvida.
    const orfas = acervo.db
      .prepare(
        `SELECT f.id FROM pessoas f JOIN pessoas m ON m.id = f.absorvida_por
          WHERE m.absorvida_por IS NOT NULL`,
      )
      .all();
    assert.deepEqual(orfas, []);
  } finally {
    c.limpar();
  }
});

test('desfazer devolve a Pessoa inteira e acrescenta à trilha', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const a = criarPessoa(acervo);
    const b = criarPessoa(acervo);
    const { id: iB } = registrarIdentificador(acervo, { fonte: 'instagram', valor: 'perfil-des' });
    vincularIdentificador(acervo, { identificadorId: iB, pessoaId: b, procedencia: 'humano' });
    mesclarPessoas(acervo, { pessoaA: a, pessoaB: b, quando: AGORA });

    desfazerMesclagem(acervo, { absorvidaId: b, quando: AGORA });

    assert.deepEqual(familiaDe(acervo, b), [b], 'B volta a ser raiz');
    assert.deepEqual(
      identificadoresDaPessoa(acervo, b).map((i) => i.id),
      [iB],
      'com o que sempre teve',
    );
    // Critério 18: desfazer também não apaga.
    assert.equal(contarPessoas(acervo), 2, 'desfazer não apaga Pessoa');
    // A trilha CRESCE: o ato original continua legível.
    const atos = acervo.db
      .prepare('SELECT tipo FROM atos_de_mesclagem ORDER BY ocorrido_em, tipo')
      .all() as Array<{ tipo: string }>;
    assert.deepEqual(atos.map((x) => x.tipo).sort(), ['desfazer', 'mesclagem']);
  } finally {
    c.limpar();
  }
});

test('desfazer NÃO ressuscita mesclagem já desfeita', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const a = criarPessoa(acervo);
    const b = criarPessoa(acervo);
    const d = criarPessoa(acervo);
    mesclarPessoas(acervo, { pessoaA: a, pessoaB: b, quando: AGORA }); // ato 1: B -> A
    mesclarPessoas(acervo, { pessoaA: d, pessoaB: a, quando: AGORA }); // ato 2: A -> D, B reapontada
    desfazerMesclagem(acervo, { absorvidaId: b, quando: AGORA }); // desfaz o ato 1
    assert.deepEqual(familiaDe(acervo, b), [b]);

    desfazerMesclagem(acervo, { absorvidaId: a, quando: AGORA }); // desfaz o ato 2

    // A e B são raízes INDEPENDENTES. Sem o filtro por ato ativo, B voltaria
    // para A — revivendo uma mesclagem que já havia sido desfeita.
    assert.deepEqual(familiaDe(acervo, a), [a], 'B não volta para A');
    assert.deepEqual(familiaDe(acervo, b), [b]);
  } finally {
    c.limpar();
  }
});

test('desfazer o que não está mesclado, ou desfazer duas vezes, é recusado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const a = criarPessoa(acervo);
    const b = criarPessoa(acervo);
    assert.throws(
      () => desfazerMesclagem(acervo, { absorvidaId: b, quando: AGORA }),
      /nao esta mesclada/i,
    );
    mesclarPessoas(acervo, { pessoaA: a, pessoaB: b, quando: AGORA });
    desfazerMesclagem(acervo, { absorvidaId: b, quando: AGORA });
    assert.throws(
      () => desfazerMesclagem(acervo, { absorvidaId: b, quando: AGORA }),
      /nao esta mesclada/i,
    );
  } finally {
    c.limpar();
  }
});

test('o detector devolve vazio num Acervo íntegro e acha a órfã num corrompido', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const a = criarPessoa(acervo);
    const b = criarPessoa(acervo);
    const d = criarPessoa(acervo);
    mesclarPessoas(acervo, { pessoaA: a, pessoaB: b, quando: AGORA });
    assert.deepEqual(conferirMesclagem(acervo), [], 'Acervo íntegro: vazio');

    // As guardas são apertadas o bastante para que NÃO exista corrupção em
    // banda — o único caminho é desligá-las. Por isso o schema exporta o SQL
    // delas: o teste apaga, corrompe e recria pelo MESMO texto.
    acervo.db.exec('DROP TRIGGER mestre_e_raiz; DROP TRIGGER nao_absorve_quem_e_mestre;');
    acervo.db
      .prepare('UPDATE pessoas SET absorvida_por = ?, absorvida_em = ? WHERE id = ?')
      .run(d, new Date().toISOString(), a); // A vira absorvida; B segue apontando para A
    acervo.db.exec(GUARDAS_DA_ESTRELA);

    assert.deepEqual(conferirMesclagem(acervo), [b], 'B aponta para quem não é mais raiz');
  } finally {
    c.limpar();
  }
});

test('mesclar não promove a Procedência de nenhum vínculo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const a = criarPessoa(acervo);
    const b = criarPessoa(acervo);
    const { id: i } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511900000009' });
    vincularIdentificador(acervo, { identificadorId: i, pessoaId: b, procedencia: 'catalogo' });
    mesclarPessoas(acervo, { pessoaA: a, pessoaB: b, quando: AGORA });
    const lido = identificadoresDaPessoa(acervo, a).find((x) => x.id === i);
    assert.equal(lido?.procedencia, 'catalogo', 'mesclar não transforma catalogo em humano');
  } finally {
    c.limpar();
  }
});
