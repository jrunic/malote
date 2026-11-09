import type { Acervo } from './acervo.js';
import type { Fonte } from './tipos.js';

/**
 * As portas de LEITURA do ensaio de um comando do estoque que olha enderecos (#1376). Ficam no nucleo porque so ele toca em
 * tabela; quem decide o que um endereco significa (a regra do celular) e o Adaptador da Fonte, que usa estas.
 */

/**
 * A consulta de `listarIdentificadoresPorSufixo`, exportada para o teste de plano de consulta fixar que ela pagina pelo indice
 * `(fonte, valor)` e NAO ordena em tabela temporaria (cada pagina custaria o Acervo inteiro).
 */
export const SQL_IDENTIFICADORES_POR_SUFIXO = `SELECT valor FROM identificadores
        WHERE fonte = ? AND valor > ? AND length(valor) >= ? AND substr(valor, ?) = ?
        ORDER BY valor LIMIT ?`;

/**
 * Os valores dos Identificadores de uma Fonte que terminam em `sufixo`, em ordem de valor, DEPOIS do cursor (o ultimo valor da
 * pagina anterior; `''` na primeira). Pagina pelo indice `(fonte, valor)`: um Identificador inserido durante a varredura entra se
 * o valor dele vem depois do cursor, e a renumeracao de `rowid` de um VACUUM nao importa. A leitura do Acervo todo roda em
 * paginas, FORA de transacao, para nao segurar o escritor do ouvinte.
 */
export function listarIdentificadoresPorSufixo(
  acervo: Acervo,
  fonte: Fonte,
  sufixo: string,
  depoisDe: string,
  limite: number,
): string[] {
  return (
    acervo
      .preparar(SQL_IDENTIFICADORES_POR_SUFIXO)
      .all(fonte, depoisDe, sufixo.length, -sufixo.length, sufixo, limite) as Array<{ valor: string }>
  ).map((l) => l.valor);
}

/** Quantas Mensagens tem como autor o Identificador daquele valor (zero quando o valor nao e Identificador). */
export function contarMensagensDoEndereco(acervo: Acervo, fonte: Fonte, valor: string): number {
  return (
    acervo
      .preparar(
        `SELECT COUNT(*) AS n FROM mensagens m JOIN identificadores i ON i.id = m.autor_id
          WHERE i.fonte = ? AND i.valor = ?`,
      )
      .get(fonte, valor) as { n: number }
  ).n;
}

/** As Conversas DIRETAS daquele endereco, uma por Configuracao dona. */
export function listarConversasDiretasDoEndereco(
  acervo: Acervo,
  fonte: Fonte,
  valor: string,
): Array<{ id: string; configuracaoId: string | null }> {
  const linhas = acervo
    .preparar('SELECT id, configuracao_id FROM conversas WHERE fonte = ? AND id_externo = ? AND coletiva = 0 ORDER BY id')
    .all(fonte, valor) as Array<{ id: string; configuracao_id: string | null }>;
  return linhas.map((l) => ({ id: l.id, configuracaoId: l.configuracao_id }));
}

/**
 * As Conversas DIRETAS de uma Fonte cujo endereco termina em `sufixo`, em ordem de id, DEPOIS do cursor (o id da ultima da
 * pagina anterior; `''` na primeira). Le so `conversas` (milhares de linhas no Acervo grande, ordenadas a cada pagina).
 */
export const SQL_CONVERSAS_DIRETAS_POR_SUFIXO = `SELECT id, configuracao_id, id_externo FROM conversas
        WHERE fonte = ? AND coletiva = 0 AND id > ? AND length(id_externo) >= ? AND substr(id_externo, ?) = ?
        ORDER BY id LIMIT ?`;

/**
 * As Mensagens RECEBIDAS de uma Conversa, em ordem de instante, pelo indice `(conversa_id, ocorrida_em)`. A Mensagem migrada
 * sem direcao (anterior a coluna) nao entra: nao se sabe de que lado ela veio.
 */
export const SQL_RECEBIDAS_DA_CONVERSA = `SELECT ocorrida_em, bruto FROM mensagens
        WHERE conversa_id = ? AND direcao = 'recebida'
        ORDER BY ocorrida_em, rowid`;

export interface ConversaDiretaComRecebidas {
  conversaId: string;
  /** Sempre presente: a Conversa direta tem Configuracao (restricao do schema). */
  configuracaoId: string;
  idExterno: string;
  /** TODAS as Mensagens recebidas, da mais antiga para a mais recente; `bruto` nulo quando a Fonte nao o guardou. */
  recebidas: Array<{ ocorridaEm: number; bruto: string | null }>;
}

/**
 * Uma pagina das Conversas diretas de uma Fonte cujo endereco termina no `sufixo` que o ADAPTADOR passa (o nucleo nao sabe
 * que forma de endereco e essa), cada uma com o Conteudo Bruto de todas as Mensagens recebidas (#1439). Pagina por Conversa e
 * roda fora de transacao: o estoque le assim, e o ouvinte segue escrevendo.
 */
export function listarConversasDiretasComRecebidas(
  acervo: Acervo,
  fonte: Fonte,
  sufixo: string,
  opcoes: { depoisDe: string; limite: number },
): ConversaDiretaComRecebidas[] {
  if (!Number.isInteger(opcoes.limite) || opcoes.limite <= 0) throw new RangeError('o limite precisa ser um inteiro maior que zero');
  const conversas = acervo
    .preparar(SQL_CONVERSAS_DIRETAS_POR_SUFIXO)
    .all(fonte, opcoes.depoisDe, sufixo.length, -sufixo.length, sufixo, opcoes.limite) as Array<{
    id: string;
    configuracao_id: string | null;
    id_externo: string;
  }>;
  const recebidas = acervo.preparar(SQL_RECEBIDAS_DA_CONVERSA);
  return conversas.map((c) => ({
    conversaId: c.id,
    configuracaoId: c.configuracao_id as string,
    idExterno: c.id_externo,
    recebidas: (recebidas.all(c.id) as Array<{ ocorrida_em: number; bruto: string | null }>).map((m) => ({
      ocorridaEm: m.ocorrida_em,
      bruto: m.bruto,
    })),
  }));
}
