// Import so de tipo, apagado em runtime: nao cria ciclo de modulo com `ao-vivo.ts`, que importa este arquivo.
import type { MensagemRecebida } from './ao-vivo.js';
import type { Acervo } from '../../nucleo/acervo.js';
import { resolverEndereco } from '../../nucleo/correspondencia.js';
import { emOperacao } from '../../nucleo/trilha.js';
import { lerMetadadosDeColetiva, registrarConversa, registrarMetadadosDeColetiva } from '../../nucleo/escrita.js';

const FONTE = 'whatsapp' as const;

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

/**
 * Grava o evento de grupo. Chamado de DENTRO da Operacao do evento, ao lado da gravacao da Mensagem sem texto:
 * se a Mensagem for recusada, a Operacao inteira se desfaz, e a tolerancia de relogio vale para os dois.
 * Devolve se a linha mudou.
 *
 * Cria a Conversa coletiva se ela ainda nao existe (decisao D1 da spec), como a Etiqueta e a Transicao.
 */
export function gravarMetadadosDoEvento(acervo: Acervo, m: MensagemRecebida, mudanca: MudancaDeMetadados): boolean {
  const enderecoDaConversa = resolverEndereco(acervo, FONTE, m.key.remoteJid);
  const conversaId = registrarConversa(acervo, {
    fonte: FONTE,
    idExterno: enderecoDaConversa,
    coletiva: true,
    bruto: JSON.stringify(m.key),
  });
  // O autor e o que o evento declara, na forma canonica quando o Acervo a conhece. Nunca por `fromMe`.
  const alteradoPor = mudanca.autor === undefined ? undefined : resolverEndereco(acervo, FONTE, mudanca.autor);
  const texto = mudanca.texto;
  return registrarMetadadosDeColetiva(acervo, conversaId, {
    ...(mudanca.acao === 'remover' ? { removerDescricao: true } : {}),
    ...(texto !== undefined && mudanca.natureza === 'descricao' ? { descricao: texto } : {}),
    ...(texto !== undefined && mudanca.natureza !== 'descricao' ? { assunto: texto } : {}),
    ...(alteradoPor !== undefined ? { alteradoPor } : {}),
    alteradoEm: new Date(mudanca.instante).toISOString(),
    // Reentrega do mesmo evento, ou texto que o aviso ja gravou, nao reescreve nada.
    soSeMudar: true,
  });
}

export interface ResultadoDoAviso {
  gravados: number;
  repetidos: number;
}

/**
 * Grava os avisos de metadados de grupo: a COBERTURA do evento de grupo, que nao depende da Mensagem. Quem chama ja
 * decidiu LENDO que ha o que gravar (`processarAvisoDeGrupo`): o aviso chega milissegundos depois do evento, com o
 * mesmo texto, e nao pode sobrescrever o instante dele. Na troca, que nao traz instante, usa o de chegada.
 */
export function gravarAvisosDeGrupo(acervo: Acervo, avisos: readonly AvisoDeGrupo[], agora: number): ResultadoDoAviso {
  const resultado: ResultadoDoAviso = { gravados: 0, repetidos: 0 };
  for (const a of avisos) {
    const enderecoDaConversa = resolverEndereco(acervo, FONTE, a.grupo);
    // O `bruto` so entra quando o aviso CRIA a Conversa, e e o item cru: numa Conversa que ja existe, `registrarConversa`
    // o reescreveria, e o aviso trocaria o bruto do evento pela forma do aviso.
    const conversaId =
      lerMetadadosDeColetiva(acervo, FONTE, enderecoDaConversa).conversaId ??
      registrarConversa(acervo, { fonte: FONTE, idExterno: enderecoDaConversa, coletiva: true, bruto: a.bruto });
    const alteradoPor = a.autor === undefined ? undefined : resolverEndereco(acervo, FONTE, a.autor);
    const gravou = registrarMetadadosDeColetiva(acervo, conversaId, {
      ...(a.assunto !== undefined ? { assunto: a.assunto } : {}),
      ...(a.descricao !== undefined ? { descricao: a.descricao } : {}),
      ...(alteradoPor !== undefined ? { alteradoPor } : {}),
      alteradoEm: new Date(a.instante ?? agora).toISOString(),
    });
    if (gravou) resultado.gravados += 1;
    else resultado.repetidos += 1;
  }
  return resultado;
}

export interface ResultadoDoAvisoLido extends ResultadoDoAviso {
  semTexto: number;
  foraDeGrupo: number;
}

/** Le e grava o aviso de metadados de grupo que a conexao entregou. So contagens: o texto nunca sai daqui. */
export function processarAvisoDeGrupo(acervo: Acervo, fluxo: string, dado: unknown, agora: number): ResultadoDoAvisoLido {
  const lidos = lerAvisoDeGrupo(fluxo, dado);
  // DECIDE LENDO, como a Etiqueta de Participacao: o aviso chega depois de TODO evento de grupo, com o mesmo texto, e
  // abrir Operacao para ele geraria uma Operacao sem efeito por troca de grupo, num ouvinte que roda por meses. So se
  // abre a Operacao quando a Conversa nao existe ou o texto difere do gravado.
  const pendentes = lidos.avisos.filter((a) => {
    const atual = lerMetadadosDeColetiva(acervo, FONTE, resolverEndereco(acervo, FONTE, a.grupo));
    return (
      atual.conversaId === undefined ||
      (a.assunto !== undefined && a.assunto !== atual.assunto) ||
      (a.descricao !== undefined && a.descricao !== atual.descricao)
    );
  });
  const gravacao =
    pendentes.length === 0
      ? { gravados: 0, repetidos: 0 }
      : emOperacao(
          acervo,
          { natureza: 'receber-ao-vivo', reversibilidade: 'irreversivel', registraEfeito: false },
          () => gravarAvisosDeGrupo(acervo, pendentes, agora),
        );
  return {
    gravados: gravacao.gravados,
    repetidos: gravacao.repetidos + (lidos.avisos.length - pendentes.length),
    semTexto: lidos.semTexto,
    foraDeGrupo: lidos.foraDeGrupo,
  };
}
