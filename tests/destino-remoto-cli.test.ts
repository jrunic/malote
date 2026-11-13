import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalacaoComChave, instalacaoTemporaria, rodar } from './ajuda/instalacao.js';
import { abrirRegistro } from '../src/registro/registro.js';
import { lerDestinoRemotoDeMidia } from '../src/registro/destino-remoto.js';

function lido(raiz: string, inquilino: string) {
  const registro = abrirRegistro(raiz);
  try {
    return lerDestinoRemotoDeMidia(registro, inquilino);
  } finally {
    registro.fechar();
  }
}

test('inquilino destino-remoto declara o Destino Remoto com os padroes e a trava fechada', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, chave } = instalacaoComChave(raiz);
    const r = rodar(raiz, ['inquilino', 'destino-remoto', '--chave', chave, '--inquilino', inquilino, '--remoto', 'drive_de_teste']);
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /drive_de_teste/);
    assert.match(r.saida, /apagamento local: travado/);
    assert.deepEqual(lido(raiz, inquilino), {
      remoto: 'drive_de_teste',
      pastaBase: 'malote',
      janelaDias: 7,
      apagarLocal: false,
      fuso: 'America/Cuiaba',
      transferencias: 4,
      chamadasPorSegundo: 8,
    });
  } finally {
    limpar();
  }
});

test('as flags dadas valem e as omitidas mantem o que ja estava gravado', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, chave } = instalacaoComChave(raiz);
    const base = ['inquilino', 'destino-remoto', '--chave', chave, '--inquilino', inquilino, '--remoto', 'drive_de_teste'];
    assert.equal(
      rodar(raiz, [...base, '--pasta', 'a/b', '--janela-dias', '3', '--transferencias', '8', '--fuso', 'America/Sao_Paulo']).codigo,
      0,
    );
    assert.equal(rodar(raiz, [...base, '--chamadas-por-segundo', '12']).codigo, 0);
    assert.deepEqual(lido(raiz, inquilino), {
      remoto: 'drive_de_teste',
      pastaBase: 'a/b',
      janelaDias: 3,
      apagarLocal: false,
      fuso: 'America/Sao_Paulo',
      transferencias: 8,
      chamadasPorSegundo: 12,
    });
  } finally {
    limpar();
  }
});

test('liberar o apagamento local exige --confirmo; religar a trava nao', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, chave } = instalacaoComChave(raiz);
    const base = ['inquilino', 'destino-remoto', '--chave', chave, '--inquilino', inquilino, '--remoto', 'drive_de_teste'];
    assert.equal(rodar(raiz, base).codigo, 0);

    const sem = rodar(raiz, [...base, '--apagar-local', 'sim']);
    assert.equal(sem.codigo, 1);
    assert.match(sem.saida, /--confirmo/);
    assert.equal(lido(raiz, inquilino)?.apagarLocal, false, 'a trava continua fechada');

    const com = rodar(raiz, [...base, '--apagar-local', 'sim', '--confirmo']);
    assert.equal(com.codigo, 0, com.saida);
    assert.match(com.saida, /apagamento local: LIBERADO/);
    assert.equal(lido(raiz, inquilino)?.apagarLocal, true);

    const trava = rodar(raiz, [...base, '--apagar-local', 'nao']);
    assert.equal(trava.codigo, 0, trava.saida);
    assert.equal(lido(raiz, inquilino)?.apagarLocal, false);
  } finally {
    limpar();
  }
});

test('recusa invocacao e valor ruins sem gravar nada', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, chave } = instalacaoComChave(raiz);
    const base = ['inquilino', 'destino-remoto', '--chave', chave, '--inquilino', inquilino];

    const semRemoto = rodar(raiz, base);
    assert.equal(semRemoto.codigo, 1);
    assert.match(semRemoto.saida, /--remoto/);

    const hifen = rodar(raiz, [...base, '--remoto', 'drive-com-hifen']);
    assert.equal(hifen.codigo, 1);
    assert.match(hifen.saida, /nome do remoto/);

    const inteiro = rodar(raiz, [...base, '--remoto', 'drive_de_teste', '--janela-dias', 'sete']);
    assert.equal(inteiro.codigo, 1);
    assert.match(inteiro.saida, /--janela-dias precisa ser um inteiro/);

    const fechado = rodar(raiz, [...base, '--remoto', 'drive_de_teste', '--apagar-local', 'talvez']);
    assert.notEqual(fechado.codigo, 0, 'valor fora do conjunto fechado nao passa em silencio');

    const desconhecido = rodar(raiz, [
      'inquilino', 'destino-remoto', '--chave', chave, '--inquilino', 'nao-existe', '--remoto', 'drive_de_teste',
    ]);
    assert.equal(desconhecido.codigo, 1);

    assert.equal(lido(raiz, inquilino), undefined, 'nada foi gravado');
  } finally {
    limpar();
  }
});

test('sem Chave de Operador valida a recusa de administracao', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino } = instalacaoComChave(raiz);
    const r = rodar(raiz, ['inquilino', 'destino-remoto', '--inquilino', inquilino, '--remoto', 'drive_de_teste']);
    assert.notEqual(r.codigo, 0);
    assert.equal(lido(raiz, inquilino), undefined);
  } finally {
    limpar();
  }
});

test('--remoto so e exigido na primeira declaracao; depois, o que nao vem fica como esta', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, chave } = instalacaoComChave(raiz);
    const sem = ['inquilino', 'destino-remoto', '--chave', chave, '--inquilino', inquilino];
    const primeira = rodar(raiz, sem);
    assert.equal(primeira.codigo, 1);
    assert.match(primeira.saida, /primeira declaracao/);
    assert.equal(lido(raiz, inquilino), undefined);

    assert.equal(rodar(raiz, [...sem, '--remoto', 'drive_de_teste']).codigo, 0);
    // Sem --remoto, so a Janela muda: o nome do remoto NAO se perde nem se troca por erro de digitacao.
    assert.equal(rodar(raiz, [...sem, '--janela-dias', '3']).codigo, 0);
    assert.equal(lido(raiz, inquilino)?.remoto, 'drive_de_teste');
    assert.equal(lido(raiz, inquilino)?.janelaDias, 3);
  } finally {
    limpar();
  }
});

test('trocar o remoto ou a pasta-base RELIGA a trava; liberar de novo exige --confirmo', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, chave } = instalacaoComChave(raiz);
    const base = ['inquilino', 'destino-remoto', '--chave', chave, '--inquilino', inquilino];
    assert.equal(rodar(raiz, [...base, '--remoto', 'drive_antigo', '--apagar-local', 'sim', '--confirmo']).codigo, 0);
    assert.equal(lido(raiz, inquilino)?.apagarLocal, true);

    // Trocar a pasta-base com a trava liberada: religa e avisa.
    const troca = rodar(raiz, [...base, '--pasta', 'outra']);
    assert.equal(troca.codigo, 0, troca.saida);
    assert.match(troca.saida, /RELIGADA/);
    assert.equal(lido(raiz, inquilino)?.apagarLocal, false);

    // Liberar de novo sem --confirmo: recusa e a trava segue fechada.
    assert.equal(rodar(raiz, [...base, '--apagar-local', 'sim']).codigo, 1);
    assert.equal(lido(raiz, inquilino)?.apagarLocal, false);
    assert.equal(rodar(raiz, [...base, '--apagar-local', 'sim', '--confirmo']).codigo, 0);
    assert.equal(lido(raiz, inquilino)?.apagarLocal, true);

    // Trocar o remoto E pedir a liberacao na mesma chamada sem --confirmo: recusa, mesmo ja liberada.
    assert.equal(rodar(raiz, [...base, '--remoto', 'drive_novo', '--apagar-local', 'sim']).codigo, 1);
    assert.equal(lido(raiz, inquilino)?.remoto, 'drive_antigo');
    // Com --confirmo vale, e a trava continua liberada.
    assert.equal(rodar(raiz, [...base, '--remoto', 'drive_novo', '--apagar-local', 'sim', '--confirmo']).codigo, 0);
    assert.equal(lido(raiz, inquilino)?.apagarLocal, true);
    assert.equal(lido(raiz, inquilino)?.remoto, 'drive_novo');
  } finally {
    limpar();
  }
});
