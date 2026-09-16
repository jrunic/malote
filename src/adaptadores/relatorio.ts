/**
 * O relatório de importação é contrato COMPARTILHADO entre adaptadores —
 * um formato só, para que o Titular leia a mesma coisa venha de onde vier.
 */
export interface RelatorioDeImportacao {
  conversasCriadas: number;
  mensagensLidas: number;
  mensagensCriadas: number;
  mensagensJaExistentes: number;
  mensagensRejeitadas: number;
  /** Contagem por causa. "Rejeitada" sem motivo não diz o que fazer. */
  rejeicoesPorMotivo: Record<string, number>;
  /**
   * O que o LEITOR descartou, por motivo — separado das rejeicoes.
   *
   * Sao fenomenos diferentes e juntar os dois esconderia qual esta
   * acontecendo: rejeicao e decisao da importacao sobre uma linha que chegou
   * ate ela; descarte e a leitura constatando que o material se contradiz —
   * linha que aponta para Conversa que nao existe no proprio arquivo.
   *
   * Ate 12/09/2026 esses descartes eram MUDOS, e o criterio 18 — nada some sem
   * registro — estava quebrado por 99 Mensagens nos dois materiais reais.
   */
  descartesDoLeitor: Record<string, number>;
  /**
   * Linhas que o MATERIAL repetia pelo mesmo identificador. Nao ha perda — elas
   * colapsam na unicidade do Acervo —, mas sem este numero elas engordam
   * `mensagensJaExistentes` e o relatorio afirma que ja estavam no acervo.
   */
  linhasRepetidasNoMaterial: number;
  /**
   * Nomes que a Fonte entregou e que apenas repetiam o PROPRIO endereco.
   *
   * Contado, nunca silencioso: a plataforma preenche o campo de nome com o
   * numero quando nao ha contato cadastrado, e recusar sem contar faria a
   * diferenca entre 'ninguem tem nome' e 'o produto descartou' desaparecer.
   */
  nomesQueRepetemOEndereco: number;
  /**
   * Marcas do Titular que NASCERAM nesta passagem — Mensagem favoritada.
   *
   * Conta as que nasceram, nao as que o material declara: reimportar o mesmo
   * material tem de devolver zero na segunda vez, senao o numero vira a
   * contagem do material e nao a do efeito.
   */
  favoritos: number;
  anexosCriados: number;
  /**
   * Criado e ja existente andam em PAR nas quatro grandezas. Sem o par, uma
   * rodada recorrente reporta como nova a Conversa que ja estava no Acervo —
   * defeito real do adaptador de WhatsApp desde o ciclo 2.
   */
  /**
   * Verdadeiro quando o Material ja tinha entrado e a passagem foi PULADA.
   * Distingue "rodada sem efeito" de "rodada sem material" — sem isso, as duas
   * sao indistinguiveis para quem opera.
   */
  jaRegistrado: boolean;
  conversasJaExistentes: number;
  /**
   * Pares de endereco em que o material se contradisse.
   *
   * Achado, nao erro: a primeira correspondencia permanece e a importacao
   * segue. Zero e o normal; numero alto e sinal de material inconsistente.
   */
  conflitosDeEndereco: number;
  anexosJaExistentes: number;
  participacoesCriadas: number;
  /** Transicoes que NASCERAM nesta execucao. Reimportar nao as recontabiliza. */
  transicoesCriadas: number;
  /** Codigo de evento nao classificado -> quantas vezes apareceu. */
  eventosDesconhecidos: Record<string, number>;
  /**
   * Participantes de Conversa coletiva que a Fonte declara ativos e inativos.
   * Conversa direta nao entra: la nao ha roster, e ninguem declara nada.
   */
  participantesAtivos: number;
  participantesInativos: number;
  participacoesJaExistentes: number;
  /**
   * Registros indistinguíveis desempatados por ordinal. Contado porque a
   * alternativa — colapsar os dois numa Mensagem — perde acervo em silêncio.
   * Medido em 26/08/2026: zero em 30.496 mensagens de material real.
   */
  colisoesDesempatadas: number;
  /** Conversas por caixa do material. Nomes de caixa são do adaptador. */
  conversasPorCaixa: Record<string, number>;
  /** Diretórios de Conversa observados sem arquivo de mensagem algum. */
  conversasSemArquivo: number;
}

export function relatorioVazio(): RelatorioDeImportacao {
  return {
    conversasCriadas: 0,
    mensagensLidas: 0,
    mensagensCriadas: 0,
    mensagensJaExistentes: 0,
    mensagensRejeitadas: 0,
    rejeicoesPorMotivo: {},
    descartesDoLeitor: {},
    linhasRepetidasNoMaterial: 0,
    nomesQueRepetemOEndereco: 0,
    favoritos: 0,
    anexosCriados: 0,
    jaRegistrado: false,
    conversasJaExistentes: 0,
    conflitosDeEndereco: 0,
    anexosJaExistentes: 0,
    participacoesCriadas: 0,
    transicoesCriadas: 0,
    eventosDesconhecidos: {},
    participantesAtivos: 0,
    participantesInativos: 0,
    participacoesJaExistentes: 0,
    colisoesDesempatadas: 0,
    conversasPorCaixa: {},
    conversasSemArquivo: 0,
  };
}

export function contarRejeicao(relatorio: RelatorioDeImportacao, motivo: string): void {
  relatorio.mensagensRejeitadas += 1;
  relatorio.rejeicoesPorMotivo[motivo] = (relatorio.rejeicoesPorMotivo[motivo] ?? 0) + 1;
}
