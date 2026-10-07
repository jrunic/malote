import { opcao } from './bandeiras.js';

/**
 * `--chave-em` NOMEIA a variavel de ambiente (nunca recebe o valor). Pedida e ausente ou vazia,
 * RECUSA: cair na chave padrao mandaria o pedido pelo Inquilino errado.
 */
export function resolverChaveEm(
  argumentos: string[],
  env: Record<string, string | undefined>,
  chavePadrao: string | undefined,
): { chave: string | undefined } | { erro: string } {
  const nome = opcao(argumentos, 'chave-em');
  if (nome === undefined) return { chave: chavePadrao };
  const valor = env[nome];
  if (valor === undefined || valor.trim() === '') {
    return {
      erro:
        `A variavel ${nome} (--chave-em) nao esta definida ou esta vazia; ` +
        'nao uso outra chave no lugar dela.',
    };
  }
  return { chave: valor.trim() };
}
