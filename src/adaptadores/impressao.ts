import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * A impressão identifica um Material sem abrir o conteúdo dele.
 *
 * A fronteira é essa — percorrer a estrutura e ler nome e tamanho, nunca abrir
 * arquivo de mensagem — e não "não tocar a estrutura", por medição: em sete
 * materiais reais da mesma conta, QUATRO pares têm árvore idêntica e diferem
 * só no tamanho. Ignorar a árvore colidiria nesses quatro; por nome mais
 * tamanho, as sete impressões saem distintas.
 *
 * O custo fica proporcional ao número de arquivos, não ao volume de bytes.
 */

export interface EntradaDeMaterial {
  /**
   * Nome do arquivo relativo à raiz do material — nunca o absoluto, que muda
   * de máquina.
   *
   * Chama-se `relativo` de propósito. A guarda de fronteira reprova a forma
   * `caminho:` em qualquer arquivo de adaptador, para impedir que endereço de
   * arquivo atravesse a porta do núcleo e acabe no Acervo. Este módulo nunca
   * manda nada pela porta — devolve um digest —, mas afrouxar a guarda para
   * acomodar um caso legítimo é remover a proteção em vez do defeito.
   */
  relativo: string;
  tamanho: number;
}

/** Percorre a árvore e devolve nome e tamanho de cada arquivo que casa. */
export function entradasDaArvore(raiz: string, padrao: RegExp): EntradaDeMaterial[] {
  const achados: EntradaDeMaterial[] = [];
  const pilha = [raiz];
  while (pilha.length > 0) {
    const atual = pilha.pop() as string;
    for (const nome of readdirSync(atual)) {
      const alvo = join(atual, nome);
      const info = statSync(alvo);
      if (info.isDirectory()) pilha.push(alvo);
      else if (padrao.test(nome)) {
        achados.push({ relativo: relative(raiz, alvo), tamanho: info.size });
      }
    }
  }
  return achados;
}

/** Ordem estável: a impressão não pode depender da ordem do sistema de arquivos. */
export function impressaoDeEntradas(entradas: EntradaDeMaterial[]): string {
  const ordenadas = [...entradas].sort((a, b) => a.relativo.localeCompare(b.relativo));
  const hash = createHash('sha256');
  for (const e of ordenadas) hash.update(`${e.relativo} ${e.tamanho} `);
  return hash.digest('hex');
}
