/**
 * Mimetype pelo nome do arquivo. Uma tabela so, usada pelo `malote enviar` local e pelo
 * por rede: duplica-la deixaria os dois modos divergirem em silencio (o mesmo PDF sairia
 * com tipos diferentes conforme o modo). Cobre os tipos comuns; nao e objetivo cobrir todos.
 */
const MIMETYPE_POR_EXTENSAO: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
};

export function mimetypeDoCaminho(caminho: string): string {
  const ponto = caminho.lastIndexOf('.');
  const extensao = ponto === -1 ? '' : caminho.slice(ponto).toLowerCase();
  return MIMETYPE_POR_EXTENSAO[extensao] ?? 'application/octet-stream';
}
