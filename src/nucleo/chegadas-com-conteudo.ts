import type { Acervo } from './acervo.js';
import {
  codificarMarcador,
  decodificarMarcador,
  lerChegadas,
  type ChegadaLida,
  type FiltroDeChegadas,
  type PaginaDeChegadas,
} from './chegada.js';
import { lerMensagensPorIds, type MensagemLida } from './consulta.js';

/**
 * A leitura de Chegadas COM CONTEUDO: cada Chegada de Mensagem, de Edicao e de Anexo traz a Mensagem correspondente, lida
 * na hora de responder e na MESMA forma que a leitura de Mensagens entrega (texto atual, Edicoes, Anexos). O Diario nao
 * guarda texto: o conteudo e uma juncao da leitura, e por isso mostra a Mensagem como ela esta AGORA (uma Edicao que chegou
 * depois da Chegada ja vem aplicada).
 *
 * A Chegada de Transicao, a de Etiqueta e a `inicio-do-diario` nao tem Mensagem e NAO levam a chave `conteudo`. Mensagem que
 * nao existe mais no Acervo (a Conversa foi apagada, por exemplo) leva `conteudo: null`, e a Chegada continua legivel.
 */

/** O corte de uma pagina com conteudo: abaixo dos 2,0 MB do modo rede, deixando folga para o resto do corpo. */
export const TETO_DE_BYTES_COM_CONTEUDO = 1_500_000;

const TIPOS_COM_CONTEUDO: ReadonlySet<string> = new Set(['mensagem', 'edicao', 'anexo-disponivel']);

export type ChegadaComConteudo = ChegadaLida & { conteudo?: MensagemLida | null };

export interface PaginaDeChegadasComConteudo {
  chegadas: ChegadaComConteudo[];
  proximo: string;
  ultima: boolean;
}

/**
 * Le a pagina e liga o conteudo. Se a pagina passar do teto de bytes, devolve so as primeiras que cabem (sempre ao menos
 * uma), com o `proximo` na ultima incluida: o consumidor continua dali sem repetir nem pular.
 */
export function lerChegadasComConteudo(
  acervo: Acervo,
  filtro: FiltroDeChegadas,
  tetoDeBytes: number = TETO_DE_BYTES_COM_CONTEUDO,
): PaginaDeChegadasComConteudo {
  const pagina: PaginaDeChegadas = lerChegadas(acervo, filtro);
  const ids = [
    ...new Set(
      pagina.chegadas
        .filter((c) => TIPOS_COM_CONTEUDO.has(c.tipo) && c.mensagemId !== null)
        .map((c) => c.mensagemId as string),
    ),
  ];
  const porId = new Map(lerMensagensPorIds(acervo, ids).map((m) => [m.id, m]));
  const completas: ChegadaComConteudo[] = pagina.chegadas.map((c) =>
    TIPOS_COM_CONTEUDO.has(c.tipo) ? { ...c, conteudo: porId.get(c.mensagemId ?? '') ?? null } : c,
  );

  let bytes = 0;
  let cabem = 0;
  for (const c of completas) {
    const tamanho = Buffer.byteLength(JSON.stringify(c));
    if (cabem > 0 && bytes + tamanho > tetoDeBytes) break;
    bytes += tamanho;
    cabem += 1;
  }
  if (cabem === completas.length) return { chegadas: completas, proximo: pagina.proximo, ultima: pagina.ultima };

  const mantidas = completas.slice(0, cabem);
  const epoca = decodificarMarcador(pagina.proximo)!.epoca;
  return {
    chegadas: mantidas,
    proximo: codificarMarcador({ epoca, seq: mantidas[mantidas.length - 1]!.seq }),
    ultima: false,
  };
}
