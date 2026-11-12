import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A Localizacao do Anexo: onde o arquivo de cada Anexo esta no Destino Remoto,
 * com o que prova que esta la inteiro. Base PROPRIA do Servico de Armazenamento,
 * uma por Inquilino, fora do Acervo (o Acervo nao muda de forma por causa dela).
 *
 * E CACHE REFAZIVEL: o caminho remoto e funcao do Anexo, e o que nao se
 * deriva (o identificador do arquivo no remoto) volta por listagem. Por isso
 * a politica de forma NAO e a do Registro (que migra) nem a do Acervo entre
 * piso e corrente (que tambem migra): forma diferente da corrente, QUALQUER
 * uma, e RECUSADA com a instrucao de recriar, e nao ha passo de migracao (ADR
 * `20260901-politica-de-forma-por-base`, que ganhou a linha da Localizacao). Mora em `registro/` porque so `nucleo/` e
 * `registro/` tocam em tabela, e na categoria de ESTADO do armazenamento (o
 * que se refaz), nao na de dados.
 *
 * So o Servico de Armazenamento escreve. Quem so le (o comando de estado) abre
 * `somente leitura`, que nunca cria nem migra.
 */

export const VERSAO_DA_LOCALIZACAO = 1;

export class LocalizacaoDeOutraFormaError extends Error {
  constructor(gravada: number) {
    super(
      `A base de Localizacao esta na forma ${gravada} e esta versao do malote espera a ${VERSAO_DA_LOCALIZACAO}. ` +
        'A base e refazivel: recrie-a com "malote armazenamento reconstruir".',
    );
    this.name = 'LocalizacaoDeOutraFormaError';
  }
}

export interface LocalizacaoDoAnexo {
  anexoId: string;
  remoto: string;
  caminhoRemoto: string;
  /** Identificador do arquivo no remoto, quando o remoto o da (Google Drive). */
  idNoRemoto: string | null;
  tamanho: number;
  /** Impressao de Anexo verificada no remoto. */
  hash: string;
  verificadaEm: string;
  copiaLocalRemovidaEm: string | null;
  /** Quantos arquivos alem deste existem no mesmo caminho remoto. Nunca se apaga automaticamente. */
  duplicatas: number;
}

export interface NovaLocalizacao {
  anexoId: string;
  remoto: string;
  caminhoRemoto: string;
  idNoRemoto: string | null;
  tamanho: number;
  hash: string;
  verificadaEm: string;
}

export interface ResumoDaLocalizacao {
  enviados: number;
  bytesEnviados: number;
  copiasLocaisRemovidas: number;
  duplicatas: number;
  falhos: number;
  ultimaVerificacaoEm: string | null;
}

export interface Localizacao {
  db: Database.Database;
  preparar(sql: string): Database.Statement;
  fechar(): void;
}

function montar(db: Database.Database): Localizacao {
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
    fechar(): void {
      compilados.clear();
      db.close();
    },
  };
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS versao_da_localizacao (
    id     INTEGER PRIMARY KEY CHECK (id = 1),
    versao INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS localizacoes (
    anexo_id                 TEXT PRIMARY KEY,
    remoto                   TEXT NOT NULL,
    caminho_remoto           TEXT NOT NULL,
    id_no_remoto            TEXT,
    tamanho                  INTEGER NOT NULL,
    hash                     TEXT NOT NULL,
    verificada_em            TEXT NOT NULL,
    copia_local_removida_em  TEXT,
    duplicatas               INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_localizacoes_verificada ON localizacoes(verificada_em);

  CREATE TABLE IF NOT EXISTS falhas_de_envio (
    anexo_id            TEXT PRIMARY KEY,
    tentativas          INTEGER NOT NULL,
    ultimo_erro         TEXT NOT NULL,
    ultima_tentativa_em TEXT NOT NULL
  );
`;

/** `<estado>/armazenamento/<inquilino>.db`: um arquivo por Inquilino, o isolamento e fisico. */
export function caminhoDaLocalizacao(raizDeEstado: string, inquilinoId: string): string {
  return join(raizDeEstado, 'armazenamento', `${inquilinoId}.db`);
}

function abrirBanco(caminho: string, somenteLeitura: boolean): Database.Database {
  const db = somenteLeitura
    ? new Database(caminho, { readonly: true, fileMustExist: true })
    : new Database(caminho);
  if (!somenteLeitura) {
    db.pragma('journal_mode = WAL');
    // Mesmo teto do Acervo: bloqueia a thread, entao nao aumentar.
    db.pragma('busy_timeout = 5000');
  }
  db.pragma('foreign_keys = ON');
  return db;
}

/**
 * A forma gravada, ou `LocalizacaoDeOutraFormaError`. Base sem a tabela de versao (arquivo truncado, cópia pela
 * metade) conta como forma 0: a saida e a mesma de qualquer outra forma, recriar.
 */
function conferirForma(db: Database.Database): void {
  let linha: { versao: number } | undefined;
  try {
    linha = db.prepare('SELECT versao FROM versao_da_localizacao').get() as { versao: number } | undefined;
  } catch {
    throw new LocalizacaoDeOutraFormaError(0);
  }
  if (linha === undefined || linha.versao !== VERSAO_DA_LOCALIZACAO) {
    throw new LocalizacaoDeOutraFormaError(linha?.versao ?? 0);
  }
}

/**
 * Cria a base se nao existe e recusa forma diferente da corrente. O arquivo nasce com o modo 0600 ANTES de o SQLite
 * o abrir: o `-wal` e o `-shm` herdam o modo do arquivo principal, e um `chmod` depois deixava os dois 0644. Base
 * vazia (a criacao foi interrompida, ou dois processos criaram juntos) e completada, e a linha de versao tem chave
 * unica: criar de novo e inofensivo.
 */
export function abrirLocalizacao(raizDeEstado: string, inquilinoId: string): Localizacao {
  const caminho = caminhoDaLocalizacao(raizDeEstado, inquilinoId);
  mkdirSync(join(raizDeEstado, 'armazenamento'), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(caminho, '', { flag: 'wx', mode: 0o600 });
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code !== 'EEXIST') throw erro;
  }
  const db = abrirBanco(caminho, false);
  try {
    const tabelas = (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n;
    if (tabelas === 0) {
      db.exec(SCHEMA);
      db.prepare('INSERT OR IGNORE INTO versao_da_localizacao (id, versao) VALUES (1, ?)').run(VERSAO_DA_LOCALIZACAO);
    }
    conferirForma(db);
  } catch (causa) {
    db.close();
    throw causa;
  }
  return montar(db);
}

/** `undefined` quando a base ainda nao existe: nenhum Anexo foi enviado. Nunca cria nem migra. */
export function abrirLocalizacaoSomenteLeitura(
  raizDeEstado: string,
  inquilinoId: string,
): Localizacao | undefined {
  const caminho = caminhoDaLocalizacao(raizDeEstado, inquilinoId);
  if (!existsSync(caminho)) return undefined;
  const db = abrirBanco(caminho, true);
  try {
    conferirForma(db);
  } catch (causa) {
    db.close();
    throw causa;
  }
  return montar(db);
}

/**
 * Apaga a base e cria outra vazia. Quem chama repovoa por listagem do remoto;
 * o arquivo remoto e o Acervo nao sao tocados. SO COM O SERVICO PARADO: apagar
 * o arquivo por baixo de um processo que o tem aberto faz esse processo gravar
 * num arquivo sem nome, sem erro, e a base nova nasce vazia (medido na revisao
 * do plano). O comando que a chama recusa com o servico vivo.
 */
export function recriarLocalizacao(raizDeEstado: string, inquilinoId: string): Localizacao {
  const caminho = caminhoDaLocalizacao(raizDeEstado, inquilinoId);
  for (const sufixo of ['', '-wal', '-shm']) rmSync(`${caminho}${sufixo}`, { force: true });
  return abrirLocalizacao(raizDeEstado, inquilinoId);
}

interface LinhaDeLocalizacao {
  anexo_id: string;
  remoto: string;
  caminho_remoto: string;
  id_no_remoto: string | null;
  tamanho: number;
  hash: string;
  verificada_em: string;
  copia_local_removida_em: string | null;
  duplicatas: number;
}

function deLinha(l: LinhaDeLocalizacao): LocalizacaoDoAnexo {
  return {
    anexoId: l.anexo_id,
    remoto: l.remoto,
    caminhoRemoto: l.caminho_remoto,
    idNoRemoto: l.id_no_remoto,
    tamanho: l.tamanho,
    hash: l.hash,
    verificadaEm: l.verificada_em,
    copiaLocalRemovidaEm: l.copia_local_removida_em,
    duplicatas: l.duplicatas,
  };
}

/** Grava (ou regrava) a Localizacao verificada; nao desfaz a remocao da copia local nem as duplicatas ja vistas. */
export function registrarLocalizacao(base: Localizacao, nova: NovaLocalizacao): void {
  base
    .preparar(
      `INSERT INTO localizacoes (anexo_id, remoto, caminho_remoto, id_no_remoto, tamanho, hash, verificada_em)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (anexo_id) DO UPDATE SET
         remoto = excluded.remoto,
         caminho_remoto = excluded.caminho_remoto,
         id_no_remoto = excluded.id_no_remoto,
         tamanho = excluded.tamanho,
         hash = excluded.hash,
         verificada_em = excluded.verificada_em`,
    )
    .run(nova.anexoId, nova.remoto, nova.caminhoRemoto, nova.idNoRemoto, nova.tamanho, nova.hash, nova.verificadaEm);
  base.preparar('DELETE FROM falhas_de_envio WHERE anexo_id = ?').run(nova.anexoId);
}

const TAMANHO_DO_LOTE = 500;

/** As Localizacoes dos Anexos pedidos, em lotes de tamanho fixo: o SQL e constante e `preparar` o reusa. */
export function lerLocalizacoes(
  base: Localizacao,
  anexoIds: readonly string[],
): Map<string, LocalizacaoDoAnexo> {
  const achadas = new Map<string, LocalizacaoDoAnexo>();
  for (let i = 0; i < anexoIds.length; i += TAMANHO_DO_LOTE) {
    const lote = anexoIds.slice(i, i + TAMANHO_DO_LOTE);
    const linhas = base
      .preparar(
        `SELECT anexo_id, remoto, caminho_remoto, id_no_remoto, tamanho, hash, verificada_em,
                copia_local_removida_em, duplicatas
           FROM localizacoes WHERE anexo_id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify(lote)) as LinhaDeLocalizacao[];
    for (const l of linhas) achadas.set(l.anexo_id, deLinha(l));
  }
  return achadas;
}

export function marcarCopiaLocalRemovida(base: Localizacao, anexoId: string, em: string): void {
  base.preparar('UPDATE localizacoes SET copia_local_removida_em = ? WHERE anexo_id = ?').run(em, anexoId);
}

export function registrarDuplicatas(base: Localizacao, anexoId: string, quantidade: number): void {
  base.preparar('UPDATE localizacoes SET duplicatas = ? WHERE anexo_id = ?').run(quantidade, anexoId);
}

/**
 * Localizacoes verificadas ha tempo bastante e ainda com copia local: as
 * candidatas a perder a copia local. `verificadasAte` e um instante ISO; a
 * Janela de Copia Local conta da verificacao, entao o corte e agora menos a Janela.
 */
export function candidatasAPerderACopiaLocal(
  base: Localizacao,
  verificadasAte: string,
  limite: number,
): LocalizacaoDoAnexo[] {
  const linhas = base
    .preparar(
      `SELECT anexo_id, remoto, caminho_remoto, id_no_remoto, tamanho, hash, verificada_em,
              copia_local_removida_em, duplicatas
         FROM localizacoes
        WHERE copia_local_removida_em IS NULL AND verificada_em <= ?
        ORDER BY verificada_em, anexo_id
        LIMIT ?`,
    )
    .all(verificadasAte, limite) as LinhaDeLocalizacao[];
  return linhas.map(deLinha);
}

export function registrarFalhaDeEnvio(base: Localizacao, anexoId: string, erro: string, em: string): void {
  base
    .preparar(
      `INSERT INTO falhas_de_envio (anexo_id, tentativas, ultimo_erro, ultima_tentativa_em)
       VALUES (?, 1, ?, ?)
       ON CONFLICT (anexo_id) DO UPDATE SET
         tentativas = tentativas + 1, ultimo_erro = excluded.ultimo_erro, ultima_tentativa_em = excluded.ultima_tentativa_em`,
    )
    .run(anexoId, erro.slice(0, 500), em);
}

export function resumoDaLocalizacao(base: Localizacao): ResumoDaLocalizacao {
  const l = base
    .preparar(
      `SELECT COUNT(*) AS enviados, COALESCE(SUM(tamanho), 0) AS bytes_enviados,
              COALESCE(SUM(copia_local_removida_em IS NOT NULL), 0) AS removidas,
              COALESCE(SUM(duplicatas), 0) AS duplicatas, MAX(verificada_em) AS ultima
         FROM localizacoes`,
    )
    .get() as {
    enviados: number;
    bytes_enviados: number;
    removidas: number;
    duplicatas: number;
    ultima: string | null;
  };
  const falhos = (base.preparar('SELECT COUNT(*) AS n FROM falhas_de_envio').get() as { n: number }).n;
  return {
    enviados: l.enviados,
    bytesEnviados: l.bytes_enviados,
    copiasLocaisRemovidas: l.removidas,
    duplicatas: l.duplicatas,
    falhos,
    ultimaVerificacaoEm: l.ultima,
  };
}
