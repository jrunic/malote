// src/cli/sinal-da-conexao.ts
import { lerUltimoEvento, marcarUltimoEvento } from './ultimo-evento.js';

/**
 * O SINAL DE VIDA DA CONEXAO (#1162).
 *
 * O `ultimo-evento` so avanca quando chega Mensagem, e conta quieta e ouvinte
 * morto produzem o mesmo silencio. Este e o instante do ULTIMO FRAME que a
 * Conexao recebeu do WhatsApp: a biblioteca manda um `ping` a cada 30 s e encerra a
 * Conexao se passam 35 s sem frame (lido na versao 6.7.24), entao numa Conexao
 * aberta o instante anda mesmo sem Mensagem nenhuma.
 *
 * Aqui mora so o ESTRANGULAMENTO e a tolerancia a falha. A escrita atomica e a
 * leitura sao as de `ultimo-evento`, que sao genericas. O sinal e do TRANSPORTE
 * e nao prova que Mensagem esta sendo gravada: Conexao viva com Mensagem parada
 * continua sem detector (#1151, #1152).
 *
 * MORA em `src/cli/`, e nao sob `adaptadores/`: quem decide onde o arquivo cai e
 * quem monta a instalacao.
 */
export const INTERVALO_DO_SINAL_MS = 15_000;

let falhasNoProcesso = 0;

/** Quantas vezes gravar o sinal falhou NESTE processo. Em memoria, de proposito: o destino que falhou e o mesmo que o guardaria. */
export function falhasDoSinal(): number {
  return falhasNoProcesso;
}

/**
 * Devolve a funcao que o gancho de frame chama. Grava no maximo uma vez por
 * `intervaloMs`; a janela conta a partir da TENTATIVA, nao do sucesso, para que
 * um disco que falha nao leve uma tentativa por frame. Falha nunca propaga: vira
 * contagem e UM aviso, so com o codigo do erro (a mensagem de sistema carrega caminho).
 */
export function criarMarcadorDoSinal(opcoes: {
  caminho: string;
  agora: () => number;
  avisar: (texto: string) => void;
  intervaloMs?: number;
}): () => void {
  const intervalo = opcoes.intervaloMs ?? INTERVALO_DO_SINAL_MS;
  let ultimaTentativa = Number.NEGATIVE_INFINITY;
  let avisou = false;
  return (): void => {
    const t = opcoes.agora();
    // `t >= ultimaTentativa`: relogio que volta para tras (ajuste do sistema) nao pode
    // congelar o sinal ate alcancar o instante antigo.
    if (t >= ultimaTentativa && t - ultimaTentativa < intervalo) return;
    ultimaTentativa = t;
    try {
      marcarUltimoEvento(opcoes.caminho, t);
    } catch (erro) {
      falhasNoProcesso += 1;
      if (avisou) return;
      avisou = true;
      const codigo = (erro as NodeJS.ErrnoException).code ?? 'erro';
      opcoes.avisar(`[ouvinte] sinal da conexao: falha ao gravar (${codigo}); a recepcao segue`);
    }
  };
}

/** O instante do ultimo frame gravado, ou `null` (ausente ou ilegivel): sinal indisponivel, nunca "Conexao morta". */
export function lerSinalDaConexao(caminho: string): number | null {
  return lerUltimoEvento(caminho);
}
