import type { Acervo } from '../../nucleo/acervo.js';
import { listarAnexosDeAudioSemDuracao } from '../../nucleo/inventario.js';
import { atualizarDuracaoDoAnexo } from '../../nucleo/escrita.js';
import { emOperacao } from '../../nucleo/trilha.js';

export interface RelatorioDeExtracaoDeDuracao {
  extraidas: number;
  /** Bruto preservado, mas sem `seconds` nem `ZMOVIEDURATION` — nada a extrair. */
  semChaveConhecida: number;
}

/**
 * Extrai a duração do Conteúdo Bruto de todo Anexo de áudio que ainda não a
 * tem, e grava — sem abrir arquivo, sem `ffprobe`. As DUAS chaves que o
 * WhatsApp usa, medidas em 01/10/2026 contra o Acervo real do Titular
 * (20.199 de 20.199 fora-de-escopo cobertos): `seconds` no evento ao vivo,
 * `ZMOVIEDURATION` no item de mídia do backup de iOS.
 *
 * Idempotente: só olha Anexo sem duração (`listarAnexosDeAudioSemDuracao`),
 * então rodar duas vezes sobre o mesmo recorte não reprocessa nada.
 *
 * Comando de decisão do operador — grava UMA Operação para o lote inteiro,
 * mesmo grão de `reenfileirarFalhas`: abrir uma por Anexo multiplicaria por
 * dezenas de milhares no estoque real.
 */
export function extrairDuracoesDoBruto(acervo: Acervo): RelatorioDeExtracaoDeDuracao {
  const elegiveis = listarAnexosDeAudioSemDuracao(acervo);

  // Separado ANTES de abrir Operação: um Anexo sem chave conhecida continua
  // elegível em toda chamada seguinte (nunca ganha duração), e abrir Operação
  // só por ele reabriria uma a cada chamada — a mesma classe de cuidado que
  // `reenfileirarFalhas` já tem ao checar `falhas.length` antes.
  const paraGravar: Array<{ anexoId: string; duracao: number }> = [];
  let semChaveConhecida = 0;
  for (const anexo of elegiveis) {
    const dado = JSON.parse(anexo.bruto) as Record<string, unknown>;
    const duracao =
      typeof dado['seconds'] === 'number'
        ? dado['seconds']
        : typeof dado['ZMOVIEDURATION'] === 'number'
          ? dado['ZMOVIEDURATION']
          : undefined;
    if (duracao === undefined) {
      semChaveConhecida += 1;
      continue;
    }
    paraGravar.push({ anexoId: anexo.anexoId, duracao });
  }

  if (paraGravar.length === 0) return { extraidas: 0, semChaveConhecida };

  emOperacao(acervo, { natureza: 'extrair-duracao-de-anexo', reversibilidade: 'por-efeito' }, (op) => {
    for (const { anexoId, duracao } of paraGravar) {
      atualizarDuracaoDoAnexo(acervo, anexoId, duracao);
      op.valor({ tabela: 'anexos', chave: anexoId, campo: 'duracao', antes: null, depois: String(duracao) });
    }
  });

  return { extraidas: paraGravar.length, semChaveConhecida };
}
