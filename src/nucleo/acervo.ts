import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { InquilinoId } from './tipos.js';
import { aplicarSchemaAcervo, PISO_SCHEMA_ACERVO, VERSAO_SCHEMA_ACERVO } from './schema-acervo.js';
import {
  migrarComTrilha,
  pendenciasDeMidia,
  versaoGravada,
  type ContextoDeMigracao,
} from './migracao.js';
import { PLANO_DO_ACERVO } from './passos-do-acervo.js';

export { VERSAO_SCHEMA_ACERVO, PISO_SCHEMA_ACERVO };

export interface Acervo {
  db: Database.Database;
  inquilinoId: InquilinoId;
  caminho: string;
  /**
   * Compila o SQL na primeira vez e REUSA daí em diante, por conexão.
   *
   * Não é otimização: compilar por chamada vaza memória que nada recupera. Um
   * `sqlite3_stmt` vive fora do heap do V8, e o `better-sqlite3` mantém os
   * statements referenciados na conexão para finalizá-los no `close()` — então
   * a coleta de lixo nunca os alcança e o processo só devolve essa memória ao
   * morrer. Medido em 06/09/2026: ~3,8 KB de RSS por `prepare`, invariante ao
   * teto de heap, linear no número de chamadas.
   *
   * Reusar é seguro aqui porque nenhum caminho do produto usa `.iterate()`,
   * `.pluck()`, `.raw()`, `.expand()` ou `.bind()` — todos guardam estado no
   * statement, e aí a segunda chamada herdaria o estado da primeira. Quem
   * introduzir um desses precisa de statement próprio, não do cache.
   */
  preparar(sql: string): Database.Statement;
  versaoDoSchema(): number;
  fechar(): void;
}

/**
 * O objeto Acervo, com o cache de statements por conexão. Um só lugar constrói
 * os dois modos (escrita e somente-leitura) para que o cache não exista em um e
 * falte no outro.
 */
function montarAcervo(db: Database.Database, inquilinoId: InquilinoId, caminho: string): Acervo {
  const compilados = new Map<string, Database.Statement>();
  return {
    db,
    inquilinoId,
    caminho,
    preparar(sql: string): Database.Statement {
      const guardado = compilados.get(sql);
      if (guardado !== undefined) return guardado;
      const novo = db.prepare(sql);
      compilados.set(sql, novo);
      return novo;
    },
    versaoDoSchema(): number {
      const l = db.prepare('SELECT versao FROM versao_schema').get() as { versao: number };
      return l.versao;
    },
    fechar(): void {
      compilados.clear();
      db.close();
    },
  };
}

function caminhoDoAcervo(pasta: string, inquilinoId: InquilinoId): string {
  return join(pasta, `${inquilinoId}.db`);
}

/**
 * A recusa que sobrou, e no que ela virou.
 *
 * Ate a forma 10 esta classe cobria as duas direcoes. A partir do ciclo 14,
 * forma ENTRE o piso e a corrente e MIGRADA ao abrir para escrita — e o que
 * esta classe cobre e o que a migracao nao alcanca: forma posterior a este
 * codigo, e abertura somente-leitura, que nao pode escrever forma.
 *
 * Classe propria, e nao Error generico, para que o chamador distinga isto de
 * arquivo corrompido — e para que desligar esta guarda derrube so o teste dela.
 */
export class AcervoDeOutraVersaoError extends Error {
  constructor(
    readonly caminhoDoAcervo: string,
    readonly versaoDoAcervo: number,
    readonly versaoDoCodigo: number,
    readonly somenteLeitura = false,
  ) {
    const explicacao =
      versaoDoAcervo > versaoDoCodigo
        ? `foi criado por uma versao POSTERIOR do malote: forma ${versaoDoAcervo}, ` +
          `este codigo espera ${versaoDoCodigo}. Use a versao do malote que o criou, ou mais nova.`
        : `esta na forma ${versaoDoAcervo} e este codigo espera ${versaoDoCodigo}. ` +
          `Consulta nao migra: rode "malote acervo migrar --inquilino <id>" antes.`;
    super(`Acervo ${caminhoDoAcervo} ${explicacao}`);
    this.name = 'AcervoDeOutraVersaoError';
  }
}

/**
 * Confere que o Acervo aberto é mesmo o do Inquilino pedido.
 * O isolamento vem do arquivo separado; esta checagem existe para o caso em
 * que a resolução de caminho erra o arquivo — aí a separação física já não
 * protege, porque a conexão está no banco do outro.
 */
function conferirIdentidade(db: Database.Database, esperado: InquilinoId, caminho: string): void {
  const linha = db.prepare('SELECT inquilino_id FROM acervo WHERE linha_unica = 1').get() as
    | { inquilino_id: string }
    | undefined;
  if (linha === undefined) return;
  if (linha.inquilino_id !== esperado) {
    throw new Error(
      `Acervo pertence a outro Inquilino: ${caminho} guarda ${linha.inquilino_id}, ` +
        `foi aberto como ${esperado}.`,
    );
  }
}

/**
 * Abre — criando se preciso — o Acervo de um Inquilino.
 *
 * O `contexto` alimenta os passos de migracao que precisam de dado que NAO
 * esta no Acervo. Hoje e um so: o 13 -> 14, que preenche
 * `conversas.configuracao_id` a partir das Configuracoes do REGISTRO, que e
 * outro arquivo. Quem abre sem contexto e migra uma base que exige contexto
 * recebe recusa com a instrucao — nunca um valor escolhido por conveniencia.
 */
export function abrirAcervo(
  pasta: string,
  inquilinoId: InquilinoId,
  contexto: ContextoDeMigracao = {},
): Acervo {
  mkdirSync(pasta, { recursive: true });
  const caminho = caminhoDoAcervo(pasta, inquilinoId);
  const db = new Database(caminho);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // EXPLICITO, e o valor e o mesmo que ja valia. O `CONTEXTO.md` da pasta de
  // trabalho afirmava desde 01/09/2026 que "dois processos no mesmo Acervo
  // serializam com busy_timeout de 5.000 ms" — e em 08/09, procurando a causa
  // da morte do ouvinte, `grep busy_timeout src/` nao achou NADA. Os 5.000 ms
  // eram o default do `better-sqlite3` (medido), nunca uma decisao do produto.
  //
  // Nao adianta aumentar: `better-sqlite3` e SINCRONO e este timeout bloqueia a
  // THREAD, entao esperar mais congelaria o ouvinte. Quem protege de disputa
  // longa e o derrame (`cli/derrame.ts`), nao este numero.
  db.pragma('busy_timeout = 5000');

  const versaoAntes = versaoGravada(db);

  if (versaoAntes === undefined) {
    // Base NOVA: a forma corrente vem do schema fresco, de uma vez so.
    aplicarSchemaAcervo(db);
    db.prepare('INSERT INTO versao_schema (versao) VALUES (?)').run(VERSAO_SCHEMA_ACERVO);
  } else if (versaoAntes > VERSAO_SCHEMA_ACERVO) {
    db.close();
    throw new AcervoDeOutraVersaoError(caminho, versaoAntes, VERSAO_SCHEMA_ACERVO);
  } else if (versaoAntes < VERSAO_SCHEMA_ACERVO) {
    // Forma anterior sobe pelos PASSOS, e aplicarSchemaAcervo NAO roda aqui.
    // Essa e a decisao estrutural do ciclo 14: com ele no caminho, uma tabela
    // acrescentada ao schema fresco SEM passo apareceria no banco existente
    // por CREATE TABLE IF NOT EXISTS, e o teste de equivalencia passaria —
    // cegando exatamente o defeito que ele existe para pegar.
    try {
      // `inquilinoId` fica UNDEFINED de proposito: a trilha do Acervo nao tem
      // coluna `inquilino_id` — quem a tem e a do Registro. Passa-lo aqui, so
      // porque a assinatura o aceita, quebra a migracao com
      // "table operacoes has no column named inquilino_id".
      migrarComTrilha(db, caminho, PLANO_DO_ACERVO, undefined, contexto);
    } catch (erro) {
      db.close();
      throw erro;
    }
  }
  // Forma corrente: nao aplica schema e nao conta tabela. Este e o caminho
  // quente, percorrido por todo comando, e ele nao ganhou trabalho novo.

  // Pendencia em aberto NAO segue como se estivesse tudo certo. Nenhum passo
  // deste ciclo mexe em midia, entao este ramo so dispara para quem escrever o
  // primeiro — e e para ele que a mensagem fala.
  const pendentes = pendenciasDeMidia(db);
  if (pendentes.length > 0) {
    const lista = pendentes.map((p) => `${p.de}->${p.para}: ${p.acao}`).join('; ');
    db.close();
    throw new Error(
      `Acervo ${caminho} tem acao de midia PENDENTE da migracao: ${lista}. ` +
        `O banco esta na forma nova e os arquivos podem nao estar. Conclua a acao ` +
        `e baixe a pendencia antes de usar este Acervo.`,
    );
  }

  conferirIdentidade(db, inquilinoId, caminho);

  const agora = new Date().toISOString();
  db.prepare(
    `INSERT INTO acervo (linha_unica, inquilino_id, criado_em) VALUES (1, ?, ?)
     ON CONFLICT (linha_unica) DO NOTHING`,
  ).run(inquilinoId, agora);

  return montarAcervo(db, inquilinoId, caminho);
}

/** Abre o Acervo sem permitir escrita. Usado pelos caminhos de consulta. */
export function abrirAcervoSomenteLeitura(pasta: string, inquilinoId: InquilinoId): Acervo {
  const caminho = caminhoDoAcervo(pasta, inquilinoId);
  const db = new Database(caminho, { readonly: true });

  // Ler nao muda o que se le: subir a forma e escrita, e esta porta nao
  // escreve. Forma divergente — em qualquer direcao — recusa, e a mensagem
  // manda migrar.
  const gravada = versaoGravada(db);
  if (gravada !== undefined && gravada !== VERSAO_SCHEMA_ACERVO) {
    db.close();
    throw new AcervoDeOutraVersaoError(caminho, gravada, VERSAO_SCHEMA_ACERVO, true);
  }

  conferirIdentidade(db, inquilinoId, caminho);

  return montarAcervo(db, inquilinoId, caminho);
}

/**
 * Forma gravada de um Acervo SEM abri-lo pela porta normal.
 *
 * Existe porque abrir para escrita JA migra: para relatar "a forma X subiu
 * para Y" e preciso ler X antes. Abre somente-leitura e nao confere versao —
 * e a unica leitura do produto que precisa ver forma divergente sem recusar.
 */
export function versaoDoAcervoEmDisco(pasta: string, inquilinoId: InquilinoId): number | undefined {
  const caminho = caminhoDoAcervo(pasta, inquilinoId);
  if (!existsSync(caminho)) return undefined;
  const db = new Database(caminho, { readonly: true });
  try {
    return versaoGravada(db);
  } finally {
    db.close();
  }
}
