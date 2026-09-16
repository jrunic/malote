import type { Database } from 'better-sqlite3';

/**
 * A forma de um banco, lida por ESTRUTURA e nao pelo texto do CREATE.
 *
 * O SQLite guarda em `sqlite_master.sql` o texto original — com IF NOT EXISTS,
 * espacamento e ordem de clausulas de quem escreveu. O passo de migracao e o
 * schema fresco escrevem textos diferentes para a MESMA forma, entao comparar
 * texto reprova por cosmetica e vira teste instavel no primeiro dia. O que
 * importa e coluna, tipo, nulidade, padrao, chave primaria, indice, unicidade
 * e chave estrangeira.
 *
 * Gatilho e a excecao declarada: nao ha pragma que o descreva, entao ele entra
 * pelo texto, normalizado em espacos e sem o IF NOT EXISTS.
 */
export interface FormaDeBanco {
  tabelas: Record<string, ColunaLida[]>;
  indices: Record<string, IndiceLido[]>;
  estrangeiras: Record<string, EstrangeiraLida[]>;
  gatilhos: Record<string, string>;
}

export interface ColunaLida {
  nome: string;
  tipo: string;
  naoNulo: number;
  padrao: string | null;
  chavePrimaria: number;
}

export interface IndiceLido {
  nome: string;
  unico: number;
  colunas: string[];
}

export interface EstrangeiraLida {
  tabela: string;
  de: string;
  para: string | null;
  aoApagar: string;
}

function nomesDeTabela(db: Database): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((l) => l.name);
}

export function lerForma(db: Database): FormaDeBanco {
  const forma: FormaDeBanco = { tabelas: {}, indices: {}, estrangeiras: {}, gatilhos: {} };

  for (const tabela of nomesDeTabela(db)) {
    const colunas = db.pragma(`table_info(${JSON.stringify(tabela)})`) as {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }[];
    forma.tabelas[tabela] = colunas
      .map((c) => ({
        nome: c.name,
        tipo: c.type,
        naoNulo: c.notnull,
        padrao: c.dflt_value,
        chavePrimaria: c.pk,
      }))
      .sort((x, y) => x.nome.localeCompare(y.nome));

    const indices = db.pragma(`index_list(${JSON.stringify(tabela)})`) as {
      name: string;
      unique: number;
    }[];
    forma.indices[tabela] = indices
      .map((i) => ({
        nome: i.name,
        unico: i.unique,
        colunas: (
          db.pragma(`index_info(${JSON.stringify(i.name)})`) as { name: string | null }[]
        ).map((c) => c.name ?? ''),
      }))
      .sort((x, y) => x.nome.localeCompare(y.nome));

    const fks = db.pragma(`foreign_key_list(${JSON.stringify(tabela)})`) as {
      table: string;
      from: string;
      to: string | null;
      on_delete: string;
    }[];
    forma.estrangeiras[tabela] = fks
      .map((f) => ({ tabela: f.table, de: f.from, para: f.to, aoApagar: f.on_delete }))
      .sort((x, y) => `${x.tabela}.${x.de}`.localeCompare(`${y.tabela}.${y.de}`));
  }

  const gatilhos = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
    .all() as { name: string; sql: string }[];
  for (const g of gatilhos) {
    // Gatilho nao tem pragma. Normaliza espaco para que indentacao nao reprove,
    // e remove o IF NOT EXISTS, que e a unica divergencia de texto que a dupla
    // schema-fresco/passo produz de proposito.
    forma.gatilhos[g.name] = g.sql
      .replace(/IF NOT EXISTS/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return forma;
}
