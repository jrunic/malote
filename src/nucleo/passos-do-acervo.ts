import type { PassoDeMigracao, PlanoDeMigracao } from './migracao.js';
import { PISO_SCHEMA_ACERVO, VERSAO_SCHEMA_ACERVO } from './schema-acervo.js';

/**
 * DDL CONGELADO da forma 11. Nao importa nada de `schema-acervo.ts`, de
 * proposito: quando um passo futuro alterar `migracoes_aplicadas`, este aqui
 * tem de continuar criando a forma de ENTAO. Compartilhar o SQL faria o passo
 * antigo produzir a forma nova, e a cadeia deixaria de reconstruir a historia.
 * A duplicacao e deliberada, e o teste de equivalencia e quem a mantem honesta.
 */
const CONTABILIDADE_V11 = `
  CREATE TABLE migracoes_aplicadas (
    de             INTEGER NOT NULL,
    para           INTEGER NOT NULL,
    descricao      TEXT NOT NULL,
    aplicada_em    TEXT NOT NULL,
    conferencia    TEXT NOT NULL,
    midia_pendente TEXT,
    PRIMARY KEY (de, para)
  );
`;

/**
 * A contabilidade da propria maquina e o primeiro passo real do produto.
 *
 * A tabela de versao guarda um numero e nada mais: nao diz qual passo rodou,
 * quando, nem o que a conferencia mediu. A maquina precisa dessa memoria — a
 * pendencia de midia mora nela, o registro da conferencia tambem, e e por ela
 * que a segunda execucao sabe que nao ha o que fazer.
 *
 * Decidido no gate de 01/09/2026. A alternativa era lista de passos vazia,
 * exercitada so por passo sintetico de teste, que deixaria a subida sem
 * verificacao contra o binario.
 */
const CRIA_CONTABILIDADE: PassoDeMigracao = {
  de: 10,
  para: 11,
  descricao: 'cria a contabilidade da maquina de migracao',
  tabelasNovas: ['migracoes_aplicadas'],
  aplicar: (db) => db.exec(CONTABILIDADE_V11),
};

/**
 * DDL CONGELADO da forma 12. Duplica o texto do schema fresco de proposito —
 * a mesma regra do passo anterior, e o teste de equivalencia e quem a mantem
 * honesta.
 */
const CORRESPONDENCIAS_V12 = `
  CREATE TABLE correspondencias_de_endereco (
    fonte        TEXT NOT NULL,
    alternativo  TEXT NOT NULL,
    canonico     TEXT NOT NULL,
    aprendida_em TEXT NOT NULL,
    PRIMARY KEY (fonte, alternativo)
  );
`;

/**
 * O primeiro passo de migracao causado por NECESSIDADE DE PRODUTO.
 *
 * O passo anterior criou a contabilidade da propria maquina; este existe
 * porque a recepcao ao vivo entrega o endereco numa forma que o material
 * exportado nao grava, e sem traduzir o produto duplicaria Conversa e
 * identidade. Medido em 02/09/2026 sobre 11h23 de captura real.
 */
const CRIA_CORRESPONDENCIAS: PassoDeMigracao = {
  de: 11,
  para: 12,
  descricao: 'cria a correspondencia entre formas de endereco',
  tabelasNovas: ['correspondencias_de_endereco'],
  aplicar: (db) => db.exec(CORRESPONDENCIAS_V12),
};

/**
 * O Ator entra na trilha do Acervo.
 *
 * `ALTER TABLE ADD COLUMN` e o caso barato: nao recria tabela, nao move linha, e
 * as existentes ficam com NULL — que e o valor certo para elas, porque quando
 * foram gravadas nao havia campo. Por isso o passo nao declara `tabelasNovas`:
 * nao ha tabela nova, e a conferencia de contagens nao muda nada.
 */
const ATOR_V13: PassoDeMigracao = {
  de: 12,
  para: 13,
  descricao: 'acrescenta o Ator a trilha do Acervo',
  aplicar: (db) => db.exec('ALTER TABLE operacoes ADD COLUMN ator TEXT;'),
};

/**
 * DDL CONGELADO da forma 14. Duplica o schema fresco de proposito — mesma regra
 * dos passos anteriores, e o teste de equivalencia e quem a mantem honesta.
 *
 * Sem crase nos comentarios daqui para baixo: este texto vive dentro de um
 * template literal, e crase FECHA A STRING. Custou uma quebra de compilacao em
 * 08/09/2026.
 */
const CONVERSAS_V14 = `
  CREATE TABLE conversas_v14 (
    id              TEXT PRIMARY KEY,
    fonte           TEXT NOT NULL,
    id_externo      TEXT NOT NULL,
    coletiva        INTEGER NOT NULL DEFAULT 0,
    configuracao_id TEXT,
    criada_em       TEXT NOT NULL,
    bruto           TEXT,
    CHECK ((coletiva = 1 AND configuracao_id IS NULL)
        OR (coletiva = 0 AND configuracao_id IS NOT NULL))
  );
`;

/** O rebuild propriamente dito, depois das duas tabelas coexistirem. */
const TROCA_CONVERSAS_V14 = `
  DROP TABLE conversas;
  ALTER TABLE conversas_v14 RENAME TO conversas;
  CREATE UNIQUE INDEX idx_conversas_coletiva
    ON conversas (fonte, id_externo) WHERE coletiva = 1;
  CREATE UNIQUE INDEX idx_conversas_direta
    ON conversas (fonte, id_externo, configuracao_id) WHERE coletiva = 0;
`;

/**
 * Conversa direta passa a ser identificada pela Configuracao de Adaptador.
 *
 * E RECONSTRUCAO DE TABELA, e nao `ALTER TABLE ADD COLUMN`: a restricao
 * `UNIQUE (fonte, id_externo)` e declarada DENTRO da tabela, vive como
 * `sqlite_autoindex_conversas_2`, e NAO existe `DROP INDEX` para ela. Se
 * sobrevivesse, os dois indices parciais seriam decoracao e a segunda Conversa
 * direta continuaria recusada pela chave velha — com a suite verde.
 *
 * Quatro tabelas apontam para `conversas` com `ON DELETE CASCADE`: `mensagens`,
 * `participacoes`, `transicoes_de_participacao` e `metadados_de_coletiva`. Por
 * isso `recriaTabelaReferenciada`, que desliga o enforcement de FK ANTES da
 * transacao — dentro dela o PRAGMA e ignorado em silencio.
 *
 * Medido em 08/09/2026, ao importar a segunda conta de WhatsApp do Titular: 89
 * Conversas diretas colidiram no mesmo fio, e ZERO coletivas.
 */
const CONVERSA_POR_CONFIGURACAO_V14: PassoDeMigracao = {
  de: 13,
  para: 14,
  descricao: 'Conversa direta passa a ser identificada pela Configuracao de Adaptador',
  recriaTabelaReferenciada: true,
  exigeContexto: true,
  aplicar: (db, contexto) => {
    // Mapa de LISTA, e nao de valor unico: com duas Configuracoes da mesma
    // Fonte, um mapa simples faria a ultima vencer EM SILENCIO e todas as
    // diretas iriam para ela. Este passo e congelado e roda em qualquer v13
    // para sempre, inclusive num Registro que ja tenha duas.
    const porFonte = new Map<string, string[]>();
    for (const c of contexto.configuracoes ?? []) {
      porFonte.set(c.fonte, [...(porFonte.get(c.fonte) ?? []), c.id]);
    }

    // Mede as Fontes ANTES de preencher. Atribuir a unica Configuracao que
    // existe funcionaria hoje e mentiria no dia em que o Instagram entrar.
    const fontes = db
      .prepare('SELECT fonte, COUNT(*) AS n FROM conversas WHERE coletiva = 0 GROUP BY fonte')
      .all() as { fonte: string; n: number }[];
    for (const f of fontes) {
      const ids = porFonte.get(f.fonte) ?? [];
      if (ids.length === 0) {
        throw new Error(
          `${f.n} Conversas diretas da Fonte ${f.fonte} e nenhuma Configuracao dessa Fonte.`,
        );
      }
      if (ids.length > 1) {
        throw new Error(
          `${f.n} Conversas diretas da Fonte ${f.fonte} e ${ids.length} Configuracoes dessa ` +
            'Fonte, mais de uma. Nao ha como saber de qual conta cada fio e.',
        );
      }
    }

    db.exec(CONVERSAS_V14);
    for (const [fonte, ids] of porFonte) {
      db.prepare(
        `INSERT INTO conversas_v14
           (id, fonte, id_externo, coletiva, configuracao_id, criada_em, bruto)
         SELECT id, fonte, id_externo, coletiva, ?, criada_em, bruto
           FROM conversas WHERE coletiva = 0 AND fonte = ?`,
      ).run(ids[0] as string, fonte);
    }
    db.exec(
      `INSERT INTO conversas_v14
         (id, fonte, id_externo, coletiva, configuracao_id, criada_em, bruto)
       SELECT id, fonte, id_externo, coletiva, NULL, criada_em, bruto
         FROM conversas WHERE coletiva = 1;`,
    );
    db.exec(TROCA_CONVERSAS_V14);
  },
};

/**
 * O CRITERIO DE COLETIVA PASSA A SER UM SO, E O DADO ANTIGO ACOMPANHA.
 *
 * Ate 08/09/2026 a recepcao ao vivo classificava por `endsWith('@g.us')` e a
 * importacao de material por `ZSESSIONTYPE != 0`. Os dois discordavam em
 * broadcast e status, e o Acervo real guardava as duas respostas:
 *
 *   1.054 Conversas de broadcast/status marcadas COLETIVA (importacao)
 *      11 marcadas DIRETA           (ouvinte ao vivo), com 29.035 Mensagens
 *
 * Enquanto o lookup ignorava a natureza, quem chegasse segundo encontrava a
 * linha do primeiro. Com a chave por natureza da v14, o mesmo endereco vira
 * DUAS Conversas — e a guarda que impede isso BLOQUEOU a importacao da segunda
 * conta. Este passo e a causa; a guarda era o sintoma. Tarefa #826.
 *
 * VIRA, E NAO FUNDE: medido no Acervo real, NENHUM dos 11 enderecos existe
 * tambem como coletiva. Se existisse, um UPDATE cru violaria o indice parcial
 * das coletivas — e a correcao seria mover Mensagem, nao virar linha.
 *
 * `configuracao_id` vai a NULL na mesma sentenca porque o CHECK da tabela
 * exige: coletiva com Configuracao e recusada pelo schema.
 */
const COLETIVA_POR_ENDERECO_V15: PassoDeMigracao = {
  de: 14,
  para: 15,
  descricao: 'broadcast e status passam a ser Conversa coletiva, como a importacao ja gravava',
  aplicar: (db) => {
    db.prepare(
      `UPDATE conversas
          SET coletiva = 1, configuracao_id = NULL
        WHERE coletiva = 0
          AND (id_externo LIKE '%@broadcast'
            OR id_externo LIKE '%@status'
            OR id_externo LIKE '%.status')`,
    ).run();
  },
};

/**
 * DDL CONGELADO da forma 16. Duplica o texto do schema fresco DE PROPOSITO:
 * quando um passo futuro alterar estas tabelas, este aqui tem de continuar
 * criando a forma de ENTAO.
 */
const IDENTIDADE_V16 = `
  CREATE TABLE cartoes_de_catalogo_v16 (
    identificador_id   TEXT NOT NULL,
    cartao             TEXT NOT NULL,
    configuracao_id    TEXT NOT NULL,
    visto_em           TEXT NOT NULL,
    ultimo_avistamento TEXT NOT NULL,
    ausente_em         TEXT,
    PRIMARY KEY (identificador_id, cartao, configuracao_id),
    FOREIGN KEY (identificador_id) REFERENCES identificadores(id) ON DELETE CASCADE
  );
  CREATE TABLE atribuicoes_de_nome_v16 (
    id                 TEXT PRIMARY KEY,
    pessoa_id          TEXT,
    identificador_id   TEXT,
    origem             TEXT NOT NULL,
    configuracao_id    TEXT,
    nome               TEXT NOT NULL,
    atribuido_em       TEXT NOT NULL,
    ultimo_avistamento TEXT NOT NULL,
    CHECK (
      (pessoa_id IS NOT NULL AND identificador_id IS NULL) OR
      (pessoa_id IS NULL     AND identificador_id IS NOT NULL)
    ),
    FOREIGN KEY (pessoa_id) REFERENCES pessoas(id) ON DELETE CASCADE,
    FOREIGN KEY (identificador_id) REFERENCES identificadores(id) ON DELETE CASCADE
  );
`;

/**
 * O rebuild, depois de as tabelas coexistirem.
 *
 * Os indices antigos saem por remocao EXPLICITA. Indice nao se altera, e sem a
 * remocao a base migrada manteria `idx_nome_da_pessoa` na forma antiga — e o
 * defeito nao apareceria aqui: apareceria depois, quando o mesmo nome vindo de
 * uma segunda Configuracao esbarrasse na chave velha. Falha so em base
 * migrada, que e a pior classe.
 */
const TROCA_IDENTIDADE_V16 = `
  DROP TABLE cartoes_de_catalogo;
  ALTER TABLE cartoes_de_catalogo_v16 RENAME TO cartoes_de_catalogo;

  DROP INDEX IF EXISTS idx_nome_da_pessoa;
  DROP INDEX IF EXISTS idx_nome_do_identificador;
  DROP INDEX IF EXISTS idx_atribuicoes_pessoa;
  DROP INDEX IF EXISTS idx_atribuicoes_identificador;
  DROP TABLE atribuicoes_de_nome;
  ALTER TABLE atribuicoes_de_nome_v16 RENAME TO atribuicoes_de_nome;

  CREATE UNIQUE INDEX idx_nome_da_pessoa
    ON atribuicoes_de_nome(pessoa_id, origem, nome, configuracao_id)
    WHERE pessoa_id IS NOT NULL AND configuracao_id IS NOT NULL;
  CREATE UNIQUE INDEX idx_nome_da_pessoa_sem_config
    ON atribuicoes_de_nome(pessoa_id, origem, nome)
    WHERE pessoa_id IS NOT NULL AND configuracao_id IS NULL;
  CREATE UNIQUE INDEX idx_nome_do_identificador
    ON atribuicoes_de_nome(identificador_id, origem, nome, configuracao_id)
    WHERE identificador_id IS NOT NULL AND configuracao_id IS NOT NULL;
  CREATE UNIQUE INDEX idx_nome_do_identificador_sem_config
    ON atribuicoes_de_nome(identificador_id, origem, nome)
    WHERE identificador_id IS NOT NULL AND configuracao_id IS NULL;
  CREATE INDEX idx_atribuicoes_pessoa ON atribuicoes_de_nome(pessoa_id);
  CREATE INDEX idx_atribuicoes_identificador ON atribuicoes_de_nome(identificador_id);

  ALTER TABLE identificadores ADD COLUMN configuracao_id TEXT;
`;

/**
 * A Configuracao de catalogo entra nas tres tabelas de identidade, e o
 * reavistamento ganha coluna propria.
 *
 * AS DUAS TABELAS SAO RECRIADAS, e nao alteradas, e a razao e mecanica:
 * `ALTER TABLE ADD COLUMN ... NOT NULL` e RECUSADO pelo SQLite sem valor
 * padrao ("Cannot add a NOT NULL column with default value NULL"), e com valor
 * padrao o pragma o grava — e o teste de equivalencia COMPARA esse campo, entao
 * a coluna migrada divergiria da criada do zero. Medido em 12/09/2026.
 * `identificadores.configuracao_id` e anulavel, e ali o ALTER basta.
 *
 * `configuracao_id` do Cartao e NOT NULL e nao ha valor a inventar: o passo
 * RECUSA se houver linha, em vez de escolher uma Configuracao. Producao tem
 * zero cartoes — medido em 11/09/2026 —, e a recusa existe porque isso pode
 * mudar antes de a release sair.
 */
const IDENTIDADE_POR_CONFIGURACAO_V16: PassoDeMigracao = {
  de: 15,
  para: 16,
  descricao: 'a Configuracao de catalogo entra nas tabelas de identidade',
  recriaTabelaReferenciada: true,
  aplicar: (db) => {
    const cartoes = db.prepare('SELECT COUNT(*) AS n FROM cartoes_de_catalogo').get() as {
      n: number;
    };
    if (cartoes.n > 0) {
      throw new Error(
        `${cartoes.n} Cartoes de Catalogo e nenhuma Configuracao a atribuir a eles. ` +
          'Nao ha como saber de qual catalogo cada endereco veio.',
      );
    }

    db.exec(IDENTIDADE_V16);
    // O backfill usa o valor que ja existe: a primeira vez vista serve de
    // ultima ate que alguem reavista. Leitor simples, e producao honesta.
    db.exec(
      `INSERT INTO atribuicoes_de_nome_v16
         (id, pessoa_id, identificador_id, origem, configuracao_id, nome,
          atribuido_em, ultimo_avistamento)
       SELECT id, pessoa_id, identificador_id, origem, NULL, nome,
              atribuido_em, atribuido_em
         FROM atribuicoes_de_nome;`,
    );
    db.exec(TROCA_IDENTIDADE_V16);
  },
};

/**
 * A Autoridade entra na Atribuicao de Nome.
 *
 * ALTER TABLE ADD COLUMN como o passo do Ator (12 -> 13): nao recria tabela,
 * nao move linha, e as existentes ficam com NULL — que e o valor certo para
 * elas, porque quando foram gravadas nao havia campo e ninguem sabe de qual
 * campo do material cada nome veio. Por isso o passo nao declara tabelasNovas:
 * nao ha tabela nova, e a conferencia de contagens nao muda nada.
 *
 * Quem resolve as linhas indeterminadas e a REIMPORTACAO, pela subida monotona
 * da porta — nunca um backfill por heuristica, que teria de julgar formato para
 * adivinhar quem falou.
 */
const AUTORIDADE_V17: PassoDeMigracao = {
  de: 16,
  para: 17,
  descricao: 'acrescenta a Autoridade a Atribuicao de Nome',
  aplicar: (db) =>
    db.exec(
      'ALTER TABLE atribuicoes_de_nome ADD COLUMN autoridade TEXT ' +
        "CHECK (autoridade IS NULL OR autoridade IN ('titular', 'terceiro'));",
    ),
};

/**
 * DDL CONGELADO da v18. Duplicado do schema de proposito: o passo tem de
 * continuar produzindo a forma de 2026 mesmo depois de o schema de 2027 mudar.
 */
const MARCAS_V18 = `
  CREATE TABLE marcas_de_conversa (
    conversa_id     TEXT NOT NULL,
    marca           TEXT NOT NULL CHECK (marca IN ('fixada')),
    configuracao_id TEXT NOT NULL,
    observada_em    INTEGER NOT NULL,
    PRIMARY KEY (conversa_id, marca, configuracao_id),
    FOREIGN KEY (conversa_id) REFERENCES conversas(id) ON DELETE CASCADE
  );
  CREATE TABLE marcas_de_mensagem (
    mensagem_id     TEXT NOT NULL,
    marca           TEXT NOT NULL CHECK (marca IN ('favorito')),
    configuracao_id TEXT NOT NULL,
    observada_em    INTEGER NOT NULL,
    PRIMARY KEY (mensagem_id, marca, configuracao_id),
    FOREIGN KEY (mensagem_id) REFERENCES mensagens(id) ON DELETE CASCADE
  );
`;

/**
 * As duas tabelas de Marca do Titular.
 *
 * Acrescimo puro de tabela, como `CRIA_CORRESPONDENCIAS`: nao recria, nao move
 * linha, nao toca dado existente. Precisa existir como PASSO mesmo assim —
 * medido em 12/09/2026: `abrirAcervo` aplica o schema fresco so em base NOVA, e
 * base existente sobe pelos passos. Sem passo, a tabela nao existiria em
 * producao e a primeira escrita de Marca estouraria.
 */
const MARCA_DO_TITULAR_V18: PassoDeMigracao = {
  de: 17,
  para: 18,
  descricao: 'cria as tabelas de Marca do Titular',
  tabelasNovas: ['marcas_de_conversa', 'marcas_de_mensagem'],
  aplicar: (db) => db.exec(MARCAS_V18),
};

/**
 * Direcao da Mensagem — metade do WhatsApp.
 *
 * Nao precisa de ContextoDeMigracao: as duas formas de bruto do WhatsApp
 * (material: ZISFROMME; ao vivo/conversao: key.fromMe) carregam o
 * discriminante na propria Mensagem. Medido em 23/09/2026 contra o Acervo
 * real de producao antes de escrever este passo: 1.574.659 Mensagens de
 * WhatsApp, 1.349.726 na forma material + 224.933 na forma ao vivo, zero sem
 * forma reconhecida, zero bruto invalido.
 *
 * `json_extract` — confirmado disponivel no better-sqlite3 desta arvore.
 * Booleano JSON (`true`/`false`) vira `1`/`0` na comparacao. `json_valid`
 * guarda contra bruto malformado: sem ela, uma linha com JSON invalido
 * lancaria excecao e abortaria a migracao inteira — ela fica `direcao NULL`,
 * contada pelo `acervo migrar`.
 */
const DIRECAO_WHATSAPP_V19: PassoDeMigracao = {
  de: 18,
  para: 19,
  descricao: 'acrescenta a Direcao da Mensagem e preenche para WhatsApp',
  aplicar: (db) => {
    db.exec('ALTER TABLE mensagens ADD COLUMN direcao TEXT ' +
      "CHECK (direcao IS NULL OR direcao IN ('enviada', 'recebida'));");

    db.prepare(
      `UPDATE mensagens
          SET direcao = CASE WHEN json_extract(bruto, '$.ZISFROMME') = 1
                              THEN 'enviada' ELSE 'recebida' END
        WHERE fonte = 'whatsapp'
          AND json_valid(bruto)
          AND json_extract(bruto, '$.ZISFROMME') IS NOT NULL`,
    ).run();

    db.prepare(
      `UPDATE mensagens
          SET direcao = CASE WHEN json_extract(bruto, '$.key.fromMe') = 1
                              THEN 'enviada' ELSE 'recebida' END
        WHERE fonte = 'whatsapp'
          AND direcao IS NULL
          AND json_valid(bruto)
          AND json_extract(bruto, '$.key.fromMe') IS NOT NULL`,
    ).run();
    // Mensagem de WhatsApp cujo bruto e invalido ou nao tem NENHUMA das duas
    // formas fica direcao NULL — visivel, contada pelo `acervo migrar`,
    // nunca adivinhada.
  },
};

export const PASSOS_DO_ACERVO: readonly PassoDeMigracao[] = [
  CRIA_CONTABILIDADE,
  CRIA_CORRESPONDENCIAS,
  ATOR_V13,
  CONVERSA_POR_CONFIGURACAO_V14,
  COLETIVA_POR_ENDERECO_V15,
  IDENTIDADE_POR_CONFIGURACAO_V16,
  AUTORIDADE_V17,
  MARCA_DO_TITULAR_V18,
  DIRECAO_WHATSAPP_V19,
];

export const PLANO_DO_ACERVO: PlanoDeMigracao = {
  nome: 'Acervo',
  piso: PISO_SCHEMA_ACERVO,
  corrente: VERSAO_SCHEMA_ACERVO,
  passos: PASSOS_DO_ACERVO,
  instrucaoAbaixoDoPiso:
    'Recrie o Acervo com `malote acervo recriar --inquilino <id> --confirmo` e ' +
    'reimporte o material, que continua sendo a fonte.',
};
