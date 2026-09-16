import type { Database } from 'better-sqlite3';

/**
 * Versao corrente do schema do Registro.
 *
 * Do PISO ate aqui, forma anterior e MIGRADA por passos ao abrir para escrita,
 * pela MESMA maquina do Acervo. Forma posterior recusa.
 *
 * Ate o ciclo 14 a regra daqui era outra, e vale registrar por que ela caiu: a
 * subida reexecutava o schema e carimbava o numero novo. Isso alcanca TABELA
 * que falta, porque CREATE TABLE IF NOT EXISTS a cria, e nunca alcanca COLUNA
 * que falta, porque nada ali altera tabela existente — um Registro de forma
 * anterior seria marcado como corrente SEM a coluna. O custo ja tinha sido
 * pago duas vezes neste arquivo: as tabelas de conta de Adaptador e de
 * intervalo esperado sao tabelas, e nao colunas de
 * `configuracoes_de_adaptador`, exatamente por isso.
 *
 * A assimetria que sobra em relacao ao Acervo e uma so: o Registro nao tem
 * comando de recriar, porque guarda Inquilino e Chave de Operador, que nada
 * reconstroi — o Acervo tem o material exportado como fonte. Tabela completa
 * da politica na ADR local `20260901-politica-de-forma-por-base.md`.
 */
export const VERSAO_SCHEMA_REGISTRO = 7;

/**
 * Forma mais antiga do Registro que a maquina de migracao alcanca.
 *
 * E 2, e nao 1, por um motivo factual: antes da v2 esta constante nao era
 * movida a cada mudanca — os ciclos 3, 4, 5 e 7 acrescentaram tabelas sem
 * toca-la. Um Registro marcado com 1 no mundo pode ter qualquer subconjunto
 * dessas tabelas, entao 1 nao identifica uma forma, e nao ha passo possivel
 * para um alvo indeterminado.
 */
export const PISO_SCHEMA_REGISTRO = 2;

/**
 * O Registro descreve a INSTALAÇÃO: quais Inquilinos existem, quem é o Titular
 * de cada um, onde a mídia deles mora, quais Adaptadores estão configurados e
 * quais Chaves de Operador administram tudo isso.
 *
 * Não guarda conteúdo de conversa. Conteúdo mora no Acervo de cada Inquilino,
 * que é outro arquivo de banco — o isolamento é físico, não uma cláusula WHERE.
 */
export function aplicarSchemaRegistro(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS versao_schema (
      versao INTEGER NOT NULL
    );

    -- A contabilidade da maquina de migracao. O modulo passos-do-registro.ts
    -- guarda a forma CONGELADA desta mesma tabela — as duas sao iguais hoje e
    -- vao divergir quando um passo futuro alterar esta. A duplicacao e
    -- deliberada, e o teste de equivalencia e quem a mantem honesta.
    CREATE TABLE IF NOT EXISTS migracoes_aplicadas (
      de             INTEGER NOT NULL,
      para           INTEGER NOT NULL,
      descricao      TEXT NOT NULL,
      aplicada_em    TEXT NOT NULL,
      conferencia    TEXT NOT NULL,
      midia_pendente TEXT,
      PRIMARY KEY (de, para)
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

    -- Qual Configuracao de catalogo prevalece no desempate, POR INQUILINO.
    --
    -- Tabela, e nao linha-sentinela em precedencias_de_nome: o valor e um
    -- APELIDO, nao um peso, e enfia-lo na coluna de peso e o tipo de atalho que
    -- o leitor seguinte nao tem como adivinhar.
    --
    -- Vive no Registro, e nao no Acervo, pela mesma razao da precedencia por
    -- origem: e o que faz troca-la mudar o nome exibido sem escrever uma linha
    -- de conteudo.
    CREATE TABLE IF NOT EXISTS catalogos_preferidos (
      inquilino_id    TEXT PRIMARY KEY,
      configuracao_id TEXT NOT NULL,
      definido_em     TEXT NOT NULL,
      FOREIGN KEY (inquilino_id) REFERENCES inquilinos(id) ON DELETE CASCADE,
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

    -- Onde uma Configuracao espera encontrar material novo, e como le-lo.
    --
    -- Satelite por Configuracao, na mesma forma de intervalos_esperados: quem
    -- nao declarou nao tem linha, e ausencia significa "esta Configuracao nao e
    -- vigiada" — nunca "vigiada com padrao". Exigir a declaracao faria toda
    -- Configuracao nascer sendo varrida numa pasta que ninguem escolheu.
    --
    -- A natureza decide se ausencia significa alguma coisa: em material
    -- completo o que nao veio sumiu na origem; em parcial, apenas nao mudou.
    -- Ler ausencia como remocao num material parcial marcaria dado bom como
    -- sumido, em silencio.
    --
    -- O nome do titular na fonte so existe onde a Fonte exige — o Instagram
    -- precisa dele para achar quem e "eu" na Conversa direta. Fica aqui, e nao
    -- na invocacao, porque quem varre sozinho nao tem como sabe-lo.
    --
    -- Ao contrario das tabelas acima, esta entrou COM PASSO DE MIGRACAO. Os
    -- comentarios delas dizendo que tabela nova alcanca instalacao existente
    -- descrevem o comportamento PRE-CICLO-14: hoje o schema fresco so roda em
    -- base nova, e base existente sobe pelos passos.
    CREATE TABLE IF NOT EXISTS entradas_de_adaptador (
      configuracao_id          TEXT PRIMARY KEY,
      pasta                    TEXT NOT NULL,
      natureza                 TEXT NOT NULL CHECK (natureza IN ('completo', 'parcial')),
      nome_do_titular_na_fonte TEXT,
      declarada_em             TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS chaves_de_acesso (
      id           TEXT PRIMARY KEY,
      inquilino_id TEXT NOT NULL REFERENCES inquilinos(id),
      sal          TEXT NOT NULL,
      hash         TEXT NOT NULL,
      criada_em    TEXT NOT NULL,
      revogada_em  TEXT
    );

    -- O indice existe para o caminho quente da autenticacao: a verificacao
    -- varre as ATIVAS a cada requisicao, porque nao ha cache de credencial em
    -- memoria. Sem ele, cada requisicao le a tabela inteira, incluindo as
    -- revogadas, que so crescem.
    CREATE INDEX IF NOT EXISTS chaves_de_acesso_ativas
      ON chaves_de_acesso (revogada_em) WHERE revogada_em IS NULL;

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
      -- Por ordem de QUEM. NULL nas linhas anteriores ao ciclo 11, e essa
      -- ausencia e distinguivel de indeterminado de proposito: uma diz "nao
      -- havia campo", a outra diz "o caminho de execucao nao declarou".
      ator            TEXT,
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
      ON tentativas_de_chave(ocorrida_em);
  `);
}
