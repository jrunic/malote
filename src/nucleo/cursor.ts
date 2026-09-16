/**
 * Cursor opaco de paginacao de Mensagens: composto de (ocorridaEm, id) — o
 * MESMO par que ordena a consulta. O instante sozinho nao pagina: duas
 * Mensagens podem ter o mesmo instante, e o limite caindo no meio desse
 * conjunto pularia (exclusivo) ou repetiria (inclusivo) — achado da revisao
 * do ciclo 21.
 *
 * O consumidor nunca monta cursor: recebe `proximo` da resposta e devolve em
 * `--antes`. O token e opaco de proposito — a forma interna pode mudar sem
 * quebrar quem consulta.
 */
export interface CursorDePaginacao {
  ocorridaEm: number;
  id: string;
}

export function codificarCursor(c: CursorDePaginacao): string {
  return Buffer.from(JSON.stringify([c.ocorridaEm, c.id])).toString('base64url');
}

export function decodificarCursor(token: string): CursorDePaginacao | undefined {
  try {
    const partes = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (
      Array.isArray(partes) &&
      partes.length === 2 &&
      typeof partes[0] === 'number' &&
      typeof partes[1] === 'string'
    ) {
      return { ocorridaEm: partes[0], id: partes[1] };
    }
    return undefined;
  } catch {
    return undefined;
  }
}
