import { realpathSync } from 'node:fs';

/**
 * O que o modulo precisa saber de si mesmo para responder se e o ponto de
 * entrada. Recebido como parametro, e nao lido de `import.meta` la dentro,
 * porque `import.meta` do modulo que DEFINE a funcao nunca e o do modulo que
 * pergunta — e porque so assim os dois ramos abaixo sao testaveis.
 */
export interface MetaDoModulo {
  /** `import.meta.main`. Ausente em Node anterior a 22.18. */
  main?: boolean | undefined;
  /** `import.meta.filename` — sempre o REALPATH, nunca o caminho digitado. */
  filename: string;
}

/**
 * O modulo esta sendo executado como ponto de entrada?
 *
 * A forma ingenua — `import.meta.url === ` + `file://` + `process.argv[1]` —
 * erra em dois casos MEDIDOS, e erra da pior maneira possivel: o bloco de
 * entrada nao roda, nada e executado, e o processo sai 0. Quem invoca ve
 * sucesso e um acervo vazio.
 *
 *  (a) SYMLINK. `import.meta.url` resolve o realpath; `process.argv[1]` fica
 *      como foi digitado. Medido em 30/08/2026: invocada por um link, a CLI
 *      devolveu EXIT=0 e ZERO byte, contra 176 bytes pelo caminho real.
 *      Nao e caso exotico — `npm link` e instalacao global passam por ali.
 *
 *  (b) ESPACO OU ACENTO no caminho, sem symlink nenhum. `import.meta.url` e
 *      uma URL e vem percent-encoded; a concatenacao com o caminho cru nao.
 *      Medido no mesmo dia, num diretorio chamado "sonda h2": tambem `false`.
 *
 * `import.meta.main` responde a pergunta diretamente e acerta os dois casos —
 * medido nos quatro cenarios (entrada real, entrada por link, importado por
 * outro modulo pelos dois caminhos). Mas ele foi adicionado em **v24.2.0 e
 * v22.18.0**, e o `engines` deste pacote diz `>=22`: entre 22.0 e 22.17 o
 * campo e `undefined`, que e falsy. Confiar so nele reintroduziria ESTE bug,
 * com esta assinatura, para quem estivesse naquela faixa — e `engines` do npm
 * avisa, nao impede.
 *
 * Por isso o segundo ramo, que compara caminho com caminho: `realpathSync` do
 * lado digitado contra `filename`, que ja e realpath. Nenhum dos dois e URL,
 * entao (b) tambem nao alcanca esse ramo.
 */
export function ehPontoDeEntrada(meta: MetaDoModulo, invocado: string | undefined): boolean {
  if (typeof meta.main === 'boolean') return meta.main;
  if (invocado === undefined) return false;
  try {
    return realpathSync(invocado) === meta.filename;
  } catch {
    // Caminho inexistente ou link quebrado. Se o Node carregou este modulo a
    // partir dele, ele existe — logo, chegar aqui significa que a entrada foi
    // outra coisa. `false` e a resposta correta, nao um engolimento de erro.
    return false;
  }
}
