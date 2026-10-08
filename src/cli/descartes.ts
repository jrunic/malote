import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RelatoDeRecepcao } from '../adaptadores/whatsapp/ao-vivo.js';
import { DIAS_GUARDADOS } from './vigilancia.js';

/**
 * A SERIE DIARIA DO QUE A RECEPCAO NAO GRAVA COMO MENSAGEM (#1159).
 *
 * Medir antes de guardar: o volume por tipo nunca foi medido, e a classificacao
 * errada do documento com legenda (06/10/2026) so apareceu porque alguem
 * procurou o arquivo. So TIPOS e NUMEROS, nunca conteudo, endereco ou identificador.
 *
 * Segue a serie da correspondencia (`vigilancia.ts`): balde por dia UTC, 30 dias,
 * arquivo corrompido le como vazio. Difere em UMA coisa: a escrita e por troca
 * atomica, porque o arquivo e lido de fora (`ouvinte estado --json`).
 */

/** Quantos tipos DISTINTOS um dia aceita. O tipo vem da Fonte, entao o conjunto nao tem dono. */
export const TIPOS_POR_DIA = 64;
const EXCEDENTE = 'outros';

export type DescartesPorDia = Record<string, Record<string, number>>;

function diaDe(instante: number): string {
  return new Date(instante).toISOString().slice(0, 10);
}

/** A serie gravada. Ausente OU corrompido le como vazio: perder o contador e barato. */
export function lerDescartes(caminho: string): DescartesPorDia {
  try {
    const lido: unknown = JSON.parse(readFileSync(caminho, 'utf8'));
    if (lido === null || typeof lido !== 'object') return {};
    const serie: DescartesPorDia = {};
    for (const [dia, balde] of Object.entries(lido as Record<string, unknown>)) {
      if (balde === null || typeof balde !== 'object') continue;
      const limpo: Record<string, number> = {};
      for (const [tipo, n] of Object.entries(balde as Record<string, unknown>)) {
        if (typeof n === 'number') limpo[tipo] = n;
      }
      serie[dia] = limpo;
    }
    return serie;
  } catch {
    return {};
  }
}

/** Soma o lote ao balde do dia, aplicando o teto de tipos e podando o que envelheceu. */
export function anotarDescartes(
  caminho: string,
  contagem: Readonly<Record<string, number>>,
  agora: number,
): void {
  const entradas = Object.entries(contagem).filter(([, n]) => n > 0);
  // Zero VISTO e diferente de nada visto: balde de zeros diria "dia sem descarte".
  if (entradas.length === 0) return;

  const serie = lerDescartes(caminho);
  const dia = diaDe(agora);
  const balde = serie[dia] ?? {};
  for (const [tipo, n] of entradas) {
    const destino = tipo in balde || Object.keys(balde).length < TIPOS_POR_DIA ? tipo : EXCEDENTE;
    balde[destino] = (balde[destino] ?? 0) + n;
  }
  serie[dia] = balde;

  const corte = diaDe(agora - DIAS_GUARDADOS * 86_400_000);
  for (const chave of Object.keys(serie)) {
    if (chave < corte) delete serie[chave];
  }

  mkdirSync(dirname(caminho), { recursive: true });
  // Temporario mais renomeacao: quem le de fora ve a versao antiga inteira ou a nova inteira.
  //
  // MUTANTE EQUIVALENTE OBSERVAVEL, medido em 07/10/2026: trocar isto por escrita direta
  // nao derruba nenhum teste, porque a suite so le o arquivo DEPOIS da escrita. A
  // atomicidade protege o leitor concorrente (`ouvinte estado --json`), que nao se
  // reproduz sem costura de tempo. Nao tentar matar este mutante com mais um teste.
  const parcial = `${caminho}.parcial`;
  writeFileSync(parcial, JSON.stringify(serie), 'utf8');
  renameSync(parcial, caminho);
}

/**
 * O que a serie soma de UM relato: cada descarte por motivo, mais o parametro de
 * stub sem endereco, que nao descarta evento (o evento e Mensagem) e por isso so
 * e CONTADO, nunca guardado.
 */
export function contagemDosDescartes(r: RelatoDeRecepcao): Record<string, number> {
  const contagem: Record<string, number> = {};
  for (const d of r.descartados) contagem[d.motivo] = (contagem[d.motivo] ?? 0) + 1;
  const parametros = r.ignorados['parametro-sem-endereco'];
  if (parametros !== undefined && parametros > 0) contagem['parametro-sem-endereco'] = parametros;
  return contagem;
}

let falhasNoProcesso = 0;

/** Quantas vezes gravar o contador falhou NESTE processo. Em memoria, de proposito: o destino que falhou e o mesmo que a guardaria. */
export function falhasDeDescartes(): number {
  return falhasNoProcesso;
}

/**
 * O ponto unico que a recepcao, a drenagem e o reprocessar do derrame chamam.
 * Falha de escrita NUNCA propaga: a Mensagem do mesmo lote ja foi gravada, e
 * derrubar o ouvinte por causa de um contador seria trocar o pequeno pelo grande.
 */
export function registrarDescartes(
  caminhos: { descartes: string },
  r: RelatoDeRecepcao,
  agora: number,
  avisar: (texto: string) => void,
): void {
  try {
    anotarDescartes(caminhos.descartes, contagemDosDescartes(r), agora);
  } catch (erro) {
    falhasNoProcesso += 1;
    // So o codigo do erro: a mensagem de sistema carrega caminho.
    const codigo = (erro as NodeJS.ErrnoException).code ?? 'erro';
    avisar(`[ouvinte] descartes: falha ao gravar o contador (${codigo}); a Mensagem seguiu gravada`);
  }
}
