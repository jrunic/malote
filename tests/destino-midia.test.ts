import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { chmodSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import {
  configurarDestinoDeMidia,
  destinoAcessivel,
  lerDestinoDeMidia,
} from '../src/registro/destino-midia.js';

test('configurar Destino grava e devolve o que foi apontado', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const inquilino = criarInquilino(registro, { titularNome: 'Leia Organa' });
    const destino = join(raiz, 'midia-leia');

    configurarDestinoDeMidia(registro, inquilino, { natureza: 'local', endereco: destino });

    const lido = lerDestinoDeMidia(registro, inquilino);
    assert.equal(lido?.natureza, 'local');
    assert.equal(lido?.endereco, destino);
    registro.fechar();
  } finally {
    limpar();
  }
});

test('dois Inquilinos com Destinos diferentes não se afetam — não há raiz fixa', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const leia = criarInquilino(registro, { titularNome: 'Leia Organa' });
    const han = criarInquilino(registro, { titularNome: 'Han Solo' });

    const destinoLeia = join(raiz, 'midia-leia');
    const destinoHan = join(raiz, 'outra-arvore', 'midia-han');

    configurarDestinoDeMidia(registro, leia, { natureza: 'local', endereco: destinoLeia });
    configurarDestinoDeMidia(registro, han, { natureza: 'local', endereco: destinoHan });

    assert.equal(lerDestinoDeMidia(registro, leia)?.endereco, destinoLeia);
    assert.equal(lerDestinoDeMidia(registro, han)?.endereco, destinoHan);
    assert.notEqual(
      lerDestinoDeMidia(registro, leia)?.endereco,
      lerDestinoDeMidia(registro, han)?.endereco,
    );
    registro.fechar();
  } finally {
    limpar();
  }
});

test('reconfigurar o Destino de um Inquilino substitui, sem duplicar', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const inquilino = criarInquilino(registro, { titularNome: 'Leia Organa' });

    configurarDestinoDeMidia(registro, inquilino, {
      natureza: 'local',
      endereco: join(raiz, 'antigo'),
    });
    configurarDestinoDeMidia(registro, inquilino, {
      natureza: 'local',
      endereco: join(raiz, 'novo'),
    });

    assert.equal(lerDestinoDeMidia(registro, inquilino)?.endereco, join(raiz, 'novo'));
    const total = registro.db.prepare('SELECT COUNT(*) AS n FROM destinos_de_midia').get() as {
      n: number;
    };
    assert.equal(total.n, 1);
    registro.fechar();
  } finally {
    limpar();
  }
});

test('Destino não-gravável falha na hora da configuração, não no primeiro arquivo', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const inquilino = criarInquilino(registro, { titularNome: 'Leia Organa' });

    const somenteLeitura = join(raiz, 'somente-leitura');
    mkdirSync(somenteLeitura, { recursive: true });
    chmodSync(somenteLeitura, 0o500);

    assert.throws(
      () =>
        configurarDestinoDeMidia(registro, inquilino, {
          natureza: 'local',
          endereco: join(somenteLeitura, 'midia'),
        }),
      /Destino de Midia inalcancavel/,
      'mensagem própria desta guarda',
    );
    assert.equal(lerDestinoDeMidia(registro, inquilino), undefined);

    chmodSync(somenteLeitura, 0o700);
    registro.fechar();
  } finally {
    limpar();
  }
});

test('a verificação de alcance não deixa lixo no Destino', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const inquilino = criarInquilino(registro, { titularNome: 'Leia Organa' });
    const destino = join(raiz, 'midia-leia');

    configurarDestinoDeMidia(registro, inquilino, { natureza: 'local', endereco: destino });

    assert.deepEqual(readdirSync(destino), [], 'a sonda de gravabilidade tem de ser removida');
    registro.fechar();
  } finally {
    limpar();
  }
});

test('configurar Destino para Inquilino inexistente é recusado', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    assert.throws(
      () =>
        configurarDestinoDeMidia(registro, 'inquilino-que-nao-existe', {
          natureza: 'local',
          endereco: join(raiz, 'qualquer'),
        }),
      /Inquilino desconhecido/,
    );
    registro.fechar();
  } finally {
    limpar();
  }
});

test('destinoAcessivel devolve falso para caminho ausente, e NÃO o cria', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const ausente = join(raiz, 'destino-que-nao-existe');
    assert.equal(destinoAcessivel(ausente), false);

    // A distinção que dá razão a esta função existir: `verificarAlcance`, usada
    // por `configurar`, CRIA a pasta. Se esta a criasse, um Destino desmontado
    // passaria no gate do descarte com efeito.
    assert.equal(existsSync(ausente), false);
  } finally {
    limpar();
  }
});

test('destinoAcessivel devolve verdadeiro para caminho gravável e não deixa sonda', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const destino = join(raiz, 'destino');
    mkdirSync(destino, { recursive: true });
    assert.equal(destinoAcessivel(destino), true);
    assert.deepEqual(readdirSync(destino), []);
  } finally {
    limpar();
  }
});
