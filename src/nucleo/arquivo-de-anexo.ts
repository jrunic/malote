import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  linkSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { Acervo } from './acervo.js';
import { caminhoDeMidia } from './caminho-de-midia.js';

/**
 * Gravar o arquivo de um Anexo sob o Destino de Mídia.
 *
 * O Adaptador entrega os BYTES; quem decide onde eles caem é o núcleo. É o que
 * mantém o layout uniforme entre Fontes e o caminho livre de dado pessoal — o
 * Adaptador conhece o nome original e o endereço da origem, e nenhum dos dois
 * atravessa esta fronteira.
 */

/**
 * Destino que sumiu não é estado do Acervo: é condição de execução. A Presença
 * do Anexo não muda, e quem chamou decide se aborta ou contabiliza.
 */
export class DestinoInacessivelError extends Error {
  constructor(
    readonly destino: string,
    causa?: unknown,
  ) {
    super(`Destino de Midia inacessivel: ${destino}`, { cause: causa });
    this.name = 'DestinoInacessivelError';
  }
}

export interface EntradaDeArquivo {
  anexoId: string;
  /** Raiz do Destino de Mídia deste Inquilino. */
  destino: string;
  bytes: Buffer;
}

/** Devolve o caminho relativo gravado no Acervo. */
export function gravarArquivoDeAnexo(acervo: Acervo, entrada: EntradaDeArquivo): string {
  const linha = acervo.preparar('SELECT tipo FROM anexos WHERE id = ?').get(entrada.anexoId) as
    { tipo: string } | undefined;
  if (linha === undefined) throw new Error(`Anexo desconhecido: ${entrada.anexoId}`);

  // O Inquilino vem do ACERVO em que a linha esta sendo escrita, nunca de
  // parametro: chamador que o errasse gravaria o arquivo na subarvore de outro
  // Inquilino com a linha aqui — o atravessamento que a guarda existe para
  // matar por construcao.
  const relativo = caminhoDeMidia({
    inquilinoId: acervo.inquilinoId,
    anexoId: entrada.anexoId,
    tipo: linha.tipo,
  });
  const absoluto = join(entrada.destino, relativo);

  try {
    mkdirSync(dirname(absoluto), { recursive: true });
    writeFileSync(absoluto, entrada.bytes);
  } catch (causa) {
    throw new DestinoInacessivelError(entrada.destino, causa);
  }

  // O tamanho vem do ARQUIVO GRAVADO, nao do que o material declarou: e o
  // Acervo dizendo o que ele tem, nao o que lhe prometeram.
  const tamanho = statSync(absoluto).size;
  // A impressao do ARQUIVO, gravada no momento da escrita. E o que vai
  // permitir, no ciclo 10, distinguir arquivo que ja veio de arquivo que veio
  // de novo. Nao confundir com a Impressao de Material, que identifica um lote
  // por nome e tamanho sem abrir nada: mesma palavra, dois conceitos.
  const impressao = createHash('sha256').update(entrada.bytes).digest('hex');

  acervo.preparar(
      `UPDATE anexos
          SET presenca = 'presente', caminho = ?, tamanho = ?, impressao = ?
        WHERE id = ?`,
    )
    .run(relativo, tamanho, impressao, entrada.anexoId);
  return relativo;
}

export interface EntradaDeArquivoPorCaminho {
  anexoId: string;
  /** Raiz do Destino de Mídia deste Inquilino. */
  destino: string;
  /** O arquivo que já está em disco, fora do Destino. */
  origem: string;
}

export type ModoDeGravacao = 'vinculo' | 'copia';

/**
 * Impressão do arquivo lida em pedaços, sem carregar tudo na memória.
 *
 * Síncrona de propósito: todo o núcleo é síncrono porque o driver do banco é, e
 * uma porta assíncrona aqui contaminaria a cadeia inteira de chamadores.
 */
function impressaoDoArquivo(caminho: string): string {
  const hash = createHash('sha256');
  const fd = openSync(caminho, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const lidos = readSync(fd, buffer, 0, buffer.length, null);
      if (lidos === 0) break;
      hash.update(buffer.subarray(0, lidos));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * Grava o Anexo a partir de um arquivo que JÁ está em disco.
 *
 * Existe porque a porta de bytes não escala: ela exige o arquivo inteiro na
 * memória, e o acervo a converter tem centenas de gigabytes.
 *
 * Tenta VÍNCULO RÍGIDO primeiro e cai para cópia no erro do próprio sistema
 * operacional. Não se compara dispositivo antes: `linkSync` responde a pergunta
 * certa — *dá para vincular daqui para lá?* —, enquanto comparar `st_dev`
 * responde uma aproximação e erra em sistema de arquivos que não suporta
 * vínculo. Deixar o sistema decidir é menos código e mais correto.
 *
 * O modo usado é DEVOLVIDO, nunca inferido pelo chamador: quem trouxe centenas
 * de gigabytes por vínculo precisa saber que descartar o Anexo remove só a
 * NOSSA ligação — o espaço volta quando a outra ponta também soltar o arquivo.
 */
export function gravarArquivoDeAnexoDeCaminho(
  acervo: Acervo,
  entrada: EntradaDeArquivoPorCaminho,
): { caminho: string; modo: ModoDeGravacao } {
  const linha = acervo.preparar('SELECT tipo FROM anexos WHERE id = ?').get(entrada.anexoId) as
    { tipo: string } | undefined;
  if (linha === undefined) throw new Error(`Anexo desconhecido: ${entrada.anexoId}`);

  // O Inquilino vem do ACERVO, pela mesma razão da porta de bytes: chamador que
  // o errasse gravaria na subárvore de outro Inquilino.
  const relativo = caminhoDeMidia({
    inquilinoId: acervo.inquilinoId,
    anexoId: entrada.anexoId,
    tipo: linha.tipo,
  });
  const absoluto = join(entrada.destino, relativo);

  let modo: ModoDeGravacao = 'vinculo';
  try {
    mkdirSync(dirname(absoluto), { recursive: true });
    try {
      linkSync(entrada.origem, absoluto);
    } catch (causa) {
      const erro = causa as NodeJS.ErrnoException;
      // EEXIST é outra história: o arquivo já está lá, e sobrescrever em
      // silêncio esconderia um Anexo gravado duas vezes.
      if (erro.code === 'EEXIST') throw causa;
      modo = 'copia';
      copyFileSync(entrada.origem, absoluto);
    }
  } catch (causa) {
    const erro = causa as NodeJS.ErrnoException;
    if (erro.code === 'EEXIST') throw causa;
    throw new DestinoInacessivelError(entrada.destino, causa);
  }

  // Tamanho e impressão saem do arquivo GRAVADO, como na porta de bytes: é o
  // Acervo dizendo o que ele tem, não o que lhe prometeram.
  const tamanho = statSync(absoluto).size;
  const impressao = impressaoDoArquivo(absoluto);

  acervo.preparar(
      `UPDATE anexos
          SET presenca = 'presente', caminho = ?, tamanho = ?, impressao = ?
        WHERE id = ?`,
    )
    .run(relativo, tamanho, impressao, entrada.anexoId);
  return { caminho: relativo, modo };
}
