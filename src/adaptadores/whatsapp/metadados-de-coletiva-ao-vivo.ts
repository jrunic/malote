// Import so de tipo, apagado em runtime: nao cria ciclo de modulo com `ao-vivo.ts`, que importa este arquivo.
import type { MensagemRecebida } from './ao-vivo.js';

/**
 * Metadados de Coletiva que chegam ao vivo (#1160, fatia C). Puro na leitura: nao abre banco nem biblioteca, e e
 * AQUI que moram os nomes de evento e de campo da Fonte — o nucleo nao nomeia ferramenta.
 *
 * Forma medida pela espiga de 13 e 14/10/2026, numa conta de teste:
 *
 * - O EVENTO DE GRUPO chega por `messages.upsert`, sem `message`, com `messageStubType` pelo NOME do enum (depois do
 *   round-trip de JSON; o numero e a forma do proto, e a biblioteca ja entregou o mesmo tipo das duas formas) e o
 *   texto novo em `messageStubParameters[0]`. A REMOCAO da descricao e o mesmo evento com os parametros NULOS.
 *   `messageTimestamp` chega as vezes numero, as vezes texto. O autor vem em `key.participant`, em LID, e `fromMe`
 *   NAO diz quem alterou: quando a propria conta altera, o evento chega com `fromMe` falso.
 * - O AVISO DE METADADOS chega por `groups.upsert` (criacao: traz `subjectTime` e `creation`) e `groups.update`
 *   (troca: so o campo que mudou e `author`, sem instante). O aviso da REMOCAO da descricao e `{id, author}`, sem a
 *   chave `desc`: ele nao distingue a remocao de uma troca de outro campo, e por isso nunca e lido como remocao.
 */
export type NaturezaDeMetadados = 'criacao' | 'assunto' | 'descricao';
export type AcaoDeMetadados = 'gravar' | 'remover' | 'forma-vazia';

export interface MudancaDeMetadados {
  natureza: NaturezaDeMetadados;
  acao: AcaoDeMetadados;
  /** O texto novo. So existe quando `acao` e `gravar`. */
  texto: string | undefined;
  /** O instante do fato, em milissegundos. */
  instante: number;
  grupo: string;
  /** Quem alterou, no endereco que o evento declara (LID ou JID). */
  autor: string | undefined;
}

const NATUREZA_POR_TIPO: Readonly<Record<string, NaturezaDeMetadados>> = Object.freeze({
  GROUP_CREATE: 'criacao',
  '20': 'criacao',
  GROUP_CHANGE_SUBJECT: 'assunto',
  '21': 'assunto',
  GROUP_CHANGE_DESCRIPTION: 'descricao',
  '24': 'descricao',
});

function ehGrupo(endereco: string): boolean {
  return endereco.endsWith('@g.us');
}

/** Reconhece, na Mensagem que a recepcao ja normalizou, o evento que cria ou muda assunto ou descricao do grupo. */
export function lerMudancaDeMetadados(m: MensagemRecebida): MudancaDeMetadados | null {
  if (m.messageStubType === undefined || m.messageStubType === null) return null;
  const natureza = NATUREZA_POR_TIPO[String(m.messageStubType)];
  if (natureza === undefined) return null;

  const segundos = Number(m.messageTimestamp);
  const base = {
    natureza,
    grupo: m.key.remoteJid,
    autor: m.key.participant,
  };
  // Sem instante legivel nao ha o que datar: contado como forma vazia, nunca com o instante de recebimento.
  if (!Number.isFinite(segundos) || segundos <= 0) {
    return { ...base, acao: 'forma-vazia', texto: undefined, instante: 0 };
  }
  const instante = segundos * 1000;

  const parametros = m.messageStubParameters;
  // A REMOCAO da descricao: parametros NULOS (forma medida). `[]`, `['']` e a ausencia do campo nao foram
  // medidos como remocao e ficam como forma vazia: contadas, nao interpretadas.
  if (natureza === 'descricao' && parametros === null) {
    return { ...base, acao: 'remover', texto: undefined, instante };
  }
  const primeiro = Array.isArray(parametros) ? parametros[0] : undefined;
  if (typeof primeiro === 'string' && primeiro !== '') {
    return { ...base, acao: 'gravar', texto: primeiro, instante };
  }
  return { ...base, acao: 'forma-vazia', texto: undefined, instante };
}

export interface AvisoDeGrupo {
  grupo: string;
  assunto?: string;
  descricao?: string;
  autor?: string;
  /** So o aviso de criacao traz instante (`subjectTime`, ou `creation`), em milissegundos. */
  instante?: number;
  /** O item CRU do aviso, como a Fonte o entregou: o Adaptador nao escolhe colunas, e o bruto da Conversa o guarda. */
  bruto: string;
}

export interface AvisosLidos {
  avisos: AvisoDeGrupo[];
  /** Avisos sem texto de assunto nem de descricao (o aviso da remocao e um deles). */
  semTexto: number;
  /** Avisos sobre endereco que nao e grupo. */
  foraDeGrupo: number;
}

function textoNaoVazio(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function segundosEmMs(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n * 1000 : undefined;
}

export function lerAvisoDeGrupo(fluxo: string, dado: unknown): AvisosLidos {
  const lidos: AvisosLidos = { avisos: [], semTexto: 0, foraDeGrupo: 0 };
  if (!Array.isArray(dado)) return lidos;
  for (const cru of dado) {
    if (cru === null || typeof cru !== 'object') continue;
    const item = cru as Record<string, unknown>;
    const id = item['id'];
    if (typeof id !== 'string') continue;
    if (!ehGrupo(id)) {
      lidos.foraDeGrupo += 1;
      continue;
    }
    const assunto = textoNaoVazio(item['subject']);
    const descricao = textoNaoVazio(item['desc']);
    if (assunto === undefined && descricao === undefined) {
      lidos.semTexto += 1;
      continue;
    }
    const autor = textoNaoVazio(item['author']);
    const instante =
      fluxo === 'groups.upsert' ? (segundosEmMs(item['subjectTime']) ?? segundosEmMs(item['creation'])) : undefined;
    lidos.avisos.push({
      grupo: id,
      bruto: JSON.stringify(item),
      ...(assunto !== undefined ? { assunto } : {}),
      ...(descricao !== undefined ? { descricao } : {}),
      ...(autor !== undefined ? { autor } : {}),
      ...(instante !== undefined ? { instante } : {}),
    });
  }
  return lidos;
}
