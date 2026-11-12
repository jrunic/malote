/**
 * O que o servidor de consulta e a transcricao pedem ao Servico de Armazenamento quando o arquivo de um Anexo ja nao
 * esta no disco, e o que o Servico devolve. So tipos e constantes: quem fala com o remoto e o Servico, e quem fala com o
 * Servico (por soquete local) e `src/cli/cliente-do-armazenamento.ts`. O servidor e o nucleo nao conhecem o rclone.
 */

/** O maior arquivo que a rota remota entrega, em bytes (50 MiB); o Servico o configura por ambiente. */
export const TAMANHO_MAXIMO_PADRAO_DA_MIDIA_REMOTA = 50 * 1024 * 1024;

export type ResultadoDaBusca =
  /** Os bytes, ja conferidos contra a Impressao de Anexo. */
  | { tipo: 'bytes'; bytes: Buffer }
  /** O Anexo nao tem Localizacao: nunca foi enviado, ou nao e deste Inquilino. Para quem pede, "nao existe". */
  | { tipo: 'sem-localizacao' }
  /** Acima do tamanho maximo da rota remota: o sinal de tamanho, como o video recusa por tipo. */
  | { tipo: 'grande-demais'; tamanho: number; maximo: number }
  /** O arquivo existe no remoto e nao veio agora (remoto fora, conteudo que nao confere, cota): "inacessivel", nunca "nao existe". */
  | { tipo: 'inacessivel'; motivo: string }
  /** O Servico nao esta no ar. Distinto de "nao existe": o Anexo so no remoto fica inacessivel ate ele voltar. */
  | { tipo: 'servico-fora' }
  /** O Servico esta no ar e no limite de entregas em voo: repetir daqui a pouco resolve. Nao e "fora do ar". */
  | { tipo: 'ocupado' };

export interface PedidoDeBusca {
  /** O Inquilino que o servidor VERIFICOU pela Chave; nunca um valor que o cliente mandou. */
  inquilinoId: string;
  anexoId: string;
  /** Quanto tempo ainda resta ao pedido, em ms. */
  prazoMs: number;
  /** O cliente que pediu foi embora. */
  sinal?: AbortSignal | undefined;
}

/** A porta que `servir` injeta no servidor e na transcricao: o que sabe falar com o Servico. */
export type BuscadorDeMidiaRemota = (pedido: PedidoDeBusca) => Promise<ResultadoDaBusca>;
