import type { Database } from 'better-sqlite3';

/**
 * Versao corrente do schema do Acervo.
 *
 * Sobe a cada mudanca de FORMA. Do PISO ate aqui, Acervo de forma anterior e
 * MIGRADO ao abrir para escrita, pelos passos de `passos-do-acervo.ts`. Abaixo
 * do piso a forma e de antes do lancamento: recusa, e a saida e recriar.
 * Politica completa das duas bases na ADR local
 * `20260901-politica-de-forma-por-base.md`.
 */
export const VERSAO_SCHEMA_ACERVO = 20;

/**
 * Forma mais antiga que a maquina de migracao alcanca.
 *
 * Nao ha passo escrito abaixo dela, e nao havera: Acervo de forma anterior a
 * esta e pre-lancamento, foi construido de material que continua sendo a
 * fonte, e recriar e mais barato que manter nove passos que ninguem consome.
 */
export const PISO_SCHEMA_ACERVO = 10;

/**
 * Schema do Acervo de UM Inquilino.
 *
 * Nenhum nome aqui nomeia ferramenta: não existe jid, lid, handle,
 * resource_name nem etag. O endereço na origem é `identificadores.valor`,
 * e o que a Fonte chamava a Conversa é `conversas.id_externo`.
 *
 * A identidade da Conversa e da Mensagem é do malote — `id` —, nunca a da
 * Fonte. O par (fonte, id_externo) é único dentro do Acervo, e é ele que
 * torna a importação idempotente sem o importador precisar lembrar de nada.
 */
/**
 * As guardas da estrela de mesclagem, exportadas em vez de embutidas.
 *
 * O teste de integridade precisa apaga-las e recria-las: as guardas sao
 * apertadas o bastante para que NAO exista corrupcao em banda, e ver o detector
 * funcionando exige corromper de proposito. Duplicar o SQL faria as duas copias
 * divergirem, e a que o teste recria e justamente a que precisa ser identica.
 *
 * `CHECK` nao serve aqui: o SQLite recusa subconsulta nele, e saber se a mestre
 * e raiz exige ler OUTRA linha. Gatilho faz.
 */
export const GUARDAS_DA_ESTRELA = `
  -- Guarda 1: a mestre indicada precisa ser raiz.
  CREATE TRIGGER IF NOT EXISTS mestre_e_raiz
    BEFORE UPDATE OF absorvida_por ON pessoas
    WHEN NEW.absorvida_por IS NOT NULL
     AND (SELECT p.absorvida_por FROM pessoas p WHERE p.id = NEW.absorvida_por) IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'a mestre indicada nao e raiz'); END;

  -- Guarda 2: quem ainda e mestre de outras nao pode ser absorvida.
  --
  -- Esta nao e obvia, e sem ela a guarda 1 PASSA no caso perigoso: ao absorver
  -- uma mestre, a escrita e na linha dela, e validar a mestre nova nada diz
  -- sobre quem a seguia. O resultado e seguidor apontando para quem deixou de
  -- ser raiz, sem erro e sem alarme.
  --
  -- A condicao OLD.absorvida_por IS NULL restringe a guarda a quem esta sendo
  -- absorvida AGORA: reapontar seguidor de uma mestre para outra continua
  -- permitido, e e o que a cascata da aplicacao faz.
  CREATE TRIGGER IF NOT EXISTS nao_absorve_quem_e_mestre
    BEFORE UPDATE OF absorvida_por ON pessoas
    WHEN NEW.absorvida_por IS NOT NULL
     AND OLD.absorvida_por IS NULL
     AND EXISTS (SELECT 1 FROM pessoas f WHERE f.absorvida_por = OLD.id)
    BEGIN SELECT RAISE(ABORT, 'esta Pessoa e mestre de outras; reaponte-as primeiro'); END;
`;

export function aplicarSchemaAcervo(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS versao_schema (
      versao INTEGER NOT NULL
    );

    -- A contabilidade da maquina de migracao. O modulo passos-do-acervo.ts
    -- forma CONGELADA desta mesma tabela — as duas sao iguais hoje e vao
    -- divergir quando um passo futuro alterar esta. A duplicacao e
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

    -- Correspondencia entre dois valores de endereco da MESMA Fonte que
    -- designam o mesmo destinatario.
    --
    -- Existe porque uma Fonte pode entregar o mesmo endereco em mais de uma
    -- forma, e o material exportado grava so uma delas. Sem a correspondencia,
    -- o que chega na forma nova nao encontra o que a importacao criou, e o
    -- produto cria uma segunda Conversa e uma segunda identidade para o mesmo
    -- ser humano. Medido em 02/09/2026: 53,7% dos enderecos vistos ao vivo ja
    -- existiam no acervo, na outra forma.
    --
    -- A coluna canonico guarda a forma que o MATERIAL EXPORTADO grava — a que
    -- o catalogo e as Pessoas ja usam. A coluna alternativo guarda a outra. A
    -- direcao importa: traduzir para a canonica e o que faz a convergencia
    -- acontecer.
    --
    -- Nenhum nome aqui nomeia ferramenta, e nao ha CHECK sobre a forma dos
    -- valores: o que e canonico e decisao do Adaptador da Fonte.
    CREATE TABLE IF NOT EXISTS correspondencias_de_endereco (
      fonte        TEXT NOT NULL,
      alternativo  TEXT NOT NULL,
      canonico     TEXT NOT NULL,
      aprendida_em TEXT NOT NULL,
      PRIMARY KEY (fonte, alternativo)
    );

    -- Identidade do Acervo: uma linha, sempre. É o que recusa abrir o arquivo
    -- de outro Inquilino quando a resolução de caminho falha.
    CREATE TABLE IF NOT EXISTS acervo (
      linha_unica  INTEGER PRIMARY KEY CHECK (linha_unica = 1),
      inquilino_id TEXT NOT NULL,
      criado_em    TEXT NOT NULL
    );

    -- absorvida_por e absorvida_em existem juntas ou nenhuma existe, pelo
    -- mesmo motivo de procedencia e vinculado_em: estado pela metade e o que
    -- produz linha que nenhuma leitura sabe interpretar.
    --
    -- A Pessoa absorvida NAO e apagada: e ela que registra que a mesclagem
    -- aconteceu, e e nela que o historico de nomes dela continua.
    CREATE TABLE IF NOT EXISTS pessoas (
      id            TEXT PRIMARY KEY,
      criada_em     TEXT NOT NULL,
      absorvida_por TEXT,
      absorvida_em  TEXT,
      CHECK (
        (absorvida_por IS NULL     AND absorvida_em IS NULL) OR
        (absorvida_por IS NOT NULL AND absorvida_em IS NOT NULL)
      ),
      CHECK (absorvida_por IS NULL OR absorvida_por <> id),
      FOREIGN KEY (absorvida_por) REFERENCES pessoas(id) ON DELETE SET NULL
    );

    -- O que foi desfeito, guardado na Pessoa que perdeu o Identificador.
    -- Guarda fonte e valor, e nao so o id: o Identificador pode ser
    -- desvinculado hoje e vinculado a outra Pessoa amanha, e sem o endereco
    -- o registro nao diz ao Titular o que ele desfez.
    --
    -- identificador_id NAO tem chave estrangeira de proposito: o registro
    -- precisa sobreviver ao Identificador, senao o que foi desfeito some
    -- junto com o que se desfez.
    CREATE TABLE IF NOT EXISTS desvinculos (
      id               TEXT PRIMARY KEY,
      pessoa_id        TEXT NOT NULL,
      identificador_id TEXT NOT NULL,
      fonte            TEXT NOT NULL,
      valor            TEXT NOT NULL,
      procedencia      TEXT NOT NULL,
      desvinculado_em  TEXT NOT NULL,
      FOREIGN KEY (pessoa_id) REFERENCES pessoas(id) ON DELETE CASCADE
    );

    -- O nome pendura em Identificador OU em Pessoa, exatamente um dos dois.
    --
    -- Por que as duas ancoras: o material afirma que um ENDERECO se chama X
    -- ("este numero e o Han"), nao que uma pessoa se chama X. Prender o nome
    -- so em Pessoa obrigaria a importacao a inventar Pessoa para nao perder o
    -- dado — e o modelo diz que resolver identidade nunca e pre-requisito de
    -- importacao. Com as duas ancoras, as duas frases ficam de pe.
    --
    -- Historico, nao linha unica: nome novo ACRESCENTA e o anterior fica.
    -- Nao ha coluna de precedencia: precedencia e configuracao do Inquilino,
    -- e e isso que faz troca-la mudar o nome exibido sem escrever no Acervo.
    -- origem continua sendo a FONTE, e a Configuracao e coluna separada.
    -- Gravar origem = 'contatos:um-catalogo' faria o lookup exato de
    -- melhorNome errar e o nome de catalogo cair para peso ZERO — abaixo do
    -- whatsapp, inclusive para as atribuicoes ja gravadas.
    CREATE TABLE IF NOT EXISTS atribuicoes_de_nome (
      id                 TEXT PRIMARY KEY,
      pessoa_id          TEXT,
      identificador_id   TEXT,
      origem             TEXT NOT NULL,
      configuracao_id    TEXT,
      -- Quem afirmou o nome: o dono da conta (titular) ou o dono do endereco
      -- (terceiro). NULL nas linhas anteriores ao ciclo 18, e essa ausencia e
      -- distinguivel dos dois valores de proposito — uma diz "nao havia campo",
      -- as outras dizem quem falou.
      --
      -- FORA da chave de unicidade. Com ela na chave, reimportar o material
      -- criaria uma linha titular NOVA ao lado da indeterminada que ja existe,
      -- e o historico mostraria o mesmo nome duas vezes em milhares de
      -- enderecos. Fora da chave, registrar de novo ATUALIZA a linha, e quem
      -- torna isso seguro e a subida monotona da porta.
      autoridade         TEXT
        CHECK (autoridade IS NULL OR autoridade IN ('titular', 'terceiro')),
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

    -- procedencia e vinculado_em acompanham pessoa_id: os tres existem juntos
    -- ou nenhum existe. A restricao e o que torna "vinculo sem procedencia"
    -- IMPOSSIVEL de gravar, em vez de proibido por convencao — inclusive para
    -- um Adaptador que escrevesse na tabela por engano.
    CREATE TABLE IF NOT EXISTS identificadores (
      id           TEXT PRIMARY KEY,
      fonte        TEXT NOT NULL,
      valor        TEXT NOT NULL,
      pessoa_id    TEXT,
      procedencia  TEXT,
      vinculado_em TEXT,
      -- Qual Configuracao de catalogo sustenta o vinculo. NULO quando a
      -- evidencia vem de mais de uma base: escolher a primeira em ordem
      -- estavel diria uma coisa que nao e verdade.
      configuracao_id TEXT,
      visto_em     TEXT NOT NULL,
      UNIQUE (fonte, valor),
      CHECK (procedencia IS NULL OR procedencia IN ('material', 'catalogo', 'humano')),
      CHECK (
        (pessoa_id IS NULL     AND procedencia IS NULL     AND vinculado_em IS NULL) OR
        (pessoa_id IS NOT NULL AND procedencia IS NOT NULL AND vinculado_em IS NOT NULL)
      ),
      FOREIGN KEY (pessoa_id) REFERENCES pessoas(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS conversas (
      id              TEXT PRIMARY KEY,
      fonte           TEXT NOT NULL,
      id_externo      TEXT NOT NULL,
      coletiva        INTEGER NOT NULL DEFAULT 0,
      -- A Configuracao de Adaptador sob a qual esta Conversa existe. Vive no
      -- REGISTRO, que e outro arquivo: nao ha chave estrangeira possivel, e a
      -- guarda de Fonte casada mora na porta de escrita.
      configuracao_id TEXT,
      criada_em       TEXT NOT NULL,
      -- O registro original da Fonte. Ver o comentario na tabela mensagens.
      bruto           TEXT,
      -- Obrigatoria na direta, PROIBIDA na coletiva. Mesmo criterio que o
      -- modelo ja aplica a Metadados de Coletiva, que nao existem em direta.
      CHECK ((coletiva = 1 AND configuracao_id IS NULL)
          OR (coletiva = 0 AND configuracao_id IS NOT NULL))
    );

    -- DOIS indices parciais, e nao uma chave unica de tres colunas: o SQLite
    -- trata NULL como distinto de NULL, entao uma UNIQUE sobre
    -- (fonte, id_externo, configuracao_id) deixaria passar DUAS COLETIVAS
    -- IDENTICAS em silencio — exatamente o defeito que a restricao existe para
    -- impedir. Um indice por natureza diz a regra em vez de contorna-la.
    --
    -- Sem crase neste comentario, de proposito: ele vive dentro de um template
    -- literal de TypeScript, e crase aqui FECHA A STRING. Custou uma quebra de
    -- compilacao em 08/09/2026.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversas_coletiva
      ON conversas (fonte, id_externo) WHERE coletiva = 1;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversas_direta
      ON conversas (fonte, id_externo, configuracao_id) WHERE coletiva = 0;

    -- Só existe para Conversa coletiva. Conversa direta não carrega campo nulo.
    CREATE TABLE IF NOT EXISTS metadados_de_coletiva (
      conversa_id   TEXT PRIMARY KEY,
      assunto       TEXT,
      descricao     TEXT,
      imagem        TEXT,
      alterado_por  TEXT,
      alterado_em   TEXT,
      FOREIGN KEY (conversa_id) REFERENCES conversas(id) ON DELETE CASCADE
    );

    -- comecou_em e terminou_em sao ANULAVEIS: material exportado nao traz
    -- data de entrada nem de saida, e o malote nao inventa data. observada_em
    -- e o que o malote de fato sabe. A chave NAO inclui comecou_em: o SQLite
    -- trata nulo como distinto de nulo em chave primaria, e reimportar
    -- duplicaria. ADR 20260826-participacao-sem-historico-em-material-exportado.
    CREATE TABLE IF NOT EXISTS participacoes (
      conversa_id      TEXT NOT NULL,
      identificador_id TEXT NOT NULL,
      comecou_em       TEXT,
      terminou_em      TEXT,
      observada_em     TEXT NOT NULL,
      -- O que a Fonte DECLAROU sobre a atividade deste membro, sem
      -- interpretacao. Nulo quando a Fonte nao declara nada — Conversa direta
      -- nao tem roster, e ali ninguem declara. NUNCA vira terminou_em: o
      -- campo e booleano e nao tem data, e preenche-lo exigiria inventar o
      -- instante, que e o que a ADR 20260826 proibe.
      ativa_na_fonte   INTEGER,
      -- O registro original da Fonte. Ver o comentario na tabela mensagens.
      bruto            TEXT,
      PRIMARY KEY (conversa_id, identificador_id),
      FOREIGN KEY (conversa_id) REFERENCES conversas(id) ON DELETE CASCADE,
      FOREIGN KEY (identificador_id) REFERENCES identificadores(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mensagens (
      id            TEXT PRIMARY KEY,
      conversa_id   TEXT NOT NULL,
      fonte         TEXT NOT NULL,
      id_externo    TEXT NOT NULL,
      autor_id      TEXT,
      conteudo      TEXT,
      ocorrida_em   INTEGER NOT NULL,
      citada_id     TEXT,
      -- Enviada pelo Titular ou recebida de outra Pessoa. NULL só é legítimo
      -- em Mensagem migrada de um Acervo anterior a esta coluna, cujo
      -- Conteudo Bruto nao permitiu calcular (ver passos 19 e 20 da
      -- migracao). Escrita NOVA sempre declara -- o parametro correspondente
      -- de registrarMensagem e obrigatorio.
      direcao       TEXT CHECK (direcao IS NULL OR direcao IN ('enviada', 'recebida')),
      bruto         TEXT,
      UNIQUE (fonte, id_externo),
      FOREIGN KEY (conversa_id) REFERENCES conversas(id) ON DELETE CASCADE,
      FOREIGN KEY (autor_id) REFERENCES identificadores(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS anexos (
      id            TEXT PRIMARY KEY,
      mensagem_id   TEXT NOT NULL,
      tipo          TEXT NOT NULL,
      tamanho       INTEGER,
      nome_original TEXT,
      duracao       INTEGER,
      impressao     TEXT,
      presenca      TEXT NOT NULL CHECK (presenca IN ('presente', 'nunca-obtido', 'descartado')),
      caminho       TEXT,
      descartado_em TEXT,
      descartado_por TEXT,
      -- O registro original da Fonte. Ver o comentario na tabela mensagens.
      -- No WhatsApp e a linha de ZWAMEDIAITEM, que carrega LATITUDE/LONGITUDE e
      -- vCard compartilhado: conteudo que o nucleo nao modela e que sem isto
      -- desaparece sem deixar rastro.
      bruto          TEXT,
      FOREIGN KEY (mensagem_id) REFERENCES mensagens(id) ON DELETE CASCADE
    );

    -- O ATO da mesclagem, imutavel e append-only.
    --
    -- A coluna absorvida_por de pessoas e a MESTRE: conclusao corrente,
    -- reescrita quando familias se juntam. Esta tabela e a outra metade — quem
    -- absorveu quem NAQUELE ato — e nunca e reescrita. E ela que torna desfazer
    -- uma reconstrucao exata em vez de um palpite.
    --
    -- Desfazer NAO apaga nem marca a linha original: acrescenta uma linha de
    -- tipo 'desfazer' apontando para ela. Ato ativo e o que nao tem desfazer
    -- apontando para si. Mesmo grao da tabela de desvinculos do ciclo 3.
    CREATE TABLE IF NOT EXISTS atos_de_mesclagem (
      id               TEXT PRIMARY KEY,
      tipo             TEXT NOT NULL CHECK (tipo IN ('mesclagem', 'desfazer')),
      absorvida_id     TEXT NOT NULL,
      absorvida_por_id TEXT NOT NULL,
      regra            TEXT,
      desfaz_id        TEXT,
      ocorrido_em      TEXT NOT NULL,
      CHECK (
        (tipo = 'mesclagem' AND regra IS NOT NULL AND desfaz_id IS NULL) OR
        (tipo = 'desfazer'  AND regra IS NULL     AND desfaz_id IS NOT NULL)
      ),
      FOREIGN KEY (absorvida_id) REFERENCES pessoas(id) ON DELETE CASCADE,
      FOREIGN KEY (absorvida_por_id) REFERENCES pessoas(id) ON DELETE CASCADE,
      FOREIGN KEY (desfaz_id) REFERENCES atos_de_mesclagem(id)
    );

    -- De qual cartao de catalogo veio cada endereco.
    --
    -- Existe porque sem ele o produtor por multiplos enderecos precisaria
    -- usar o NOME como laco, e isso funde homonimos: medido no catalogo real,
    -- 24 nomes em 51 cartoes, 57 telefones que seriam unidos indevidamente.
    -- Com o lote passando a mesclar, essas fusoes seriam aplicadas sozinhas.
    --
    -- Tabela nova, nunca coluna nova: CREATE TABLE IF NOT EXISTS acrescenta a
    -- instalacao existente, e ALTER de coluna nao acontece sozinho.
    --
    -- Append-only, com visto_em. Cartao que ganha um telefone tem identidade
    -- nova; a linha antiga fica e quem le usa a mais recente. Assim o
    -- adaptador continua nao removendo nada.
    -- De qual catalogo este endereco veio, quando foi visto pela ULTIMA vez, e
    -- se sumiu da origem.
    --
    -- configuracao_id entra na CHAVE: o mesmo endereco no mesmo cartao de
    -- duas bases sao duas evidencias, e colapsa-las perderia justamente a ponte
    -- que liga as duas bases.
    --
    -- ultimo_avistamento e coluna NOVA, e nao visto_em reaproveitado. A
    -- resolucao de nome desempata pelo mais recente dentro da mesma origem;
    -- transformar visto_em em "ultima vez visto" faria re-avistar um nome
    -- antigo traze-lo de volta ao topo — mudanca de comportamento observavel
    -- que ninguem pediu.
    --
    -- ausente_em nulo = presente. A Marca de Ausencia NAO remove: o Cartao
    -- continua legivel, o vinculo intacto, e reaparecer desfaz a marca.
    CREATE TABLE IF NOT EXISTS cartoes_de_catalogo (
      identificador_id   TEXT NOT NULL,
      cartao             TEXT NOT NULL,
      configuracao_id    TEXT NOT NULL,
      visto_em           TEXT NOT NULL,
      ultimo_avistamento TEXT NOT NULL,
      ausente_em         TEXT,
      PRIMARY KEY (identificador_id, cartao, configuracao_id),
      FOREIGN KEY (identificador_id) REFERENCES identificadores(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mensagens_conversa ON mensagens(conversa_id, ocorrida_em);
    CREATE INDEX IF NOT EXISTS idx_mensagens_autor    ON mensagens(autor_id);
    CREATE INDEX IF NOT EXISTS idx_mensagens_momento  ON mensagens(ocorrida_em);
    CREATE INDEX IF NOT EXISTS idx_identificadores_pessoa ON identificadores(pessoa_id);
    -- A unicidade NAO pode ser restricao de tabela: o SQLite trata nulo como
    -- distinto de nulo em UNIQUE, entao a restricao de tabela sobre
    -- (pessoa_id, origem, nome) com pessoa_id nulo aceitaria a mesma linha
    -- infinitas vezes — e a
    -- idempotencia de reimportacao morreria em silencio. Indice parcial e o
    -- que faz a regra valer de cada lado.
    -- QUATRO, e nao dois. O SQLite trata NULL como distinto de NULL em indice
    -- unico, entao acrescentar configuracao_id anulavel aos dois indices
    -- faria a linha de origem whatsapp — que nao tem Configuracao — aceitar
    -- duplicata infinita, e a idempotencia de reimportacao morreria EM
    -- SILENCIO. Precedente exato: os dois indices parciais do #825.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_nome_da_pessoa
      ON atribuicoes_de_nome(pessoa_id, origem, nome, configuracao_id)
      WHERE pessoa_id IS NOT NULL AND configuracao_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_nome_da_pessoa_sem_config
      ON atribuicoes_de_nome(pessoa_id, origem, nome)
      WHERE pessoa_id IS NOT NULL AND configuracao_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_nome_do_identificador
      ON atribuicoes_de_nome(identificador_id, origem, nome, configuracao_id)
      WHERE identificador_id IS NOT NULL AND configuracao_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_nome_do_identificador_sem_config
      ON atribuicoes_de_nome(identificador_id, origem, nome)
      WHERE identificador_id IS NOT NULL AND configuracao_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_atribuicoes_pessoa ON atribuicoes_de_nome(pessoa_id);
    CREATE INDEX IF NOT EXISTS idx_atribuicoes_identificador
      ON atribuicoes_de_nome(identificador_id);
    CREATE INDEX IF NOT EXISTS idx_desvinculos_pessoa ON desvinculos(pessoa_id);
    CREATE INDEX IF NOT EXISTS idx_pessoas_absorvida ON pessoas(absorvida_por);
    CREATE INDEX IF NOT EXISTS idx_atos_absorvida ON atos_de_mesclagem(absorvida_id);
    CREATE INDEX IF NOT EXISTS idx_atos_por       ON atos_de_mesclagem(absorvida_por_id);
    CREATE INDEX IF NOT EXISTS idx_atos_desfaz    ON atos_de_mesclagem(desfaz_id);
    CREATE INDEX IF NOT EXISTS idx_anexos_mensagem   ON anexos(mensagem_id);
    CREATE INDEX IF NOT EXISTS idx_anexos_presenca   ON anexos(presenca);

    -- Busca por texto. Conteúdo externo: o índice espelha mensagens.conteudo
    -- e é mantido por gatilho, sem duplicar o texto numa segunda fonte de verdade.
    CREATE VIRTUAL TABLE IF NOT EXISTS mensagens_texto USING fts5(
      conteudo,
      content = 'mensagens',
      content_rowid = 'rowid'
    );

    CREATE TRIGGER IF NOT EXISTS mensagens_texto_ins AFTER INSERT ON mensagens BEGIN
      INSERT INTO mensagens_texto(rowid, conteudo) VALUES (new.rowid, new.conteudo);
    END;

    CREATE TRIGGER IF NOT EXISTS mensagens_texto_del AFTER DELETE ON mensagens BEGIN
      INSERT INTO mensagens_texto(mensagens_texto, rowid, conteudo)
        VALUES ('delete', old.rowid, old.conteudo);
    END;

    -- Estado de Sincronizacao: qual Material ja entrou, por Configuracao.
    --
    -- Mora DENTRO do Acervo de proposito, e o criterio SOBREVIVE ao ciclo 14
    -- ainda que a razao antiga tenha caido: estado que sobrevivesse ao Acervo
    -- faria o produto afirmar "esse material ja entrou" contra um banco vazio.
    -- Vale sempre que alguem recriar, e recriar continua existindo — deixou de
    -- ser rotina, nao deixou de acontecer. Consistencia por construcao, e nao
    -- regra que alguem precisa lembrar.
    --
    -- configuracao_id NAO tem chave estrangeira: a Configuracao vive no
    -- Registro, que e outro arquivo de banco. Mesmo precedente do registro de
    -- desvinculo do ciclo 3.
    CREATE TABLE IF NOT EXISTS materiais (
      id                TEXT PRIMARY KEY,
      configuracao_id   TEXT NOT NULL,
      fonte             TEXT NOT NULL,
      impressao         TEXT NOT NULL,
      registrado_em     TEXT NOT NULL,
      conversas_criadas INTEGER NOT NULL,
      mensagens_criadas INTEGER NOT NULL,
      UNIQUE (configuracao_id, impressao)
    );

    -- A Operacao: a unidade da trilha e o ATO, nao a linha escrita.
    --
    -- Um comando que escreve duas linhas — desvincular, mesclar, desfazer —
    -- grava UMA Operacao com duas linhas de efeito. Quem abre e quem atende o
    -- comando; quem escreve a linha so relata.
    --
    -- Sem coluna de Inquilino de proposito: o Acervo e de um Inquilino so, e a
    -- coluna seria a afirmacao de que poderia nao ser. A trilha do Registro,
    -- que e da instalacao inteira, tem a coluna.
    CREATE TABLE IF NOT EXISTS operacoes (
      id              TEXT PRIMARY KEY,
      natureza        TEXT NOT NULL,
      reversibilidade TEXT NOT NULL
        CHECK (reversibilidade IN ('por-efeito', 'por-delegacao', 'irreversivel')),
      ocorrida_em     TEXT NOT NULL,
      desfaz_id       TEXT,
      -- Por ordem de QUEM. NULL nas linhas anteriores ao ciclo 11, e essa
      -- ausencia e distinguivel de indeterminado de proposito: uma diz "nao
      -- havia campo", a outra diz "o caminho de execucao nao declarou".
      ator            TEXT,
      FOREIGN KEY (desfaz_id) REFERENCES operacoes(id)
    );

    CREATE INDEX IF NOT EXISTS operacoes_por_instante
      ON operacoes (ocorrida_em DESC);

    -- "Operacao ja desfeita nao se desfaz duas vezes" e guarda de SCHEMA, nao
    -- de codigo: a checagem em TypeScript some quando alguem chama a porta por
    -- outro caminho, e o indice nao some.
    CREATE UNIQUE INDEX IF NOT EXISTS operacao_desfeita_uma_vez
      ON operacoes (desfaz_id) WHERE desfaz_id IS NOT NULL;

    -- A Linha de Efeito tem DUAS naturezas, exatamente uma por linha:
    --   'valor'      — diferenca: campo, antes, depois. Desfazer reconstroi.
    --   'referencia' — aponta para linha de trilha semantica que ja existe
    --                  (atos_de_mesclagem, materiais). Desfazer delega.
    -- A segunda nao e conveniencia: um lote mistura vinculos com centenas de
    -- mesclagens na MESMA Operacao, e um ponteiro unico nao as alcancaria.
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

    -- Transicao de Participacao: o evento que a FONTE declarou, nunca a
    -- diferenca entre dois retratos. A Participacao continua sendo o quadro
    -- de um instante; as duas coexistem e nenhuma deriva da outra.
    --
    -- A unicidade em (fonte, id_externo, identificador_id) da a idempotencia
    -- de graca: a mensagem administrativa que origina o evento tem
    -- identificador externo estavel, verificado distinto em 100% dos 16.402
    -- eventos dos dois backups em 30/08/2026. Reimportar o mesmo material
    -- reencontra a mesma linha em vez de criar outra.
    --
    -- A coluna codigo_da_fonte guarda o codigo BRUTO, mesmo classificado.
    -- Sem ele, uma reclassificacao futura nao teria como saber o que releu.
    CREATE TABLE IF NOT EXISTS transicoes_de_participacao (
      id               TEXT PRIMARY KEY,
      conversa_id      TEXT NOT NULL,
      identificador_id TEXT NOT NULL,
      natureza         TEXT NOT NULL CHECK (natureza IN ('entrou', 'saiu')),
      ocorrida_em      INTEGER NOT NULL,
      fonte            TEXT NOT NULL,
      id_externo       TEXT NOT NULL,
      codigo_da_fonte  TEXT NOT NULL,
      UNIQUE (fonte, id_externo, identificador_id),
      FOREIGN KEY (conversa_id) REFERENCES conversas(id) ON DELETE CASCADE,
      FOREIGN KEY (identificador_id) REFERENCES identificadores(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS transicao_por_conversa
      ON transicoes_de_participacao (conversa_id, ocorrida_em);

    CREATE INDEX IF NOT EXISTS linhas_por_operacao
      ON linhas_de_efeito (operacao_id, ordem);

    -- MARCA DO TITULAR: o que o dono da conta destacou.
    --
    -- Objeto de valor pendurado, nunca entidade com historico proprio: nenhuma
    -- Fonte medida entrega o evento de DESMARCACAO, entao guardar historico
    -- seria guardar metade dele. O modelo guarda o estado corrente.
    --
    -- DUAS tabelas, e nao uma com coluna de tipo de alvo: com uma so, a coluna
    -- do alvo apontaria ora para mensagens, ora para conversas, e nao haveria
    -- chave estrangeira possivel — apagar uma Conversa deixaria marca orfa.
    --
    -- POR QUE A COLUNA DE CONFIGURACAO NAO E REDUNDANTE, mesmo com a Conversa ja
    -- sabendo de qual Configuracao e: Conversa COLETIVA e compartilhada entre
    -- Configuracoes desde o ciclo 14 — direta separa, coletiva compartilha.
    -- Fixar uma coletiva numa conta nao afirma nada sobre a outra.
    --
    -- O CHECK com um unico valor por tabela e deliberado: a marca de arquivada esta
    -- fora do escopo do ciclo 18 — chega no mesmo Retrato, foi medida na chave
    -- e nao no valor, e nenhuma consulta a pede. A coluna existe para que
    -- entrar depois seja um passo de uma linha em vez de uma tabela nova.
    CREATE TABLE IF NOT EXISTS marcas_de_conversa (
      conversa_id     TEXT NOT NULL,
      marca           TEXT NOT NULL CHECK (marca IN ('fixada')),
      configuracao_id TEXT NOT NULL,
      observada_em    INTEGER NOT NULL,
      PRIMARY KEY (conversa_id, marca, configuracao_id),
      FOREIGN KEY (conversa_id) REFERENCES conversas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS marcas_de_mensagem (
      mensagem_id     TEXT NOT NULL,
      marca           TEXT NOT NULL CHECK (marca IN ('favorito')),
      configuracao_id TEXT NOT NULL,
      observada_em    INTEGER NOT NULL,
      PRIMARY KEY (mensagem_id, marca, configuracao_id),
      FOREIGN KEY (mensagem_id) REFERENCES mensagens(id) ON DELETE CASCADE
    );

  `);

  // As guardas entram por ultimo e a partir da constante exportada: e o mesmo
  // SQL que o teste de integridade recria depois de corromper de proposito.
  db.exec(GUARDAS_DA_ESTRELA);
}
