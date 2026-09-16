/**
 * Se o erro e DISPUTA DE ESCRITA — e so ela.
 *
 * Mora no nucleo porque dois lados precisam da mesma resposta: o adaptador de
 * recepcao, que nao pode contar disputa como recusa de dado, e a camada de
 * comando, que derrama o evento em vez de morrer.
 *
 * O CODIGO DECIDE, NUNCA A MENSAGEM. Um teste por texto engole defeito de
 * produto: invariante violado, natureza de Conversa divergente, erro de tipo —
 * todos trazem mensagens que mudam entre versoes da biblioteca, e nenhum e
 * disputa.
 */
export function ehBancoOcupado(erro: unknown): boolean {
  return (
    typeof erro === 'object' &&
    erro !== null &&
    (erro as { code?: unknown }).code === 'SQLITE_BUSY'
  );
}
