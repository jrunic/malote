import type { Acervo } from './acervo.js';

/**
 * Porta de leitura do Servico de Armazenamento: quais Anexos tem arquivo no
 * Destino de Midia e precisam existir no Destino Remoto. O Acervo e de UM
 * Inquilino, entao o escopo ja esta na base — nao ha filtro de Inquilino na SQL.
 *
 * Cursor pelo identificador do Anexo, que e chave primaria: a pagina seguinte
 * e `id > ultimo`. Sem a Mensagem no meio, nao ha o problema do indice de
 * Presenca que `anexos-da-conversa.ts` documenta; o `+` unario em
 * `+a.presenca` pelo mesmo motivo: o otimizador nao pode escolher o indice de
 * Presenca e ordenar depois (medido: minutos num Acervo de 330 mil Anexos).
 */

export interface AnexoPresente {
  id: string;
  tipo: string;
  /** Relativo ao Destino de Midia, como o nucleo o gravou. */
  caminho: string;
  tamanho: number;
  /** Impressao de Anexo: sha256 hex do conteudo, gravada quando o arquivo entrou. */
  impressao: string;
  /**
   * Audio que ainda sera transcrito (sem linha de Transcricao, ou `pendente`).
   * O arquivo local desse Anexo nao pode sair do disco: a transcricao le o arquivo.
   */
  transcricaoPorFazer: boolean;
}

export interface AnexoDescartado {
  id: string;
  descartadoEm: string | null;
}

export interface OpcoesDePagina {
  /** Exclusivo; ausente comeca do primeiro Anexo. */
  depoisDoId?: string;
  limite: number;
}

const LIMITE_MAXIMO = 5_000;

function limiteValido(limite: number): number {
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) {
    throw new RangeError(`limite precisa ser um inteiro de 1 a ${LIMITE_MAXIMO}`);
  }
  return limite;
}

/** A SQL e constante: `preparar` cacheia por texto exato. */
export const SQL_ANEXOS_PRESENTES = `
  SELECT a.id AS id, a.tipo AS tipo, a.caminho AS caminho, a.tamanho AS tamanho, a.impressao AS impressao,
         (a.tipo = 'audio' AND (t.anexo_id IS NULL OR t.estado = 'pendente')) AS transcricao_por_fazer
    FROM anexos a LEFT JOIN transcricoes t ON t.anexo_id = a.id
   WHERE +a.presenca = 'presente' AND a.caminho IS NOT NULL AND a.impressao IS NOT NULL
     AND a.tamanho IS NOT NULL AND a.id > ?
   ORDER BY a.id
   LIMIT ?`;

export function listarAnexosPresentes(acervo: Acervo, opcoes: OpcoesDePagina): AnexoPresente[] {
  const linhas = acervo
    .preparar(SQL_ANEXOS_PRESENTES)
    .all(opcoes.depoisDoId ?? '', limiteValido(opcoes.limite)) as Array<{
    id: string;
    tipo: string;
    caminho: string;
    tamanho: number;
    impressao: string;
    transcricao_por_fazer: number;
  }>;
  return linhas.map((l) => ({
    id: l.id,
    tipo: l.tipo,
    caminho: l.caminho,
    tamanho: l.tamanho,
    impressao: l.impressao,
    transcricaoPorFazer: l.transcricao_por_fazer === 1,
  }));
}

/**
 * Anexos que a Politica de Retencao descartou. O descarte zera o caminho no
 * Acervo, entao quem cruza com a Localizacao (que guarda o arquivo remoto) e o
 * chamador, por identificador, em memoria: nao ha transacao entre bancos.
 */
export const SQL_ANEXOS_DESCARTADOS = `
  SELECT a.id AS id, a.descartado_em AS descartado_em
    FROM anexos a
   WHERE +a.presenca = 'descartado' AND a.id > ?
   ORDER BY a.id
   LIMIT ?`;

export function listarAnexosDescartados(acervo: Acervo, opcoes: OpcoesDePagina): AnexoDescartado[] {
  const linhas = acervo
    .preparar(SQL_ANEXOS_DESCARTADOS)
    .all(opcoes.depoisDoId ?? '', limiteValido(opcoes.limite)) as Array<{
    id: string;
    descartado_em: string | null;
  }>;
  return linhas.map((l) => ({ id: l.id, descartadoEm: l.descartado_em }));
}

export interface ResumoDePresentes {
  anexos: number;
  bytes: number;
}

export const SQL_RESUMO_DE_PRESENTES = `
  SELECT COUNT(*) AS anexos, COALESCE(SUM(tamanho), 0) AS bytes
    FROM anexos
   WHERE +presenca = 'presente' AND caminho IS NOT NULL AND impressao IS NOT NULL AND tamanho IS NOT NULL`;

export function resumoDePresentes(acervo: Acervo): ResumoDePresentes {
  return acervo.preparar(SQL_RESUMO_DE_PRESENTES).get() as ResumoDePresentes;
}
