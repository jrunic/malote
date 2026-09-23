import { randomUUID } from 'node:crypto';
import type { Acervo } from './acervo.js';
import { caminhoDeMidia } from './caminho-de-midia.js';
import { motivoDaRejeicao } from './instante.js';
import type {
  ConversaId,
  Direcao,
  Fonte,
  MensagemId,
  NaturezaDeTransicao,
  PessoaId,
  Presenca,
} from './tipos.js';
import { emOperacao } from './trilha.js';

/**
 * A porta de escrita do núcleo. É a ÚNICA entrada de escrita: Adaptador
 * nenhum toca tabela diretamente. É esta fronteira que o ciclo 2 vai testar
 * — acrescentar Fonte não pode alterar nada daqui para dentro.
 */

export interface EntradaIdentificador {
  fonte: Fonte;
  valor: string;
}

export interface IdentificadorRegistrado {
  id: string;
  /**
   * Falso quando (fonte, valor) ja existia. E o que o adaptador precisa para
   * contar sem consultar tabela — a divida da tarefa #670.
   */
  criado: boolean;
}

/** Registra um endereço numa Fonte. Idempotente por (fonte, valor). */
export function registrarIdentificador(
  acervo: Acervo,
  entrada: EntradaIdentificador,
): IdentificadorRegistrado {
  const existente = acervo.preparar('SELECT id FROM identificadores WHERE fonte = ? AND valor = ?')
    .get(entrada.fonte, entrada.valor) as { id: string } | undefined;
  if (existente !== undefined) return { id: existente.id, criado: false };

  const id = randomUUID();
  acervo.preparar('INSERT INTO identificadores (id, fonte, valor, visto_em) VALUES (?, ?, ?, ?)')
    .run(id, entrada.fonte, entrada.valor, new Date().toISOString());
  return { id, criado: true };
}

/**
 * Registra de qual cartao de catalogo, e de qual CONFIGURACAO, veio este
 * endereco. Append-only: o mesmo trio nao duplica, e cartao novo para o mesmo
 * endereco acrescenta em vez de substituir.
 *
 * A Configuracao entra na chave porque o mesmo endereco no mesmo cartao de duas
 * bases sao duas evidencias — e e o par delas que liga uma base a outra.
 *
 * O ultimo avistamento nasce igual ao primeiro e AVANCA a cada reavistamento;
 * o primeiro nunca se move. Sao coisas diferentes: o desempate de nome usa a
 * recencia da atribuicao, e mover o primeiro traria nome antigo de volta ao
 * topo.
 *
 * `ausente_em = NULL` no reavistamento e o criterio 18 inteiro: reaparecer
 * desfaz a Marca de Ausencia, ATOMICO com a escrita que o causa. Um segundo
 * comando para isso seria um comando que alguem esquece de chamar.
 */
export function registrarCartaoDeCatalogo(
  acervo: Acervo,
  identificadorId: string,
  cartao: string,
  configuracaoId: string,
  vistoEm: string,
): void {
  acervo.preparar(
      `INSERT INTO cartoes_de_catalogo
         (identificador_id, cartao, configuracao_id, visto_em, ultimo_avistamento)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (identificador_id, cartao, configuracao_id) DO UPDATE SET
         ultimo_avistamento = excluded.ultimo_avistamento,
         ausente_em = NULL`,
    )
    .run(identificadorId, cartao, configuracaoId, vistoEm, vistoEm);
}

export function lerPessoaDoIdentificador(acervo: Acervo, identificadorId: string): PessoaId | null {
  const linha = acervo.preparar('SELECT pessoa_id FROM identificadores WHERE id = ?')
    .get(identificadorId) as { pessoa_id: string | null } | undefined;
  return linha?.pessoa_id ?? null;
}

/**
 * Erro próprio da recusa por instante implausível.
 * Classe distinta, e não `Error` genérico, para que o importador conte por
 * causa e para que desligar esta guarda derrube só o teste dela.
 */
export class InstanteImplausivelError extends Error {
  constructor(readonly motivo: string) {
    super(`Mensagem recusada: ${motivo}`);
    this.name = 'InstanteImplausivelError';
  }
}

export interface MetadadosDeColetiva {
  assunto?: string;
  descricao?: string;
  imagem?: string;
  alteradoPor?: string;
  alteradoEm?: string;
}

/**
 * Erro próprio da recusa por Configuração ausente, sobrando, ou de outra Fonte.
 * Classe distinta pela mesma razão da anterior: quem chama conta por causa, e
 * desligar esta guarda derruba só os testes dela.
 */
export class ConfiguracaoDeConversaError extends Error {
  constructor(readonly motivo: string) {
    super(`Conversa recusada: ${motivo}`);
    this.name = 'ConfiguracaoDeConversaError';
  }
}

export interface EntradaConversa {
  fonte: Fonte;
  idExterno: string;
  coletiva: boolean;
  /**
   * A Configuracao de Adaptador sob a qual esta Conversa existe.
   *
   * OBRIGATORIA em Conversa direta, PROIBIDA em coletiva. A assimetria e o
   * modelo: `conta-a <-> fulano` e `conta-b <-> fulano` sao dois fios que dividem
   * o mesmo endereco do outro lado; um grupo com as duas contas dentro e um
   * grupo, nao dois. Medido em 08/09/2026 ao importar a segunda conta: 89
   * Conversas diretas colidiram, ZERO coletivas.
   *
   * Vem a Fonte JUNTO do id, de proposito. Sem ela a porta nao consegue recusar
   * uma Conversa `whatsapp` pendurada numa Configuracao `instagram`, e o schema
   * tambem nao — a Configuracao vive no Registro, que e outro arquivo, entao
   * nao ha chave estrangeira possivel. Esta porta e o unico lugar onde os dois
   * valores se encontram.
   */
  configuracao?: { id: string; fonte: Fonte };
  metadadosDeColetiva?: MetadadosDeColetiva;
  /**
   * O registro original da Fonte, serializado. Preservado para o que o nucleo
   * nao modela — ver o agregado Conteudo Bruto no modelo de dominio.
   */
  bruto?: string;
}

/** Registra uma Conversa. Idempotente por (fonte, idExterno). */
export function registrarConversa(acervo: Acervo, entrada: EntradaConversa): ConversaId {
  // As guardas vem ANTES de qualquer leitura ou escrita: recusar depois de ter
  // consultado o banco nao seria mais correto, so mais caro.
  if (entrada.coletiva && entrada.configuracao !== undefined) {
    throw new ConfiguracaoDeConversaError(
      'coletiva nao leva Configuracao — o grupo e um so para todas as contas do Inquilino',
    );
  }
  if (!entrada.coletiva && entrada.configuracao === undefined) {
    throw new ConfiguracaoDeConversaError(
      'direta exige Configuracao — sem ela dois fios de contas diferentes viram um',
    );
  }
  if (entrada.configuracao !== undefined && entrada.configuracao.fonte !== entrada.fonte) {
    throw new ConfiguracaoDeConversaError(
      `Configuracao e da Fonte ${entrada.configuracao.fonte} e a Conversa e de ${entrada.fonte}`,
    );
  }

  // Endereco que ja existe com a OUTRA natureza e CONFLITO, nao linha nova.
  //
  // Antes do lookup ramificado, o `SELECT` por (fonte, id_externo) absorvia o
  // desencontro: quem chegasse segundo encontrava a linha do primeiro. Agora
  // nao absorve, e sem esta guarda o mesmo endereco viraria duas Conversas —
  // uma em cada indice parcial, sem nada reclamar.
  //
  // Medido em 08/09/2026: a importacao classifica coletiva por
  // `ZSESSIONTYPE != 0` e a recepcao ao vivo por `endsWith('@g.us')`. Para
  // `<numero>@status` os dois DISCORDAM. Unificar o criterio e a tarefa #826;
  // esta guarda transforma a divergencia em erro contado, e no caminho ao vivo
  // o catch por evento a registra como recusa em vez de derrubar o processo.
  const daOutraNatureza = acervo
    .preparar(
      'SELECT id, coletiva FROM conversas WHERE fonte = ? AND id_externo = ? AND coletiva != ?',
    )
    .get(entrada.fonte, entrada.idExterno, entrada.coletiva ? 1 : 0) as
    | { id: string; coletiva: number }
    | undefined;
  if (daOutraNatureza !== undefined) {
    throw new ConfiguracaoDeConversaError(
      `${entrada.idExterno} ja existe como ${daOutraNatureza.coletiva === 1 ? 'coletiva' : 'direta'}`,
    );
  }

  // O lookup RAMIFICA pela natureza: coletiva encontra por endereco; direta so
  // encontra dentro da propria Configuracao. Procurar sem ramificar faria a
  // segunda conta reencontrar o fio da primeira — que e o defeito inteiro.
  const existente = (
    entrada.coletiva
      ? acervo
          .preparar('SELECT id FROM conversas WHERE fonte = ? AND id_externo = ? AND coletiva = 1')
          .get(entrada.fonte, entrada.idExterno)
      : acervo
          .preparar(
            `SELECT id FROM conversas
              WHERE fonte = ? AND id_externo = ? AND coletiva = 0 AND configuracao_id = ?`,
          )
          .get(entrada.fonte, entrada.idExterno, (entrada.configuracao as { id: string }).id)
  ) as { id: string } | undefined;
  if (existente !== undefined) {
    // Conversa e ESTADO CORRENTE, nao fato imutavel: a reimportacao e a
    // ingestao recorrente a revisitam, e o retrato mais novo vale. Sem este
    // UPDATE o bruto viraria retrato velho em silencio depois da primeira
    // importacao, que e pior que nao ter bruto nenhum.
    if (entrada.bruto !== undefined) {
      acervo.preparar('UPDATE conversas SET bruto = ? WHERE id = ?').run(entrada.bruto, existente.id);
    }
    return existente.id;
  }

  const id = randomUUID();
  acervo.preparar(
      `INSERT INTO conversas (id, fonte, id_externo, coletiva, configuracao_id, criada_em, bruto)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      entrada.fonte,
      entrada.idExterno,
      entrada.coletiva ? 1 : 0,
      entrada.configuracao?.id ?? null,
      new Date().toISOString(),
      entrada.bruto ?? null,
    );

  if (entrada.coletiva && entrada.metadadosDeColetiva !== undefined) {
    const m = entrada.metadadosDeColetiva;
    acervo.preparar(
        `INSERT INTO metadados_de_coletiva
           (conversa_id, assunto, descricao, imagem, alterado_por, alterado_em)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        m.assunto ?? null,
        m.descricao ?? null,
        m.imagem ?? null,
        m.alteradoPor ?? null,
        m.alteradoEm ?? null,
      );
  }

  return id;
}

export function idDeConversaPorEndereco(
  acervo: Acervo,
  e: { fonte: Fonte; idExterno: string; configuracaoId: string },
): string | undefined {
  const coletiva = acervo
    .preparar('SELECT id FROM conversas WHERE fonte = ? AND id_externo = ? AND coletiva = 1')
    .get(e.fonte, e.idExterno) as { id: string } | undefined;
  if (coletiva !== undefined) return coletiva.id;
  const direta = acervo
    .preparar(
      `SELECT id FROM conversas
        WHERE fonte = ? AND id_externo = ? AND coletiva = 0 AND configuracao_id = ?`,
    )
    .get(e.fonte, e.idExterno, e.configuracaoId) as { id: string } | undefined;
  return direta?.id;
}

export interface EntradaParticipacao {
  conversaId: ConversaId;
  identificadorId: string;
  /** Nulo quando a Fonte não informa. Nunca uma aproximação. */
  comecouEm?: string;
  terminouEm?: string;
  /** Quando o malote soube desta Participação. Obrigatório. */
  observadaEm: string;
  /**
   * O que a Fonte declarou sobre a atividade deste membro. AUSENTE quando a
   * Fonte não declara — Conversa direta não tem roster, e ali ninguém declara.
   * Entra como veio; não vira `terminouEm`.
   */
  ativaNaFonte?: boolean;
  /**
   * O registro original da Fonte, serializado. Preservado para o que o nucleo
   * nao modela — ver o agregado Conteudo Bruto no modelo de dominio.
   */
  bruto?: string;
}

/**
 * Registra a presença de alguém numa Conversa.
 *
 * Início e fim ficam nulos quando a Fonte não os fornece — material exportado
 * traz o quadro do momento do export, sem data de entrada. Inventar a data
 * seria o mesmo defeito que o Acervo recusa em Mensagem.
 * ADR `20260826-participacao-sem-historico-em-material-exportado`.
 */
export function registrarParticipacao(acervo: Acervo, entrada: EntradaParticipacao): void {
  acervo.preparar(
      `INSERT INTO participacoes
         (conversa_id, identificador_id, comecou_em, terminou_em, observada_em, ativa_na_fonte,
          bruto)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (conversa_id, identificador_id) DO UPDATE SET
         comecou_em     = COALESCE(excluded.comecou_em, participacoes.comecou_em),
         terminou_em    = COALESCE(excluded.terminou_em, participacoes.terminou_em),
         observada_em   = excluded.observada_em,
         ativa_na_fonte = COALESCE(excluded.ativa_na_fonte, participacoes.ativa_na_fonte),
         bruto          = COALESCE(excluded.bruto, participacoes.bruto)`,
    )
    .run(
      entrada.conversaId,
      entrada.identificadorId,
      entrada.comecouEm ?? null,
      entrada.terminouEm ?? null,
      entrada.observadaEm,
      entrada.ativaNaFonte === undefined ? null : entrada.ativaNaFonte ? 1 : 0,
      entrada.bruto ?? null,
    );
}

export interface EntradaTransicao {
  conversaId: ConversaId;
  identificadorId: string;
  natureza: NaturezaDeTransicao;
  /** O instante que a FONTE declarou. Nunca derivado, nunca aproximado. */
  ocorridaEm: number;
  fonte: Fonte;
  /** Identificador externo do evento na Fonte. E ele que da a idempotencia. */
  idExterno: string;
  /** O codigo bruto da Fonte, preservado mesmo depois de classificado. */
  codigoDaFonte: string;
}

/**
 * Registra um evento de entrada ou saida que a Fonte DECLAROU.
 *
 * Esta porta e agnostica de produtor: o adaptador de material a chama hoje, e
 * a recepcao continua do ciclo 10 a chama sem mudanca de forma. Nada aqui
 * pressupoe que o evento veio de um arquivo.
 *
 * NAO existe caminho que derive `ocorridaEm` — quem nao tem o instante da
 * Fonte nao tem Transicao. E a mesma recusa que o Acervo faz em Mensagem.
 *
 * Devolve `true` quando a linha NASCEU aqui e `false` quando ja existia. O
 * chamador conta pelo retorno: contar por chamada faria o relatorio da
 * reimportacao afirmar que criou tudo de novo, quando nao criou nada.
 */
export function registrarTransicao(acervo: Acervo, entrada: EntradaTransicao): boolean {
  const info = acervo.preparar(
      `INSERT INTO transicoes_de_participacao
         (id, conversa_id, identificador_id, natureza, ocorrida_em, fonte, id_externo, codigo_da_fonte)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (fonte, id_externo, identificador_id) DO NOTHING`,
    )
    .run(
      randomUUID(),
      entrada.conversaId,
      entrada.identificadorId,
      entrada.natureza,
      entrada.ocorridaEm,
      entrada.fonte,
      entrada.idExterno,
      entrada.codigoDaFonte,
    );
  return info.changes === 1;
}

export interface EntradaMensagem {
  conversaId: ConversaId;
  fonte: Fonte;
  idExterno: string;
  autorId?: string;
  conteudo?: string;
  ocorridaEm: number;
  citadaId?: string;
  bruto?: string;
  /** Enviada pelo Titular ou recebida — obrigatorio, sem inferencia. */
  direcao: Direcao;
  /** Instante de referência para a checagem de plausibilidade. */
  agora: number;
}

/**
 * Registra uma Mensagem. Idempotente por (fonte, idExterno).
 * Instante implausível é RECUSADO na entrada — não existe estado intermediário
 * de data suspeita, e o Acervo não comporta instante implausível.
 */
export function idDeMensagemPorExterno(
  acervo: Acervo,
  e: { fonte: Fonte; idExterno: string },
): string | undefined {
  const linha = acervo
    .preparar('SELECT id FROM mensagens WHERE fonte = ? AND id_externo = ?')
    .get(e.fonte, e.idExterno) as { id: string } | undefined;
  return linha?.id;
}

export function registrarMensagem(acervo: Acervo, entrada: EntradaMensagem): MensagemId {
  const motivo = motivoDaRejeicao(entrada.fonte, entrada.ocorridaEm, entrada.agora);
  if (motivo !== null) {
    throw new InstanteImplausivelError(motivo);
  }

  const existente = idDeMensagemPorExterno(acervo, {
    fonte: entrada.fonte,
    idExterno: entrada.idExterno,
  });
  if (existente !== undefined) return existente;

  const id = randomUUID();
  acervo.preparar(
      `INSERT INTO mensagens
         (id, conversa_id, fonte, id_externo, autor_id, conteudo, ocorrida_em, citada_id, direcao, bruto)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      entrada.conversaId,
      entrada.fonte,
      entrada.idExterno,
      entrada.autorId ?? null,
      entrada.conteudo ?? null,
      entrada.ocorridaEm,
      entrada.citadaId ?? null,
      entrada.direcao,
      entrada.bruto ?? null,
    );
  return id;
}

export interface EntradaAnexo {
  mensagemId: MensagemId;
  tipo: string;
  tamanho?: number;
  nomeOriginal?: string;
  duracao?: number;
  impressao?: string;
  presenca: Presenca;
  caminho?: string;
  /**
   * O registro original da Fonte, serializado. Preservado para o que o nucleo
   * nao modela — ver o agregado Conteudo Bruto no modelo de dominio.
   */
  bruto?: string;
}

/**
 * Registra um Anexo. Nasce junto com a Mensagem, mesmo antes de o arquivo
 * existir em disco — Presença sempre explícita, para que "não está lá" nunca
 * seja indistinguível de "nunca existiu".
 */
export function registrarAnexo(acervo: Acervo, entrada: EntradaAnexo): string {
  const id = randomUUID();
  acervo.preparar(
      `INSERT INTO anexos
         (id, mensagem_id, tipo, tamanho, nome_original, duracao, impressao, presenca, caminho,
          bruto)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      entrada.mensagemId,
      entrada.tipo,
      entrada.tamanho ?? null,
      entrada.nomeOriginal ?? null,
      entrada.duracao ?? null,
      entrada.impressao ?? null,
      entrada.presenca,
      entrada.caminho ??
        (entrada.presenca === 'presente'
          ? // O Inquilino vem do ACERVO em que a linha esta sendo escrita,
            // nunca de parametro: chamador que o errasse gravaria o arquivo
            // na subarvore de outro Inquilino com a linha aqui.
            caminhoDeMidia({
              inquilinoId: acervo.inquilinoId,
              anexoId: id,
              tipo: entrada.tipo,
            })
          : null),
      entrada.bruto ?? null,
    );
  return id;
}

/**
 * Marca o arquivo como descartado. NUNCA apaga a Mensagem nem o Anexo:
 * o Descritor sobrevive, e continua sendo possível saber que houve um vídeo
 * ali, de que tamanho e quando saiu.
 */
export function descartarAnexo(
  acervo: Acervo,
  anexoId: string,
  motivo: { politica: string; quando?: number },
): void {
  const antes = acervo.preparar('SELECT presenca, caminho FROM anexos WHERE id = ?')
    .get(anexoId) as { presenca: string; caminho: string | null } | undefined;
  if (antes === undefined) return;

  const quando = new Date(motivo.quando ?? Date.now()).toISOString();

  // IRREVERSIVEL: o arquivo sai do disco e nao volta. A trilha registra por
  // qual execucao ele saiu — que e o que a linha do Anexo nao diz — e o
  // desfazer recusa com a causa nomeada, em vez de fingir que reverteu.
  //
  // Grava efeito MESMO sendo irreversivel: os dois eixos sao distintos, e o
  // caminho anterior so existe aqui depois que a coluna e zerada.
  emOperacao(acervo, { natureza: 'descartar-anexo', reversibilidade: 'irreversivel' }, (op) => {
    acervo.preparar(
        `UPDATE anexos
            SET presenca = 'descartado', caminho = NULL, descartado_em = ?, descartado_por = ?
          WHERE id = ?`,
      )
      .run(quando, motivo.politica, anexoId);

    op.valor({
      tabela: 'anexos',
      chave: anexoId,
      campo: 'presenca',
      antes: antes.presenca,
      depois: 'descartado',
    });
    op.valor({
      tabela: 'anexos',
      chave: anexoId,
      campo: 'caminho',
      antes: antes.caminho,
      depois: null,
    });
    op.valor({
      tabela: 'anexos',
      chave: anexoId,
      campo: 'descartado_por',
      antes: null,
      depois: motivo.politica,
    });
  });
}

/**
 * Existência pela porta, não por consulta direta à tabela.
 *
 * Antes destas funções o Adaptador perguntava com um `SELECT` próprio,
 * conhecendo o schema do núcleo — dívida aberta na tarefa #670. É também o que
 * torna a contagem "criada" honesta: `registrarConversa` devolve o mesmo id
 * para nova e existente, e quem conta não distingue sem perguntar antes.
 */
export function conversaJaExiste(acervo: Acervo, fonte: Fonte, idExterno: string): boolean {
  const linha = acervo.preparar('SELECT 1 AS ok FROM conversas WHERE fonte = ? AND id_externo = ?')
    .get(fonte, idExterno) as { ok: number } | undefined;
  return linha !== undefined;
}

export function mensagemJaExiste(acervo: Acervo, fonte: Fonte, idExterno: string): boolean {
  const linha = acervo.preparar('SELECT 1 AS ok FROM mensagens WHERE fonte = ? AND id_externo = ?')
    .get(fonte, idExterno) as { ok: number } | undefined;
  return linha !== undefined;
}

export function participacaoJaExiste(
  acervo: Acervo,
  conversaId: ConversaId,
  identificadorId: string,
): boolean {
  const linha = acervo.preparar('SELECT 1 AS ok FROM participacoes WHERE conversa_id = ? AND identificador_id = ?')
    .get(conversaId, identificadorId) as { ok: number } | undefined;
  return linha !== undefined;
}

export function anexoJaExiste(acervo: Acervo, mensagemId: MensagemId): boolean {
  const linha = acervo.preparar('SELECT 1 AS ok FROM anexos WHERE mensagem_id = ?')
    .get(mensagemId) as { ok: number } | undefined;
  return linha !== undefined;
}
