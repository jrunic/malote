import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * O DERRAME — onde o evento vai quando o Acervo esta ocupado.
 *
 * POR QUE ELE EXISTE, medido em 08/09/2026 contra a conta real: com a conversao
 * rodando, o ouvinte morreu em tres minutos com `SQLITE_BUSY` nao tratado
 * dentro do envelope de Operacao, e o unit NAO o reergueu — o proprio unit
 * declara `RestartPreventExitStatus=0 1 2 78`, e o processo sai com 1. Ficar
 * caido e deliberado.
 *
 * AS TRES SAIDAS QUE NAO SERVEM, e por que:
 *
 *   - Esperar mais. `better-sqlite3` e SINCRONO, e o `busy_timeout` bloqueia a
 *     THREAD. Uma espera de minutos congelaria o WebSocket e derrubaria a
 *     conexao por outro caminho.
 *   - Contar como recusa. A Fonte nao reentrega: recusar e PERDER, e nao
 *     perder Mensagem e a razao de o produto existir.
 *   - Tornar o manipulador assincrono. Muda a ordem de escrita, e a ordem
 *     importa — a correspondencia de endereco tem de ser aprendida antes do
 *     laco, e inverter isso ja foi defeito real em 03/09/2026.
 *
 * O que sobra e escrever o evento CRU num arquivo e reprocessa-lo depois. A
 * captura fica atrasada enquanto houver disputa; nao fica perdida. E a divida
 * e visivel: o arquivo existe, tem tamanho, e ha comando que o esvazia.
 *
 * Uma linha por LOTE, e nao por Mensagem: o lote e a unidade que
 * `receberEvento` recebe, e reprocessar na mesma granularidade preserva o
 * envelope de Operacao unico que ele abre.
 */

// O discriminante mora no NUCLEO: o adaptador de recepcao precisa da mesma
// resposta, e adaptador nao importa de `cli/`.
export { ehBancoOcupado } from '../nucleo/erro-de-banco.js';

/** Acrescenta o lote ao derrame. Cria a pasta se preciso. */
export function derramar(caminho: string, mensagens: readonly unknown[]): void {
  mkdirSync(dirname(caminho), { recursive: true });
  appendFileSync(caminho, `${JSON.stringify(mensagens)}\n`);
}

/**
 * Os lotes derramados, em ordem.
 *
 * Linha ilegivel e PULADA, nao aborta a leitura: o derrame e escrito por um
 * processo que pode morrer no meio de uma linha, e perder tudo por causa da
 * ultima seria trocar um problema pequeno por um grande.
 */
export function lerDerrame(caminho: string): unknown[][] {
  let texto: string;
  try {
    texto = readFileSync(caminho, 'utf8');
  } catch {
    // Ausencia nao e erro: e ouvinte que nunca precisou derramar.
    return [];
  }
  const lotes: unknown[][] = [];
  for (const linha of texto.split('\n')) {
    if (linha.trim() === '') continue;
    try {
      const lote = JSON.parse(linha) as unknown;
      if (Array.isArray(lote)) lotes.push(lote);
    } catch {
      continue;
    }
  }
  return lotes;
}

/** Quantos LOTES estao parados. E a unidade que a drenagem consome. */
export function contarDerrame(caminho: string): number {
  return lerDerrame(caminho).length;
}

/**
 * Quantos EVENTOS estao parados — a soma dos comprimentos dos lotes.
 *
 * As duas contagens existem porque respondem a perguntas diferentes: a drenagem
 * trabalha por lote, e quem pergunta "o que esta parado?" quer saber de
 * Mensagem. Um lote de cinco e UM lote e CINCO eventos, e reportar o primeiro
 * numero onde a pergunta pede o segundo diria 1 onde a resposta e 5.
 */
export function contarEventosDerramados(caminho: string): number {
  return lerDerrame(caminho).reduce((soma, lote) => soma + lote.length, 0);
}

/**
 * Tira o PRIMEIRO lote do derrame, preservando a ordem do resto.
 *
 * A ORDEM DA OPERACAO E OBRIGATORIA, e quem chama tem de respeita-la: grava no
 * Acervo PRIMEIRO, remove daqui DEPOIS. Invertido, morrer no meio apaga o que
 * nunca entrou. Nesta ordem, morrer no meio deixa o lote nos DOIS lugares — e a
 * unicidade de identificador externo descarta a repeticao na drenagem seguinte.
 * Repeticao e barata; perda nao tem volta.
 *
 * A reescrita usa temporario mais renomeacao, que no sistema de arquivos e troca
 * atomica — o mesmo padrao de `ultimo-evento.ts`, e pelo mesmo motivo: quem le
 * concorrentemente ve a versao antiga inteira ou a nova inteira, nunca meia.
 */
export function removerPrimeiroLote(caminho: string): void {
  // A reescrita sai de `lerDerrame`, que PULA linha ilegivel — entao reescrever
  // tambem a descarta. E decisao, nao acidente: linha parcial e dado que ja se
  // perdeu quando o processo morreu no meio de um `appendFileSync`, e mante-la
  // so faria a proxima leitura pular de novo, para sempre.
  const restantes = lerDerrame(caminho).slice(1);
  if (restantes.length === 0) {
    descartarDerrame(caminho);
    return;
  }
  const parcial = `${caminho}.parcial`;
  writeFileSync(parcial, `${restantes.map((l) => JSON.stringify(l)).join('\n')}\n`);
  renameSync(parcial, caminho);
}

/** Onde o lote que falhou por algo que NAO e disputa vai parar. */
export function caminhoDoEnvenenado(caminho: string): string {
  return `${caminho}.envenenado.jsonl`;
}

/**
 * Move o PRIMEIRO lote para o arquivo do envenenado, com a causa junto.
 *
 * DECIDIDO NO GATE DE 09/09/2026. Sem isto, um lote que falha por erro que NAO e
 * disputa fica no derrame para sempre: a excecao sobe, mata o ouvinte, o unit
 * nao o reergue (`RestartPreventExitStatus=0 1 2 78`), alguem religa, a primeira
 * escrita boa dispara a drenagem, e o mesmo lote mata de novo. Antes do derrame
 * um evento venenoso derrubava UMA vez e passava; persistido, derruba para
 * sempre.
 *
 * NAO e engolir o erro: o lote e preservado, a causa vai junto, e quem chama
 * avisa alto. O que muda e quem paga — o lote fica de fora, nao o ouvinte.
 */
export function moverLoteEnvenenado(caminho: string, erro: unknown): void {
  const primeiro = lerDerrame(caminho)[0];
  if (primeiro === undefined) return;
  appendFileSync(
    caminhoDoEnvenenado(caminho),
    `${JSON.stringify({ movidoEm: new Date().toISOString(), causa: String(erro), lote: primeiro })}\n`,
  );
  removerPrimeiroLote(caminho);
}

/** Apaga o derrame. So depois de reprocessar com sucesso. */
export function descartarDerrame(caminho: string): void {
  rmSync(caminho, { force: true });
}
