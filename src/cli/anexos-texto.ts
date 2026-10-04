import type { AnexoDaConversa } from '../nucleo/anexos-da-conversa.js';

const APELIDOS_DE_TIPO: Record<string, string> = { imagem: 'image', documento: 'document' };

/**
 * `--tipo` aceita o vocabulario do Acervo (`image`, `document`, ...) e os apelidos de `malote
 * enviar` (`imagem`, `documento`). So a CLI traduz: a rota e exata, e `--tipo imagem` nunca deve
 * devolver lista vazia por ser a palavra errada.
 */
export function tipoGuardado(tipo: string): string {
  return APELIDOS_DE_TIPO[tipo] ?? tipo;
}

/** Uma linha por Anexo; o id e o que se passa a `malote midia <id> --saida <arquivo>`. */
export function formatarAnexos(anexos: AnexoDaConversa[]): string[] {
  if (anexos.length === 0) return ['Nenhum Anexo encontrado com estes filtros.'];
  return anexos.map((a) => {
    const tamanho = a.tamanho === null ? '(tamanho desconhecido)' : `${a.tamanho} bytes`;
    return [new Date(a.ocorridaEm).toISOString(), a.tipo, a.presenca, tamanho, a.nomeOriginal ?? '(sem nome)', a.id].join(
      '  ',
    );
  });
}
