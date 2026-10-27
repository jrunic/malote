import type { Acervo } from '../nucleo/acervo.js';
import { atorDeServico, comAtor } from '../nucleo/ator.js';
import { apararDiario, LOTE_DA_APARAGEM, RETENCAO_PADRAO_DO_DIARIO_EM_DIAS } from '../nucleo/chegada.js';
import { ehBancoOcupado } from '../nucleo/erro-de-banco.js';

/**
 * A aparagem do Diario de Chegadas dentro do ouvinte.
 *
 * Nunca na subida: trabalho de disco na subida pode travar o ouvinte. O primeiro passo vem `primeiroPassoMs` (10 minutos)
 * depois de armada, para que o ouvinte que reinicia com frequencia tambem apare, e os seguintes a cada `intervaloMs` (uma
 * hora). Cada passo repete lotes curtos, cedendo o laco entre eles, enquanto o lote vier cheio. Banco ocupado nao e
 * falha: a passada seguinte tenta de novo. O Inquilino sem ouvinte nao apara sozinho: para ele existe
 * `malote chegadas aparar`.
 *
 * Devolve a funcao que para: ela marca o fim e limpa os dois temporizadores, antes de o Acervo fechar.
 */
export interface OpcoesDaAparagemDoOuvinte {
  agora: () => number;
  escrever: (texto: string) => void;
  primeiroPassoMs?: number;
  intervaloMs?: number;
  dias?: number;
  lote?: number;
}

const DEZ_MINUTOS_MS = 10 * 60_000;
const UMA_HORA_MS = 60 * 60_000;
/** Um passo nunca passa deste numero de lotes: o que sobrar fica para o passo da hora seguinte. */
const LOTES_POR_PASSO = 200;

export function iniciarAparagemDoDiario(acervo: Acervo, opcoes: OpcoesDaAparagemDoOuvinte): () => void {
  const lote = opcoes.lote ?? LOTE_DA_APARAGEM;
  const dias = opcoes.dias ?? RETENCAO_PADRAO_DO_DIARIO_EM_DIAS;
  let parado = false;
  let emAndamento = false;

  const passo = async (): Promise<void> => {
    if (parado || emAndamento) return;
    emAndamento = true;
    try {
      let removidasNoPasso = 0;
      for (let lotes = 0; lotes < LOTES_POR_PASSO && !parado; lotes += 1) {
        const r = comAtor(atorDeServico('ouvinte-whatsapp'), () =>
          apararDiario(acervo, { agora: opcoes.agora(), dias, lote }),
        );
        removidasNoPasso += r.removidas;
        if (r.removidas < lote) break;
        await new Promise<void>((resolver) => setImmediate(resolver));
      }
      if (removidasNoPasso > 0) {
        opcoes.escrever(`[ouvinte] diario de chegadas: ${String(removidasNoPasso)} aparada(s).`);
      }
    } catch (erro) {
      if (!ehBancoOcupado(erro) && !parado) {
        opcoes.escrever(`[ouvinte] aparagem do diario de chegadas abortou: ${(erro as Error).message}`);
      }
    } finally {
      emAndamento = false;
    }
  };

  const primeiro = setTimeout(() => void passo(), opcoes.primeiroPassoMs ?? DEZ_MINUTOS_MS);
  const periodico = setInterval(() => void passo(), opcoes.intervaloMs ?? UMA_HORA_MS);
  // Nenhum dos dois segura o processo vivo: quem o mantem e a conexao.
  primeiro.unref();
  periodico.unref();
  return (): void => {
    parado = true;
    clearTimeout(primeiro);
    clearInterval(periodico);
  };
}
