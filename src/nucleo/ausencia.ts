import type { Acervo } from './acervo.js';
import { emOperacao } from './trilha.js';

/**
 * A Marca de Ausencia: o Cartao sumiu da origem, e isso fica dito sem que nada
 * seja removido.
 *
 * MARCA, NAO REMOVE. O Cartao continua legivel, o vinculo intacto e a
 * Atribuicao de Nome de pe — e reaparecer num material seguinte desfaz a marca,
 * atomico com o reavistamento, em `registrarCartaoDeCatalogo`.
 *
 * QUEM CHAMA E A VARREDURA, e so quando a Natureza do Material e `completo`. A
 * Natureza vive na Pasta de Entrada, e so quem varre a conhece: `malote
 * importar` manual NUNCA marca, mesmo com material completo na mao. Ler
 * ausencia como remocao num material parcial marcaria dado bom como sumido, em
 * silencio.
 *
 * O QUE ESTAVA PRESENTE NAO E PARAMETRO — e derivado do instante.
 *
 * A alternativa era o relatorio do catalogo devolver os ids dos cartoes vistos,
 * o que faria uma lista de milhares atravessar a fronteira entre adaptador e
 * varredura. Aqui nada atravessa: quem foi reavistado nesta passada tem o
 * instante DELA, porque o reavistamento o grava.
 *
 * O PRECO DISSO E UMA RESTRICAO, e ela e real: a varredura usa UM INSTANTE POR
 * PASSADA, compartilhado por todas as importacoes daquela Configuracao, e a
 * marcacao roda UMA VEZ AO FINAL. Marcar depois do primeiro de dois materiais
 * marcaria como ausente tudo o que so o segundo traz.
 */

/** Fracao de Cartoes ausentes acima da qual a marcacao recusa agir. */
export const LIMITE_PADRAO_DE_AUSENCIA = 0.2;

export class AusenciaDesproporcionalError extends Error {
  constructor(
    readonly configuracaoId: string,
    readonly ausentes: number,
    readonly total: number,
    readonly limite: number,
  ) {
    super(
      `${ausentes} de ${total} Cartoes sumiriam nesta passada ` +
        `(${Math.round((ausentes / total) * 100)}%), acima do limite de ` +
        `${Math.round(limite * 100)}%. Nada foi marcado. ` +
        'Material parcial declarado como completo e a causa mais provavel.',
    );
    this.name = 'AusenciaDesproporcionalError';
  }
}

export interface OpcoesDeMarcacao {
  configuracaoId: string;
  /**
   * O instante da passada. Cartao com `ultimo_avistamento` ANTERIOR a ele nao
   * veio neste material.
   */
  instanteDaPassada: string;
  /** Padrao `LIMITE_PADRAO_DE_AUSENCIA`. Declarado, nunca implicito. */
  limite?: number;
}

export interface ResultadoDaMarcacao {
  marcados: number;
  /** Cartoes vivos da Configuracao antes desta passada. */
  total: number;
}

export function marcarAusentes(acervo: Acervo, opcoes: OpcoesDeMarcacao): ResultadoDaMarcacao {
  const limite = opcoes.limite ?? LIMITE_PADRAO_DE_AUSENCIA;

  // Conta ANTES de escrever, para que a guarda decida sobre o mundo inteiro e
  // nao sobre o que sobrou depois de marcar metade.
  const total = (
    acervo
      .preparar(
        `SELECT COUNT(*) AS n FROM cartoes_de_catalogo
          WHERE configuracao_id = ? AND ausente_em IS NULL`,
      )
      .get(opcoes.configuracaoId) as { n: number }
  ).n;

  const sumiram = (
    acervo
      .preparar(
        `SELECT COUNT(*) AS n FROM cartoes_de_catalogo
          WHERE configuracao_id = ? AND ausente_em IS NULL AND ultimo_avistamento < ?`,
      )
      .get(opcoes.configuracaoId, opcoes.instanteDaPassada) as { n: number }
  ).n;

  if (sumiram === 0) return { marcados: 0, total };
  if (total > 0 && sumiram / total > limite) {
    throw new AusenciaDesproporcionalError(opcoes.configuracaoId, sumiram, total, limite);
  }

  // Envelope PROPRIO, e aqui ele e necessario: nada mais o abre nesta operacao.
  // `registraEfeito` fica LIGADO — a marca e reversivel por efeito, e o volume
  // e o numero de Cartoes que sumiram, nao o de Cartoes.
  return emOperacao(
    acervo,
    { natureza: 'marcar-ausentes', reversibilidade: 'por-efeito' },
    (op) => {
      const alvos = acervo
        .preparar(
          `SELECT identificador_id, cartao FROM cartoes_de_catalogo
            WHERE configuracao_id = ? AND ausente_em IS NULL AND ultimo_avistamento < ?`,
        )
        .all(opcoes.configuracaoId, opcoes.instanteDaPassada) as Array<{
        identificador_id: string;
        cartao: string;
      }>;

      const marcar = acervo.preparar(
        `UPDATE cartoes_de_catalogo SET ausente_em = ?
          WHERE identificador_id = ? AND cartao = ? AND configuracao_id = ?`,
      );
      for (const a of alvos) {
        marcar.run(opcoes.instanteDaPassada, a.identificador_id, a.cartao, opcoes.configuracaoId);
        op.valor({
          tabela: 'cartoes_de_catalogo',
          // Chave composta vira chave composta na trilha: so o trio acha a
          // linha de volta.
          chave: `${a.identificador_id}:${a.cartao}:${opcoes.configuracaoId}`,
          campo: 'ausente_em',
          antes: null,
          depois: opcoes.instanteDaPassada,
        });
      }
      return { marcados: alvos.length, total };
    },
  );
}
