import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { criarRegistroNoPiso } from './ajuda/registro-no-piso.js';
import { migrar, migrarComTrilha } from '../src/nucleo/migracao.js';
import { PLANO_DO_REGISTRO } from '../src/registro/passos-do-registro.js';

type BancoDaMaquina = Parameters<typeof migrar>[0];

/**
 * Um abridor que LEU a forma antiga antes de o outro migrar: a primeira leitura de `versao_schema` devolve
 * a forma velha, e as seguintes, a verdadeira. E a corrida que servidor e ouvintes reiniciando juntos
 * produzem, escrita sem depender de relogio.
 */
function comLeituraDeFormaVelha(db: Database.Database, formaVelha: number): BancoDaMaquina {
  let jaServiu = false;
  const chamar = (alvo: object, prop: string | symbol): unknown => {
    const v = Reflect.get(alvo, prop, alvo) as unknown;
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(alvo) : v;
  };
  return new Proxy(db, {
    get(alvo, prop) {
      if (prop !== 'prepare') return chamar(alvo, prop);
      return (sql: string) => {
        const stmt = alvo.prepare(sql);
        if (jaServiu || !/SELECT versao FROM versao_schema/.test(sql)) return stmt;
        return new Proxy(stmt, {
          get(s, p) {
            if (p !== 'get') return chamar(s, p);
            return () => {
              jaServiu = true;
              return { versao: formaVelha };
            };
          },
        });
      };
    },
  }) as unknown as BancoDaMaquina;
}

test('o abridor atrasado nao reaplica o que outro ja aplicou: a forma e relida DENTRO da transacao', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  let a: Database.Database | undefined;
  let b: Database.Database | undefined;
  try {
    criarRegistroNoPiso(raiz);
    a = new Database(join(raiz, 'registro.db'));
    b = new Database(join(raiz, 'registro.db'));
    const formaVelha = (a.prepare('SELECT versao FROM versao_schema').get() as { versao: number }).versao;

    migrar(a as unknown as BancoDaMaquina, 'a', PLANO_DO_REGISTRO); // o primeiro abridor migra
    const r = migrar(comLeituraDeFormaVelha(b, formaVelha), 'b', PLANO_DO_REGISTRO); // o segundo ainda "acha" a forma velha

    assert.deepEqual(r.passosAplicados, [], 'o segundo nao aplicou nada');
    const n = (a.prepare('SELECT COUNT(*) AS n FROM migracoes_aplicadas WHERE para = ?').get(PLANO_DO_REGISTRO.corrente) as { n: number }).n;
    assert.equal(n, 1, 'o passo para a forma corrente esta registrado UMA vez');
  } finally {
    a?.close();
    b?.close();
    limpar();
  }
});

test('o abridor atrasado, pela trilha, tambem nao abre Operacao vazia', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  let a: Database.Database | undefined;
  let b: Database.Database | undefined;
  try {
    criarRegistroNoPiso(raiz);
    a = new Database(join(raiz, 'registro.db'));
    b = new Database(join(raiz, 'registro.db'));
    const formaVelha = (a.prepare('SELECT versao FROM versao_schema').get() as { versao: number }).versao;

    migrar(a as unknown as BancoDaMaquina, 'a', PLANO_DO_REGISTRO);
    const r = migrarComTrilha(comLeituraDeFormaVelha(b, formaVelha), 'b', PLANO_DO_REGISTRO);

    assert.deepEqual(r.passosAplicados, []);
    const vazias = (a.prepare("SELECT COUNT(*) AS n FROM operacoes WHERE natureza = 'migrar-base'").get() as { n: number }).n;
    assert.equal(vazias, 0, 'quem nao migrou nada nao registra "migrar-base"');
  } finally {
    a?.close();
    b?.close();
    limpar();
  }
});
