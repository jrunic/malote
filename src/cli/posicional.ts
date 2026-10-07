import { BANDEIRAS } from './bandeiras.js';

/**
 * O primeiro argumento, depois da posicao `depoisDe`, que nao e opcao nem valor de opcao. As
 * bandeiras (`BANDEIRAS`) nao levam valor; qualquer outra `--opcao` leva um valor, que se pula —
 * sem isso o valor de `--fonte` viraria o argumento posicional. Ler o MESMO registro que a validacao
 * evita duas fontes de verdade sobre o que e bandeira.
 */
export function primeiroPosicional(argumentos: string[], depoisDe: number): string | undefined {
  const resto = argumentos.slice(depoisDe);
  for (let i = 0; i < resto.length; i += 1) {
    const a = resto[i] as string;
    if (!a.startsWith('--')) return a;
    if (!BANDEIRAS.has(a.slice(2))) i += 1;
  }
  return undefined;
}
