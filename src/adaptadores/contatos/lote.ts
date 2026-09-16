import type { Acervo } from '../../nucleo/acervo.js';
import {
  aplicarConjunto,
  desfazerAplicacao,
  type ResultadoDaAplicacao,
} from '../../nucleo/aplicacao.js';
import type { Proposta, ProdutorDeProposta } from './propostas.js';
import { emOperacao } from '../../nucleo/trilha.js';

/**
 * O lote e `aplicarConjunto` em laco. Atomico POR PROPOSTA: uma recusa nao
 * aborta as demais, e o relatorio diz quantas entraram e por que as outras
 * ficaram de fora.
 */

export interface OpcoesDoLote {
  produtor?: ProdutorDeProposta;
  quando?: number;
}

export interface RelatorioDoLote {
  propostasVistas: number;
  aplicadas: number;
  vinculosCriados: number;
  mesclagensFeitas: number;
  pessoasCriadas: number;
  preservadoPorProcedencia: number;
  recusadoPorConflito: number;
  motivosPorCausa: Record<string, number>;
  /** O que desfazer consome. Nao ha tabela de lote: a lista e a memoria. */
  feito: ResultadoDaAplicacao[];
}

export function aplicarLote(
  acervo: Acervo,
  propostas: Proposta[],
  opcoes: OpcoesDoLote = {},
): RelatorioDoLote {
  // UMA Operacao para o lote inteiro. Medido em 29/08/2026 contra material
  // real: sem este envoltorio, 922 Propostas gravavam 3.102 Operacoes — uma
  // por vinculo e uma por Pessoa criada —, e desfazer o lote exigia desfazer
  // 3.102 coisas. A reentrancia junta tudo numa so; o savepoint do caminho
  // aninhado garante que a Proposta recusada nao deixe linha de efeito de um
  // trabalho que foi revertido.
  return emOperacao(
    acervo,
    { natureza: 'aplicar-propostas', reversibilidade: 'por-efeito' },
    () => aplicarLoteInterno(acervo, propostas, opcoes),
  );
}

function aplicarLoteInterno(
  acervo: Acervo,
  propostas: Proposta[],
  opcoes: OpcoesDoLote = {},
): RelatorioDoLote {
  const r: RelatorioDoLote = {
    propostasVistas: 0,
    aplicadas: 0,
    vinculosCriados: 0,
    mesclagensFeitas: 0,
    pessoasCriadas: 0,
    preservadoPorProcedencia: 0,
    recusadoPorConflito: 0,
    motivosPorCausa: {},
    feito: [],
  };

  for (const p of propostas) {
    if (opcoes.produtor !== undefined && p.produtor !== opcoes.produtor) continue;
    r.propostasVistas += 1;
    // UMA Configuracao vira declaracao no vinculo; duas ou mais viram silencio,
    // que e a verdade: nao ha uma base que sustente o que atravessa duas.
    const unica = p.configuracoes.length === 1 ? p.configuracoes[0] : undefined;
    const feito = aplicarConjunto(acervo, p.identificadores, {
      ...(opcoes.quando !== undefined ? { quando: opcoes.quando } : {}),
      ...(unica !== undefined ? { configuracaoId: unica } : {}),
    });
    r.preservadoPorProcedencia += feito.preservadoPorProcedencia;
    r.recusadoPorConflito += feito.recusadoPorConflito;
    if (feito.motivo !== null) {
      // Chave e a CAUSA, nunca a mensagem: mensagem de erro carrega UUID, e
      // cem recusas iguais virariam cem linhas distintas no relatorio.
      r.motivosPorCausa[feito.motivo] = (r.motivosPorCausa[feito.motivo] ?? 0) + 1;
    }
    if (feito.vinculos.length === 0 && feito.mesclagens.length === 0) continue;
    r.aplicadas += 1;
    r.vinculosCriados += feito.vinculos.length;
    r.mesclagensFeitas += feito.mesclagens.length;
    r.pessoasCriadas += feito.pessoasCriadas.length;
    r.feito.push(feito);
  }
  return r;
}

/** Desfaz na ordem inversa da aplicacao. */
export function desfazerLote(
  acervo: Acervo,
  relatorio: RelatorioDoLote,
  opcoes: { quando?: number } = {},
): void {
  for (const feito of [...relatorio.feito].reverse()) {
    desfazerAplicacao(acervo, feito, opcoes);
  }
}
