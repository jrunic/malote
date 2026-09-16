const FLUXOS_DE_CONVERSA = new Set([
  'chats.update',
  'chats.upsert',
  'messaging-history.set',
]);

export type ClasseDeEstado = 'retrato' | 'atualizacao' | 'ignorar';

export function itensDeConversa(fluxo: string, dado: unknown): unknown[] {
  if (fluxo === 'messaging-history.set') {
    if (dado === null || typeof dado !== 'object') return [];
    const chats = (dado as { chats?: unknown }).chats;
    return Array.isArray(chats) ? chats : [];
  }
  return Array.isArray(dado) ? dado : dado === undefined || dado === null ? [] : [dado];
}

function chavesDe(item: unknown): string[] {
  if (item === null || typeof item !== 'object') return [];
  return Object.keys(item as Record<string, unknown>);
}

export function classificarEstado(fluxo: string, dado: unknown): ClasseDeEstado {
  if (!FLUXOS_DE_CONVERSA.has(fluxo)) return 'ignorar';
  const itens = itensDeConversa(fluxo, dado);
  const chaves = new Set(itens.flatMap(chavesDe));
  const falaDeMarca = chaves.has('pinned') || chaves.has('archived');
  if (!falaDeMarca) return 'ignorar';
  return itens.length >= 30 ? 'retrato' : 'atualizacao';
}
