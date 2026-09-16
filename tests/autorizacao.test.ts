import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro } from '../src/registro/registro.js';
import { verificarChaveDeOperador, criarChaveDeOperador } from '../src/registro/chave-operador.js';
import { autorizarAdministracao, autorizarBootstrap } from '../src/cli/autorizacao.js';

test('sem Chave no Registro, comando administrativo é recusado citando o bootstrap', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    assert.throws(
      () => autorizarAdministracao(registro, undefined, null),
      /nenhuma Chave de Operador/,
      'mensagem própria desta guarda',
    );
    registro.fechar();
  } finally {
    limpar();
  }
});

test('havendo Chave, comando administrativo exige uma válida — e executa com ela', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const { valor } = criarChaveDeOperador(registro);

    assert.throws(() => autorizarAdministracao(registro, undefined, null), /Chave de Operador ausente/);
    assert.throws(() => autorizarAdministracao(registro, 'errada', null), /Chave de Operador invalida/);

    // A metade positiva: sem ela, um defeito que recusasse tudo passaria.
    assert.doesNotThrow(() => autorizarAdministracao(registro, valor, verificarChaveDeOperador(registro, valor)));
    registro.fechar();
  } finally {
    limpar();
  }
});

test('bootstrap roda sem Chave enquanto não houver nenhuma, e passa a exigir depois', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);

    // Estado A: Registro vazio — criar a primeira Chave dispensa credencial.
    assert.doesNotThrow(() => autorizarBootstrap(registro, undefined, null));
    const { valor } = criarChaveDeOperador(registro);

    // Estado B: já existe Chave — criar outra passa a exigir uma válida.
    assert.throws(() => autorizarBootstrap(registro, undefined, null), /ja existe Chave de Operador/);
    assert.doesNotThrow(() => autorizarBootstrap(registro, valor, verificarChaveDeOperador(registro, valor)));
    registro.fechar();
  } finally {
    limpar();
  }
});

test('a regra é sobre o estado do Registro, não sobre contagem de invocações', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);

    // Invocar o bootstrap várias vezes sem criar Chave nenhuma continua liberado:
    // se a regra fosse "a partir da segunda invocação", esta asserção cairia.
    autorizarBootstrap(registro, undefined, null);
    autorizarBootstrap(registro, undefined, null);
    autorizarBootstrap(registro, undefined, null);
    assert.doesNotThrow(() => autorizarBootstrap(registro, undefined, null));
    registro.fechar();
  } finally {
    limpar();
  }
});
