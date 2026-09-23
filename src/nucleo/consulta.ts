import type { Acervo } from './acervo.js';
import type { PrecedenciaDeNome } from '../registro/precedencia-de-nome.js';
import { SQL_FAMILIA } from './familia.js';
import type { ConversaId, Direcao, Fonte, MensagemId, PessoaId, Presenca } from './tipos.js';
import { nomeDoIdentificador } from './identidade.js';

/**
 * Leitura do Acervo. Nenhum caminho daqui escreve.
 *
 * Toda consulta é de UM Acervo, que é de UM Inquilino — não existe assinatura
 * que aceite dois, e é por isso que "não atravessa Inquilino" não é disciplina
 * a lembrar: é o que o tipo permite escrever.
 */

export interface AnexoLido {
  id: string;
  tipo: string;
  tamanho: number | null;
  nomeOriginal: string | null;
  duracao: number | null;
  impressao: string | null;
  presenca: Presenca;
  caminho: string | null;
  descartadoEm: string | null;
  descartadoPor: string | null;
}

export function lerAnexos(acervo: Acervo, mensagemId: MensagemId): AnexoLido[] {
  const linhas = acervo.preparar(
      `SELECT id, tipo, tamanho, nome_original, duracao, impressao, presenca, caminho,
              descartado_em, descartado_por
         FROM anexos WHERE mensagem_id = ? ORDER BY id`,
    )
    .all(mensagemId) as Array<Record<string, unknown>>;

  return linhas.map((l) => ({
    id: l['id'] as string,
    tipo: l['tipo'] as string,
    tamanho: (l['tamanho'] as number | null) ?? null,
    nomeOriginal: (l['nome_original'] as string | null) ?? null,
    duracao: (l['duracao'] as number | null) ?? null,
    impressao: (l['impressao'] as string | null) ?? null,
    presenca: l['presenca'] as Presenca,
    caminho: (l['caminho'] as string | null) ?? null,
    descartadoEm: (l['descartado_em'] as string | null) ?? null,
    descartadoPor: (l['descartado_por'] as string | null) ?? null,
  }));
}

/** Um Anexo pelo próprio id, ou `undefined` se não existe. */
export function lerAnexoPorId(acervo: Acervo, anexoId: string): AnexoLido | undefined {
  const linha = acervo.preparar(
      `SELECT id, tipo, tamanho, nome_original, duracao, impressao, presenca, caminho,
              descartado_em, descartado_por
         FROM anexos WHERE id = ?`,
    )
    .get(anexoId) as Record<string, unknown> | undefined;
  if (linha === undefined) return undefined;
  return {
    id: linha['id'] as string,
    tipo: linha['tipo'] as string,
    tamanho: (linha['tamanho'] as number | null) ?? null,
    nomeOriginal: (linha['nome_original'] as string | null) ?? null,
    duracao: (linha['duracao'] as number | null) ?? null,
    impressao: (linha['impressao'] as string | null) ?? null,
    presenca: linha['presenca'] as Presenca,
    caminho: (linha['caminho'] as string | null) ?? null,
    descartadoEm: (linha['descartado_em'] as string | null) ?? null,
    descartadoPor: (linha['descartado_por'] as string | null) ?? null,
  };
}

export interface ParticipacaoLida {
  identificadorId: string;
  comecouEm: string | null;
  terminouEm: string | null;
  observadaEm: string;
}

export function lerParticipacoes(acervo: Acervo, conversaId: ConversaId): ParticipacaoLida[] {
  const linhas = acervo.preparar(
      `SELECT identificador_id, comecou_em, terminou_em, observada_em
         FROM participacoes WHERE conversa_id = ? ORDER BY identificador_id`,
    )
    .all(conversaId) as Array<Record<string, unknown>>;

  return linhas.map((l) => ({
    identificadorId: l['identificador_id'] as string,
    comecouEm: (l['comecou_em'] as string | null) ?? null,
    terminouEm: (l['terminou_em'] as string | null) ?? null,
    observadaEm: l['observada_em'] as string,
  }));
}

export interface ConversaListada {
  id: ConversaId;
  fonte: Fonte;
  coletiva: boolean;
  assunto: string | null;
  mensagens: number;
  /** Null para Conversa coletiva — ela pertence ao Inquilino, nao a uma Configuracao. */
  configuracaoId: string | null;
}

export interface FiltroDeConversa {
  fonte?: Fonte;
  coletiva?: boolean;
  pessoaId?: PessoaId;
  /** Assunto contém o termo, case-insensitive, LITERAL — `%` e `_` escapados. */
  busca?: string;
  /**
   * So Conversa DIRETA tem Configuracao (`c.configuracao_id`). Coletiva nunca
   * casa — o campo e NULL para ela, e NULL nunca satisfaz `= ?`. Nao e defeito:
   * e o mesmo desenho que os dois indices parciais de #825 ja impoem.
   */
  configuracaoId?: string;
  limite?: number;
}

export function listarConversas(acervo: Acervo, filtro: FiltroDeConversa): ConversaListada[] {
  const condicoes: string[] = [];
  const valores: unknown[] = [];
  if (filtro.fonte !== undefined) {
    condicoes.push('c.fonte = ?');
    valores.push(filtro.fonte);
  }
  if (filtro.coletiva !== undefined) {
    condicoes.push('c.coletiva = ?');
    valores.push(filtro.coletiva ? 1 : 0);
  }
  if (filtro.pessoaId !== undefined) {
    // Pela PARTICIPACAO, e nao pelo autor: a Conversa e dela por ela estar
    // la, mesmo sem ter falado. Alcanca todos os Identificadores da Pessoa.
    condicoes.push(
      `c.id IN (SELECT p.conversa_id FROM participacoes p
                 WHERE p.identificador_id IN
                   (SELECT id FROM identificadores WHERE pessoa_id IN (${SQL_FAMILIA})))`,
    );
    valores.push(filtro.pessoaId, filtro.pessoaId);
  }
  if (filtro.busca !== undefined) {
    // Termo do usuario e LITERAL: % e _ sao escapados, senao "100%" casa
    // qualquer coisa. LOWER para case-insensitive por ser ASCII-safe.
    condicoes.push(
      "LOWER(m.assunto) LIKE LOWER(?) ESCAPE '\\'",
    );
    valores.push(
      filtro.busca.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
        .replace(/^/, '%') + '%',
    );
  }
  if (filtro.configuracaoId !== undefined) {
    condicoes.push('c.configuracao_id = ?');
    valores.push(filtro.configuracaoId);
  }
  const onde = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';
  const limite = filtro.limite !== undefined ? ` LIMIT ${Number(filtro.limite)}` : '';

  const linhas = acervo.preparar(
      `SELECT c.id, c.fonte, c.coletiva, c.configuracao_id, m.assunto,
              (SELECT COUNT(*) FROM mensagens x WHERE x.conversa_id = c.id) AS mensagens
         FROM conversas c
         LEFT JOIN metadados_de_coletiva m ON m.conversa_id = c.id
         ${onde}
         ORDER BY c.criada_em${limite}`,
    )
    .all(...valores) as Array<Record<string, unknown>>;

  return linhas.map((l) => ({
    id: l['id'] as string,
    fonte: l['fonte'] as Fonte,
    coletiva: (l['coletiva'] as number) === 1,
    assunto: (l['assunto'] as string | null) ?? null,
    mensagens: l['mensagens'] as number,
    configuracaoId: (l['configuracao_id'] as string | null) ?? null,
  }));
}

export interface MensagemLida {
  id: string;
  conversaId: ConversaId;
  fonte: Fonte;
  autorId: string | null;
  conteudo: string | null;
  ocorridaEm: number;
  /** Enviada pelo Titular ou recebida de outra Pessoa. NULL em Mensagem migrada sem discriminante. */
  direcao: Direcao | null;
  anexos: AnexoLido[];
}

export interface FiltroDeMensagem {
  conversaId?: ConversaId;
  pessoaId?: PessoaId;
  fonte?: Fonte;
  de?: number;
  ate?: number;
  /**
   * So as favoritadas pelo Titular — a Marca do Titular.
   *
   * `false` e `undefined` significam SEM FILTRO, nunca "so as nao
   * favoritas". Quem quiser o complemento pede uma consulta que ainda nao
   * existe, em vez de ganha-la por acidente de um booleano frouxo.
   *
    * Marca vale por Configuracao. Pedir favorito sem Configuracao recusa.
    */
  favorito?: boolean;
  configuracaoId?: string;
  /** Enviada pelo Titular ou recebida de outra Pessoa. */
  direcao?: Direcao;
  /** Quantidade maxima de Mensagens devolvidas. */
  limite?: number;
  /** 'cronologica' (default) ou 'recentes' — sempre por (ocorrida_em, id). */
  ordem?: 'cronologica' | 'recentes';
  /** Paginacao: token composto (ocorrida_em, id) EXCLUSIVO — sem pular nem repetir. */
  cursor?: { ocorridaEm: number; id: string };
}

function montarMensagens(acervo: Acervo, linhas: Array<Record<string, unknown>>): MensagemLida[] {
  return linhas.map((l) => {
    const id = l['id'] as string;
    return {
      id,
      conversaId: l['conversa_id'] as string,
      fonte: l['fonte'] as Fonte,
      autorId: (l['autor_id'] as string | null) ?? null,
      conteudo: (l['conteudo'] as string | null) ?? null,
      direcao: (l['direcao'] as Direcao | null) ?? null,
      ocorridaEm: l['ocorrida_em'] as number,
      anexos: lerAnexos(acervo, id),
    };
  });
}

/**
 * `AAAA-MM-DD` expande para inicio/fim do dia em UTC — o mesmo valor em
 * qualquer maquina cliente (revisao do ciclo 21). Instante completo `...Z`
 * passa cru. `--desde`/`--ate` sao inclusivos: inicio e fim, respectivamente.
 */
export function expandirData(
  valor: string,
  borda: 'inicio' | 'fim',
): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const base = Date.parse(`${valor}T00:00:00Z`);
    if (Number.isNaN(base)) throw new Error(`data invalida: ${valor}`);
    return borda === 'inicio' ? base : base + 86_399_999;
  }
  const instante = Date.parse(valor);
  if (Number.isNaN(instante)) throw new Error(`instante invalido: ${valor}`);
  return instante;
}

export function lerMensagens(acervo: Acervo, filtro: FiltroDeMensagem): MensagemLida[] {
  const condicoes: string[] = [];
  const valores: unknown[] = [];
  const limites: string[] = [];

  if (filtro.conversaId !== undefined) {
    condicoes.push('m.conversa_id = ?');
    valores.push(filtro.conversaId);
  }
  if (filtro.pessoaId !== undefined) {
    // Alcança TODOS os Identificadores da Pessoa, em todas as Fontes.
    condicoes.push(
      `m.autor_id IN (SELECT id FROM identificadores WHERE pessoa_id IN (${SQL_FAMILIA}))`,
    );
    valores.push(filtro.pessoaId, filtro.pessoaId);
  }
  if (filtro.fonte !== undefined) {
    condicoes.push('m.fonte = ?');
    valores.push(filtro.fonte);
  }
  if (filtro.de !== undefined) {
    condicoes.push('m.ocorrida_em >= ?');
    valores.push(filtro.de);
  }
  if (filtro.ate !== undefined) {
    condicoes.push('m.ocorrida_em <= ?');
    valores.push(filtro.ate);
  }
  if (filtro.direcao !== undefined) {
    condicoes.push('m.direcao = ?');
    valores.push(filtro.direcao);
  }
  // Cursor COMPOSTO e EXCLUSIVO: o instante sozinho nao pagina — duas
  // Mensagens podem ter o mesmo instante, e o limite caindo no meio desse
  // conjunto pularia ou repetiria (revisao do ciclo 21).
  if (filtro.cursor !== undefined) {
    if (filtro.ordem === 'recentes') {
      condicoes.push('(m.ocorrida_em < ? OR (m.ocorrida_em = ? AND m.id < ?))');
    } else {
      condicoes.push('(m.ocorrida_em > ? OR (m.ocorrida_em = ? AND m.id > ?))');
    }
    valores.push(filtro.cursor.ocorridaEm, filtro.cursor.ocorridaEm, filtro.cursor.id);
  }
  if (filtro.limite !== undefined) {
    limites.push(` LIMIT ${Number(filtro.limite)}`);
  }
  // `=== true` por explicitude, e NAO porque um teste separe as duas formas: o
  // campo e `boolean | undefined`, entao `if (filtro.favorito)` se comporta
  // igual em todo input possivel. O mutante que trocou uma pela outra
  // sobreviveu por EQUIVALENCIA — esta escrito aqui para ninguem gastar um
  // teste tentando mata-lo. O que muda isso e o campo passar a aceitar outro
  // tipo; ai as duas formas divergem e a guarda passa a caber.
  if (filtro.favorito === true) {
    if (filtro.configuracaoId === undefined) {
      throw new Error('favorito exige configuracao');
    }
    condicoes.push(
      `EXISTS (SELECT 1 FROM marcas_de_mensagem mm
                WHERE mm.mensagem_id = m.id AND mm.marca = 'favorito'
                  AND mm.configuracao_id = ?)`,
    );
    valores.push(filtro.configuracaoId);
  }

  const onde = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';
  const ordem = filtro.ordem === 'recentes' ? 'DESC' : 'ASC';
  const linhas = acervo.preparar(
      `SELECT m.id, m.conversa_id, m.fonte, m.autor_id, m.conteudo, m.direcao, m.ocorrida_em
         FROM mensagens m ${onde} ORDER BY m.ocorrida_em ${ordem}, m.id ${ordem}${limites.join('')}`,
    )
    .all(...valores) as Array<Record<string, unknown>>;

  return montarMensagens(acervo, linhas);
}

export interface FiltroDeBusca {
  texto: string;
  limite?: number;
  pessoaId?: PessoaId;
  /** Restringe a busca a uma Conversa. */
  conversaId?: ConversaId;
  /** Instantes, na mesma semântica de `--desde`/`--ate` (inclusivos). */
  de?: number;
  ate?: number;
}

export function buscarMensagens(acervo: Acervo, filtro: FiltroDeBusca): MensagemLida[] {
  const condicoes = ['mensagens_texto MATCH ?'];
  const valores: unknown[] = [filtro.texto];
  if (filtro.pessoaId !== undefined) {
    // Alcança TODOS os Identificadores da Pessoa, em todas as Fontes.
    condicoes.push(
      `m.autor_id IN (SELECT id FROM identificadores WHERE pessoa_id IN (${SQL_FAMILIA}))`,
    );
    valores.push(filtro.pessoaId, filtro.pessoaId);
  }
  if (filtro.conversaId !== undefined) {
    condicoes.push('m.conversa_id = ?');
    valores.push(filtro.conversaId);
  }
  if (filtro.de !== undefined) {
    condicoes.push('m.ocorrida_em >= ?');
    valores.push(filtro.de);
  }
  if (filtro.ate !== undefined) {
    condicoes.push('m.ocorrida_em <= ?');
    valores.push(filtro.ate);
  }

  const linhas = acervo.preparar(
      `SELECT m.id, m.conversa_id, m.fonte, m.autor_id, m.conteudo, m.direcao, m.ocorrida_em
         FROM mensagens_texto t
         JOIN mensagens m ON m.rowid = t.rowid
        WHERE ${condicoes.join(' AND ')}
        ORDER BY m.ocorrida_em
        LIMIT ?`,
    )
    .all(...valores, filtro.limite ?? 100) as Array<Record<string, unknown>>;

  return montarMensagens(acervo, linhas);
}

export interface ContagemDoAcervo {
  conversas: number;
  mensagens: number;
  pessoas: number;
  identificadores: number;
  anexos: number;
}

export function contarAcervo(acervo: Acervo): ContagemDoAcervo {
  const um = (tabela: string): number => {
    const l = acervo.preparar(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number };
    return l.n;
  };
  return {
    conversas: um('conversas'),
    mensagens: um('mensagens'),
    pessoas: um('pessoas'),
    identificadores: um('identificadores'),
    anexos: um('anexos'),
  };
}

export interface EnderecoSemPessoa {
  identificadorId: string;
  fonte: Fonte;
  valor: string;
  /** O que o material chamou este endereco. Nulo quando a Fonte nao deu nome. */
  nome: string | null;
  conversas: number;
  /** Quantas Mensagens o vinculo passa a cobrir. E o que ordena a lista. */
  mensagens: number;
}

export interface FiltroSemEndereco {
  limite?: number;
}

/**
 * Os enderecos que ainda nao tem Pessoa, do que mais cobre para o que menos.
 *
 * A linha e o ENDERECO, e nao a Conversa, porque e o endereco que se liga: o
 * mesmo numero pode aparecer em varias Conversas, e ligar uma vez cobre todas
 * — por isso `mensagens` soma as Conversas em que ele participa.
 *
 * O endereco do proprio Titular aparece aqui, e costuma vir primeiro: ele
 * participa de tudo. Ligar o Titular a uma Pessoa uma unica vez o tira da
 * lista, e e uma primeira acao legitima.
 */
export function listarSemEndereco(
  acervo: Acervo,
  precedencia: PrecedenciaDeNome,
  filtro: FiltroSemEndereco,
): EnderecoSemPessoa[] {
  const linhas = acervo.preparar(
      `SELECT i.id, i.fonte, i.valor,
              (SELECT COUNT(*) FROM participacoes p WHERE p.identificador_id = i.id)
                AS conversas,
              (SELECT COUNT(*) FROM mensagens m
                WHERE m.conversa_id IN
                  (SELECT p2.conversa_id FROM participacoes p2 WHERE p2.identificador_id = i.id))
                AS mensagens
         FROM identificadores i
        WHERE i.pessoa_id IS NULL
        ORDER BY mensagens DESC, i.valor
        ${filtro.limite === undefined ? '' : 'LIMIT ?'}`,
    )
    .all(...(filtro.limite === undefined ? [] : [filtro.limite])) as Array<{
    id: string;
    fonte: Fonte;
    valor: string;
    conversas: number;
    mensagens: number;
  }>;

  return linhas.map((l) => ({
    identificadorId: l.id,
    fonte: l.fonte,
    valor: l.valor,
    nome: nomeDoIdentificador(acervo, l.id, precedencia),
    conversas: l.conversas,
    mensagens: l.mensagens,
  }));
}

/**
 * A Conversa existe neste Acervo?
 *
 * Porta do nucleo para quem so precisa decidir se segue ou recusa — a CLI,
 * antes de responder uma consulta por identificador. Sem ela o chamador
 * consulta a tabela direto, que e a divida da tarefa #670; e foi assim que ela
 * voltou no ciclo 9, depois de a classe ter sido declarada paga.
 */
export function conversaExiste(acervo: Acervo, conversaId: string): boolean {
  const linha = acervo.preparar('SELECT 1 AS achou FROM conversas WHERE id = ?')
    .get(conversaId) as { achou: number } | undefined;
  return linha !== undefined;
}

/** A Fonte de uma Conversa específica, ou `undefined` se ela não existe. */
export function fonteDaConversa(acervo: Acervo, conversaId: string): Fonte | undefined {
  const linha = acervo.preparar('SELECT fonte FROM conversas WHERE id = ?')
    .get(conversaId) as { fonte: Fonte } | undefined;
  return linha?.fonte;
}

/** Pessoa resolvida por texto: id + nomes + identificadores, para a rede. */
export interface PessoaResolvida {
  id: string;
  nome: string | null;
  identificadores: string[];
}

/**
 * Resolve Pessoa por texto — nome de atribuicao, titular ou endereco. A busca
 * por rede e a UNICA entrada por texto: os demais pontos recebem o id.
 */
export function procurarPessoas(acervo: Acervo, filtro: { texto: string }): PessoaResolvida[] {
  const termo = `%${filtro.texto.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
  const linhas = acervo.preparar(
      `SELECT p.id,
              (SELECT a.nome FROM atribuicoes_de_nome a
                 JOIN identificadores i2 ON i2.id = a.identificador_id
                WHERE i2.pessoa_id = p.id
                ORDER BY a.autoridade DESC, a.ultimo_avistamento DESC LIMIT 1) AS nome,
              (SELECT GROUP_CONCAT(i.valor, char(10)) FROM identificadores i WHERE i.pessoa_id = p.id) AS identificadores
         FROM pessoas p
        WHERE p.id IN (
                SELECT pessoa_id FROM identificadores WHERE valor LIKE ? ESCAPE '\\'
              )
           OR p.id IN (
                SELECT i.pessoa_id FROM identificadores i
                 JOIN atribuicoes_de_nome a ON a.identificador_id = i.id
                WHERE LOWER(a.nome) LIKE LOWER(?) ESCAPE '\\'
              )
        LIMIT 30`,
    )
    .all(termo, termo) as Array<Record<string, unknown>>;
  return linhas.map((l) => ({
    id: l['id'] as string,
    nome: (l['nome'] as string | null) ?? null,
    identificadores: ((l['identificadores'] as string | null) ?? '').length
      ? (l['identificadores'] as string).split('\n')
      : [],
  }));
}

/** Totais por Fonte — direta/coletiva vale para Conversas; Mensagens por Fonte. */
export interface ContagemPorFonte {
  conversas: { porFonte: Record<string, { direta: number; coletiva: number; total: number }>; total: number };
  mensagens: { porFonte: Record<string, number>; total: number };
}

export function contarPorFonte(acervo: Acervo): ContagemPorFonte {
  const linhasConversas = acervo.preparar(
      'SELECT fonte, coletiva, COUNT(*) AS n FROM conversas GROUP BY fonte, coletiva',
    )
    .all() as Array<Record<string, unknown>>;
  const conversas: ContagemPorFonte['conversas'] = { porFonte: {}, total: 0 };
  for (const l of linhasConversas) {
    const fonte = l['fonte'] as string;
    const n = l['n'] as number;
    conversas.porFonte[fonte] ??= { direta: 0, coletiva: 0, total: 0 };
    if (l['coletiva'] === 1) conversas.porFonte[fonte]!.coletiva += n;
    else conversas.porFonte[fonte]!.direta += n;
    conversas.porFonte[fonte]!.total += n;
    conversas.total += n;
  }
  const linhasMensagens = acervo.preparar(
      'SELECT fonte, COUNT(*) AS n FROM mensagens GROUP BY fonte',
    )
    .all() as Array<Record<string, unknown>>;
  const mensagens: ContagemPorFonte['mensagens'] = { porFonte: {}, total: 0 };
  for (const l of linhasMensagens) {
    const fonte = l['fonte'] as string;
    mensagens.porFonte[fonte] = l['n'] as number;
    mensagens.total += l['n'] as number;
  }
  return { conversas, mensagens };
}
