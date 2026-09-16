import { createHash } from 'node:crypto';

/**
 * Onde o arquivo de um Anexo cai SOB o Destino de Mídia.
 *
 * Isto é decisão do NÚCLEO, não do Adaptador — o layout é uniforme entre
 * Fontes e entre Destinos, e trocar o Destino não muda a estrutura interna.
 *
 * O caminho é derivado do id interno do Anexo. Nome original, apelido de
 * perfil e número não entram: caminho de arquivo é dado que vaza em backup,
 * em listagem de diretório e em mensagem de erro.
 */

const EXTENSAO_POR_TIPO: Record<string, string> = {
  image: 'jpg',
  video: 'mp4',
  audio: 'opus',
  document: 'bin',
  sticker: 'webp',
};

const PASTA_DESCONHECIDA = 'outros';
const EXTENSAO_DESCONHECIDA = 'bin';

export interface EntradaDeCaminho {
  /**
   * O Inquilino dono do Anexo. E o PRIMEIRO segmento do caminho, e isso e
   * estrutural: `destinos_de_midia` nao tem restricao de unicidade em
   * `endereco`, entao dois Inquilinos podem apontar para a mesma raiz. Sem o
   * segmento, apagar os arquivos de um ao recriar alcancaria os do outro.
   *
   * O valor e gerado pelo produto, nao vem da Fonte: nao carrega dado pessoal.
   */
  inquilinoId: string;
  anexoId: string;
  tipo: string;
  /** Aceito e deliberadamente IGNORADO — ver o teste de vazamento. */
  nomeOriginal?: string;
  /** Idem. Existe na assinatura para que ninguém o acrescente achando que falta. */
  apelidoDaOrigem?: string;
}

export function caminhoDeMidia(entrada: EntradaDeCaminho): string {
  const extensao = EXTENSAO_POR_TIPO[entrada.tipo];
  const pasta = extensao === undefined ? PASTA_DESCONHECIDA : entrada.tipo;
  const sufixo = extensao ?? EXTENSAO_DESCONHECIDA;

  // Hash do id interno: distribui uniformemente e não carrega nada da origem.
  const digest = createHash('sha256').update(entrada.anexoId).digest('hex');
  const nivel1 = digest.slice(0, 2);
  const nivel2 = digest.slice(2, 4);

  return `${entrada.inquilinoId}/${pasta}/${nivel1}/${nivel2}/${digest.slice(4, 36)}.${sufixo}`;
}
