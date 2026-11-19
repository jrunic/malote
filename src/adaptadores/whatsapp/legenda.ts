import { desembrulhar } from './conteudo-de-mensagem.js';

/**
 * A LEGENDA de uma midia de WhatsApp (#1530): o texto que a pessoa escreve junto da foto, do video ou do documento. Ela
 * chega no objeto da PROPRIA midia, e a recepcao a guardava no Conteudo Bruto sem lê-la como texto da Mensagem.
 *
 * So a legenda da propria midia conta. A que aparece dentro de uma mensagem CITADA (`contextInfo`) e de outra Mensagem
 * e nunca vem daqui: o caminho e sempre `<tipo>Message.caption` da mensagem que o evento carrega.
 */

const MIDIAS_COM_LEGENDA = ['imageMessage', 'videoMessage', 'documentMessage'] as const;
const IMAGEM_E_VIDEO = ['imageMessage', 'videoMessage'] as const;

export type TipoDeMidiaComLegenda = 'imagem' | 'video' | 'documento';
const TIPO_POR_CHAVE: Record<string, TipoDeMidiaComLegenda> = {
  imageMessage: 'imagem',
  videoMessage: 'video',
  documentMessage: 'documento',
};

function legendaETipoDe(
  message: Record<string, unknown> | undefined | null,
  midias: readonly string[],
): { texto: string; tipo: TipoDeMidiaComLegenda } | undefined {
  if (message == null) return undefined;
  for (const chave of midias) {
    const midia = message[chave];
    if (midia === null || typeof midia !== 'object') continue;
    const legenda = (midia as Record<string, unknown>)['caption'];
    if (typeof legenda !== 'string') continue;
    // Legenda vazia e legenda ausente: o texto da Mensagem segue nulo, nunca vazio. Imagem e video tambem tratam a so de espacos
    // como ausente; o DOCUMENTO segue a regra da v0.34.0 (so a vazia), para o estoque e a recepcao nao divergirem.
    const ausente = chave === 'documentMessage' ? legenda === '' : legenda.trim() === '';
    if (!ausente) return { texto: legenda, tipo: TIPO_POR_CHAVE[chave]! };
  }
  return undefined;
}

function legendaDe(message: Record<string, unknown> | undefined | null, midias: readonly string[]): string | undefined {
  return legendaETipoDe(message, midias)?.texto;
}

/** A legenda de imagem ou de video da mensagem JA desembrulhada: o que o texto da Mensagem ao vivo acrescenta. */
export function legendaDeImagemOuVideo(message: Record<string, unknown> | undefined | null): string | undefined {
  return legendaDe(message, IMAGEM_E_VIDEO);
}

/**
 * A legenda que o Conteudo Bruto de uma Mensagem AO VIVO guarda (o evento inteiro): abre os embrulhos que a recepcao abre
 * e le a midia propria, de imagem, video ou documento. `undefined` quando o bruto e ilegivel ou nao tem legenda.
 */
export function legendaDoBrutoAoVivo(bruto: string): string | undefined {
  return legendaETipoDoBrutoAoVivo(bruto)?.texto;
}

/** A mesma extracao, com o TIPO da midia de que a legenda saiu: o estoque conta por tipo pelo caminho que le, nunca por texto do bruto. */
export function legendaETipoDoBrutoAoVivo(bruto: string): { texto: string; tipo: TipoDeMidiaComLegenda } | undefined {
  let evento: unknown;
  try {
    evento = JSON.parse(bruto);
  } catch {
    return undefined;
  }
  if (evento === null || typeof evento !== 'object') return undefined;
  const message = (evento as Record<string, unknown>)['message'];
  if (message === null || typeof message !== 'object') return undefined;
  return legendaETipoDe(desembrulhar(message as Record<string, unknown>), MIDIAS_COM_LEGENDA);
}

/**
 * A legenda no registro de midia do BACKUP do iPhone: o titulo da midia, so de imagem e de video. No documento o titulo e o
 * nome do arquivo, nao a legenda (medido: 319 de 426 divergem do texto gravado), e a legenda de documento ja vem na linha
 * da Mensagem. `undefined` quando o registro e ilegivel, o tipo nao e imagem ou video, ou o titulo e vazio.
 */
export function legendaDoRegistroDeMidia(brutoDoAnexo: string | undefined, tipoDoAnexo: string): string | undefined {
  if (brutoDoAnexo === undefined || (tipoDoAnexo !== 'image' && tipoDoAnexo !== 'video')) return undefined;
  let registro: unknown;
  try {
    registro = JSON.parse(brutoDoAnexo);
  } catch {
    return undefined;
  }
  if (registro === null || typeof registro !== 'object') return undefined;
  const titulo = (registro as Record<string, unknown>)['ZTITLE'];
  return typeof titulo === 'string' && titulo.trim() !== '' ? titulo : undefined;
}
