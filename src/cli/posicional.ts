/**
 * O primeiro argumento, depois da posicao `depoisDe`, que nao e opcao nem valor de opcao.
 * `--json` e bandeira (sem valor); qualquer outra `--opcao` leva um valor, que se pula — sem
 * isso o valor de `--fonte` viraria o argumento posicional.
 */
export function primeiroPosicional(argumentos: string[], depoisDe: number): string | undefined {
  const resto = argumentos.slice(depoisDe);
  for (let i = 0; i < resto.length; i += 1) {
    const a = resto[i] as string;
    if (a === '--json') continue;
    if (a.startsWith('--')) {
      i += 1;
      continue;
    }
    return a;
  }
  return undefined;
}
