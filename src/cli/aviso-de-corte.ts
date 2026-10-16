import type { OrdemDaBusca } from '../nucleo/consulta.js';

/** A linha que diz que o `buscar` cortou, quantas mostrou, em que ordem, e o que muda isso. */
export function avisoDeCorte(limite: number, ordem: OrdemDaBusca): string {
  const quais = ordem === 'recentes' ? 'mais recentes' : 'mais antigas';
  const outra = ordem === 'recentes' ? 'cronologica' : 'recentes';
  return `Mostrando as ${limite} ${quais}; ha mais resultados. Use --desde, --ate ou --limite para ajustar, ou --ordem ${outra}.`;
}

/**
 * A linha que diz que `conversas` cortou na primeira pagina (#1202): quantas mostrou, o cursor da proxima (para colar em
 * `--antes`) e o `--tudo`, que entrega a lista inteira. Sem ela, a primeira pagina passaria pela lista toda.
 */
export function avisoDeCorteDeConversas(mostradas: number, proximo: string): string {
  return `Mostrando as primeiras ${mostradas} Conversas; ha mais. Use --tudo para a lista inteira, ou --antes ${proximo} para a proxima pagina.`;
}
