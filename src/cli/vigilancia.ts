import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ContagemDeCorrespondencia } from '../adaptadores/whatsapp/ao-vivo.js';

/**
 * A serie de vigilancia da fonte de correspondencia de endereco — a #775.
 *
 * O produto aprende a correspondencia entre as duas formas de endereco a partir
 * do campo que a Fonte manda junto do evento. Se ela parar de mandar, o
 * aprendizado para e NADA acusa: o ouvinte nao trava, nao reinicia, nao some do
 * watchdog de silencio. So empobrece.
 *
 * POR QUE BALDE DIARIO, e nao janela movel com linha de base aprendida, que e o
 * que a tarefa pedia: medido em 12/09/2026 contra o Acervo de producao, a taxa
 * diaria da Conversa direta oscila de 0% a 66% entre dias CONSECUTIVOS, com o
 * mesmo coletor e a mesma conta. Alarme por queda diaria dispararia quase todo
 * dia. Balde por dia UTC deixa a FROTA escolher a janela, e tira do produto a
 * maquina de janela movel inteira.
 *
 * O produto CONTA e EXPOE; quem compara e alarma e o vigia da frota — mesma
 * fronteira que o Titular fixou para o timer da varredura e para o watchdog de
 * silencio do ouvinte.
 *
 * FORA do Acervo, como o instante do ultimo evento: ler a serie nao pode exigir
 * abrir a base, porque abrir para escrita MIGRA, e um verificador que roda de
 * minuto em minuto nao pode ter esse poder.
 */

/** Quantos dias de serie ficam no arquivo. */
export const DIAS_GUARDADOS = 30;

export type SerieDeCorrespondencia = Record<string, ContagemDeCorrespondencia>;

function diaDe(instante: number): string {
  return new Date(instante).toISOString().slice(0, 10);
}

/**
 * A serie gravada. Arquivo ausente OU corrompido le como vazio.
 *
 * Corrompido nao lanca de proposito: o consumidor e o ouvinte de producao, que
 * roda por meses. Perder a serie de vigilancia e barato; perder Mensagem porque
 * o processo caiu lendo um JSON truncado nao e.
 */
export function lerCorrespondencia(caminho: string): SerieDeCorrespondencia {
  try {
    const lido: unknown = JSON.parse(readFileSync(caminho, 'utf8'));
    if (lido === null || typeof lido !== 'object') return {};
    return lido as SerieDeCorrespondencia;
  } catch {
    return {};
  }
}

/**
 * Soma a contagem do lote ao balde do dia, podando o que envelheceu.
 *
 * `agora` e PARAMETRO e nao `Date.now()`: teste que depende de dois relogios
 * diferirem e corrida, nao teste — foi o que um mutante sobrevivente do plano 2
 * do ciclo 16 mostrou.
 */
export function anotarCorrespondencia(
  caminho: string,
  contagem: ContagemDeCorrespondencia,
  agora: number,
): void {
  // Lote sem nada em forma opaca nao cria balde. Zero VISTO e diferente de nada
  // visto, e um balde de zeros diria que a fonte secou naquele dia — quando o
  // que houve foi nao ter havido evento opaco nenhum.
  const total =
    contagem.coletivaOpaca + contagem.coletivaComPar + contagem.diretaOpaca + contagem.diretaComPar;
  if (total === 0) return;

  const serie = lerCorrespondencia(caminho);
  const dia = diaDe(agora);
  const atual = serie[dia] ?? {
    coletivaOpaca: 0,
    coletivaComPar: 0,
    diretaOpaca: 0,
    diretaComPar: 0,
  };
  serie[dia] = {
    coletivaOpaca: atual.coletivaOpaca + contagem.coletivaOpaca,
    coletivaComPar: atual.coletivaComPar + contagem.coletivaComPar,
    diretaOpaca: atual.diretaOpaca + contagem.diretaOpaca,
    diretaComPar: atual.diretaComPar + contagem.diretaComPar,
  };

  const corte = diaDe(agora - DIAS_GUARDADOS * 86_400_000);
  for (const chave of Object.keys(serie)) {
    if (chave < corte) delete serie[chave];
  }

  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, JSON.stringify(serie), 'utf8');
}
