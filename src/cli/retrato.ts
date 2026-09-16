import { readFileSync, writeFileSync } from 'node:fs';

/**
 * O instante do ultimo RETRATO DE ESTADO recebido.
 *
 * Por que isto existe: a fixacao de Conversa so chega num Retrato, e o Retrato
 * chega quando a plataforma decide. Medido em 13/09/2026, em nove dias: tres
 * tentativas de ressincronizacao e UM retrato completo. Reiniciar o processo
 * NAO o provoca — mais de dez reinicios, um retrato.
 *
 * Sem este campo, "nenhuma Conversa fixada" e "o retrato nao veio" viram a
 * mesma resposta, e a segunda e a unica em que nao se pode concluir nada.
 *
 * FORA do Acervo, como o instante do ultimo evento e a serie de
 * correspondencia: ler nao pode exigir abrir a base, porque abrir para escrita
 * MIGRA, e o verificador da frota roda de minuto em minuto.
 *
 * O produto CONTA e EXPOE; quem compara com a linha de base e alarma e o vigia
 * da frota — ADR 20260912-produto-mede-frota-alarma.
 */
export interface UltimoRetrato {
  /** Instante ISO em que o Retrato chegou. */
  em: string;
  /**
   * Quantos itens ele trouxe. Guardado JUNTO do instante porque o piso que
   * classifica o evento pode mudar: sem a contagem, uma release futura que
   * afrouxe o piso nao tem como ser auditada contra o que ja foi anotado.
   */
  itens: number;
}

/**
 * Piso de itens para um evento de estado contar como Retrato.
 *
 * Medido no log de producao: o unico Retrato trouxe 2.674 itens; TODA
 * atualizacao observada trouxe 1 ou 2. Trinta esta uma ordem de grandeza acima
 * do ruido e duas abaixo do sinal.
 */
export const PISO_DE_RETRATO = 30;

/**
 * REGUA PROVISORIA, e a provisoriedade e escolha, nao descuido.
 *
 * A chave de estado sozinha NAO discrimina: dos eventos com a chave de
 * arquivamento, um trouxe 2.674 itens e dois trouxeram um item cada. E fixar
 * uma Conversa no aparelho emite um evento de um item COM a chave de fixacao.
 *
 * O custo de errar aqui e assimetrico, e e o que autoriza usar regua medida em
 * uma amostra: este predicado so decide um CONTADOR — errar mente sobre um
 * instante, para um vigia que compara series. A RECONCILIACAO de marcas usa
 * outro predicado, cravado depois da captura, porque errar la desmarca o
 * acervo.
 */
export function pareceRetrato(chaves: readonly string[], itens: number): boolean {
  const falaDeEstado = chaves.includes('pinned') || chaves.includes('archived');
  return falaDeEstado && itens >= PISO_DE_RETRATO;
}

export function anotarRetrato(caminho: string, retrato: UltimoRetrato): void {
  try {
    writeFileSync(caminho, JSON.stringify(retrato));
  } catch {
    // Perder a anotacao de vigilancia e barato; perder Mensagem porque o
    // processo caiu escrevendo um arquivo de diagnostico nao e.
  }
}

/**
 * O que esta gravado, ou `null`. Arquivo ausente OU corrompido le como ausente
 * e NAO lanca: o consumidor e o ouvinte de producao, que roda por meses.
 */
export function lerUltimoRetrato(caminho: string): UltimoRetrato | null {
  try {
    const lido: unknown = JSON.parse(readFileSync(caminho, 'utf8'));
    if (lido === null || typeof lido !== 'object') return null;
    const r = lido as Partial<UltimoRetrato>;
    if (typeof r.em !== 'string' || typeof r.itens !== 'number') return null;
    return { em: r.em, itens: r.itens };
  } catch {
    return null;
  }
}
