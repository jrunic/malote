import type { PassoDeMigracao, PlanoDeMigracao } from '../nucleo/migracao.js';
import { PISO_SCHEMA_REGISTRO, VERSAO_SCHEMA_REGISTRO } from './schema.js';

/**
 * DDL CONGELADO da forma 3 do Registro. Duplica de proposito o texto que o
 * schema fresco tem hoje: quando um passo futuro alterar esta tabela, este
 * aqui tem de continuar criando a forma de ENTAO. Mesma regra do Acervo, e
 * pela mesma razao.
 */
const CONTABILIDADE_V3 = `
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
 * A estreia do Registro, e a razao de ele entrar na maquina.
 *
 * Ate aqui o Registro subia sozinho ao abrir, e a subida consistia em
 * reexecutar o schema e carimbar o numero novo. Isso alcanca TABELA que falta
 * e nunca COLUNA que falta — um Registro de forma anterior seria marcado como
 * corrente sem a coluna, e o produto passaria a ler uma forma que ele nao tem.
 *
 * O custo disso ja tinha sido pago duas vezes, e esta no proprio schema: os
 * dados de conta de Adaptador e de intervalo esperado sao TABELAS separadas, e
 * nao colunas de `configuracoes_de_adaptador`, com o comentario dizendo que
 * coluna nova nao alcancaria instalacao existente. Era desenho de schema
 * distorcido pela ausencia desta maquina.
 */
const CRIA_CONTABILIDADE: PassoDeMigracao = {
  de: 2,
  para: 3,
  descricao: 'cria a contabilidade da maquina de migracao no Registro',
  tabelasNovas: ['migracoes_aplicadas'],
  aplicar: (db) => db.exec(CONTABILIDADE_V3),
};

/**
 * DDL CONGELADO da forma 4. Duplica o texto do schema fresco de proposito:
 * quando um passo futuro alterar esta tabela, este aqui tem de continuar
 * criando a forma de ENTAO. Mesma regra do resto da maquina.
 */
const CHAVES_DE_ACESSO_V4 = `
  CREATE TABLE chaves_de_acesso (
    id           TEXT PRIMARY KEY,
    inquilino_id TEXT NOT NULL REFERENCES inquilinos(id),
    sal          TEXT NOT NULL,
    hash         TEXT NOT NULL,
    criada_em    TEXT NOT NULL,
    revogada_em  TEXT
  );
  CREATE INDEX chaves_de_acesso_ativas
    ON chaves_de_acesso (revogada_em) WHERE revogada_em IS NULL;
`;

/**
 * A Chave de Acesso entra em instalacao que ja existe.
 *
 * E tabela nova, nao coluna: o passo nao precisa recriar tabela referenciada, e
 * a conferencia de contagens nao muda nada do que ja estava la.
 */
const CRIA_CHAVES_DE_ACESSO: PassoDeMigracao = {
  de: 3,
  para: 4,
  descricao: 'cria a Chave de Acesso',
  tabelasNovas: ['chaves_de_acesso'],
  aplicar: (db) => db.exec(CHAVES_DE_ACESSO_V4),
};

/**
 * O Ator entra na trilha do Registro. Mesma forma do passo do Acervo, e pela
 * mesma razao: a trilha existe nas duas bases, e Ator numa so responderia
 * "quem" para metade dos atos.
 */
const ATOR_V5: PassoDeMigracao = {
  de: 4,
  para: 5,
  descricao: 'acrescenta o Ator a trilha do Registro',
  aplicar: (db) => db.exec('ALTER TABLE operacoes ADD COLUMN ator TEXT;'),
};

/**
 * DDL CONGELADO da forma 6. Duplica o texto do schema fresco DE PROPOSITO:
 * quando um passo futuro alterar esta tabela, este aqui tem de continuar
 * criando a forma de ENTAO. Mesma regra do resto da maquina.
 */
const ENTRADAS_DE_ADAPTADOR_V6 = `
  CREATE TABLE entradas_de_adaptador (
    configuracao_id          TEXT PRIMARY KEY,
    pasta                    TEXT NOT NULL,
    natureza                 TEXT NOT NULL CHECK (natureza IN ('completo', 'parcial')),
    nome_do_titular_na_fonte TEXT,
    declarada_em             TEXT NOT NULL,
    FOREIGN KEY (configuracao_id) REFERENCES configuracoes_de_adaptador(id) ON DELETE CASCADE
  );
`;

/**
 * A Pasta de Entrada entra em instalacao que ja existe.
 *
 * E tabela nova, nao coluna: o passo nao recria tabela referenciada, e a
 * conferencia de contagens nao muda nada do que ja estava la. Nasce vazia, e
 * isso e o comportamento certo — instalacao que existia antes deste ciclo nao
 * vigia pasta nenhuma ate alguem declarar.
 */
const PASTA_DE_ENTRADA_V6: PassoDeMigracao = {
  de: 5,
  para: 6,
  descricao: 'acrescenta a Pasta de Entrada por Configuracao',
  tabelasNovas: ['entradas_de_adaptador'],
  aplicar: (db) => db.exec(ENTRADAS_DE_ADAPTADOR_V6),
};

/**
 * DDL CONGELADO da forma 7. Duplica o texto do schema fresco DE PROPOSITO.
 */
const CATALOGOS_PREFERIDOS_V7 = `
  CREATE TABLE catalogos_preferidos (
    inquilino_id    TEXT PRIMARY KEY,
    configuracao_id TEXT NOT NULL,
    definido_em     TEXT NOT NULL,
    FOREIGN KEY (inquilino_id) REFERENCES inquilinos(id) ON DELETE CASCADE,
    FOREIGN KEY (configuracao_id) REFERENCES configuracoes_de_adaptador(id) ON DELETE CASCADE
  );
`;

/**
 * A preferencia entre catalogos entra em instalacao que ja existe.
 *
 * Tabela nova, e nao coluna: o passo nao recria tabela referenciada, e nasce
 * vazia — instalacao que existia antes deste ciclo nao declarou preferencia
 * nenhuma, e ausencia significa "desempate por recencia", que e o
 * comportamento de sempre.
 */
const CATALOGO_PREFERIDO_V7: PassoDeMigracao = {
  de: 6,
  para: 7,
  descricao: 'acrescenta a preferencia entre catalogos de contatos',
  tabelasNovas: ['catalogos_preferidos'],
  aplicar: (db) => db.exec(CATALOGOS_PREFERIDOS_V7),
};

export const PASSOS_DO_REGISTRO: readonly PassoDeMigracao[] = [
  CRIA_CONTABILIDADE,
  CRIA_CHAVES_DE_ACESSO,
  ATOR_V5,
  PASTA_DE_ENTRADA_V6,
  CATALOGO_PREFERIDO_V7,
];

export const PLANO_DO_REGISTRO: PlanoDeMigracao = {
  nome: 'Registro',
  piso: PISO_SCHEMA_REGISTRO,
  corrente: VERSAO_SCHEMA_REGISTRO,
  passos: PASSOS_DO_REGISTRO,
  // NAO manda recriar: nao existe `registro recriar`, e a base guarda
  // Inquilino e Chave de Operador, que nada reconstroi.
  instrucaoAbaixoDoPiso:
    'Use uma versao do malote que alcance esta forma. Esta base nao pode ser recriada.',
};
