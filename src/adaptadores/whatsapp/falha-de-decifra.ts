/**
 * O registro estreito de uma falha de decifra (#1537). Sai dos argumentos da linha `failed to decrypt message` da
 * biblioteca (`{ key, err }`, com `key` = `{ id, remoteJid, participant?, fromMe? }`) e leva SO o que o diagnostico
 * precisa: o identificador externo, a conversa, o autor, a direcao, o tipo e a causa agrupada. Nada do resto da linha
 * (pilha, texto de mensagem).
 */
export type TipoDeConversa = 'grupo' | 'direta-opaca' | 'direta-telefone' | 'status-e-outros';
export type Causa =
  | 'reentrega'
  | 'sem-sessao'
  | 'sem-sessao-compativel'
  | 'prechave-invalida'
  | 'contador-antigo'
  | 'outra';
export type Direcao = 'recebida' | 'enviada';

export interface FalhaCapturada {
  id: string;
  conversa: string;
  autor?: string;
  direcao: Direcao;
  tipo: TipoDeConversa;
  causa: Causa;
  /** So na causa `outra`: o texto do erro, sem digitos e truncado a 60. */
  textoDaCausa?: string;
}

export function tipoDaConversa(jid: string): TipoDeConversa {
  if (jid.endsWith('@g.us')) return 'grupo';
  if (jid.endsWith('@lid')) return 'direta-opaca';
  if (jid.endsWith('@s.whatsapp.net')) return 'direta-telefone';
  return 'status-e-outros';
}

const CAUSAS: ReadonlyArray<readonly [RegExp, Causa]> = [
  [/^Key used already or never filled/, 'reentrega'],
  [/^No session found to decrypt message/, 'sem-sessao'],
  [/^No matching sessions found for message/, 'sem-sessao-compativel'],
  [/^Invalid PreKey ID/, 'prechave-invalida'],
  [/^Received message with old counter/, 'contador-antigo'],
];

export function agruparCausa(texto: string): Causa {
  for (const [re, causa] of CAUSAS) if (re.test(texto)) return causa;
  return 'outra';
}

const texto = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

export function extrairFalha(args: readonly unknown[]): FalhaCapturada | undefined {
  const a = args[0];
  if (a === null || typeof a !== 'object') return undefined;
  const { key, err } = a as { key?: unknown; err?: unknown };
  if (key === null || typeof key !== 'object') return undefined;
  const k = key as { id?: unknown; remoteJid?: unknown; participant?: unknown; fromMe?: unknown };
  const id = texto(k.id);
  const conversa = texto(k.remoteJid);
  if (id === undefined || conversa === undefined) return undefined;
  const mensagem = texto((err as { message?: unknown } | null | undefined)?.message) ?? '';
  const causa = agruparCausa(mensagem);
  const autor = texto(k.participant);
  return {
    id,
    conversa,
    ...(autor !== undefined ? { autor } : {}),
    direcao: k.fromMe === true ? 'enviada' : 'recebida',
    tipo: tipoDaConversa(conversa),
    causa,
    ...(causa === 'outra' ? { textoDaCausa: mensagem.replace(/\d+/g, '').slice(0, 60) } : {}),
  };
}
