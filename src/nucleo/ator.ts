import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * O Ator: por ordem de QUEM uma Operacao aconteceu.
 *
 * O ciclo 8 construiu a trilha sem este campo, por uma razao medida: nao
 * existia identidade verificavel, e gravar rotulo autodeclarado num registro de
 * auditoria "se le como prova sem ser". O ciclo 11 cria a identidade — a Chave
 * de Acesso e a verificacao que devolve quem —, e o campo passa a poder existir.
 *
 * VOCABULARIO FECHADO, quatro formas, e cada uma diz o que garante:
 *
 *   operador:<id>  provado por Chave de Operador verificada
 *   acesso:<id>    provado por Chave de Acesso verificada
 *   servico:<nome> declarado pelo DEPLOY, nao pelo chamador — garantia mais
 *                  fraca que as duas acima, e a diferenca esta dita aqui de
 *                  proposito: comando de usuario nao consegue se passar por
 *                  servico, mas quem configura o servico escolhe o nome
 *   local          uma pessoa rodou um comando sem apresentar credencial —
 *                  fato que o sistema conhece, nao rotulo que alguem escolheu
 */

/** Ninguem declarou. NAO e o mesmo que `local`, e nao e o mesmo que ausente. */
export const INDETERMINADO = 'indeterminado';

export const LOCAL = 'local';

export function atorDeOperador(chaveId: string): string {
  return `operador:${chaveId}`;
}

export function atorDeAcesso(chaveId: string): string {
  return `acesso:${chaveId}`;
}

export function atorDeServico(nome: string): string {
  return `servico:${nome}`;
}

/**
 * O escopo. `AsyncLocalStorage` e da biblioteca padrao — nao acrescenta
 * dependencia, e o criterio 22 da spec continua valendo.
 *
 * Uma variavel de modulo resolveria a CLI e o ouvinte, que tem um Ator so do
 * comeco ao fim. Ela QUEBRA no servidor do plano 3, que atende requisicoes
 * concorrentes com Chaves diferentes: a Operacao de uma sairia com o Ator de
 * outra, e o defeito seria intermitente e proporcional a carga.
 *
 * A alternativa sem biblioteca — salvar e restaurar ao redor de uma funcao —
 * funciona ENQUANTO a funcao for sincrona, e a primeira funcao assincrona a
 * passar por ali devolve o vazamento, agora disfarcado.
 */
const escopo = new AsyncLocalStorage<string>();

/**
 * As formas que `comAtor` aceita. O vocabulario e fechado por MECANISMO, e nao
 * por convencao: `comAtor('deus:eu', fn)` tem de ser recusado, senao o campo
 * volta a ser rotulo livre — que e a razao pela qual o ciclo 8 o deixou de
 * fora. `indeterminado` nao esta aqui de proposito: e o default, nunca uma
 * declaracao.
 */
const FORMA_VALIDA = /^(?:operador|acesso|servico):.+$|^local$/;

export function comAtor<T>(ator: string, trabalho: () => T): T {
  if (!FORMA_VALIDA.test(ator)) {
    throw new Error(
      `Ator fora do vocabulario: ${ator}. ` +
        'Use operador:<id>, acesso:<id>, servico:<nome> ou local.',
    );
  }
  return escopo.run(ator, trabalho);
}

export function atorAtual(): string {
  return escopo.getStore() ?? INDETERMINADO;
}
