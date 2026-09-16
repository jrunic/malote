import type { InquilinoId } from '../nucleo/tipos.js';
import type { Registro } from './registro.js';
import { emOperacao } from '../nucleo/trilha.js';

/**
 * Padrao DECLARADO, nao escondido no codigo de derivacao: catalogo de
 * contatos acima do material, porque o nome que a pessoa escolheu para o
 * contato vale mais que o nome de exibicao da plataforma. O Titular troca.
 */
export const PRECEDENCIA_PADRAO: Record<string, number> = {
  manual: 300,
  contatos: 200,
  whatsapp: 100,
  instagram: 100,
};

/**
 * A precedencia completa: peso por FONTE, e o catalogo preferido DENTRO de
 * `contatos`.
 *
 * Dois niveis, e nao um mapa maior, por uma razao medida: `melhorNome` faz
 * lookup EXATO por origem, e origem e a Fonte. Gravar a Configuracao colada na
 * origem faria o nome de catalogo cair para peso ZERO — abaixo do whatsapp,
 * inclusive para as atribuicoes ja gravadas. O nivel 1 fica intocado, e o 2 so
 * desempata quando os pesos empatam.
 */
export interface PrecedenciaDeNome {
  /** Peso por Fonte. O nivel 1, e o que faz catalogo ficar acima de plataforma. */
  porOrigem: Record<string, number>;
  /** Configuracao de catalogo preferida. Nulo = desempate por recencia. */
  catalogoPreferido: string | null;
}

export function definirCatalogoPreferido(
  registro: Registro,
  inquilinoId: InquilinoId,
  configuracaoId: string,
): void {
  const dono = registro
    .preparar('SELECT inquilino_id FROM configuracoes_de_adaptador WHERE id = ?')
    .get(configuracaoId) as { inquilino_id: string } | undefined;
  if (dono === undefined) throw new Error(`Configuracao desconhecida: ${configuracaoId}`);
  if (dono.inquilino_id !== inquilinoId) {
    throw new Error(`A Configuracao ${configuracaoId} nao e deste Inquilino.`);
  }

  const antes = registro
    .preparar('SELECT configuracao_id FROM catalogos_preferidos WHERE inquilino_id = ?')
    .get(inquilinoId) as { configuracao_id: string } | undefined;

  emOperacao(
    registro,
    { natureza: 'definir-catalogo-preferido', reversibilidade: 'por-efeito', inquilinoId },
    (op) => {
      registro
        .preparar(
          `INSERT INTO catalogos_preferidos (inquilino_id, configuracao_id, definido_em)
           VALUES (?, ?, ?)
           ON CONFLICT (inquilino_id) DO UPDATE SET
             configuracao_id = excluded.configuracao_id,
             definido_em = excluded.definido_em`,
        )
        .run(inquilinoId, configuracaoId, new Date().toISOString());

      if (antes?.configuracao_id !== configuracaoId) {
        op.valor({
          tabela: 'catalogos_preferidos',
          chave: inquilinoId,
          campo: 'configuracao_id',
          antes: antes?.configuracao_id ?? null,
          depois: configuracaoId,
        });
      }
    },
  );
}

export function definirPrecedenciaDeNome(
  registro: Registro,
  inquilinoId: InquilinoId,
  origem: string,
  peso: number,
): void {
  const existe = registro.preparar('SELECT 1 AS ok FROM inquilinos WHERE id = ?').get(inquilinoId) as
    | { ok: number }
    | undefined;
  if (existe === undefined) throw new Error(`Inquilino desconhecido: ${inquilinoId}`);

  const antes = registro.preparar('SELECT peso FROM precedencias_de_nome WHERE inquilino_id = ? AND origem = ?')
    .get(inquilinoId, origem) as { peso: number } | undefined;

  emOperacao(
    registro,
    { natureza: 'definir-precedencia', reversibilidade: 'por-efeito', inquilinoId },
    (op) => {
      registro.preparar(
          `INSERT INTO precedencias_de_nome (inquilino_id, origem, peso, definida_em)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (inquilino_id, origem) DO UPDATE SET
             peso = excluded.peso, definida_em = excluded.definida_em`,
        )
        .run(inquilinoId, origem, peso, new Date().toISOString());

      // Chave composta vira chave composta na trilha: a linha e identificada
      // por (Inquilino, origem), e so o par a acha de volta.
      if (antes?.peso !== peso) {
        op.valor({
          tabela: 'precedencias_de_nome',
          chave: `${inquilinoId}:${origem}`,
          campo: 'peso',
          antes: antes === undefined ? null : String(antes.peso),
          depois: String(peso),
        });
      }
    },
  );
}

/** O padrao vale para toda origem que o Inquilino nao redefiniu. */
export function lerPrecedenciasDeNome(
  registro: Registro,
  inquilinoId: InquilinoId,
): PrecedenciaDeNome {
  const linhas = registro.preparar('SELECT origem, peso FROM precedencias_de_nome WHERE inquilino_id = ?')
    .all(inquilinoId) as Array<{ origem: string; peso: number }>;

  const porOrigem: Record<string, number> = { ...PRECEDENCIA_PADRAO };
  for (const l of linhas) porOrigem[l.origem] = l.peso;

  const preferido = registro
    .preparar('SELECT configuracao_id FROM catalogos_preferidos WHERE inquilino_id = ?')
    .get(inquilinoId) as { configuracao_id: string } | undefined;

  return { porOrigem, catalogoPreferido: preferido?.configuracao_id ?? null };
}
