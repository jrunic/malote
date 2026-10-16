/**
 * Cursor opaco da listagem de Conversas (#1202). Tem forma PROPRIA, e nao o `{ocorridaEm, id}` das Mensagens: a
 * listagem tem duas ordens, cada uma com o seu par estavel, e o instante de criacao da Conversa e TEXTO.
 *
 * - `criacao` (a padrao): (instante de criacao, id). O instante sozinho nao pagina, porque o backup grava Conversas em
 *   lote no mesmo instante; o id desempata.
 * - `atividade` (com `desde`): (instante da ultima Mensagem, id), do mais recente para o mais antigo.
 *
 * O token carrega a ordem a que pertence: o de uma ordem em outra e invalido, e quem o recebe responde 400.
 */
export type OrdemDaListagem = 'criacao' | 'atividade';

export type CursorDeConversas =
  | { ordem: 'criacao'; valor: string; id: string }
  | { ordem: 'atividade'; valor: number; id: string };

export function codificarCursorDeConversas(c: CursorDeConversas): string {
  return Buffer.from(JSON.stringify([c.ordem, c.valor, c.id])).toString('base64url');
}

export function decodificarCursorDeConversas(token: string): CursorDeConversas | undefined {
  try {
    const partes: unknown = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (!Array.isArray(partes) || partes.length !== 3 || typeof partes[2] !== 'string') return undefined;
    const [ordem, valor, id] = partes as [unknown, unknown, string];
    if (ordem === 'criacao' && typeof valor === 'string') return { ordem, valor, id };
    if (ordem === 'atividade' && typeof valor === 'number') return { ordem, valor, id };
    return undefined;
  } catch {
    return undefined;
  }
}
