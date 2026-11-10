import type { Acervo } from './acervo.js';
import { nomesDoIdentificador } from './identidade.js';
import type { Operacao } from './trilha.js';
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

// ---------------------------------------------------------------------------------------------------------------------------
// Escrita: mover as Mensagens e levar as marcas.

interface ConversaLida {
  id: string;
  fonte: string;
  id_externo: string;
  coletiva: number;
  configuracao_id: string | null;
}

function lerConversa(acervo: Acervo, id: string): ConversaLida | undefined {
  return acervo
    .preparar('SELECT id, fonte, id_externo, coletiva, configuracao_id FROM conversas WHERE id = ?')
    .get(id) as ConversaLida | undefined;
}

/**
 * As duas Conversas existem, sao diretas, da mesma Fonte e da MESMA Configuracao. Mover entre Configuracoes nunca acontece
 * (criterio 7): a porta recusa, e nao so o planejamento do Adaptador.
 */
function conferirParDeDiretas(acervo: Acervo, de: string, para: string): void {
  if (de === para) throw new RangeError('a Conversa de origem e a de destino sao a mesma');
  const a = lerConversa(acervo, de);
  const b = lerConversa(acervo, para);
  if (a === undefined || b === undefined) throw new RangeError('Conversa de origem ou de destino inexistente');
  if (a.coletiva !== 0 || b.coletiva !== 0) throw new RangeError('so Conversa direta se une');
  if (a.fonte !== b.fonte || a.configuracao_id !== b.configuracao_id) {
    throw new RangeError('as duas Conversas precisam ser da mesma Fonte e da mesma Configuracao');
  }
}

/**
 * Move TODAS as Mensagens da Conversa `de` para a `para`. So a Conversa da Mensagem muda: nada mais na linha, nem Anexo,
 * Edicao, Citacao ou Chegada (que pendem da Mensagem ou guardam a Conversa da hora da chegada). Uma linha de efeito por
 * Mensagem, de proposito: o `desfazer` e item a item. Devolve quantas moveu. A leitura dos ids e a escrita ficam na mesma
 * transacao (savepoint quando quem chama ja abriu a dele), para uma Mensagem que chegue no meio nunca mudar sem linha.
 */
export function moverMensagensDeConversa(acervo: Acervo, e: { de: string; para: string }, op: Operacao): number {
  return acervo.db.transaction(() => {
    conferirParDeDiretas(acervo, e.de, e.para);
    const ids = (
      acervo.preparar('SELECT id FROM mensagens WHERE conversa_id = ? ORDER BY id').all(e.de) as Array<{ id: string }>
    ).map((l) => l.id);
    if (ids.length === 0) return 0;
    acervo.preparar('UPDATE mensagens SET conversa_id = ? WHERE conversa_id = ?').run(e.para, e.de);
    for (const id of ids) {
      op.valor({ tabela: 'mensagens', chave: id, campo: 'conversa_id', antes: e.de, depois: e.para });
    }
    return ids.length;
  })();
}

/**
 * Leva a marca de Conversa da `de` para a `para`, SO onde a `para` ainda nao tem a mesma (marca, Configuracao): onde tem, a do
 * alvo vale e a da origem fica onde esta (nada sai do Acervo). A chave da linha de efeito e a POSTERIOR a troca, porque e por
 * ela que o `desfazer` acha a linha hoje.
 */
export function levarMarcasDeConversa(acervo: Acervo, e: { de: string; para: string }, op: Operacao): number {
  return acervo.db.transaction(() => {
    conferirParDeDiretas(acervo, e.de, e.para);
    const aLevar = acervo
      .preparar(
        `SELECT o.marca, o.configuracao_id FROM marcas_de_conversa o
          WHERE o.conversa_id = ?
            AND NOT EXISTS (SELECT 1 FROM marcas_de_conversa a
                             WHERE a.conversa_id = ? AND a.marca = o.marca AND a.configuracao_id = o.configuracao_id)
          ORDER BY o.marca, o.configuracao_id`,
      )
      .all(e.de, e.para) as Array<{ marca: string; configuracao_id: string }>;
    const levar = acervo.preparar(
      'UPDATE marcas_de_conversa SET conversa_id = ? WHERE conversa_id = ? AND marca = ? AND configuracao_id = ?',
    );
    for (const m of aLevar) {
      levar.run(e.para, e.de, m.marca, m.configuracao_id);
      op.valor({
        tabela: 'marcas_de_conversa',
        chave: JSON.stringify([e.para, m.marca, m.configuracao_id]),
        campo: 'conversa_id',
        antes: e.de,
        depois: e.para,
      });
    }
    return aLevar.length;
  })();
}
