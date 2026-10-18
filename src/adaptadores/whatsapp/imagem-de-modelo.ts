/**
 * A imagem do cabecalho da mensagem de modelo de conta comercial (#1242).
 *
 * PURO: sem biblioteca, sem Acervo. A recepcao, o comando do operador, a conexao e o retry de midia importam daqui.
 * Reconhece UMA forma, a medida em 18/10/2026 nas 9 Mensagens de modelo com imagem do Acervo real: a imagem mora em
 * `templateMessage.interactiveMessageTemplate.header.imageMessage`, com `mediaKey` e `url` ou `directPath`. A classificacao e
 * medida, nunca deduzida: imagem em qualquer outro lugar do modelo (a forma hidratada, por exemplo, nunca vista) ou sem chave
 * legivel e `nao-reconhecida`, contada e deixada no bruto.
 *
 * NAO entra no desembrulhador da recepcao (`desembrulhar`): abrir o modelo ali faria o classificador de tipo devolver
 * `imageMessage` e a leitura do texto perderia o corpo da Mensagem. Aqui a imagem e lida do evento por um caminho proprio,
 * depois de a Mensagem ter sido classificada como sempre.
 */

export type LeituraDoModelo =
  | { tipo: 'imagem'; conteudo: Record<string, unknown> }
  | { tipo: 'sem-imagem' }
  | { tipo: 'nao-reconhecida' };

const SEM_IMAGEM: LeituraDoModelo = { tipo: 'sem-imagem' };
const NAO_RECONHECIDA: LeituraDoModelo = { tipo: 'nao-reconhecida' };

const objeto = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * `mediaKey` legivel: texto base64 nao vazio, o `Buffer` que o JSON round-trip produz, ou o binario de verdade que a conexao
 * entrega (a mensagem crua da biblioteca, antes da normalizacao).
 */
function mediaKeyLegivel(v: unknown): boolean {
  if (typeof v === 'string') return v !== '';
  if (v instanceof Uint8Array) return v.length > 0;
  const o = objeto(v);
  return o !== null && o['type'] === 'Buffer' && Array.isArray(o['data']) && o['data'].length > 0;
}

/** Tem a chave `imageMessage` em algum lugar dentro do valor (qualquer profundidade). */
function temImagemEmQualquerLugar(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(temImagemEmQualquerLugar);
  const o = objeto(v);
  if (o === null) return false;
  return Object.entries(o).some(([k, filho]) => k === 'imageMessage' || temImagemEmQualquerLugar(filho));
}

/** `message` e o `message` do evento (nao o evento). */
export function leituraDoModelo(message: unknown): LeituraDoModelo {
  const modelo = objeto(objeto(message)?.['templateMessage']);
  if (modelo === null) return SEM_IMAGEM;

  const cabecalho = objeto(objeto(modelo['interactiveMessageTemplate'])?.['header']);
  const nolugar = cabecalho !== null && 'imageMessage' in cabecalho;
  if (nolugar) {
    const imagem = objeto(cabecalho['imageMessage']);
    const temEndereco = imagem !== null && (typeof imagem['url'] === 'string' || typeof imagem['directPath'] === 'string');
    if (imagem !== null && mediaKeyLegivel(imagem['mediaKey']) && temEndereco) return { tipo: 'imagem', conteudo: imagem };
    return NAO_RECONHECIDA;
  }
  return temImagemEmQualquerLugar(modelo) ? NAO_RECONHECIDA : SEM_IMAGEM;
}
