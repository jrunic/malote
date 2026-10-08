import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EventoDescartado } from '../adaptadores/whatsapp/ao-vivo.js';

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
