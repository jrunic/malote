/**
 * Encerra o processo DEPOIS de o stdout e o stderr entregarem o que ja foi escrito (#1125).
 *
 * `process.exit` logo apos `console.log` perde o que o pipe ainda nao aceitou: a escrita em
 * pipe do Node e assincrona quando passa do buffer (64 KB), e o que ficou enfileirado morre
 * com o processo. Arquivo e terminal escondem o defeito porque escrevem de forma sincrona —
 * por isso so o agente, que le por pipe, via a resposta cortada.
 *
 * Escrever uma cadeia vazia com callback e esperar por ele garante que tudo o que veio antes
 * foi entregue (a fila e ordenada). O teto de 10 s evita pendurar o processo quando o leitor
 * nunca esvazia o pipe: perder a cauda da saida e melhor que nao sair.
 */
export function encerrar(codigo: number): void {
  const esvaziar = (fluxo: NodeJS.WriteStream): Promise<void> =>
    new Promise((resolver) => {
      // Leitor que fechou cedo (`| head`) devolve EPIPE: nao ha mais o que entregar.
      fluxo.once('error', () => resolver());
      fluxo.write('', () => resolver());
    });
  setTimeout(() => process.exit(codigo), 10_000).unref();
  void Promise.all([esvaziar(process.stdout), esvaziar(process.stderr)]).then(() =>
    process.exit(codigo),
  );
}
