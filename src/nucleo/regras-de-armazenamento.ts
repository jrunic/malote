/**
 * As regras do Servico de Armazenamento que nao dependem de rede nem de disco:
 * quando um arquivo local pode sair, quando ja pode subir, em que ordem e com
 * que ritmo. Puras, para os testes as cobrirem sem subir processo nenhum.
 */

/** Arquivo escrito ha menos que isto pode estar em escrita: nao sobe ainda. */
export const IDADE_MINIMA_DO_ARQUIVO_MS = 10 * 60 * 1000;

const DIA_MS = 24 * 60 * 60 * 1000;

export function arquivoMaduro(agora: number, modificadoEmMs: number): boolean {
  return agora - modificadoEmMs >= IDADE_MINIMA_DO_ARQUIVO_MS;
}

/** O video vai primeiro no estoque: e 84% dos bytes, e o que mais libera disco. */
export function ordemDeEnvio(tipo: string): 0 | 1 {
  return tipo === 'video' ? 0 : 1;
}

export type MotivoDeNaoApagar = 'trava-fechada' | 'dentro-da-janela' | 'transcricao-por-fazer';

export type DecisaoDeApagar = { apagar: true } | { apagar: false; motivo: MotivoDeNaoApagar };

export interface EntradaDaDecisao {
  /** A trava do Destino Remoto: enquanto falsa, o servico nunca apaga a copia local. */
  apagarLocalLiberado: boolean;
  janelaDias: number;
  /** Instante atual, em milissegundos. */
  agora: number;
  /** Instante ISO em que a Localizacao foi verificada no remoto: a Janela conta daqui. */
  verificadaEm: string;
  /** Audio que a fila de transcricao ainda vai ler do disco. */
  transcricaoPorFazer: boolean;
}

/** A ordem das razoes e a ordem de prioridade: a trava vence tudo. */
export function decidirApagarCopiaLocal(e: EntradaDaDecisao): DecisaoDeApagar {
  if (!e.apagarLocalLiberado) return { apagar: false, motivo: 'trava-fechada' };
  if (e.agora < Date.parse(e.verificadaEm) + e.janelaDias * DIA_MS) {
    return { apagar: false, motivo: 'dentro-da-janela' };
  }
  if (e.transcricaoPorFazer) return { apagar: false, motivo: 'transcricao-por-fazer' };
  return { apagar: true };
}

/** O corte da Janela como instante ISO: Localizacoes verificadas ate ele ja cumpriram a Janela. */
export function corteDaJanela(agora: number, janelaDias: number): string {
  return new Date(agora - janelaDias * DIA_MS).toISOString();
}

export interface Ritmo {
  transferencias: number;
  /** Quanto esperar antes da proxima tentativa depois de um limite da API. */
  esperaMs: number;
}

const ESPERA_INICIAL_MS = 2_000;
const ESPERA_MAXIMA_MS = 60_000;

/** Metade das transferencias (no minimo 1) e a espera dobra, ate o teto. */
export function reduzirRitmo(r: Ritmo): Ritmo {
  return {
    transferencias: Math.max(1, Math.floor(r.transferencias / 2)),
    esperaMs: r.esperaMs === 0 ? ESPERA_INICIAL_MS : Math.min(ESPERA_MAXIMA_MS, r.esperaMs * 2),
  };
}
