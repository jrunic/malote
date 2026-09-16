import type { Fonte } from './tipos.js';

/**
 * Início da faixa de plausibilidade de cada Fonte, em milissegundos.
 * Não é a data de fundação da empresa: é quando aquela Fonte passou a poder
 * produzir a mensagem que estamos importando.
 */
export const INICIO_DA_FONTE: Record<Fonte, number> = {
  whatsapp: Date.parse('2009-01-01T00:00:00Z'),
  instagram: Date.parse('2013-12-01T00:00:00Z'),
  contatos: Date.parse('2006-01-01T00:00:00Z'),
};

/**
 * Devolve o motivo da rejeição, ou null quando o instante é plausível.
 * Motivo distinto por causa: o relatório de importação contabiliza por motivo,
 * e "rejeitada" sem causa não diz o que fazer a respeito.
 */
export function motivoDaRejeicao(fonte: Fonte, instante: number, agora: number): string | null {
  if (!Number.isFinite(instante)) {
    return 'instante ausente ou nao numerico';
  }
  if (instante < INICIO_DA_FONTE[fonte]) {
    return `instante anterior ao inicio da Fonte ${fonte}`;
  }
  if (instante > agora) {
    return 'instante no futuro';
  }
  return null;
}

export function ehInstantePlausivel(fonte: Fonte, instante: number, agora: number): boolean {
  return motivoDaRejeicao(fonte, instante, agora) === null;
}
