import { createDecipheriv, createHmac } from 'node:crypto';
import { mensagemParaEdicao, type EntradaDeEdicao } from '../../nucleo/edicao.js';
import type { Acervo } from '../../nucleo/acervo.js';
import { resolverEndereco } from '../../nucleo/correspondencia.js';
import type { MensagemRecebida } from './ao-vivo.js';

/**
 * A Edicao de Mensagem do WhatsApp (#1246): vocabulario de Fonte, so aqui.
 *
 * Duas formas chegam, e convergem depois da decifracao:
 *  - CIFRADA (`secretEncryptedMessage` com `secretEncType` de edicao de mensagem): o texto novo vem cifrado com o
 *    SEGREDO DA MENSAGEM ORIGINAL (`messageContextInfo.messageSecret`, que o Conteudo Bruto dela guarda). Medido em
 *    18/10/2026: 99 de 100 decifram, 0 falhas; a tag do AES-GCM autentica, entao so passa com a derivacao certa.
 *  - ABERTA (`protocolMessage` de edicao): o texto vem em claro. Vista uma vez em 11 dias, nunca capturada; o formato
 *    interno e o das 99 decifradas, e o conteudo do evento e premissa.
 *
 * O protobuf do texto claro NAO e lido aqui: quem importa a biblioteca e so o portao (`conexao`), que entrega a funcao
 * `Decodificador`. Este modulo nao conhece a biblioteca.
 */

/** Le os bytes de um texto claro (protobuf, em producao) e devolve a mensagem como objeto simples. */
export type Decodificador = (bytes: Uint8Array) => Record<string, unknown>;

/** O tipo de protocolo e o do envelope cifrado, como o nome do enum (a forma medida; o numero nunca foi visto). */
const TIPO_DE_EDICAO = 'MESSAGE_EDIT';

/** As causas pelas quais uma edicao NAO e gravada. So rotulo: nunca texto de conversa. */
export type CausaDeEdicaoNaoGravada =
  | 'envelope-incompleto'
  | 'sem-decodificador'
  | 'original-ausente'
  | 'sem-segredo'
  | 'tag-invalida'
  | 'forma-desconhecida'
  | 'sem-texto'
  | 'outra-conversa'
  | 'instante-implausivel';

export type EdicaoRecebida =
  | { origem: 'cifrada'; alvoId: string; iv: Buffer; carga: Buffer }
  | { origem: 'aberta'; alvoId: string; protocolo: Record<string, unknown> };

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

/**
 * Reconhece a edicao no evento: `null` quando NAO e edicao (segue o caminho de sempre), `'envelope-incompleto'` quando e
 * mas falta o que se precisa para trata-la. O alvo vale pela chave que CADA forma traz: `targetMessageKey` na cifrada (e
 * o que entra na derivacao), a chave do proprio protocolo na aberta.
 */
export function lerEdicaoRecebida(m: MensagemRecebida): EdicaoRecebida | 'envelope-incompleto' | null {
  const sec = objeto(m.message?.['secretEncryptedMessage']);
  if (sec !== null) {
    if (sec['secretEncType'] !== TIPO_DE_EDICAO) return null;
    const alvo = objeto(sec['targetMessageKey']);
    const alvoId = alvo?.['id'];
    const iv = sec['encIv'];
    const carga = sec['encPayload'];
    if (typeof alvoId !== 'string' || alvoId === '' || typeof iv !== 'string' || typeof carga !== 'string') {
      return 'envelope-incompleto';
    }
    const ivB = Buffer.from(iv, 'base64');
    const cargaB = Buffer.from(carga, 'base64');
    // O GCM de 96 bits e a tag de 16 bytes: carga menor que a tag nao tem o que decifrar.
    if (ivB.length !== 12 || cargaB.length <= 16) return 'envelope-incompleto';
    return { origem: 'cifrada', alvoId, iv: ivB, carga: cargaB };
  }
  const protocolo = objeto(m.message?.['protocolMessage']);
  if (protocolo !== null && protocolo['type'] === TIPO_DE_EDICAO) {
    const alvoId = objeto(protocolo['key'])?.['id'];
    if (typeof alvoId !== 'string' || alvoId === '' || objeto(protocolo['editedMessage']) === null) {
      return 'envelope-incompleto';
    }
    return { origem: 'aberta', alvoId, protocolo };
  }
  return null;
}

/** O segredo de 32 bytes que o Conteudo Bruto da Mensagem original guarda, ou `null`. */
export function segredoDaMensagem(bruto: string | null): Buffer | null {
  if (bruto === null) return null;
  let evento: unknown;
  try {
    evento = JSON.parse(bruto);
  } catch {
    return null;
  }
  const contexto = objeto(objeto(objeto(evento)?.['message'])?.['messageContextInfo']);
  const segredo = contexto?.['messageSecret'];
  if (typeof segredo !== 'string') return null;
  const bytes = Buffer.from(segredo, 'base64');
  return bytes.length === 32 ? bytes : null;
}

function hmac(chave: Buffer, dados: Buffer): Buffer {
  return createHmac('sha256', chave).update(dados).digest();
}

/**
 * Decifra a carga de uma edicao cifrada, ou devolve `null` quando a tag nao autentica. A derivacao (a do PR 2743 do
 * Baileys, provada nos eventos reais): a extraida e HMAC-SHA256 do segredo com a chave de 32 zeros; a chave e HMAC-SHA256
 * da extraida sobre `id da original || remetente || editor || "Message Edit" || 0x01`, cada parte em UTF-8, o endereco
 * COMO O ENVELOPE O TRAZ. Quem edita e o autor da original, entao remetente e editor sao o mesmo endereco (99 de 99).
 * AES-256-GCM com o IV do envelope, a tag nos 16 ultimos bytes e dados autenticados vazios.
 */
export function decifrarEdicao(a: {
  segredo: Buffer;
  alvoId: string;
  editor: string;
  iv: Buffer;
  carga: Buffer;
}): Buffer | null {
  const extraida = hmac(Buffer.alloc(32, 0), a.segredo);
  const info = Buffer.concat([
    Buffer.from(a.alvoId),
    Buffer.from(a.editor),
    Buffer.from(a.editor),
    Buffer.from('Message Edit'),
    Buffer.from([1]),
  ]);
  try {
    const decifra = createDecipheriv('aes-256-gcm', hmac(extraida, info), a.iv);
    decifra.setAuthTag(a.carga.subarray(a.carga.length - 16));
    return Buffer.concat([decifra.update(a.carga.subarray(0, a.carga.length - 16)), decifra.final()]);
  } catch {
    return null;
  }
}

export interface MensagemEditadaLida {
  texto: string;
  /** Em milissegundos, ou `null` quando a mensagem editada nao o traz. */
  instanteMs: number | null;
}

/**
 * O texto novo e o instante, tirados do protocolo de edicao (o mesmo formato nas duas formas). Vale o texto simples, o
 * estendido e a legenda de imagem, de video e de documento (esta ultima tambem embrulhada). Mensagem de midia SEM legenda
 * e uma legenda apagada: texto vazio, e e uma edicao valida. Forma sem nada disso devolve `null`.
 */
export function lerMensagemEditada(protocolo: Record<string, unknown>): MensagemEditadaLida | null {
  const editada = objeto(protocolo['editedMessage']);
  if (editada === null) return null;
  const embrulho = objeto(objeto(editada['documentWithCaptionMessage'])?.['message']);
  const m = embrulho ?? editada;

  let texto: string | null = null;
  if (typeof m['conversation'] === 'string') texto = m['conversation'];
  else if (objeto(m['extendedTextMessage']) !== null) {
    const t = objeto(m['extendedTextMessage'])?.['text'];
    if (typeof t === 'string') texto = t;
  } else {
    for (const chave of ['imageMessage', 'videoMessage', 'documentMessage']) {
      const midia = objeto(m[chave]);
      if (midia !== null) {
        const legenda = midia['caption'];
        texto = typeof legenda === 'string' ? legenda : '';
        break;
      }
    }
  }
  if (texto === null) return null;
  return { texto, instanteMs: milissegundos(protocolo['timestampMs']) };
}

function milissegundos(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

export type DecisaoDeEdicao =
  | { gravar: Omit<EntradaDeEdicao, 'agora' | 'toleranciaDeRelogioMs' | 'origemDaChegada'> }
  | { recusar: CausaDeEdicaoNaoGravada };

/**
 * Decide, LENDO (sem Operacao), o que fazer com uma edicao reconhecida. Nunca lanca por dado ruim: toda causa que impede
 * a gravacao vira um rotulo, e o evento segue descartado, contado e guardado cru. A disputa de escrita sobe, como no resto
 * da recepcao (so leitura aqui, mas o banco ocupado pode aparecer).
 */
export function decidirEdicao(
  acervo: Acervo,
  fonte: 'whatsapp',
  m: MensagemRecebida,
  edicao: EdicaoRecebida,
  decodificar: Decodificador | undefined,
): DecisaoDeEdicao {
  const original = mensagemParaEdicao(acervo, { fonte, idExterno: edicao.alvoId });
  if (original === undefined) return { recusar: 'original-ausente' };

  // O endereco da Conversa do envelope, resolvido pela MESMA rota da recepcao (o envelope traz a forma opaca e o Acervo
  // grava a canonica). Medido em 18/10/2026: 101 de 101 casam, em grupo e em conversa direta.
  if (resolverEndereco(acervo, fonte, m.key.remoteJid) !== original.enderecoDaConversa) {
    return { recusar: 'outra-conversa' };
  }

  let protocolo: Record<string, unknown>;
  if (edicao.origem === 'cifrada') {
    if (decodificar === undefined) return { recusar: 'sem-decodificador' };
    const segredo = segredoDaMensagem(original.bruto);
    if (segredo === null) return { recusar: 'sem-segredo' };
    const editor = m.key.participant ?? m.key.remoteJid;
    const claro = decifrarEdicao({ segredo, alvoId: edicao.alvoId, editor, iv: edicao.iv, carga: edicao.carga });
    if (claro === null) return { recusar: 'tag-invalida' };
    let lida: Record<string, unknown>;
    try {
      lida = decodificar(claro);
    } catch {
      return { recusar: 'forma-desconhecida' };
    }
    const p = objeto(lida['protocolMessage']);
    if (p === null || p['type'] !== TIPO_DE_EDICAO) return { recusar: 'forma-desconhecida' };
    protocolo = p;
  } else {
    protocolo = edicao.protocolo;
  }

  const editada = lerMensagemEditada(protocolo);
  if (editada === null) return { recusar: 'sem-texto' };
  return {
    gravar: {
      mensagemId: original.id,
      fonte,
      idExterno: m.key.id,
      texto: editada.texto,
      // Nunca o instante de RECEBIMENTO: o da edicao, e na falta dele o do envelope.
      editadaEm: editada.instanteMs ?? m.messageTimestamp * 1000,
      origem: edicao.origem,
      bruto: JSON.stringify(m),
    },
  };
}
