import Database from 'better-sqlite3';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * FOTOGRAFIA CONGELADA da forma 2 do Registro — o piso da migracao.
 *
 * Extraida de `git show 37e83ca:src/registro/schema.ts`, o commit de linha de
 * base do ciclo 14.
 *
 * Por que ela existe, e nao uma fabricacao derivada do schema corrente: no
 * plano 1 deste ciclo a fabricacao sintetica do Acervo — criar do binario
 * atual e remover so a tabela que o passo cria — foi medida e NAO detectava o
 * pecado que devia detectar. Ela contamina os DOIS lados da comparacao, entao
 * tabela acrescentada ao schema fresco sem passo aparece em ambos e a
 * equivalencia passa. Aqui a base do piso vem do DDL de entao, e so dele.
 *
 * Quando o piso subir um dia, esta fixture se regenera no piso novo, do commit
 * correspondente.
 */
const SCHEMA_REGISTRO_V2 = `
    CREATE TABLE IF NOT EXISTS versao_schema (
      versao INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inquilinos (
      id            TEXT PRIMARY KEY,
      titular_nome  TEXT NOT NULL,
      criado_em     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS destinos_de_midia (
      inquilino_id   TEXT PRIMARY KEY,
      natureza       TEXT NOT NULL CHECK (natureza IN ('local')),
      endereco       TEXT NOT NULL,
      configurado_em TEXT NOT NULL,
      FOREIGN KEY (inquilino_id) REFERENCES inquilinos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS configuracoes_de_adaptador (
      id            TEXT PRIMARY KEY,
      inquilino_id  TEXT NOT NULL,
      fonte         TEXT NOT NULL,
      apelido       TEXT NOT NULL,
      criada_em     TEXT NOT NULL,
      UNIQUE (inquilino_id, fonte, apelido),
      FOREIGN KEY (inquilino_id) REFERENCES inquilinos(id) ON DELETE CASCADE
    );

    -- Precedencia entre origens de nome, POR INQUILINO. Nao vive no Acervo:
    -- e o que faz troca-la mudar o nome exibido sem escrever no Acervo.
    -- Acrescimo puro: nenhuma coluna de tabela existente muda, entao
    -- CREATE TABLE IF NOT EXISTS alcanca instalacao que ja existe.
    CREATE TABLE IF NOT EXISTS precedencias_de_nome (
      inquilino_id  TEXT NOT NULL,
      origem        TEXT NOT NULL,
      peso          INTEGER NOT NULL,
      definida_em   TEXT NOT NULL,
      PRIMARY KEY (inquilino_id, origem),
      FOREIGN KEY (inquilino_id) REFERENCES inquilinos(id) ON DELETE CASCADE
    );

    -- Qual conta DENTRO da Fonte esta Configuracao representa. Tabela nova, e
    -- nao coluna em configuracoes_de_adaptador, por uma razao mecanica:
    -- CREATE TABLE IF NOT EXISTS acrescenta tabela a instalacao que ja existe
    -- e NUNCA altera tabela existente. Coluna nova exigiria migracao do
    -- Registro. Coluna nova em tabela povoada continua sendo o que se evita:
    -- o Registro sobe de versao sozinho ao abrir, mas subir de versao NAO
    -- reescreve tabela — so acrescenta o que falta.
    --
    -- O valor e OPACO para o Registro. Quem sabe o que 'pessoal' significa e o
    -- Adaptador da Fonte; aqui e so uma cadeia.
    CREATE TABLE IF NOT EXISTS contas_de_adaptador (
      configuracao_id TEXT PRIMARY KEY,
      conta           TEXT NOT NULL,
      definida_em     TEXT NOT NULL,
      FOREIGN KEY (configuracao_id) REFERENCES configuracoes_de_adaptador(id) ON DELETE CASCADE
    );

    -- Intervalo esperado entre Materiais, em dias, por Configuracao.
    --
    -- Tabela nova, e nao coluna em configuracoes_de_adaptador, pela mesma
    -- razao mecanica da tabela de contas: CREATE TABLE IF NOT EXISTS
    -- acrescenta tabela a instalacao existente e nunca altera tabela que ja
    -- existe. Mesma razao mecanica da tabela de contas: tabela nova alcanca
    -- instalacao existente, coluna nova nao.
    CREATE TABLE IF NOT EXISTS intervalos_esperados (
      configuracao_id TEXT PRIMARY KEY,
      dias            INTEGER NOT NULL CHECK (dias > 0),
      declarado_em    TEXT NOT NULL,
      FOREIGN KEY (configuracao_id) REFERENCES configuracoes_de_adaptador(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS politicas_de_retencao (
      inquilino_id        TEXT PRIMARY KEY,
      mais_velho_que_dias INTEGER,
      maior_que_bytes     INTEGER,
      tipos               TEXT,
      definida_em         TEXT NOT NULL,
      FOREIGN KEY (inquilino_id) REFERENCES inquilinos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chaves_de_operador (
      id           TEXT PRIMARY KEY,
      sal          TEXT NOT NULL,
      hash         TEXT NOT NULL,
      criada_em    TEXT NOT NULL,
      revogada_em  TEXT
    );

    CREATE TABLE IF NOT EXISTS tentativas_de_chave (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      ocorrida_em    TEXT NOT NULL,
      chave_id       TEXT,
      aceita         INTEGER NOT NULL,
      inquilino_alvo TEXT
    );

    -- A trilha da INSTALACAO. Mesma forma da do Acervo, mais a coluna de
    -- Inquilino — que aqui existe porque o Registro serve a todos, e decisao
    -- de configuracao (Destino, Politica, Precedencia, Intervalo) e de um
    -- Inquilino, enquanto criar Inquilino e gerir Chave nao sao de nenhum.
    --
    -- A trilha mora junto do efeito: decisao gravada aqui tem a Operacao aqui,
    -- na mesma transacao. Acervo e Registro sao bancos separados, e transacao
    -- entre bancos nao e coisa que se queira construir para isto.
    CREATE TABLE IF NOT EXISTS operacoes (
      id              TEXT PRIMARY KEY,
      natureza        TEXT NOT NULL,
      reversibilidade TEXT NOT NULL
        CHECK (reversibilidade IN ('por-efeito', 'por-delegacao', 'irreversivel')),
      ocorrida_em     TEXT NOT NULL,
      desfaz_id       TEXT,
      -- Sem chave estrangeira para inquilinos: a trilha SOBREVIVE ao que ela
      -- registra. ON DELETE CASCADE apagaria a prova junto com o objeto.
      inquilino_id    TEXT,
      FOREIGN KEY (desfaz_id) REFERENCES operacoes(id)
    );

    CREATE INDEX IF NOT EXISTS operacoes_por_instante
      ON operacoes (ocorrida_em DESC);
    CREATE INDEX IF NOT EXISTS operacoes_por_inquilino
      ON operacoes (inquilino_id, ocorrida_em DESC);

    -- "Operacao ja desfeita nao se desfaz duas vezes" e guarda de SCHEMA.
    CREATE UNIQUE INDEX IF NOT EXISTS operacao_desfeita_uma_vez
      ON operacoes (desfaz_id) WHERE desfaz_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS linhas_de_efeito (
      id          TEXT PRIMARY KEY,
      operacao_id TEXT NOT NULL,
      ordem       INTEGER NOT NULL,
      natureza    TEXT NOT NULL CHECK (natureza IN ('valor', 'referencia')),
      tabela      TEXT NOT NULL,
      chave       TEXT NOT NULL,
      campo       TEXT,
      antes       TEXT,
      depois      TEXT,
      CHECK (
        (natureza = 'valor'      AND campo IS NOT NULL) OR
        (natureza = 'referencia' AND campo IS NULL AND antes IS NULL AND depois IS NULL)
      ),
      FOREIGN KEY (operacao_id) REFERENCES operacoes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS linhas_por_operacao
      ON linhas_de_efeito (operacao_id, ordem);

    CREATE INDEX IF NOT EXISTS idx_adaptador_inquilino
      ON configuracoes_de_adaptador(inquilino_id);
    CREATE INDEX IF NOT EXISTS idx_tentativas_momento
      ON tentativas_de_chave(ocorrida_em);`;

/**
 * Cria um Registro GENUINAMENTE na forma 2, do DDL congelado.
 *
 * Apaga o arquivo existente antes — base, `-wal` e `-shm` —, porque escrever o
 * DDL antigo por cima de um banco corrente deixaria as tabelas dos dois.
 */
export function criarRegistroNoPiso(raiz: string): void {
  mkdirSync(raiz, { recursive: true });
  const caminho = join(raiz, 'registro.db');
  for (const sufixo of ['', '-wal', '-shm']) {
    rmSync(`${caminho}${sufixo}`, { force: true });
  }

  const db = new Database(caminho);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA_REGISTRO_V2);
    db.prepare('INSERT INTO versao_schema (versao) VALUES (2)').run();
  } finally {
    db.close();
  }
}
