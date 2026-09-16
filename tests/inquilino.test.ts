import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino, listarInquilinos } from '../src/registro/registro.js';

test('criar Inquilino devolve identificador próprio e registra o Titular', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const id = criarInquilino(registro, { titularNome: 'Leia Organa' });
    assert.equal(typeof id, 'string');
    assert.ok(id.length > 0);

    const todos = listarInquilinos(registro);
    assert.equal(todos.length, 1);
    assert.equal(todos[0]?.titularNome, 'Leia Organa');
    assert.equal(todos[0]?.id, id);
    registro.fechar();
  } finally {
    limpar();
  }
});

test('dois Inquilinos recebem identificadores distintos', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const primeiro = criarInquilino(registro, { titularNome: 'Leia Organa' });
    const segundo = criarInquilino(registro, { titularNome: 'Han Solo' });
    assert.notEqual(primeiro, segundo);
    assert.equal(listarInquilinos(registro).length, 2);
    registro.fechar();
  } finally {
    limpar();
  }
});

test('criar Inquilino sem nome de Titular é recusado', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    assert.throws(
      () => criarInquilino(registro, { titularNome: '   ' }),
      /Titular/,
      'a mensagem precisa citar o Titular — é o que distingue esta recusa das outras',
    );
    assert.equal(listarInquilinos(registro).length, 0);
    registro.fechar();
  } finally {
    limpar();
  }
});
