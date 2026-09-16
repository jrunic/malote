import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro } from '../src/registro/registro.js';
import {
  criarChaveDeOperador,
  verificarChaveDeOperador,
  listarChavesDeOperador,
  contarChavesAtivas,
  revogarChaveDeOperador,
} from '../src/registro/chave-operador.js';

test('criar Chave de Operador devolve o valor uma vez e ele não é recuperável depois', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const { valor, id } = criarChaveDeOperador(registro);

    assert.ok(valor.length >= 32, 'valor curto demais para ser credencial');

    const listadas = listarChavesDeOperador(registro);
    assert.equal(listadas.length, 1);
    assert.equal(listadas[0]?.id, id);
    assert.ok(
      !Object.values(listadas[0] ?? {}).includes(valor),
      'listar nunca devolve o valor da Chave',
    );
    registro.fechar();
  } finally {
    limpar();
  }
});

test('duas instalações do zero produzem Chaves diferentes — não há valor embutido', () => {
  const a = instalacaoTemporaria();
  const b = instalacaoTemporaria();
  try {
    const primeira = criarChaveDeOperador(abrirRegistro(a.raiz)).valor;
    const segunda = criarChaveDeOperador(abrirRegistro(b.raiz)).valor;
    assert.notEqual(primeira, segunda);
  } finally {
    a.limpar();
    b.limpar();
  }
});

test('verificar aceita a Chave correta e recusa a errada', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const { id, valor } = criarChaveDeOperador(registro);

    // As duas metades são assertadas: recusar sozinho não prova nada,
    // porque um defeito qualquer também recusa.
    //
    // Compara com o ID, e não com "não é nulo": a verificação passou a
    // devolver identidade no ciclo 11, e é ela que o Ator consome. Provar
    // que voltou *algo* provaria menos do que o chamador precisa.
    assert.equal(verificarChaveDeOperador(registro, valor), id);
    assert.equal(verificarChaveDeOperador(registro, 'valor-que-nao-e-a-chave'), null);
    registro.fechar();
  } finally {
    limpar();
  }
});

test('o valor da Chave não é guardado em claro em lugar nenhum do Registro', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const { valor } = criarChaveDeOperador(registro);

    // Exercita TODOS os caminhos que escrevem, não só a criação: a verificação
    // grava em tentativas_de_chave, e um vazamento ali passaria despercebido
    // se a varredura rodasse sobre a tabela vazia. Achado ao medir o poder
    // deste teste em 24/08/2026 — ele não pegava vazamento na verificação.
    verificarChaveDeOperador(registro, valor);
    verificarChaveDeOperador(registro, 'errada');

    const tabelas = registro.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;

    for (const { name } of tabelas) {
      const linhas = registro.db.prepare(`SELECT * FROM "${name}"`).all() as Array<
        Record<string, unknown>
      >;
      for (const linha of linhas) {
        for (const celula of Object.values(linha)) {
          assert.notEqual(
            String(celula),
            valor,
            `valor da Chave encontrado em claro na tabela ${name}`,
          );
        }
      }
    }
    registro.fechar();
  } finally {
    limpar();
  }
});

test('toda tentativa de uso é registrada, aceita ou recusada', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const { valor } = criarChaveDeOperador(registro);
    verificarChaveDeOperador(registro, valor);
    verificarChaveDeOperador(registro, 'errada');

    const tentativas = registro.db
      .prepare('SELECT aceita FROM tentativas_de_chave ORDER BY id')
      .all() as Array<{ aceita: number }>;
    assert.deepEqual(
      tentativas.map((t) => t.aceita),
      [1, 0],
    );
    registro.fechar();
  } finally {
    limpar();
  }
});

test('contarChavesAtivas reflete criação e revogação', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    assert.equal(contarChavesAtivas(registro), 0);
    criarChaveDeOperador(registro);
    assert.equal(contarChavesAtivas(registro), 1);
    registro.fechar();
  } finally {
    limpar();
  }
});

test('revogar a última Chave ativa é recusado — a instalação nunca fica sem administração', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const unica = criarChaveDeOperador(registro);

    assert.throws(
      () => revogarChaveDeOperador(registro, unica.id),
      /ultima Chave de Operador ativa/,
      'a mensagem precisa ser própria desta guarda, para que desligá-la derrube só o teste dela',
    );
    assert.equal(contarChavesAtivas(registro), 1);
    registro.fechar();
  } finally {
    limpar();
  }
});

test('revogar Chave havendo outra ativa funciona e o valor revogado deixa de valer', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const primeira = criarChaveDeOperador(registro);
    criarChaveDeOperador(registro);

    revogarChaveDeOperador(registro, primeira.id);

    assert.equal(contarChavesAtivas(registro), 1);
    assert.equal(verificarChaveDeOperador(registro, primeira.valor), null);
    registro.fechar();
  } finally {
    limpar();
  }
});

test('revogar Chave já revogada não é erro', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const primeira = criarChaveDeOperador(registro);
    criarChaveDeOperador(registro);

    revogarChaveDeOperador(registro, primeira.id);
    revogarChaveDeOperador(registro, primeira.id);

    assert.equal(contarChavesAtivas(registro), 1);
    registro.fechar();
  } finally {
    limpar();
  }
});

test('a verificacao devolve QUAL chave casou, e nao um booleano', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    const criada = criarChaveDeOperador(registro);
    // O plano 2 grava o Ator, e para isso precisa do id da chave que
    // autenticou — nunca do valor. Booleano nao carrega identidade, e o
    // chamador nao tem como descobri-la depois sem verificar de novo, o que
    // dobraria a derivacao no caminho quente.
    assert.equal(verificarChaveDeOperador(registro, criada.valor), criada.id);
    assert.equal(verificarChaveDeOperador(registro, 'errada'), null);
  } finally {
    registro.fechar();
    limpar();
  }
});
