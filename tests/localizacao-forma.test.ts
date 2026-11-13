import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import {
  LocalizacaoDeOutraFormaError,
  abrirLocalizacao,
  abrirLocalizacaoSomenteLeitura,
  caminhoDaLocalizacao,
  registrarLocalizacao,
  resumoDaLocalizacao,
} from '../src/registro/localizacao.js';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const INQUILINO = 'inquilino-forma';

function arquivoCom(raiz: string, conteudoSql: string | null): string {
  mkdirSync(join(raiz, 'armazenamento'), { recursive: true });
  const caminho = caminhoDaLocalizacao(raiz, INQUILINO);
  if (conteudoSql === null) {
    writeFileSync(caminho, '');
  } else {
    const db = new Database(caminho);
    db.exec(conteudoSql);
    db.close();
  }
  return caminho;
}

test('arquivo VAZIO (a criacao foi interrompida) e completado, nao quebra', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    arquivoCom(raiz, null);
    const base = abrirLocalizacao(raiz, INQUILINO);
    try {
      assert.equal(resumoDaLocalizacao(base).enviados, 0);
      registrarLocalizacao(base, {
        anexoId: 'a1',
        remoto: 'r',
        caminhoRemoto: 'x',
        idNoRemoto: null,
        tamanho: 1,
        hash: 'h',
        verificadaEm: '2026-11-12T00:00:00.000Z',
      });
      assert.equal(resumoDaLocalizacao(base).enviados, 1);
    } finally {
      base.fechar();
    }
  } finally {
    limpar();
  }
});

test('base sem a tabela de versao conta como forma 0 e manda recriar, nos dois modos', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    arquivoCom(raiz, 'CREATE TABLE outra_coisa (x INTEGER);');
    for (const abrir of [
      () => abrirLocalizacao(raiz, INQUILINO),
      () => abrirLocalizacaoSomenteLeitura(raiz, INQUILINO),
    ]) {
      assert.throws(
        abrir,
        (e: unknown) => e instanceof LocalizacaoDeOutraFormaError && /forma 0/.test(e.message) && /reconstruir/.test(e.message),
      );
    }
  } finally {
    limpar();
  }
});

test('abrir duas vezes (a corrida na criacao) deixa UMA linha de versao e a mesma base', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const a = abrirLocalizacao(raiz, INQUILINO);
    const b = abrirLocalizacao(raiz, INQUILINO);
    try {
      const n = a.db.prepare('SELECT COUNT(*) AS n FROM versao_da_localizacao').get() as { n: number };
      assert.equal(n.n, 1);
      // A linha unica e garantida pelo schema, nao so pelo codigo: uma segunda linha e recusada.
      assert.throws(() => a.db.prepare('INSERT INTO versao_da_localizacao (id, versao) VALUES (2, 1)').run(), /CHECK|constraint/i);
    } finally {
      a.fechar();
      b.fechar();
    }
  } finally {
    limpar();
  }
});

test('a pasta de estado e o arquivo ficam privados: pasta 0700, os tres arquivos 0600 depois de uma escrita', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const base = abrirLocalizacao(raiz, INQUILINO);
    try {
      base.db.prepare("INSERT INTO falhas_de_envio VALUES ('a', 1, 'e', 'agora')").run();
      assert.equal(statSync(join(raiz, 'armazenamento')).mode & 0o777, 0o700);
      const caminho = caminhoDaLocalizacao(raiz, INQUILINO);
      for (const sufixo of ['', '-wal', '-shm']) {
        if (existsSync(`${caminho}${sufixo}`)) assert.equal(statSync(`${caminho}${sufixo}`).mode & 0o777, 0o600, sufixo);
      }
    } finally {
      base.fechar();
    }
  } finally {
    limpar();
  }
});
