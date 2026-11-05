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
