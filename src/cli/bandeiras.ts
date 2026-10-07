/**
 * Registro das flags da CLI e a validacao delas (#1136).
 *
 * Toda `--flag` que NAO esta em `BANDEIRAS` leva valor. O leitor antigo devolvia "o argumento
 * seguinte" sem olhar se ele existia nem se era outra flag: `conversas --coletiva` devolvia tudo
 * (o filtro sumia) e `conversas --coletiva --json` lia `--json` como o valor de `--coletiva` e
 * devolvia so as diretas. A validacao e PURA e nao lanca: o catch externo da CLI devolve 1, e o
 * contrato e codigo 2, entao quem chama devolve o 2.
 *
 * Limitacao conhecida: `--flag=valor` nao existe, entao nao ha como passar um valor literal que
 * comece com `--`.
 */

/** As flags SEM valor, medidas no codigo (`temBandeira` e `includes('--x')`). */
export const BANDEIRAS: ReadonlySet<string> = new Set([
  'json',
  'ajuda',
  'versao',
  'confirmo',
  'com-efeito',
  'reprocessar',
  'exposto',
  'sobrescrever',
  'incluir-absorvidas',
  'historico',
]);

/** Flags cujo valor e de um conjunto fechado; fora dele, `true` virava `false` em silencio. */
export const VALORES_FECHADOS: Readonly<Record<string, readonly string[]>> = {
  coletiva: ['true', 'false'],
  fixada: ['true', 'false'],
};

/**
 * A mensagem do primeiro erro de flag, ou `undefined` quando a linha esta certa. O primeiro
 * argumento e o comando e nao e validado.
 */
export function validarBandeiras(argumentos: string[]): string | undefined {
  for (let i = 1; i < argumentos.length; i += 1) {
    const a = argumentos[i] as string;
    if (!a.startsWith('--')) continue;
    const nome = a.slice(2);
    if (BANDEIRAS.has(nome)) continue;
    const valor = argumentos[i + 1];
    if (valor === undefined || valor.startsWith('--')) return `A flag ${a} pede um valor.`;
    const aceitos = VALORES_FECHADOS[nome];
    if (aceitos !== undefined && !aceitos.includes(valor)) {
      return `A flag ${a} aceita ${aceitos.join(' ou ')}.`;
    }
    // O valor nao precisa ser pulado: ele nao comeca com `--` (senao ja teria saido como erro), entao
    // a proxima volta do laco o ignora.
  }
  return undefined;
}

/**
 * O topo de cada ponto de entrada: erro de flag e codigo 2, dito com a mensagem, antes de abrir
 * base, de abrir socket ou de fazer requisicao. Devolve `undefined` quando a linha esta certa.
 */
export function recusarBandeiras(argumentos: string[], escrever: (texto: string) => void): number | undefined {
  const erro = validarBandeiras(argumentos);
  if (erro === undefined) return undefined;
  escrever(erro);
  return 2;
}

/** Le `--nome valor`. A linha ja passou por `validarBandeiras`, entao o valor existe quando a flag existe. */
export function opcao(argumentos: string[], nome: string): string | undefined {
  const i = argumentos.indexOf(`--${nome}`);
  if (i === -1) return undefined;
  return argumentos[i + 1];
}

/** Todas as ocorrencias de uma bandeira repetida, na ordem em que aparecem. */
export function todasAsOpcoes(argumentos: string[], nome: string): string[] {
  const achados: string[] = [];
  for (let i = 0; i < argumentos.length; i += 1) {
    if (argumentos[i] === `--${nome}`) {
      const valor = argumentos[i + 1];
      if (valor !== undefined) achados.push(valor);
    }
  }
  return achados;
}

/** A flag sem valor esta presente? */
export function temBandeira(argumentos: string[], nome: string): boolean {
  return argumentos.includes(`--${nome}`);
}
