import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import {
  receberEvento,
  type EventoDescartado,
  type MensagemRecebida,
} from '../adaptadores/whatsapp/ao-vivo.js';
import type { Acervo } from '../nucleo/acervo.js';
import { descartarDerrame } from './derrame.js';

/**
 * A GUARDA DO QUE A RECEPCAO NAO GRAVA COMO MENSAGEM (#1159).
 *
 * O Conteudo Bruto so era preservado para o que entrava. Evento que a recepcao
 * descarta ou recusa por decisao de classificacao ficava perdido em silencio —
 * o documento com legenda de 06/10/2026. Aqui ele fica CRU, com o instante e o
 * motivo, para reprocessar depois da correcao.
 *
 * ARQUIVO POR CONTA, no molde do derrame, e nao tabela do Acervo: sem mudanca de
 * forma nem migracao, e o ouvinte nao escreve mais no banco que ja disputa escrita.
 *
 * O QUE ESTE ARQUIVO E: texto de conversa EM CLARO, fora do Acervo, no disco do
 * host, sem as protecoes do banco e fora do backup. O produto nao promete
 * confidencialidade contra o Operador da instalacao. Modo 0600, nunca em log.
 *
 * ROTACAO APAGA: ao passar do teto o atual vira o anterior e o anterior MAIS
 * ANTIGO se perde. E excecao nomeada a regra de que o produto nao apaga o que
 * moveu — decisao do Titular de 06/10/2026: o disco e finito e este arquivo nao
 * esta no backup.
 */

/** Teto PROVISORIO por conta (50 MiB). O definitivo sai da medicao de campo do criterio 16. */
export const TETO_PADRAO_DA_GUARDA = 50 * 1024 * 1024;

/** O teto por conta, de `MALOTE_TETO_DA_GUARDA_BYTES`; invalido volta ao padrao. */
export function tetoDaGuarda(env: NodeJS.ProcessEnv = process.env): number {
  const bruto = env['MALOTE_TETO_DA_GUARDA_BYTES'];
  if (bruto === undefined) return TETO_PADRAO_DA_GUARDA;
  const n = Number(bruto);
  return Number.isInteger(n) && n > 0 ? n : TETO_PADRAO_DA_GUARDA;
}

/** O arquivo anterior: `descartados.jsonl` vira `descartados.anterior.jsonl`. */
export function caminhoDaGuardaAnterior(caminho: string): string {
  return caminho.endsWith('.jsonl') ? caminho.replace(/\.jsonl$/, '.anterior.jsonl') : `${caminho}.anterior`;
}

/**
 * Guarda os descartes que nao sao ruido, UMA LINHA por evento. Devolve quantos
 * gravou. Sem nada a guardar nao cria nem a pasta: criar diretorio e trabalho
 * do operador, nao da partida.
 */
export function guardarDescartes(
  caminho: string,
  descartados: readonly EventoDescartado[],
  agora: number,
  teto: number,
): number {
  const aGuardar = descartados.filter((d) => !d.ruido);
  if (aGuardar.length === 0) return 0;
  mkdirSync(dirname(caminho), { recursive: true });
  const em = new Date(agora).toISOString();
  for (const d of aGuardar) {
    const linha = `${JSON.stringify({
      em,
      motivo: d.motivo,
      ...(d.causa !== undefined ? { causa: d.causa } : {}),
      evento: d.evento,
    })}\n`;
    // O teto vale POR LINHA: um lote grande nao pode estourar o limite do disco.
    if (existsSync(caminho) && statSync(caminho).size >= teto) {
      renameSync(caminho, caminhoDaGuardaAnterior(caminho));
    }
    appendFileSync(caminho, linha, { mode: 0o600 });
  }
  return aGuardar.length;
}

function linhasDoArquivo(caminho: string): string[] {
  try {
    return readFileSync(caminho, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '');
  } catch {
    // Ausencia nao e erro: e conta que nunca guardou.
    return [];
  }
}

/** Quantos eventos e quantos bytes a guarda ocupa, somando o atual e o anterior. */
export function estadoDaGuarda(caminho: string): { eventos: number; bytes: number } {
  let eventos = 0;
  let bytes = 0;
  for (const arquivo of [caminhoDaGuardaAnterior(caminho), caminho]) {
    eventos += linhasDoArquivo(arquivo).length;
    try {
      bytes += statSync(arquivo).size;
    } catch {
      continue;
    }
  }
  return { eventos, bytes };
}

export interface ResultadoDoReprocesso {
  lidos: number;
  gravados: number;
  mantidos: number;
}

/** Troca atomica do arquivo (temporario e renomeacao); sem linhas, esvazia. */
export function substituirAtomico(caminho: string, linhas: readonly string[]): void {
  if (linhas.length === 0) {
    descartarDerrame(caminho);
    return;
  }
  const parcial = `${caminho}.parcial`;
  writeFileSync(parcial, `${linhas.join('\n')}\n`, { mode: 0o600 });
  renameSync(parcial, caminho);
}

function eventoDaLinha(texto: string): MensagemRecebida | undefined {
  try {
    const lido = JSON.parse(texto) as { evento?: { key?: { remoteJid?: unknown; id?: unknown } } };
    const chave = lido.evento?.key;
    if (typeof chave?.remoteJid !== 'string' || typeof chave.id !== 'string') return undefined;
    return lido.evento as MensagemRecebida;
  } catch {
    return undefined;
  }
}

/**
 * Leva a guarda por `receberEvento`, UM EVENTO POR VEZ — o relato devolve
 * `gravados` como contagem, e e o evento isolado que diz se deixou de ser
 * descartado. Sai da guarda o que o relato nao descarta mais; fica, na linha
 * ORIGINAL, o que continua descartado, e a linha ilegivel (perder dado ja
 * guardado por causa da forma do arquivo seria trocar o pequeno pelo grande).
 *
 * NAO ESCREVE NA GUARDA. Passar por `registrarDescartes` reanexaria o que ainda
 * e descartado a cada rodada, e o arquivo cresceria sem fim.
 *
 * ORDEM: grava no Acervo ANTES de reescrever. Morrer no meio deixa o evento nos
 * dois lugares, e a unicidade `(fonte, id_externo)` descarta a repeticao. Disputa
 * de escrita (banco ocupado) SOBE sem tocar no arquivo.
 *
 * `substituir` e costura de teste: provar a ordem exige morrer entre as duas etapas.
 */
export function reprocessarDescartados(
  acervo: Acervo,
  caminho: string,
  configuracao: { id: string; fonte: 'whatsapp' },
  agora: number,
  substituir: (caminho: string, linhas: readonly string[]) => void = substituirAtomico,
): ResultadoDoReprocesso {
  const resultado: ResultadoDoReprocesso = { lidos: 0, gravados: 0, mantidos: 0 };
  for (const arquivo of [caminhoDaGuardaAnterior(caminho), caminho]) {
    const linhas = linhasDoArquivo(arquivo);
    if (linhas.length === 0) continue;
    const restantes: string[] = [];
    for (const texto of linhas) {
      resultado.lidos += 1;
      const evento = eventoDaLinha(texto);
      if (evento === undefined) {
        restantes.push(texto);
        resultado.mantidos += 1;
        continue;
      }
      const r = receberEvento(acervo, [evento], { agora, configuracao });
      if (r.descartados.length === 0) {
        resultado.gravados += 1;
      } else {
        restantes.push(texto);
        resultado.mantidos += 1;
      }
    }
    substituir(arquivo, restantes);
  }
  return resultado;
}
