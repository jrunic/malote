import type { Registro } from './registro.js';
import { emOperacao } from '../nucleo/trilha.js';

/**
 * Cada quanto tempo se espera que chegue Material novo para uma Configuração.
 *
 * É opcional de propósito: sem declaração não há atraso possível, e a ausência
 * de intervalo nunca vira alarme. Exigi-lo faria toda Configuração recém-criada
 * nascer alarmando, cobrando uma previsão que ninguém tem no primeiro dia.
 */

export interface IntervaloEsperado {
  dias: number;
  declaradoEm: string;
}

export function definirIntervaloEsperado(
  registro: Registro,
  configuracaoId: string,
  dias: number,
): void {
  if (!Number.isInteger(dias) || dias <= 0) {
    throw new Error(`Intervalo esperado precisa ser inteiro de dias maior que zero: ${dias}`);
  }
  const existe = registro.preparar('SELECT 1 AS ok FROM configuracoes_de_adaptador WHERE id = ?')
    .get(configuracaoId) as { ok: number } | undefined;
  if (existe === undefined) throw new Error(`Configuracao desconhecida: ${configuracaoId}`);

  // O Inquilino nao e parametro desta funcao — ela recebe a Configuracao.
  // Resolver antes, para que a Operacao saiba de quem e.
  const dono = registro.preparar('SELECT inquilino_id FROM configuracoes_de_adaptador WHERE id = ?')
    .get(configuracaoId) as { inquilino_id: string } | undefined;

  const antes = registro.preparar('SELECT dias FROM intervalos_esperados WHERE configuracao_id = ?')
    .get(configuracaoId) as { dias: number } | undefined;

  emOperacao(
    registro,
    {
      natureza: 'definir-intervalo',
      reversibilidade: 'por-efeito',
      ...(dono !== undefined ? { inquilinoId: dono.inquilino_id } : {}),
    },
    (op) => {
      registro.preparar(
          `INSERT INTO intervalos_esperados (configuracao_id, dias, declarado_em)
           VALUES (?, ?, ?)
           ON CONFLICT (configuracao_id) DO UPDATE SET
             dias = excluded.dias, declarado_em = excluded.declarado_em`,
        )
        .run(configuracaoId, dias, new Date().toISOString());

      if (antes?.dias !== dias) {
        op.valor({
          tabela: 'intervalos_esperados',
          chave: configuracaoId,
          campo: 'dias',
          antes: antes === undefined ? null : String(antes.dias),
          depois: String(dias),
        });
      }
    },
  );
}

export function lerIntervaloEsperado(
  registro: Registro,
  configuracaoId: string,
): IntervaloEsperado | null {
  const l = registro.preparar('SELECT dias, declarado_em FROM intervalos_esperados WHERE configuracao_id = ?')
    .get(configuracaoId) as { dias: number; declarado_em: string } | undefined;
  return l === undefined ? null : { dias: l.dias, declaradoEm: l.declarado_em };
}
