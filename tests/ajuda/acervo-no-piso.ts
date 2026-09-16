import Database from 'better-sqlite3';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * FOTOGRAFIA CONGELADA da forma 10 do Acervo — o piso da migracao.
 *
 * Extraida de `git show 37e83ca:src/nucleo/schema-acervo.ts`, o commit de
 * linha de base do ciclo 14, e o MESMO de que sai a instalacao genuina usada
 * no aceite.
 *
 * Por que ela existe, e o que a falta dela custou: a primeira versao deste
 * arquivo fabricava a base "antiga" a partir do schema CORRENTE, removendo so
 * a tabela que o passo cria. Isso contamina os DOIS lados da comparacao —
 * qualquer tabela acrescentada ao schema fresco sem passo aparece tanto na
 * base "antiga" quanto na criada do zero, e a equivalencia passa. Medido em
 * 01/09/2026: o mutante que acrescenta tabela so ao schema fresco NAO derrubou
 * o teste. Era o mesmo pecado que o ciclo existe para impedir — compartilhar
 * com o schema fresco — cometido dentro da fixture.
 *
 * Regra que sai daí: a fotografia do piso vive AQUI, extraida do commit de
 * linha de base, e nunca e derivada do schema corrente. Quando o piso subir um
 * dia, esta fixture se regenera no piso novo, do commit correspondente.
 */
const SCHEMA_V10 = `
    CREATE TABLE IF NOT EXISTS versao_schema (
      versao INTEGER NOT NULL
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
    CREATE TABLE IF NOT EXISTS atribuicoes_de_nome (
      id               TEXT PRIMARY KEY,
      pessoa_id        TEXT,
      identificador_id TEXT,
      origem           TEXT NOT NULL,
      nome             TEXT NOT NULL,
      atribuido_em     TEXT NOT NULL,
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
      id          TEXT PRIMARY KEY,
      fonte       TEXT NOT NULL,
      id_externo  TEXT NOT NULL,
      coletiva    INTEGER NOT NULL DEFAULT 0,
      criada_em   TEXT NOT NULL,
      -- O registro original da Fonte. Ver o comentario na tabela mensagens.
      bruto       TEXT,
      UNIQUE (fonte, id_externo)
    );

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
    CREATE TABLE IF NOT EXISTS cartoes_de_catalogo (
      identificador_id TEXT NOT NULL,
      cartao           TEXT NOT NULL,
      visto_em         TEXT NOT NULL,
      PRIMARY KEY (identificador_id, cartao),
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_nome_da_pessoa
      ON atribuicoes_de_nome(pessoa_id, origem, nome) WHERE pessoa_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_nome_do_identificador
      ON atribuicoes_de_nome(identificador_id, origem, nome) WHERE identificador_id IS NOT NULL;
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
    -- Mora DENTRO do Acervo de proposito. Enquanto o versionamento for por
    -- fase, recriar Acervo e rotina; estado que sobrevivesse a ele faria o
    -- produto afirmar "esse material ja entrou" contra um banco vazio.
    -- Consistencia por construcao, e nao regra que alguem precisa lembrar.
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
`;

const GUARDAS_V10 = `
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
    BEGIN SELECT RAISE(ABORT, 'esta Pessoa e mestre de outras; reaponte-as primeiro'); END;`;

/**
 * Cria um Acervo GENUINAMENTE na forma 10, do DDL congelado.
 *
 * Apaga o arquivo existente antes — base, `-wal` e `-shm`, como o proprio
 * `recriar.ts` faz —, porque escrever o DDL antigo por cima de um banco
 * corrente deixaria as tabelas dos dois.
 */
export function criarAcervoNoPiso(raiz: string, inquilinoId: string): void {
  const pasta = join(raiz, 'acervos');
  mkdirSync(pasta, { recursive: true });
  const caminho = join(pasta, `${inquilinoId}.db`);
  for (const sufixo of ['', '-wal', '-shm']) {
    rmSync(`${caminho}${sufixo}`, { force: true });
  }

  const db = new Database(caminho);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA_V10);
    db.exec(GUARDAS_V10);
    db.prepare('INSERT INTO versao_schema (versao) VALUES (10)').run();
    db.prepare(
      'INSERT INTO acervo (linha_unica, inquilino_id, criado_em) VALUES (1, ?, ?)',
    ).run(inquilinoId, new Date().toISOString());
  } finally {
    db.close();
  }
}
