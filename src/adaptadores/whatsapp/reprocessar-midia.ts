import type { Acervo } from '../../nucleo/acervo.js';
import { listarAnexosNuncaObtidosComBruto, type FiltroDeAnexosNuncaObtidos } from '../../nucleo/consulta.js';
import { gravarArquivoDeAnexo } from '../../nucleo/arquivo-de-anexo.js';
import { reconstituirMensagemParaRetry } from './retry-de-midia.js';
import { baixarMidiaReconstituida } from './conexao.js';

export interface RelatorioDeReprocessamento {
  recuperados: number;
  bytesRecuperados: number;
  falhas: number;
  /** bruto ausente, de outra Fonte, ou sem forma de recepcao ao vivo — #1084. */
  naoElegiveis: number;
  /** Os que tem forma de recepcao ao vivo dentro do recorte: o que o comando tentaria sem limite (#1248). */
  elegiveis: number;
  /** Quantos downloads foram de fato iniciados; no ensaio e sempre zero. */
  tentados: number;
  /** Elegiveis que ficaram sem tentativa porque o limite acabou. */
  foraDoLimite: number;
  /** So no ensaio: a contagem que decide o recorte, por tipo e por dia (UTC) da Mensagem. */
  ensaio?: {
    candidatos: number;
    tentaria: number;
    porTipo: Record<string, number>;
    porDia: Record<string, number>;
  };
}

export interface OpcoesDeReprocessamento {
  /** Injetavel para teste — por padrao, `baixarMidiaReconstituida` de verdade. */
  baixar?: (mensagem: unknown) => Promise<Buffer>;
  /** O recorte (#1248). A Fonte e sempre WhatsApp: este adaptador so reconstitui a forma dele. */
  filtro?: Omit<FiltroDeAnexosNuncaObtidos, 'fonte'>;
  /** Teto de TENTATIVAS, nao de sucessos. Sem ele, tenta todos os elegiveis. */
  limite?: number;
  /** So conta: nao baixa, nao escreve no Acervo, nao cria arquivo. */
  ensaio?: boolean;
}

/**
 * Tenta de novo o download dos Anexos `nunca-obtido` recebidos ao vivo — #1084.
 *
 * A causa original da falha (ETIMEDOUT, bad decrypt, o que for) NAO decide
 * elegibilidade: medido em 29-30/09/2026 contra dois Anexos reais de
 * producao, o retry INVERTEU a expectativa — o que falhara por timeout de
 * rede (candidato "facil") falhou de novo, e o que falhara com "bad decrypt"
 * (candidato "dificil") baixou com sucesso. Por isso o laco tenta TODOS os
 * elegiveis, sem filtrar por motivo anterior.
 *
 * O recorte (#1248) escolhe QUAIS, nao decide por causa de falha anterior: a regra acima segue valendo dentro dele.
 * A ordem e a da Mensagem mais antiga para a mais nova, que e a que o endereco da midia vence primeiro; o limite conta
 * tentativas, e o que nao e elegivel nunca ocupa uma vaga.
 *
 * Catch POR ITEM, nunca propaga: a falha de um Anexo nao pode custar os
 * demais, mesma disciplina do resto do adaptador (#1068, ao-vivo.ts).
 */
export async function reprocessarMidiaNuncaObtida(
  acervo: Acervo,
  destino: string | null,
  opcoes: OpcoesDeReprocessamento = {},
): Promise<RelatorioDeReprocessamento> {
  // So o ensaio dispensa o Destino: ele nunca escreve. Baixar sem Destino e erro de quem chama, dito aqui e nao la na
  // escrita do arquivo, para um refactor futuro nao gravar num caminho vazio (#1248).
  if (destino === null && opcoes.ensaio !== true) {
    throw new Error('reprocessarMidiaNuncaObtida: baixar exige o Destino de Midia; so o ensaio dispensa');
  }
  const baixar = opcoes.baixar ?? baixarMidiaReconstituida;
  const relatorio: RelatorioDeReprocessamento = {
    recuperados: 0,
    bytesRecuperados: 0,
    falhas: 0,
    naoElegiveis: 0,
    elegiveis: 0,
    tentados: 0,
    foraDoLimite: 0,
  };
  const porTipo: Record<string, number> = {};
  const porDia: Record<string, number> = {};

  const candidatos = listarAnexosNuncaObtidosComBruto(acervo, { ...opcoes.filtro, fonte: 'whatsapp' });
  for (const candidato of candidatos) {
    if (candidato.mensagemBruto === null) {
      relatorio.naoElegiveis += 1;
      continue;
    }
    const mensagem = reconstituirMensagemParaRetry(candidato.tipo, candidato.mensagemBruto);
    if (mensagem === null) {
      relatorio.naoElegiveis += 1;
      continue;
    }
    relatorio.elegiveis += 1;
    if (opcoes.ensaio === true) {
      porTipo[candidato.tipo] = (porTipo[candidato.tipo] ?? 0) + 1;
      const dia = new Date(candidato.ocorridaEm).toISOString().slice(0, 10);
      porDia[dia] = (porDia[dia] ?? 0) + 1;
      continue;
    }
    if (opcoes.limite !== undefined && relatorio.tentados >= opcoes.limite) {
      relatorio.foraDoLimite += 1;
      continue;
    }
    relatorio.tentados += 1;
    try {
      const bytes = await baixar(mensagem);
      gravarArquivoDeAnexo(acervo, { origemDaChegada: 'reprocesso', anexoId: candidato.anexoId, destino: destino as string, bytes });
      relatorio.recuperados += 1;
      relatorio.bytesRecuperados += bytes.length;
    } catch {
      relatorio.falhas += 1;
    }
  }

  if (opcoes.ensaio === true) {
    relatorio.ensaio = {
      candidatos: candidatos.length,
      tentaria: Math.min(relatorio.elegiveis, opcoes.limite ?? relatorio.elegiveis),
      porTipo,
      porDia,
    };
  }
  return relatorio;
}
