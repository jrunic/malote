/**
 * Tipos do domínio compartilhados pelo núcleo.
 * Vocabulário do GLOSSARIO.md — pt-BR, sem acento em identificador.
 */

/** Plataforma de origem de uma Conversa ou de um Identificador. */
export const FONTES = ['whatsapp', 'instagram', 'contatos'] as const;
export type Fonte = (typeof FONTES)[number];

export function ehFonte(valor: string): valor is Fonte {
  return (FONTES as readonly string[]).includes(valor);
}

/**
 * Estado do arquivo de um Anexo em disco.
 * `rebaixado` NÃO existe: nenhuma operação o produz, e estado que ninguém
 * gera é afirmação falsa de capacidade. Entra quando o rebaixamento entrar.
 */
export const PRESENCAS = ['presente', 'nunca-obtido', 'descartado'] as const;
export type Presenca = (typeof PRESENCAS)[number];

/**
 * Quem afirmou o vinculo entre um Identificador e uma Pessoa.
 * A ordem e total e e o que impede execucao automatica de desfazer correcao
 * humana: `humano` vence `catalogo`, que vence `material`.
 *
 * Nao confundir com a Referencia Externa, que marca de onde veio a Conversa
 * ou a Mensagem. Esta e a Procedencia do VINCULO.
 */
export const PROCEDENCIAS_DE_VINCULO = ['material', 'catalogo', 'humano'] as const;
export type ProcedenciaDeVinculo = (typeof PROCEDENCIAS_DE_VINCULO)[number];

export const PESO_DA_PROCEDENCIA: Record<ProcedenciaDeVinculo, number> = {
  material: 1,
  catalogo: 2,
  humano: 3,
};

/** Identificador interno, atribuído pelo malote — nunca o id da Fonte. */
export type InquilinoId = string;
export type ConversaId = string;
export type MensagemId = string;
export type PessoaId = string;

/** O par que amarra uma entidade ao que ela é na origem. */
export interface ReferenciaExterna {
  fonte: Fonte;
  idExterno: string;
}

/**
 * O que uma Transicao de Participacao afirma. Par FECHADO de proposito:
 * renomear grupo, mudar descricao e afins nao sao Transicao, e admiti-los
 * como natureza faria a consulta de presenca ler evento que nao move ninguem.
 */
export type NaturezaDeTransicao = 'entrou' | 'saiu';
