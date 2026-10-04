import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identificarPorValor } from '../src/nucleo/identificar.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import {
  acervoDeIdentidade,
  PRECEDENCIA,
  ANA,
  BRUNO,
  BRUNO_LID,
  CARLA,
  CARLA_LID,
  DANI,
  EDU,
  SOLTO_LID,
  minuto,
} from './ajuda/identidade.js';

const contar = (
  acervo: { preparar: (s: string) => { get: (...a: unknown[]) => unknown } },
  sql: string,
  ...a: unknown[]
): number => (acervo.preparar(sql).get(...a) as { n: number }).n;

test('Identificador SEM Pessoa e respondido: nomes com origem, o corrente e a origem dele (#1126)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const r = identificarPorValor(acervo, { valor: BRUNO }, PRECEDENCIA);
    assert.equal(r.identificadores.length, 1);
    const b = r.identificadores[0]!;
    assert.equal(b.id, s.bruno);
    assert.equal(b.valor, BRUNO);
    assert.equal(b.pessoaId, null);
    assert.equal(b.nomeDaPessoa, null);
    assert.equal(b.nome, 'Bruno Contato');
    assert.equal(b.origemDoNome, 'contatos');
    assert.deepEqual(
      b.nomes.map((n) => [n.nome, n.origem, n.autoridade]).sort(),
      [
        ['Bruno Contato', 'contatos', 'titular'],
        ['Bruno Silva', 'whatsapp', 'terceiro'],
      ],
    );
  } finally {
    limpar();
  }
});

test('depois de ligado a uma Pessoa, a resposta traz o pessoaId e o nome da Pessoa pela precedencia (#1126)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const a = identificarPorValor(acervo, { valor: ANA }, PRECEDENCIA).identificadores[0]!;
    assert.equal(a.pessoaId, s.pessoaDeAna);
    assert.equal(a.nomeDaPessoa, 'Ana Catalogo', 'o nome de catalogo esta na Pessoa e vence pela precedencia');
    assert.equal(a.nome, 'Ana WhatsApp', 'o nome do proprio Identificador segue sendo o dele');
  } finally {
    limpar();
  }
});

test('forma alternativa que so existe como correspondencia: o canonico gravado e a forma com identificador nulo (#1126)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const r = identificarPorValor(acervo, { valor: BRUNO_LID }, PRECEDENCIA);
    assert.deepEqual(
      r.identificadores.map((i) => [i.id, i.papel]),
      [[s.bruno, 'canonico']],
    );
    assert.deepEqual(
      r.formas.map((f) => [f.valor, f.papel, f.identificador]).sort(),
      [
        [BRUNO, 'canonico', s.bruno],
        [BRUNO_LID, 'consultado', null],
      ].sort(),
    );
  } finally {
    limpar();
  }
});

test('dada a canonica, traz as alternativas conhecidas, gravadas ou nao (#1126)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const r = identificarPorValor(acervo, { valor: BRUNO }, PRECEDENCIA);
    assert.deepEqual(
      r.formas.map((f) => [f.valor, f.papel, f.identificador]).sort(),
      [
        [BRUNO, 'consultado', s.bruno],
        [BRUNO_LID, 'alternativo', null],
      ].sort(),
    );
    const c = identificarPorValor(acervo, { valor: CARLA }, PRECEDENCIA);
    assert.deepEqual(
      c.identificadores.map((i) => [i.valor, i.papel]).sort(),
      [
        [CARLA, 'consultado'],
        [CARLA_LID, 'alternativo'],
      ].sort(),
    );
    assert.deepEqual(
      c.formas.map((f) => [f.valor, f.identificador === null]).sort(),
      [
        [CARLA, false],
        [CARLA_LID, false],
      ].sort(),
    );
  } finally {
    limpar();
  }
});

test('valor sem correspondencia devolve so ele; valor que o Acervo nunca viu devolve listas vazias (#1126)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const solto = identificarPorValor(acervo, { valor: SOLTO_LID }, PRECEDENCIA);
    assert.deepEqual(
      solto.identificadores.map((i) => i.id),
      [s.solto],
    );
    assert.deepEqual(
      solto.formas.map((f) => [f.valor, f.papel]),
      [[SOLTO_LID, 'consultado']],
    );
    const nunca = identificarPorValor(acervo, { valor: '000@lid' }, PRECEDENCIA);
    assert.deepEqual(nunca.identificadores, []);
    assert.deepEqual(nunca.formas, []);
  } finally {
    limpar();
  }
});

test('presenca e a UNIAO de participacao e autoria; os numeros batem com contagem direta (#1126)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const por = (valor: string) => identificarPorValor(acervo, { valor }, PRECEDENCIA).identificadores[0]!;
    // Bruno: autor em 2 Conversas (direta e grupo) e participante do grupo => 2. O esperado sai de
    // SQL direto nas duas tabelas, nao de literal copiado da resposta.
    const bruno = por(BRUNO);
    const conversasPorSql = contar(
      acervo,
      `SELECT COUNT(*) AS n FROM (SELECT conversa_id FROM participacoes WHERE identificador_id = ?
                                   UNION SELECT conversa_id FROM mensagens WHERE autor_id = ?)`,
      s.bruno,
      s.bruno,
    );
    assert.equal(bruno.conversas, conversasPorSql);
    assert.equal(bruno.mensagens, contar(acervo, 'SELECT COUNT(*) AS n FROM mensagens WHERE autor_id = ?', s.bruno));
    assert.equal(bruno.conversas, 2, 'e o cenario produz o que o teste afirma: direta e grupo');
    assert.equal(bruno.primeiraMensagemEm, minuto(1));
    assert.equal(bruno.ultimaMensagemEm, minuto(10));
    // Dani: SO autora (nao consta em participacoes): a presenca existe pela autoria.
    const dani = por(DANI);
    assert.equal(
      contar(acervo, 'SELECT COUNT(*) AS n FROM participacoes WHERE identificador_id = ?', s.dani),
      0,
      'a fixture produz o caso so-autor',
    );
    assert.equal(dani.conversas, 1);
    assert.equal(dani.mensagens, 2);
    // Edu: SO participante (nunca escreveu).
    const edu = por(EDU);
    assert.equal(
      contar(acervo, 'SELECT COUNT(*) AS n FROM mensagens WHERE autor_id = ?', s.edu),
      0,
      'a fixture produz o caso so-participante',
    );
    assert.equal(edu.conversas, 1);
    assert.equal(edu.mensagens, 0);
    assert.equal(edu.primeiraMensagemEm, null);
    assert.equal(edu.ultimaMensagemEm, null);
  } finally {
    limpar();
  }
});

test('--fonte restringe, e o valor e comparado EXATO (#1126)', () => {
  const { acervo, limpar } = acervoDeIdentidade();
  try {
    assert.equal(identificarPorValor(acervo, { valor: BRUNO, fonte: 'instagram' }, PRECEDENCIA).identificadores.length, 0);
    assert.equal(identificarPorValor(acervo, { valor: BRUNO, fonte: 'whatsapp' }, PRECEDENCIA).identificadores.length, 1);
    assert.equal(
      identificarPorValor(acervo, { valor: '5565222222222' }, PRECEDENCIA).identificadores.length,
      0,
      'sem o sufixo, nao e o mesmo valor',
    );
    assert.equal(identificarPorValor(acervo, { valor: BRUNO.toUpperCase() }, PRECEDENCIA).identificadores.length, 0);
  } finally {
    limpar();
  }
});

test('identificar nao escreve: zero linhas novas em operacoes (#1126)', () => {
  const { acervo, limpar } = acervoDeIdentidade();
  try {
    const antes = contar(acervo, 'SELECT COUNT(*) AS n FROM operacoes');
    identificarPorValor(acervo, { valor: BRUNO }, PRECEDENCIA);
    identificarPorValor(acervo, { valor: BRUNO_LID }, PRECEDENCIA);
    assert.equal(contar(acervo, 'SELECT COUNT(*) AS n FROM operacoes'), antes);
  } finally {
    limpar();
  }
});

test('correspondencia nova entra na resposta sem mudar o que ja estava gravado (#1126)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: '777@lid', canonico: DANI });
    const r = identificarPorValor(acervo, { valor: '777@lid' }, PRECEDENCIA);
    assert.deepEqual(
      r.identificadores.map((i) => i.id),
      [s.dani],
    );
  } finally {
    limpar();
  }
});
