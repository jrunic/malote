import { randomUUID } from 'node:crypto';
import type { Acervo } from './acervo.js';
import { emOperacao } from './trilha.js';

/**
 * Diario de Chegadas: o registro, so de acrescimo, do que ENTROU no Acervo, na ORDEM EM QUE ENTROU.
 *
 * O Cursor de Mensagens ordena pelo instante em que a Mensagem ACONTECEU, e por isso nao serve a quem acompanha o
 * Acervo: entrega atrasada (Pendentes da Plataforma, importacao, edicao) entra com instante antigo e passa despercebida
 * a quem avanca por tempo. A Chegada tem numero de sequencia proprio (`AUTOINCREMENT`: nunca reaproveitado, mesmo se
 * linhas forem apagadas) e o consumidor le por Marcador.
 *
 * A Chegada carrega REFERENCIAS (ids, autor, direcao, instantes) e nunca o conteudo da Mensagem.
 */

export const TIPOS_DE_CHEGADA = [
  'mensagem',
  'edicao',
  'anexo-disponivel',
  'transicao-de-participacao',
  'etiqueta',
  'inicio-do-diario',
] as const;
export type TipoDeChegada = (typeof TIPOS_DE_CHEGADA)[number];

export const ORIGENS_DA_CHEGADA = ['ao-vivo', 'importacao', 'reprocesso'] as const;
export type OrigemDaChegada = (typeof ORIGENS_DA_CHEGADA)[number];

export type DirecaoDaChegada = 'enviada' | 'recebida';

/** Padrao e maximo da pagina: o mesmo da listagem de Conversas. */
export const LIMITE_DE_CHEGADAS = 500;

export interface EntradaDeChegada {
  tipo: Exclude<TipoDeChegada, 'inicio-do-diario'>;
  origem: OrigemDaChegada;
  /** Instante de GRAVACAO, em milissegundos. */
  criadoEm: number;
  /** Instante do FATO, em milissegundos. O consumidor mede o atraso por `criadoEm - ocorridaEm`. */
  ocorridaEm: number;
  conversaId?: string;
  mensagemId?: string;
  autorId?: string;
  direcao?: DirecaoDaChegada;
  /** O id da linha do fato: a Mensagem, a Edicao, o Anexo, a Transicao ou a Etiqueta. */
  alvoId: string;
}

export interface ChegadaLida {
  seq: number;
  tipo: TipoDeChegada;
  /** Nulo so na `inicio-do-diario`. */
  origem: OrigemDaChegada | null;
  criadoEm: number;
  ocorridaEm: number | null;
  conversaId: string | null;
  mensagemId: string | null;
  autorId: string | null;
  direcao: DirecaoDaChegada | null;
  alvoId: string | null;
}

/** Marcador malformado: erro de USO. Nao e o mesmo que expirado. */
export class MarcadorInvalidoError extends Error {
  constructor() {
    super('Marcador invalido — devolva o `proximo` tal como recebeu.');
    this.name = 'MarcadorInvalidoError';
  }
}

export type MotivoDeMarcadorExpirado = 'outra-epoca' | 'abaixo-do-piso' | 'acima-da-ultima';

/** O Diario nao garante mais esse Marcador. O consumidor pede o ponto de partida e recomeca dali. */
export class MarcadorExpiradoError extends Error {
  constructor(readonly motivo: MotivoDeMarcadorExpirado) {
    super(`Marcador expirado (${motivo}) — peca o ponto de partida e recomece dali.`);
    this.name = 'MarcadorExpiradoError';
  }
}

interface MarcadorDecodificado {
  epoca: string;
  seq: number;
}

/** Token opaco: o consumidor devolve o `proximo` e nunca o monta. */
export function codificarMarcador(m: MarcadorDecodificado): string {
  return Buffer.from(JSON.stringify([m.epoca, m.seq])).toString('base64url');
}

export function decodificarMarcador(token: string): MarcadorDecodificado | undefined {
  try {
    const partes: unknown = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (
      Array.isArray(partes) &&
      partes.length === 2 &&
      typeof partes[0] === 'string' &&
      partes[0] !== '' &&
      typeof partes[1] === 'number' &&
      Number.isSafeInteger(partes[1]) &&
      partes[1] >= 0
    ) {
      return { epoca: partes[0], seq: partes[1] };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Semeia o Diario: a linha de controle (epoca e Piso) e a Chegada `inicio-do-diario`. Idempotente: Diario ja
 * semeado nao muda. E a mesma semente que o passo v30 grava, e um teste confere que o Acervo fresco e o migrado
 * nascem iguais.
 */
export function semearDiario(acervo: Acervo, agora: number): void {
  acervo.db.transaction(() => {
    if (acervo.preparar('SELECT 1 FROM diario_de_chegadas').get() !== undefined) return;
    const inicio = acervo
      .preparar("INSERT INTO chegadas (tipo, origem, criado_em) VALUES ('inicio-do-diario', NULL, ?)")
      .run(agora);
    acervo
      .preparar('INSERT INTO diario_de_chegadas (linha_unica, epoca, piso) VALUES (1, ?, ?)')
      .run(randomUUID(), Number(inicio.lastInsertRowid));
  })();
}

/** Grava uma Chegada. Quem chama e a porta de escrita do fato, dentro da transacao dela. Devolve o numero de sequencia. */
export function registrarChegada(acervo: Acervo, e: EntradaDeChegada): number {
  const info = acervo
    .preparar(
      `INSERT INTO chegadas (tipo, origem, criado_em, ocorrida_em, conversa_id, mensagem_id, autor_id, direcao, alvo_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      e.tipo,
      e.origem,
      e.criadoEm,
      e.ocorridaEm,
      e.conversaId ?? null,
      e.mensagemId ?? null,
      e.autorId ?? null,
      e.direcao ?? null,
      e.alvoId,
    );
  return Number(info.lastInsertRowid);
}

/**
 * Grava a Chegada de um fato que PENDE de uma Mensagem (a Edicao e o Anexo que ficou disponivel): a Conversa, o autor e a
 * direcao saem da Mensagem, e uma leitura a mais entra no caminho de gravacao. Mensagem inexistente e erro: a porta que
 * chama esta esta dentro da transacao do fato, e o erro a desfaz.
 */
export function registrarChegadaSobreMensagem(
  acervo: Acervo,
  e: {
    tipo: 'edicao' | 'anexo-disponivel';
    origem: OrigemDaChegada;
    mensagemId: string;
    alvoId: string;
    criadoEm: number;
    /** O instante do fato. Ausente, e o da Mensagem. */
    ocorridaEm?: number;
  },
): number {
  const m = acervo
    .preparar('SELECT conversa_id, autor_id, direcao, ocorrida_em FROM mensagens WHERE id = ?')
    .get(e.mensagemId) as
    | { conversa_id: string; autor_id: string | null; direcao: DirecaoDaChegada | null; ocorrida_em: number }
    | undefined;
  if (m === undefined) throw new Error(`Chegada sobre Mensagem inexistente: ${e.mensagemId}`);
  return registrarChegada(acervo, {
    tipo: e.tipo,
    origem: e.origem,
    criadoEm: e.criadoEm,
    ocorridaEm: e.ocorridaEm ?? m.ocorrida_em,
    conversaId: m.conversa_id,
    mensagemId: e.mensagemId,
    ...(m.autor_id !== null ? { autorId: m.autor_id } : {}),
    ...(m.direcao !== null ? { direcao: m.direcao } : {}),
    alvoId: e.alvoId,
  });
}

interface Controle {
  epoca: string;
  piso: number;
  ultima: number;
}

function lerControle(acervo: Acervo): Controle {
  const c = acervo.preparar('SELECT epoca, piso FROM diario_de_chegadas').get() as { epoca: string; piso: number } | undefined;
  const u = acervo.preparar('SELECT MAX(seq) AS ultima FROM chegadas').get() as { ultima: number | null };
  if (c === undefined || u.ultima === null) {
    throw new Error('Diario de Chegadas sem semente: o Acervo nao foi aberto pela porta normal.');
  }
  return { epoca: c.epoca, piso: c.piso, ultima: u.ultima };
}

/**
 * O Marcador M so e garantido se for da epoca atual, maior ou igual ao Piso e menor ou igual a ultima Chegada
 * gravada. Maior que a ultima cobre o Acervo restaurado de copia: a epoca se mantem e a sequencia volta ao ponto da
 * copia. O zero nunca e valido, porque o Piso nasce no numero da `inicio-do-diario`, que e 1 ou mais.
 */
function conferirMarcador(m: MarcadorDecodificado, c: Controle): void {
  if (m.epoca !== c.epoca) throw new MarcadorExpiradoError('outra-epoca');
  if (m.seq < c.piso) throw new MarcadorExpiradoError('abaixo-do-piso');
  if (m.seq > c.ultima) throw new MarcadorExpiradoError('acima-da-ultima');
}

/** Quanto o Diario guarda, em dias de instante de gravacao. */
export const RETENCAO_PADRAO_DO_DIARIO_EM_DIAS = 30;

/** O maximo de Chegadas que uma passada da aparagem remove: um lote curto, para nao segurar o escritor. */
export const LOTE_DA_APARAGEM = 5000;

const UM_DIA_EM_MS = 86_400_000;

export interface OpcoesDeAparagem {
  /** O relogio, em milissegundos. */
  agora: number;
  /** Retencao em dias; o padrao e `RETENCAO_PADRAO_DO_DIARIO_EM_DIAS`. */
  dias?: number;
  /** O maximo removido nesta passada; o padrao e `LOTE_DA_APARAGEM`. */
  lote?: number;
  /** `false` so conta o que removeria (o ensaio). O padrao e `true`. */
  comEfeito?: boolean;
}

export interface ResultadoDaAparagem {
  /** O que a passada removeu (ou removeria, no ensaio). */
  removidas: number;
  /** O Piso depois da passada (no ensaio, o de antes). */
  piso: number;
  /** Quantas Chegadas ficam no Diario depois da passada. */
  restam: number;
}

/**
 * Apara o Diario: remove as Chegadas mais antigas que a retencao e sobe o Piso para a ultima removida.
 *
 * Sempre um PREFIXO da ordem de gravacao: o Piso diz "tudo ate aqui foi removido", entao a passada para na primeira Chegada
 * ainda dentro da retencao, mesmo que depois dela haja outra, mais antiga pelo relogio (relogio que andou para tras). Nunca
 * remove a Chegada de maior numero: e ela que mantem o ponto de partida mesmo num Diario parado ha mais de 30 dias. Uma
 * passada remove no maximo `lote`; quem quer esvaziar tudo repete enquanto `removidas` for igual ao lote.
 *
 * A Operacao (`aparar-chegadas`, irreversivel, sem efeito linha a linha: o Diario nao e dado de origem) so e gravada
 * quando a passada remove alguma coisa. O tique que nao remove nada nao deixa rastro, porque a frota le a ausencia de
 * Operacao como sinal, e uma por hora por Inquilino seria ruido.
 */
export function apararDiario(acervo: Acervo, opcoes: OpcoesDeAparagem): ResultadoDaAparagem {
  const dias = opcoes.dias ?? RETENCAO_PADRAO_DO_DIARIO_EM_DIAS;
  const lote = opcoes.lote ?? LOTE_DA_APARAGEM;
  const corte = opcoes.agora - dias * UM_DIA_EM_MS;
  const { piso, ultima } = lerControle(acervo);

  const alvo = acervo
    .preparar(
      `SELECT COALESCE(
                (SELECT MIN(seq) - 1
                   FROM (SELECT seq, criado_em FROM chegadas WHERE seq >= @piso AND seq < @ultima ORDER BY seq LIMIT @lote)
                  WHERE criado_em >= @corte),
                (SELECT MAX(seq)
                   FROM (SELECT seq FROM chegadas WHERE seq >= @piso AND seq < @ultima ORDER BY seq LIMIT @lote))
              ) AS ate`,
    )
    .get({ piso, ultima, lote, corte }) as { ate: number | null };
  const ate = alvo.ate;
  const contar = (): number => (acervo.preparar('SELECT COUNT(*) AS n FROM chegadas').get() as { n: number }).n;
  // `>=` no Piso: o Diario nasce com o Piso igual ao numero da `inicio-do-diario`, que ainda existe e e a primeira a sair.
  if (ate === null || ate < piso) return { removidas: 0, piso, restam: contar() };

  // Com o Piso ja em `ate`, nao ha linha a remover e nao ha Operacao a gravar.
  const aRemover = (acervo.preparar('SELECT COUNT(*) AS n FROM chegadas WHERE seq <= ?').get(ate) as { n: number }).n;
  if (aRemover === 0) return { removidas: 0, piso, restam: contar() };
  if (opcoes.comEfeito === false) return { removidas: aRemover, piso, restam: contar() - aRemover };

  let removidas = 0;
  emOperacao(acervo, { natureza: 'aparar-chegadas', reversibilidade: 'irreversivel', registraEfeito: false }, () => {
    removidas = acervo.preparar('DELETE FROM chegadas WHERE seq <= ?').run(ate).changes;
    // `MAX`: uma passada concorrente que ja subiu o Piso mais alto nao pode ser desfeita por esta.
    acervo.preparar('UPDATE diario_de_chegadas SET piso = MAX(piso, ?)').run(ate);
  });
  return { removidas, piso: ate, restam: contar() };
}

/** O ponto de partida: o Marcador da ultima Chegada gravada, sem Chegada nenhuma. */
export function pontoDePartida(acervo: Acervo): string {
  return acervo.db.transaction(() => {
    const c = lerControle(acervo);
    return codificarMarcador({ epoca: c.epoca, seq: c.ultima });
  })();
}

export interface FiltroDeChegadas {
  /** O Marcador da leitura anterior (ou o ponto de partida). Le as Chegadas de numero MAIOR. */
  depois: string;
  limite?: number;
  conversaId?: string;
  configuracaoId?: string;
  direcao?: DirecaoDaChegada;
  /** Ids de Identificador autores. A lista vazia nao casa nada, nunca a ausencia de filtro. */
  autorIds?: string[];
  /** Exclui estes autores (o eco do proprio agente). Chegada sem autor nao e excluida. */
  semAutorIds?: string[];
  tipos?: TipoDeChegada[];
  origens?: OrigemDaChegada[];
}

export interface PaginaDeChegadas {
  chegadas: ChegadaLida[];
  /** O Marcador para a proxima leitura: o da ultima Chegada devolvida, ou o da ultima gravada se a pagina esgotou o Diario. */
  proximo: string;
  /** A pagina chegou ao fim do Diario no instante da leitura. */
  ultima: boolean;
}

const SQL_DE_LEITURA = `
  SELECT ch.seq, ch.tipo, ch.origem, ch.criado_em, ch.ocorrida_em, ch.conversa_id, ch.mensagem_id, ch.autor_id,
         ch.direcao, ch.alvo_id
  FROM chegadas ch
  LEFT JOIN conversas c ON c.id = ch.conversa_id
  WHERE ch.seq > @depois
    AND (@conversa IS NULL OR ch.conversa_id = @conversa)
    AND (@configuracao IS NULL OR c.configuracao_id = @configuracao)
    AND (@direcao IS NULL OR ch.direcao = @direcao)
    AND (@autores IS NULL OR ch.autor_id IN (SELECT value FROM json_each(@autores)))
    AND (@sem IS NULL OR ch.autor_id IS NULL OR ch.autor_id NOT IN (SELECT value FROM json_each(@sem)))
    AND (@tipos IS NULL OR ch.tipo IN (SELECT value FROM json_each(@tipos)))
    AND (@origens IS NULL OR ch.origem IN (SELECT value FROM json_each(@origens)))
  ORDER BY ch.seq
  LIMIT @limite`;

function listaOuNulo(lista: readonly string[] | undefined): string | null {
  return lista === undefined ? null : JSON.stringify(lista);
}

/**
 * Le as Chegadas depois de um Marcador, em ordem de gravacao. O controle e as linhas saem de UMA transacao de leitura,
 * entao o `proximo` nunca passa de uma Chegada que a pagina nao viu.
 */
export function lerChegadas(acervo: Acervo, filtro: FiltroDeChegadas): PaginaDeChegadas {
  const marcador = decodificarMarcador(filtro.depois);
  if (marcador === undefined) throw new MarcadorInvalidoError();
  const limite = Math.min(filtro.limite ?? LIMITE_DE_CHEGADAS, LIMITE_DE_CHEGADAS);

  return acervo.db.transaction((): PaginaDeChegadas => {
    const controle = lerControle(acervo);
    conferirMarcador(marcador, controle);
    const linhas = acervo.preparar(SQL_DE_LEITURA).all({
      depois: marcador.seq,
      conversa: filtro.conversaId ?? null,
      configuracao: filtro.configuracaoId ?? null,
      direcao: filtro.direcao ?? null,
      autores: listaOuNulo(filtro.autorIds),
      sem: listaOuNulo(filtro.semAutorIds),
      tipos: listaOuNulo(filtro.tipos),
      origens: listaOuNulo(filtro.origens),
      limite,
    }) as Array<{
      seq: number;
      tipo: TipoDeChegada;
      origem: OrigemDaChegada | null;
      criado_em: number;
      ocorrida_em: number | null;
      conversa_id: string | null;
      mensagem_id: string | null;
      autor_id: string | null;
      direcao: DirecaoDaChegada | null;
      alvo_id: string | null;
    }>;
    const chegadas = linhas.map(
      (l): ChegadaLida => ({
        seq: l.seq,
        tipo: l.tipo,
        origem: l.origem,
        criadoEm: l.criado_em,
        ocorridaEm: l.ocorrida_em,
        conversaId: l.conversa_id,
        mensagemId: l.mensagem_id,
        autorId: l.autor_id,
        direcao: l.direcao,
        alvoId: l.alvo_id,
      }),
    );
    const ultima = chegadas.length < limite;
    const seqDoProximo = ultima ? controle.ultima : chegadas[chegadas.length - 1]!.seq;
    return { chegadas, proximo: codificarMarcador({ epoca: controle.epoca, seq: seqDoProximo }), ultima };
  })();
}
