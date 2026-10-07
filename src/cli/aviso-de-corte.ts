import type { OrdemDaBusca } from '../nucleo/consulta.js';

/** A linha que diz que o `buscar` cortou, quantas mostrou, em que ordem, e o que muda isso. */
export function avisoDeCorte(limite: number, ordem: OrdemDaBusca): string {
  const quais = ordem === 'recentes' ? 'mais recentes' : 'mais antigas';
  const outra = ordem === 'recentes' ? 'cronologica' : 'recentes';
  return `Mostrando as ${limite} ${quais}; ha mais resultados. Use --desde, --ate ou --limite para ajustar, ou --ordem ${outra}.`;
}
