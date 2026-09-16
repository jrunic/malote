import { rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { InquilinoId } from './tipos.js';

/**
 * Apaga o Acervo de um Inquilino para que ele seja recriado do material.
 *
 * A partir do ciclo 14, recriar deixou de ser a única saída para forma
 * divergente: do piso até a forma corrente o Acervo é MIGRADO por passos ao
 * abrir para escrita. Recriar continua existindo como ESCOLHA de quem opera —
 * para quem prefere refazer do material a migrar —, e continua sendo a saída
 * para forma anterior ao piso, que não tem passo escrito.
 *
 * Recriar é sempre ato explícito — nunca efeito de abrir o Acervo.
 *
 * Apaga TAMBÉM os arquivos de Anexo deste Inquilino sob o Destino de Mídia.
 * Até o ciclo 5 nenhum arquivo existia e o banco sozinho bastava; a partir do
 * momento em que trazer funciona, recriar sem esta metade deixa gigabytes que
 * nada reconstrói e nenhum Anexo reivindica.
 */
export interface OpcoesDeRecriar {
  /**
   * Raiz do Destino de Mídia. Ausente = não há arquivo a apagar (Inquilino sem
   * Destino configurado). Nunca é o gatilho para apagar a raiz inteira.
   */
  destino?: string | undefined;
}

/**
 * A subárvore deste Inquilino, garantidamente DENTRO da raiz do Destino.
 *
 * Esta é a única operação do produto que apaga recursivamente, e o valor que
 * decide o alvo vem de fora. Dois Inquilinos podem apontar para a mesma raiz —
 * `destinos_de_midia` não tem unicidade em `endereco` — então apagar a raiz
 * seria destruição cruzada, e um id capaz de escapar por `..` alcançaria o
 * disco inteiro.
 */
export function subarvoreDoInquilino(destino: string, inquilinoId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(inquilinoId)) {
    throw new Error(`Identificador de Inquilino invalido para apagar arvore: ${inquilinoId}`);
  }
  const raiz = resolve(destino);
  const alvo = resolve(join(destino, inquilinoId));
  if (!alvo.startsWith(raiz + sep)) {
    throw new Error(`Identificador de Inquilino invalido para apagar arvore: ${inquilinoId}`);
  }
  return alvo;
}

export function recriarAcervo(
  pasta: string,
  inquilinoId: InquilinoId,
  opcoes: OpcoesDeRecriar = {},
): void {
  // A subarvore e resolvida ANTES de apagar o banco: id invalido aborta com o
  // Acervo intacto, em vez de deixar o banco apagado e os arquivos de pe.
  const subarvore =
    opcoes.destino === undefined ? null : subarvoreDoInquilino(opcoes.destino, inquilinoId);

  const base = join(pasta, `${inquilinoId}.db`);
  for (const sufixo of ['', '-wal', '-shm']) {
    rmSync(`${base}${sufixo}`, { force: true });
  }
  if (subarvore !== null) rmSync(subarvore, { recursive: true, force: true });
}
