import { statSync } from 'node:fs';
import type { Acervo } from '../../nucleo/acervo.js';
import { listarAnexosPendentes } from '../../nucleo/inventario.js';
import {
  DestinoInacessivelError,
  gravarArquivoDeAnexoDeCaminho,
} from '../../nucleo/arquivo-de-anexo.js';
import { CONTA_PADRAO, dominioDaConta, indiceDeArquivos, lerMaterial } from './material.js';

/**
 * Traz para o Destino de Mídia os arquivos que o material carrega.
 *
 * É operação à parte, e não um passo da importação: importar milhões de
 * Mensagens e copiar dezenas de GB no mesmo ato torna as duas irretomáveis
 * juntas, e o material pode não estar mais disponível quando se decidir trazer.
 */

export interface OpcoesDeTrazer {
  /** Raiz do Destino de Mídia. O Inquilino vem do Acervo, nunca daqui. */
  destino: string;
  conta?: string;
}

export interface RelatorioDeTrazer {
  pendentes: number;
  copiados: number;
  /** Material declara o caminho e nao carrega o arquivo. Nao e erro. */
  ausentesDoMaterial: number;
  falhas: number;
  bytesCopiados: number;
  /**
   * Quantos entraram por VINCULO RIGIDO em vez de copia. Relatado, e nao
   * inferido: arquivo vinculado so libera espaco quando a OUTRA ponta tambem o
   * soltar, e quem opera a retencao precisa saber disso.
   */
  vinculados: number;
}

export function trazerArquivos(
  acervo: Acervo,
  raizDoBackup: string,
  opcoes: OpcoesDeTrazer,
): RelatorioDeTrazer {
  const dominio = dominioDaConta(opcoes.conta ?? CONTA_PADRAO);
  const indice = indiceDeArquivos(raizDoBackup, dominio);

  // O elo entre Acervo e material e a Referencia Externa da Mensagem, nao um
  // caminho gravado: o caminho da origem carrega apelido e numero e nunca
  // entra no Acervo. Este mapa vive so em memoria, durante a execucao.
  const caminhoPorMensagem = new Map<string, string>();
  const material = lerMaterial(raizDoBackup, dominio);
  try {
    for (const m of material.mensagens) {
      if (m.anexo?.caminhoNaOrigem != null) {
        caminhoPorMensagem.set(m.idExterno, m.anexo.caminhoNaOrigem);
      }
    }
  } finally {
    material.fechar();
  }

  // O cursor vem do NUCLEO: adaptador nao le tabela do nucleo (tarefa #670).
  // A razao do JOIN e da escolha da Presenca esta na porta, junto do SQL.
  const pendentes = listarAnexosPendentes(acervo, { fonte: 'whatsapp' });

  const relatorio: RelatorioDeTrazer = {
    pendentes: pendentes.length,
    copiados: 0,
    ausentesDoMaterial: 0,
    falhas: 0,
    bytesCopiados: 0,
    vinculados: 0,
  };

  for (const p of pendentes) {
    const naOrigem = caminhoPorMensagem.get(p.mensagemIdExterno);
    const arquivo = naOrigem === undefined ? undefined : indice.get(`Message/${naOrigem}`);
    if (arquivo === undefined) {
      relatorio.ausentesDoMaterial += 1;
      continue;
    }
    // O arquivo NAO e mais lido para a memoria: a porta recebe o caminho e
    // vincula quando da. Ler para a memoria so para calcular a impressao
    // limitava o tamanho de um Anexo ao que coubesse no processo.
    let modo: 'vinculo' | 'copia';
    try {
      modo = gravarArquivoDeAnexoDeCaminho(acervo, {
        anexoId: p.anexoId,
        destino: opcoes.destino,
        origem: arquivo,
      }).modo;
    } catch (causa) {
      // Destino inacessivel e condicao GLOBAL: o Destino inteiro sumiu, e
      // insistir arquivo a arquivo so acumula a mesma falha. Aborta.
      if (causa instanceof DestinoInacessivelError) throw causa;
      // Falha de UM arquivo — permissao, corrupcao — conta e segue:
      // interromper milhares de copias por causa de uma seria pior.
      relatorio.falhas += 1;
      continue;
    }
    relatorio.copiados += 1;
    if (modo === 'vinculo') relatorio.vinculados += 1;
    // O tamanho vem do arquivo em disco, e nao de um buffer que nao existe mais.
    relatorio.bytesCopiados += statSync(arquivo).size;
  }
  return relatorio;
}
