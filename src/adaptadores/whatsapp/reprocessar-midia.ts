import type { Acervo } from '../../nucleo/acervo.js';
import { listarAnexosNuncaObtidosComBruto } from '../../nucleo/consulta.js';
import { gravarArquivoDeAnexo } from '../../nucleo/arquivo-de-anexo.js';
import { reconstituirMensagemParaRetry } from './retry-de-midia.js';
import { baixarMidiaReconstituida } from './conexao.js';

export interface RelatorioDeReprocessamento {
  recuperados: number;
  bytesRecuperados: number;
  falhas: number;
  /** bruto ausente, de outra Fonte, ou sem forma de recepcao ao vivo — #1084. */
  naoElegiveis: number;
}

export interface OpcoesDeReprocessamento {
  /** Injetavel para teste — por padrao, `baixarMidiaReconstituida` de verdade. */
  baixar?: (mensagem: unknown) => Promise<Buffer>;
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
 * Catch POR ITEM, nunca propaga: a falha de um Anexo nao pode custar os
 * demais, mesma disciplina do resto do adaptador (#1068, ao-vivo.ts).
 */
export async function reprocessarMidiaNuncaObtida(
  acervo: Acervo,
  destino: string,
  opcoes: OpcoesDeReprocessamento = {},
): Promise<RelatorioDeReprocessamento> {
  const baixar = opcoes.baixar ?? baixarMidiaReconstituida;
  const relatorio: RelatorioDeReprocessamento = {
    recuperados: 0,
    bytesRecuperados: 0,
    falhas: 0,
    naoElegiveis: 0,
  };

  const candidatos = listarAnexosNuncaObtidosComBruto(acervo, { fonte: 'whatsapp' });
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
    try {
      const bytes = await baixar(mensagem);
      gravarArquivoDeAnexo(acervo, { anexoId: candidato.anexoId, destino, bytes });
      relatorio.recuperados += 1;
      relatorio.bytesRecuperados += bytes.length;
    } catch {
      relatorio.falhas += 1;
    }
  }

  return relatorio;
}
