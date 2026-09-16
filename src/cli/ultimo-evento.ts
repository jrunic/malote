import { readFileSync, renameSync, writeFileSync } from 'node:fs';

/**
 * O efeito que sobrevive a morte do processo.
 *
 * Processo morto nao reporta a propria morte, e a conexao CAIR nao serve de
 * sinal: medido em 02/09/2026, a captura de 11h23 registrou quedas com codigo
 * 515 e 428 seguidas de religacao bem-sucedida — cair e rotina. O sinal de
 * parada e o instante do ultimo evento parar de avancar, comparado com o
 * relogio por quem esta de fora.
 *
 * Quem le e alarma NAO e este produto: e a camada de operacao da frota. Aqui
 * fica so a ponta que escreve, e ela e um ARQUIVO de proposito — verificar
 * abrindo o Acervo seria pior, porque abrir para escrita MIGRA a base, e um
 * verificador que roda de minuto em minuto nao pode ter esse poder.
 *
 * MORA AQUI, e nao sob `adaptadores/`, porque quem decide ONDE o arquivo cai e
 * quem monta a instalacao — e a guarda `nenhum adaptador conhece o layout de
 * arquivo em disco` reprovou a primeira colocacao, em 02/09/2026. Ela existia
 * para o layout de midia e valeu igual aqui, que e o sinal de que estava certa.
 */
export function marcarUltimoEvento(caminho: string, agora: number): void {
  // Temporario mais renomeacao: no sistema de arquivos a troca e atomica, e
  // quem le concorrentemente ve a versao antiga inteira ou a nova inteira —
  // nunca meia linha, que se leria como instante invalido em vez de erro.
  const parcial = `${caminho}.parcial`;
  writeFileSync(parcial, `${new Date(agora).toISOString()}\n`);
  renameSync(parcial, caminho);
}

/** O instante do ultimo evento, ou `null` — ausente ou ilegivel. */
export function lerUltimoEvento(caminho: string): number | null {
  let texto: string;
  try {
    texto = readFileSync(caminho, 'utf8');
  } catch {
    // Ausencia nao e erro: e ouvinte que nunca rodou para esta conta.
    return null;
  }
  const instante = Date.parse(texto.trim());
  return Number.isNaN(instante) ? null : instante;
}
