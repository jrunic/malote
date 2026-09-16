import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { InquilinoId } from '../nucleo/tipos.js';
import { aplicarSchemaRegistro, PISO_SCHEMA_REGISTRO, VERSAO_SCHEMA_REGISTRO } from './schema.js';
import { migrarComTrilha, versaoGravada } from '../nucleo/migracao.js';
import { PLANO_DO_REGISTRO } from './passos-do-registro.js';
import { emOperacao } from '../nucleo/trilha.js';

export { VERSAO_SCHEMA_REGISTRO, PISO_SCHEMA_REGISTRO };

/**
 * Recusa de abrir Registro cuja forma e POSTERIOR a que este codigo conhece.
 *
 * As duas bases recusam forma posterior, e as duas MIGRAM forma anterior por
 * passos — a maquina e a mesma desde o ciclo 14. A assimetria que sobra e uma
 * so: nao existe `registro recriar`, porque o Registro guarda Inquilino e
 * Chave de Operador, que material nenhum reconstroi.
 *
 * Por isso a mensagem daqui nao manda recriar em lugar nenhum: seria apontar
 * para um comando que nao existe. Politica completa das duas bases na ADR
 * local 20260901-politica-de-forma-por-base.md.
 */
export class RegistroDeOutraVersaoError extends Error {
  constructor(
    readonly caminhoDoRegistro: string,
    readonly versaoDoRegistro: number,
    readonly versaoDoCodigo: number,
  ) {
    super(
      `Registro ${caminhoDoRegistro} foi escrito por uma versao POSTERIOR do malote: ` +
        `forma ${versaoDoRegistro}, este codigo espera ${versaoDoCodigo}. ` +
        `Use a versao do malote que o criou, ou mais nova.`,
    );
    this.name = 'RegistroDeOutraVersaoError';
  }
}

export interface Registro {
  db: Database.Database;
  /**
   * Compila o SQL na primeira vez e REUSA daí em diante, por conexão. Mesma
   * porta e mesma razão do `Acervo.preparar` — ver a explicação lá.
   */
  preparar(sql: string): Database.Statement;
  versaoDoSchema(): number;
  fechar(): void;
}

/** O objeto Registro, com o cache de statements por conexão. */
function montarRegistro(db: Database.Database): Registro {
  const compilados = new Map<string, Database.Statement>();
  return {
    db,
    preparar(sql: string): Database.Statement {
      const guardado = compilados.get(sql);
      if (guardado !== undefined) return guardado;
      const novo = db.prepare(sql);
      compilados.set(sql, novo);
      return novo;
    },
    versaoDoSchema(): number {
      const linha = db.prepare('SELECT versao FROM versao_schema').get() as { versao: number };
      return linha.versao;
    },
    fechar(): void {
      compilados.clear();
      db.close();
    },
  };
}

/** Abre — criando se preciso — o Registro da instalação enraizada em `raiz`. */
export function abrirRegistro(raiz: string): Registro {
  mkdirSync(raiz, { recursive: true });
  const caminho = join(raiz, 'registro.db');
  const db = new Database(caminho);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // LE ANTES de aplicar schema: aplicar primeiro escreveria numa forma que
  // este codigo talvez nao devesse tocar.
  const gravada = versaoGravada(db);

  if (gravada === undefined) {
    // Base NOVA: a forma corrente vem do schema fresco, de uma vez so.
    aplicarSchemaRegistro(db);
    db.prepare('INSERT INTO versao_schema (versao) VALUES (?)').run(VERSAO_SCHEMA_REGISTRO);
  } else if (gravada > VERSAO_SCHEMA_REGISTRO) {
    db.close();
    throw new RegistroDeOutraVersaoError(caminho, gravada, VERSAO_SCHEMA_REGISTRO);
  } else if (gravada < VERSAO_SCHEMA_REGISTRO) {
    // Pelos PASSOS, e nao reexecutando o schema. A forma antiga alcancava
    // tabela e nunca coluna, e carimbava o numero novo de qualquer jeito — que
    // e afirmar uma forma que a base talvez nao tenha.
    try {
      migrarComTrilha(db, caminho, PLANO_DO_REGISTRO);
    } catch (erro) {
      db.close();
      throw erro;
    }
  }

  return montarRegistro(db);
}

/**
 * Abre o Registro sem poder de escrita — para ler a trilha e o inventario.
 *
 * NAO aplica schema e NAO sobe versao: as duas coisas sao escrita, e a porta
 * de leitura nao escreve. Forma anterior e aceita, porque a diferenca ate aqui
 * so acrescentou tabelas; forma POSTERIOR recusa, igual a porta de escrita —
 * ler estrutura que este codigo nao conhece produz resposta errada em silencio.
 */
export function abrirRegistroSomenteLeitura(raiz: string): Registro {
  const caminho = join(raiz, 'registro.db');
  const db = new Database(caminho, { readonly: true });

  const gravada = versaoGravada(db);
  // MUDOU no ciclo 14. Antes esta porta abria forma anterior assim mesmo,
  // porque toda mudanca de forma tinha sido aditiva de TABELA. Com passos isso
  // deixou de valer: um passo pode alterar coluna, e ler forma desconhecida
  // produz resultado silenciosamente errado. Subir continua sendo escrita, e
  // esta porta nao escreve — entao a saida e recusar.
  if (gravada !== undefined && gravada !== VERSAO_SCHEMA_REGISTRO) {
    db.close();
    throw new RegistroDeOutraVersaoError(caminho, gravada, VERSAO_SCHEMA_REGISTRO);
  }

  return montarRegistro(db);
}

export interface Inquilino {
  id: InquilinoId;
  titularNome: string;
  criadoEm: string;
}

/**
 * Cria um Inquilino — um mundo isolado dentro da instalação.
 * Não emite Chave de Acesso: são operações separadas, de propósito.
 */
export function criarInquilino(registro: Registro, entrada: { titularNome: string }): InquilinoId {
  const nome = entrada.titularNome.trim();
  if (nome === '') {
    throw new Error('Inquilino exige nome de Titular: informe quem é o dono do Acervo.');
  }
  const id = randomUUID();
  emOperacao(
    registro,
    { natureza: 'criar-inquilino', reversibilidade: 'por-efeito', inquilinoId: id },
    (op) => {
      registro.preparar('INSERT INTO inquilinos (id, titular_nome, criado_em) VALUES (?, ?, ?)')
        .run(id, nome, new Date().toISOString());
      op.valor({ tabela: 'inquilinos', chave: id, campo: 'id', antes: null, depois: id });
    },
  );
  return id;
}

export function listarInquilinos(registro: Registro): Inquilino[] {
  const linhas = registro.preparar('SELECT id, titular_nome, criado_em FROM inquilinos ORDER BY criado_em')
    .all() as Array<{ id: string; titular_nome: string; criado_em: string }>;
  return linhas.map((l) => ({ id: l.id, titularNome: l.titular_nome, criadoEm: l.criado_em }));
}
