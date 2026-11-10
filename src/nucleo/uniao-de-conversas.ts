import type { Acervo } from './acervo.js';
import { nomesDoIdentificador } from './identidade.js';
import type { Fonte } from './tipos.js';

/**
 * As portas da UNIAO das duas Conversas diretas de um contato (#1440): a do endereco que a Fonte entrega sem o numero e a do
 * numero, quando o par entre os dois ja esta gravado. Quem decide que forma de endereco e essa, e qual e o alvo, e o Adaptador
 * da Fonte; aqui sao Conversas, Mensagens, marcas e Identificadores. Toda porta de escrita relata UMA linha de efeito por
 * mudanca, e o `desfazer` (desfazer.ts) devolve cada uma pela guarda correspondente, SO enquanto o valor ainda e o que a
 * Operacao gravou.
 */

// ---------------------------------------------------------------------------------------------------------------------------
// Leitura do ensaio: o Adaptador planeja por estas, e nao toca em tabela.

export interface ConversaDiretaDoEndereco {
  id: string;
  configuracaoId: string;
  endereco: string;
  mensagens: number;
}

/**
 * Uma pagina das Conversas diretas da Fonte cujo endereco termina em `sufixo` (o Adaptador o passa; o nucleo nao sabe que forma
 * e essa), em ordem de id, DEPOIS do cursor (`''` na primeira), cada uma com a contagem de Mensagens. Roda fora de transacao.
 * O `length(...) >= ?` repete o filtro de `SQL_CONVERSAS_DIRETAS_POR_SUFIXO`: redundante com o `substr` negativo (que so iguala o
 * sufixo com o mesmo comprimento), mantido para as duas consultas do estoque lerem igual.
 */
export const SQL_CONVERSAS_DIRETAS_COM_CONTAGEM = `SELECT c.id, c.configuracao_id, c.id_externo,
        (SELECT COUNT(*) FROM mensagens m WHERE m.conversa_id = c.id) AS mensagens
   FROM conversas c
  WHERE c.fonte = ? AND c.coletiva = 0 AND c.id > ? AND length(c.id_externo) >= ? AND substr(c.id_externo, ?) = ?
  ORDER BY c.id LIMIT ?`;

export function listarConversasDiretasComContagem(
  acervo: Acervo,
  fonte: Fonte,
  sufixo: string,
  depoisDoId: string,
  limite: number,
): ConversaDiretaDoEndereco[] {
  if (!Number.isInteger(limite) || limite <= 0) throw new RangeError('o limite precisa ser um inteiro maior que zero');
  if (sufixo.length === 0) throw new RangeError('o sufixo nao pode ser vazio');
  const linhas = acervo
    .preparar(SQL_CONVERSAS_DIRETAS_COM_CONTAGEM)
    .all(fonte, depoisDoId, sufixo.length, -sufixo.length, sufixo, limite) as Array<{
    id: string;
    configuracao_id: string;
    id_externo: string;
    mensagens: number;
  }>;
  return linhas.map((l) => ({ id: l.id, configuracaoId: l.configuracao_id, endereco: l.id_externo, mensagens: l.mensagens }));
}

/** As marcas (marca, Configuracao) de uma Conversa, em ordem. */
export function marcasDaConversa(acervo: Acervo, conversaId: string): Array<{ marca: string; configuracaoId: string }> {
  return (
    acervo
      .preparar('SELECT marca, configuracao_id FROM marcas_de_conversa WHERE conversa_id = ? ORDER BY marca, configuracao_id')
      .all(conversaId) as Array<{ marca: string; configuracao_id: string }>
  ).map((l) => ({ marca: l.marca, configuracaoId: l.configuracao_id }));
}

/**
 * O Identificador da Fonte com este valor, e se ele tem nome, ou null. "Tem nome" e o mesmo que `nomeDoIdentificador` devolver
 * nao nulo, para QUALQUER precedencia: `nomeEscolhido` escolhe sempre que o historico tem ao menos uma Atribuicao (o primeiro
 * item vence o peso inicial -1). Por isso basta o historico, e o nucleo nao precisa da precedencia do Registro.
 */
export function identificadorDoEndereco(
  acervo: Acervo,
  fonte: Fonte,
  valor: string,
): { id: string; comNome: boolean } | null {
  const linha = acervo.preparar('SELECT id FROM identificadores WHERE fonte = ? AND valor = ?').get(fonte, valor) as
    | { id: string }
    | undefined;
  if (linha === undefined) return null;
  return { id: linha.id, comNome: nomesDoIdentificador(acervo, linha.id).length > 0 };
}
