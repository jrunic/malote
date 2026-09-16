import type { Acervo } from './acervo.js';
import { emOperacao } from './trilha.js';

/**
 * MARCA DO TITULAR — o que o dono da conta destacou.
 *
 * Objeto de valor pendurado em Conversa ou em Mensagem, nunca entidade com
 * historico proprio: nenhuma Fonte medida entrega o evento de DESMARCACAO,
 * entao guardar historico seria guardar metade dele.
 *
 * SAO DOIS VERBOS, e a diferenca entre eles e a Natureza do Material:
 *
 *   - `marcarConversa` ACRESCENTA. E o que uma atualizacao de um item
 *     autoriza: ela diz algo sobre aquele item e NADA sobre os outros.
 *   - `reconciliarPorRetrato` SUBSTITUI O CONJUNTO. So o Retrato de Estado
 *     autoriza isso, porque so ele permite concluir ausencia.
 *
 * Confundir os dois nao custa um campo errado: custa DESMARCAR O ACERVO
 * INTEIRO no primeiro evento de rotina. Medido em 13/09/2026 no log de
 * producao: em seis dias chegaram 8.415 atualizacoes de rotina e UM Retrato.
 */
export const MARCAS_DE_CONVERSA = ['fixada'] as const;
export type MarcaDeConversa = (typeof MARCAS_DE_CONVERSA)[number];

export const MARCAS_DE_MENSAGEM = ['favorito'] as const;
export type MarcaDeMensagem = (typeof MARCAS_DE_MENSAGEM)[number];

export interface EntradaDeMarcaDeConversa {
  conversaId: string;
  marca: MarcaDeConversa;
  /**
   * Sob qual conta o Titular marcou. NAO e redundante com a Configuracao da
   * Conversa: coletiva e compartilhada entre Configuracoes desde o ciclo 14.
   */
  configuracaoId: string;
  observadaEm: number;
}

export interface EntradaDeMarcaDeMensagem {
  mensagemId: string;
  marca: MarcaDeMensagem;
  configuracaoId: string;
  observadaEm: number;
}

/**
 * Acrescenta. NAO desmarca nada.
 *
 * Devolve `true` so quando a marca NASCEU. Reobservar a mesma marca atualiza o
 * instante e devolve `false`: quem conta "quantas marquei" nao pode contar de
 * novo o que ja estava marcado — mesmo criterio da porta de nome.
 */
export function marcarConversa(acervo: Acervo, e: EntradaDeMarcaDeConversa): boolean {
  return emOperacao(acervo, { natureza: 'marcar', reversibilidade: 'por-efeito' }, (op) => {
    // O `antes` e LIDO, nao presumido nulo: o upsert tambem passa por aqui
    // atualizando linha que ja existia, e gravar `antes: null` ali faria
    // desfazer APAGAR a marca em vez de restaurar o instante anterior.
    const linha = acervo
      .preparar(
        `SELECT observada_em FROM marcas_de_conversa
          WHERE conversa_id = ? AND marca = ? AND configuracao_id = ?`,
      )
      .get(e.conversaId, e.marca, e.configuracaoId) as { observada_em: number } | undefined;
    const anterior = linha === undefined ? null : String(linha.observada_em);

    acervo
      .preparar(
        `INSERT INTO marcas_de_conversa (conversa_id, marca, configuracao_id, observada_em)
              VALUES (?, ?, ?, ?)
         ON CONFLICT (conversa_id, marca, configuracao_id)
           DO UPDATE SET observada_em = excluded.observada_em`,
      )
      .run(e.conversaId, e.marca, e.configuracaoId, e.observadaEm);

    op.valor({
      tabela: 'marcas_de_conversa',
      chave: `${e.conversaId}|${e.marca}|${e.configuracaoId}`,
      campo: 'observada_em',
      antes: anterior,
      depois: String(e.observadaEm),
    });
    return anterior === null;
  });
}

export function desmarcarConversa(acervo: Acervo, e: EntradaDeMarcaDeConversa): boolean {
  return emOperacao(acervo, { natureza: 'marcar', reversibilidade: 'por-efeito' }, (op) => {
    const linha = acervo
      .preparar(
        `SELECT observada_em FROM marcas_de_conversa
          WHERE conversa_id = ? AND marca = ? AND configuracao_id = ?`,
      )
      .get(e.conversaId, e.marca, e.configuracaoId) as { observada_em: number } | undefined;
    if (linha === undefined) return false;
    acervo
      .preparar(
        `DELETE FROM marcas_de_conversa
          WHERE conversa_id = ? AND marca = ? AND configuracao_id = ?`,
      )
      .run(e.conversaId, e.marca, e.configuracaoId);
    op.valor({
      tabela: 'marcas_de_conversa',
      chave: `${e.conversaId}|${e.marca}|${e.configuracaoId}`,
      campo: 'presente',
      antes: '1',
      depois: null,
    });
    return true;
  });
}

export interface RetratoDeMarcas {
  marca: MarcaDeConversa;
  configuracaoId: string;
  /** O conjunto COMPLETO de marcadas neste instante, para esta Configuracao. */
  marcadas: readonly string[];
  observadaEm: number;
}

/**
 * Substitui o conjunto. SO o Retrato de Estado pode chamar isto.
 *
 * O escopo da substituicao e (marca, Configuracao) — nunca o acervo todo. Um
 * Retrato da conta A nao afirma nada sobre a conta B, e sem esse recorte
 * bastaria uma conta sincronizar para apagar as marcas da outra.
 */
export function reconciliarPorRetrato(acervo: Acervo, r: RetratoDeMarcas): void {
  emOperacao(acervo, { natureza: 'reconciliar-marcas', reversibilidade: 'por-efeito' }, (op) => {
    const antes = conversasMarcadas(acervo, {
      marca: r.marca,
      configuracaoId: r.configuracaoId,
    });
    const agora = new Set(r.marcadas);

    for (const id of antes) {
      if (agora.has(id)) continue;
      acervo
        .preparar(
          `DELETE FROM marcas_de_conversa
            WHERE conversa_id = ? AND marca = ? AND configuracao_id = ?`,
        )
        .run(id, r.marca, r.configuracaoId);
      op.valor({
        tabela: 'marcas_de_conversa',
        chave: `${id}|${r.marca}|${r.configuracaoId}`,
        campo: 'presente',
        antes: '1',
        depois: null,
      });
    }

    for (const id of r.marcadas) {
      marcarConversa(acervo, {
        conversaId: id,
        marca: r.marca,
        configuracaoId: r.configuracaoId,
        observadaEm: r.observadaEm,
      });
    }
  });
}

export function conversasMarcadas(
  acervo: Acervo,
  filtro: { marca: MarcaDeConversa; configuracaoId: string },
): string[] {
  return (
    acervo
      .preparar(
        `SELECT conversa_id FROM marcas_de_conversa
          WHERE marca = ? AND configuracao_id = ?
          ORDER BY conversa_id`,
      )
      .all(filtro.marca, filtro.configuracaoId) as Array<{ conversa_id: string }>
  ).map((l) => l.conversa_id);
}

/**
 * O par para Mensagem. NAO ganha reconciliacao por Retrato, e a ausencia e
 * medida: nenhuma Fonte entrega retrato de favorito. O material entrega o
 * estado de cada Mensagem, uma a uma, e o caminho ao vivo nao entrega nada —
 * zero ocorrencias em 604 eventos de atualizacao de mensagem, em seis dias.
 */
export function marcarMensagem(acervo: Acervo, e: EntradaDeMarcaDeMensagem): boolean {
  return emOperacao(acervo, { natureza: 'marcar', reversibilidade: 'por-efeito' }, (op) => {
    const linha = acervo
      .preparar(
        `SELECT observada_em FROM marcas_de_mensagem
          WHERE mensagem_id = ? AND marca = ? AND configuracao_id = ?`,
      )
      .get(e.mensagemId, e.marca, e.configuracaoId) as { observada_em: number } | undefined;
    const anterior = linha === undefined ? null : String(linha.observada_em);

    acervo
      .preparar(
        `INSERT INTO marcas_de_mensagem (mensagem_id, marca, configuracao_id, observada_em)
              VALUES (?, ?, ?, ?)
         ON CONFLICT (mensagem_id, marca, configuracao_id)
           DO UPDATE SET observada_em = excluded.observada_em`,
      )
      .run(e.mensagemId, e.marca, e.configuracaoId, e.observadaEm);

    op.valor({
      tabela: 'marcas_de_mensagem',
      chave: `${e.mensagemId}|${e.marca}|${e.configuracaoId}`,
      campo: 'observada_em',
      antes: anterior,
      depois: String(e.observadaEm),
    });
    return anterior === null;
  });
}

export function desmarcarMensagem(acervo: Acervo, e: EntradaDeMarcaDeMensagem): boolean {
  return emOperacao(acervo, { natureza: 'marcar', reversibilidade: 'por-efeito' }, (op) => {
    const linha = acervo
      .preparar(
        `SELECT observada_em FROM marcas_de_mensagem
          WHERE mensagem_id = ? AND marca = ? AND configuracao_id = ?`,
      )
      .get(e.mensagemId, e.marca, e.configuracaoId) as { observada_em: number } | undefined;
    if (linha === undefined) return false;
    acervo
      .preparar(
        `DELETE FROM marcas_de_mensagem
          WHERE mensagem_id = ? AND marca = ? AND configuracao_id = ?`,
      )
      .run(e.mensagemId, e.marca, e.configuracaoId);
    op.valor({
      tabela: 'marcas_de_mensagem',
      chave: `${e.mensagemId}|${e.marca}|${e.configuracaoId}`,
      campo: 'presente',
      antes: '1',
      depois: null,
    });
    return true;
  });
}

export function mensagensMarcadas(
  acervo: Acervo,
  filtro: { marca: MarcaDeMensagem; configuracaoId: string },
): string[] {
  return (
    acervo
      .preparar(
        `SELECT mensagem_id FROM marcas_de_mensagem
          WHERE marca = ? AND configuracao_id = ?
          ORDER BY mensagem_id`,
      )
      .all(filtro.marca, filtro.configuracaoId) as Array<{ mensagem_id: string }>
  ).map((l) => l.mensagem_id);
}
