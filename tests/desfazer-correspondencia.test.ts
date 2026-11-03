import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { desfazerOperacao } from '../src/nucleo/desfazer.js';
import { emOperacao } from '../src/nucleo/trilha.js';

function comAcervo(corpo: (acervo: Acervo) => void): void {
  const c = cenario();
  try {
    corpo(c.novoInquilino('Teste').acervo);
  } finally {
    c.limpar();
  }
}

const todos = (acervo: Acervo): string[] =>
  (acervo.db.prepare('SELECT alternativo FROM correspondencias_de_endereco ORDER BY alternativo').all() as Array<{
    alternativo: string;
  }>).map((l) => l.alternativo);

const NATUREZA = 'aprender-formas-do-celular';

function operacaoComDoisPares(acervo: Acervo): string {
  return emOperacao(acervo, { natureza: NATUREZA, reversibilidade: 'por-efeito' }, (op) => {
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: 'a1', canonico: 'c1' }, op);
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: 'a2', canonico: 'c2' }, op);
    return op.id;
  });
}

test('desfazer remove os pares da Operacao e preserva o par que ja existia', () => {
  comAcervo((acervo) => {
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: 'lid-1', canonico: 'c0' });
    const opId = operacaoComDoisPares(acervo);
    assert.deepEqual(todos(acervo), ['a1', 'a2', 'lid-1']);

    const r = desfazerOperacao(acervo, opId);

    assert.equal(r.desfeitos, 2);
    assert.deepEqual(r.recusados, []);
    assert.deepEqual(todos(acervo), ['lid-1']);
  });
});

test('par refeito para outro canonico depois da Operacao nao e tocado, e a recusa diz por que', () => {
  comAcervo((acervo) => {
    const opId = operacaoComDoisPares(acervo);
    acervo.db.prepare("UPDATE correspondencias_de_endereco SET canonico = 'outro' WHERE alternativo = 'a1'").run();

    const r = desfazerOperacao(acervo, opId);

    assert.equal(r.desfeitos, 1);
    assert.equal(r.recusados.length, 1);
    assert.match(r.recusados[0]?.causa ?? '', /ja nao existe/);
    assert.deepEqual(todos(acervo), ['a1'], 'o par alterado fica');
  });
});
