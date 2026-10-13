import type { ContatoCompartilhadoLido } from '../nucleo/contato-compartilhado.js';

/**
 * Uma linha por Contato Compartilhado, para a saida de texto de `mensagens` e `buscar` e para o
 * `exportar`: o nome (e a organizacao, quando ha) e os telefones e e-mails como a Fonte entregou.
 * Aceita `undefined` de proposito: servidor anterior a este campo nao o devolve, e o cliente
 * trata a ausencia como lista vazia.
 */
export function linhasDeContatoCompartilhado(
  cartoes: readonly ContatoCompartilhadoLido[] | undefined,
  recuo = '    ',
): string[] {
  return (cartoes ?? []).map((c) => {
    const quem = c.organizacao !== null && c.organizacao !== c.nome ? `${c.nome} — ${c.organizacao}` : c.nome;
    const valores = c.valores.map((v) => v.texto).join(', ');
    return `${recuo}[contato: ${quem}]${valores === '' ? '' : ` ${valores}`}`;
  });
}
