// Import so de tipo, apagado em runtime: nao cria ciclo de modulo com `ao-vivo.ts`, que importa este
// arquivo. O parametro e a `MensagemRecebida` inteira, e nao um recorte dela, porque literal com
// propriedade a mais e erro de compilacao.
import type { MensagemRecebida } from './ao-vivo.js';

/**
 * Reconhece, na Mensagem que a recepcao ja normalizou, o evento de mudanca de
 * Etiqueta de Participacao. Puro: nao abre banco nem biblioteca, e e AQUI que moram
 * `protocolMessage` e `memberLabel` — o nucleo nao nomeia ferramenta.
 *
 * Forma medida em campo (05/10/2026): o evento chega por `messages.upsert` como
 * Mensagem de grupo cujo `protocolMessage.type` e o NOME do enum
 * (`GROUP_MEMBER_LABEL_CHANGE`) — o numero 30 e a forma do proto, e o round-trip
 * de JSON da conexao entrega o nome. A biblioteca ja entregou o mesmo tipo como
 * nome e como numero em lugares diferentes, entao as duas formas entram; um
 * filtro so pelo numero perdeu todos os eventos reais na segunda rodada da
 * espiga.
 *
 * `label` e `labelTimestamp` chegam STRING. Remover a etiqueta e um evento com
 * `label` vazio, nunca a ausencia do campo.
 */
export interface MudancaDeEtiqueta {
  /** O texto que o membro passou a ter. Vazio e a remocao. */
  texto: string;
  /** O instante que a Fonte declarou, em milissegundos. */
  instante: number;
  /** O `protocolMessage` inteiro: o Adaptador nao escolhe colunas. */
  bruto: string;
}

const TIPOS_DE_ETIQUETA = new Set(['GROUP_MEMBER_LABEL_CHANGE', '30']);

export function lerMudancaDeEtiqueta(m: MensagemRecebida): MudancaDeEtiqueta | null {
  const protocolo = m.message?.['protocolMessage'];
  if (protocolo === null || typeof protocolo !== 'object') return null;
  const p = protocolo as Record<string, unknown>;
  // O tipo e OBRIGATORIO: qualquer outro protocolMessage (recibo, edicao,
  // revogacao) segue ignorado e contado por tipo, mesmo que um dia traga
  // `memberLabel` ao lado.
  if (!TIPOS_DE_ETIQUETA.has(String(p['type']))) return null;
  const etiqueta = p['memberLabel'];
  if (etiqueta === null || typeof etiqueta !== 'object') return null;
  const e = etiqueta as Record<string, unknown>;
  if (typeof e['label'] !== 'string') return null;
  const declarado = Number(e['labelTimestamp']);
  // Nunca o instante de RECEBIMENTO: ausente ou ilegivel cai no instante da
  // Mensagem que carrega o evento (a Fonte difere dele em 0 a 1 s).
  const segundos = Number.isFinite(declarado) && declarado > 0 ? declarado : m.messageTimestamp;
  return { texto: e['label'], instante: segundos * 1000, bruto: JSON.stringify(p) };
}
