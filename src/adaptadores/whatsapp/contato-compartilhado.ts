import type { CartaoCompartilhado, ValorDeContato } from '../../nucleo/contato-compartilhado.js';

/**
 * Leitor do cartao de contato (vCard) que o WhatsApp entrega, nos dois caminhos: o texto que o
 * backup de iOS guarda no item de midia e o `contactMessage` da recepcao ao vivo. E vocabulario
 * de Fonte (o `waid`, os campos de negocio do WhatsApp) e por isso mora aqui, nunca no nucleo.
 *
 * Medido no Acervo real em 13/10/2026: 3.586 cartoes, 3.585 em vCard 3.0, fim de linha LF, sem
 * codificacao alternativa; 8,9% com o nome de exibicao VAZIO (quase todos com organizacao).
 * Funcoes puras de texto: NUNCA lancam. Cartao ilegivel vira recusa contada, porque uma
 * Mensagem estranha nao pode derrubar a ingestao.
 */

/** Separa os cartoes dentro do campo de texto do backup. */
export const SEPARADOR_DE_CARTOES = '_$!<VCard-Separator>!$_';
/** Separa os nomes no campo de nomes do backup, que e por POSICAO. */
export const SEPARADOR_DE_NOMES = '_$!<Name-Separator>!$_';

export type RecursoDeNome =
  | 'nome-de-exibicao'
  | 'organizacao'
  | 'nome-comercial'
  | 'nome-do-evento'
  | 'nome-separado-do-backup';

export interface LeituraDeCartoes {
  cartoes: CartaoCompartilhado[];
  /** Cartoes ilegiveis ou sem nome por caminho nenhum. Contados, nunca silenciosos. */
  recusados: number;
  /** De onde veio o nome de cada cartao aceito. So os recursos que ocorreram. */
  nomesPorRecurso: Partial<Record<RecursoDeNome, number>>;
}

const BLOCO = /BEGIN:VCARD[\s\S]*?END:VCARD/gi;
/** Tipos que descrevem o canal e nao o uso: nao servem de rotulo. */
const TIPOS_SEM_ROTULO = new Set(['voice', 'pref', 'internet', 'iphone', 'x-iphone']);

function vazia(): LeituraDeCartoes {
  return { cartoes: [], recusados: 0, nomesPorRecurso: {} };
}

function desescapar(valor: string): string {
  return valor.replace(/\\([,;\\nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? ' ' : c));
}

function limpo(valor: string | undefined): string | undefined {
  if (valor === undefined) return undefined;
  const t = desescapar(valor).replace(/\s+/g, ' ').trim();
  return t === '' ? undefined : t;
}

function soDigitos(texto: string): string | null {
  const d = texto.replace(/\D/g, '');
  return d === '' ? null : d;
}

/** Desdobra as linhas dobradas (a continuacao comeca por espaco ou tab) e separa por linha. */
function linhasDe(bloco: string): string[] {
  return bloco.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

interface Linha {
  grupo: string | null;
  nome: string;
  params: Map<string, string[]>;
  valor: string;
}

function lerLinha(linha: string): Linha | null {
  const dois = linha.indexOf(':');
  if (dois < 1) return null;
  const [cabeca, ...parametros] = linha.slice(0, dois).split(';');
  const m = /^(?:([A-Za-z0-9-]+)\.)?(.+)$/.exec(cabeca as string);
  if (m === null) return null;
  const params = new Map<string, string[]>();
  for (const p of parametros) {
    const igual = p.indexOf('=');
    // vCard 2.1 traz o tipo solto (`TEL;CELL;PREF`): vira `type`.
    const chave = igual < 0 ? 'type' : p.slice(0, igual).toLowerCase();
    const valores = (igual < 0 ? p : p.slice(igual + 1)).split(',').map((v) => v.trim().toLowerCase());
    params.set(chave, [...(params.get(chave) ?? []), ...valores]);
  }
  return { grupo: m[1] ?? null, nome: (m[2] as string).toUpperCase(), params, valor: linha.slice(dois + 1) };
}

interface Reserva {
  nome: string | undefined;
  recurso: RecursoDeNome;
}

interface BlocoLido {
  cartao: CartaoCompartilhado;
  recurso: RecursoDeNome;
}

function lerBloco(bloco: string, reserva: Reserva | undefined): BlocoLido | null {
  let fn: string | undefined;
  let org: string | undefined;
  let biz: string | undefined;
  const rotulosDeGrupo = new Map<string, string>();
  const canais: Array<{ tipo: 'telefone' | 'email'; texto: string; waid: string | null; grupo: string | null; tipos: string[] }> = [];

  for (const bruta of linhasDe(bloco)) {
    const l = lerLinha(bruta);
    if (l === null) continue;
    switch (l.nome) {
      case 'FN':
        fn = limpo(l.valor);
        break;
      case 'ORG':
        // O primeiro componente (empresa); os seguintes sao departamento e afins.
        org = limpo(l.valor.split(/(?<!\\);/)[0]);
        break;
      case 'X-WA-BIZ-NAME':
        biz = limpo(l.valor);
        break;
      case 'X-ABLABEL':
        if (l.grupo !== null) {
          rotulosDeGrupo.set(l.grupo, l.valor.trim().replace(/^_\$!<(.*)>!\$_$/, '$1').toLowerCase());
        }
        break;
      case 'TEL':
      case 'EMAIL': {
        const texto = limpo(l.valor);
        if (texto === undefined) break;
        canais.push({
          tipo: l.nome === 'TEL' ? 'telefone' : 'email',
          texto,
          waid: soDigitos((l.params.get('waid') ?? [''])[0] as string),
          grupo: l.grupo,
          tipos: l.params.get('type') ?? [],
        });
        break;
      }
      default:
        // PHOTO e o resto ficam so no Conteudo Bruto.
        break;
    }
  }

  const candidatos: Array<[RecursoDeNome, string | undefined]> = [
    ['nome-de-exibicao', fn],
    ['organizacao', org],
    ['nome-comercial', biz],
  ];
  if (reserva !== undefined) candidatos.push([reserva.recurso, limpo(reserva.nome)]);
  const escolhido = candidatos.find(([, valor]) => valor !== undefined);
  if (escolhido === undefined) return null;

  const valores: ValorDeContato[] = canais.map((c) => {
    const doGrupo = c.grupo === null ? undefined : rotulosDeGrupo.get(c.grupo);
    const rotulo = doGrupo ?? c.tipos.find((t) => !TIPOS_SEM_ROTULO.has(t)) ?? null;
    return {
      tipo: c.tipo,
      texto: c.texto,
      digitos: c.tipo === 'telefone' ? (c.waid ?? soDigitos(c.texto)) : null,
      rotulo,
    };
  });
  return {
    cartao: { nome: escolhido[1] as string, organizacao: org ?? null, nomeComercial: biz ?? null, valores },
    recurso: escolhido[0],
  };
}

function somar(leitura: LeituraDeCartoes, lido: BlocoLido | null): void {
  if (lido === null) {
    leitura.recusados += 1;
    return;
  }
  leitura.cartoes.push(lido.cartao);
  leitura.nomesPorRecurso[lido.recurso] = (leitura.nomesPorRecurso[lido.recurso] ?? 0) + 1;
}

/**
 * Le o texto de cartoes do backup (`ZVCARDSTRING`) com o campo de nomes separado (`ZVCARDNAME`).
 * Esse segundo campo e por POSICAO e diverge em numero de cartoes em 121 de 3.283 Anexos, entao
 * so serve de ultimo recurso e so quando tem exatamente tantos nomes quanto cartoes.
 */
export function lerCartoesDoBackup(texto: string, nomesSeparados: string): LeituraDeCartoes {
  const leitura = vazia();
  try {
    if (typeof texto !== 'string') return leitura;
    const pedacos = texto.split(SEPARADOR_DE_CARTOES).filter((p) => p.trim() !== '');
    const nomes = typeof nomesSeparados === 'string' ? nomesSeparados.split(SEPARADOR_DE_NOMES) : [];
    const alinhado = nomes.length === pedacos.length;
    pedacos.forEach((pedaco, i) => {
      const blocos = pedaco.match(BLOCO);
      if (blocos === null) {
        leitura.recusados += 1;
        return;
      }
      for (const bloco of blocos) {
        const reserva: Reserva | undefined = alinhado
          ? { nome: nomes[i], recurso: 'nome-separado-do-backup' }
          : undefined;
        somar(leitura, lerBloco(bloco, reserva));
      }
    });
  } catch {
    leitura.recusados += 1;
  }
  return leitura;
}

/**
 * Le o `contactMessage` da recepcao ao vivo: o texto do cartao e o nome de exibicao do evento,
 * que serve de ultimo recurso por ser de cartao unico.
 */
export function lerCartaoAoVivo(vcard: string, nomeDeExibicao: string | undefined): LeituraDeCartoes {
  const leitura = vazia();
  try {
    if (typeof vcard !== 'string' || vcard.trim() === '') return leitura;
    const blocos = vcard.match(BLOCO);
    if (blocos === null) {
      leitura.recusados += 1;
      return leitura;
    }
    for (const bloco of blocos) {
      const reserva: Reserva | undefined =
        blocos.length === 1 ? { nome: nomeDeExibicao, recurso: 'nome-do-evento' } : undefined;
      somar(leitura, lerBloco(bloco, reserva));
    }
  } catch {
    leitura.recusados += 1;
  }
  return leitura;
}

/**
 * Le a lista do cartao MULTIPLO da recepcao ao vivo (`contactsArrayMessage.contacts`, #1206): cada elemento e um
 * `{displayName, vcard}`, e o nome de exibicao dele serve de ultimo recurso para o cartao dele. O nome de exibicao
 * EXTERNO do envelope ("N contatos", com uma marca de direcao invisivel) e rotulo, nunca nome: por isso so a lista
 * chega aqui. Elemento que nao e objeto e recusa contada; lista ausente ou vazia e "a Fonte nao disse nada".
 */
export function lerCartaoMultiploAoVivo(contatos: unknown): LeituraDeCartoes {
  const leitura = vazia();
  if (!Array.isArray(contatos)) return leitura;
  for (const elemento of contatos) {
    if (elemento === null || typeof elemento !== 'object') {
      leitura.recusados += 1;
      continue;
    }
    const dado = elemento as Record<string, unknown>;
    const lido = lerCartaoAoVivo(
      typeof dado['vcard'] === 'string' ? dado['vcard'] : '',
      typeof dado['displayName'] === 'string' ? dado['displayName'] : undefined,
    );
    leitura.cartoes.push(...lido.cartoes);
    leitura.recusados += lido.recusados;
    for (const [recurso, n] of Object.entries(lido.nomesPorRecurso) as Array<[RecursoDeNome, number]>) {
      leitura.nomesPorRecurso[recurso] = (leitura.nomesPorRecurso[recurso] ?? 0) + n;
    }
  }
  return leitura;
}

/**
 * Le os cartoes do Conteudo Bruto de um Anexo `contact` do backup (o item de midia serializado).
 * Bruto que nao e JSON, ou sem o campo de cartoes, e recusa contada e nunca excecao.
 */
export function lerCartoesDoAnexoDeBackup(brutoDoAnexo: string): LeituraDeCartoes {
  try {
    const dado = JSON.parse(brutoDoAnexo) as Record<string, unknown>;
    const texto = dado['ZVCARDSTRING'];
    const nomes = dado['ZVCARDNAME'];
    if (typeof texto !== 'string') return vazia();
    return lerCartoesDoBackup(texto, typeof nomes === 'string' ? nomes : '');
  } catch {
    return { cartoes: [], recusados: 1, nomesPorRecurso: {} };
  }
}
