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
 * A janela, a FRENTE do relógio local, que a recepção ao vivo tolera (#1204).
 *
 * Ao vivo a Mensagem chega agora, e o instante dela é o que o APARELHO de quem enviou declarou, em segundos:
 * relógio de celular um pouco adiantado, ou um evento que chega antes do segundo cheio, e a guarda recusava
 * "instante no futuro". Medido em 13 e 14/10/2026: de 27 eventos ao vivo, 2 vieram à frente do relógio, por 147 ms e
 * 168 ms (os dois do mesmo aparelho), e foram recusados; em produção, 0 recusas em 3 dias e o relógio do host
 * sincronizado por NTP (desvio de 69 ms). 5 s cobre o medido com folga de 30 vezes e só mistura a ordem da Conversa
 * com Mensagens de até 5 s depois. É CONSTANTE, e não variável de ambiente: uma por instalação abriria uma
 * divergência que ninguém mede. Só a recepção ao vivo a passa; na importação o futuro é dado ruim.
 */
export const TOLERANCIA_DE_RELOGIO_AO_VIVO_MS = 5_000;

/**
 * Devolve o motivo da rejeição, ou null quando o instante é plausível.
 * Motivo distinto por causa: o relatório de importação contabiliza por motivo,
 * e "rejeitada" sem causa não diz o que fazer a respeito.
 *
 * `toleranciaMs` é a folga PARA A FRENTE do relógio (padrão zero: quem não a passa mantém o limite de sempre). Ela
 * nunca mexe no início da Fonte.
 */
export function motivoDaRejeicao(
  fonte: Fonte,
  instante: number,
  agora: number,
  toleranciaMs = 0,
): string | null {
  if (!Number.isFinite(instante)) {
    return 'instante ausente ou nao numerico';
  }
  if (instante < INICIO_DA_FONTE[fonte]) {
    return `instante anterior ao inicio da Fonte ${fonte}`;
  }
  if (instante > agora + toleranciaMs) {
    return 'instante no futuro';
  }
  return null;
}

export function ehInstantePlausivel(fonte: Fonte, instante: number, agora: number, toleranciaMs = 0): boolean {
  return motivoDaRejeicao(fonte, instante, agora, toleranciaMs) === null;
}
