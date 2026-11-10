import type { Acervo } from './acervo.js';
import { resolverEndereco } from './correspondencia.js';
import { registrarIdentificador } from './escrita.js';
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

// ---------------------------------------------------------------------------------------------------------------------------
// Escrita: promover (trocar o endereco e registrar o Identificador do numero).

/** O endereco novo ja e de outra Conversa direta da mesma Fonte e Configuracao (o indice unico das diretas recusaria). */
export class EnderecoDeConversaOcupadoError extends Error {
  constructor(
    readonly conversaId: string,
    readonly endereco: string,
  ) {
    super(`a Conversa ${conversaId} nao pode receber o endereco: ele ja e de outra Conversa direta na mesma Configuracao`);
    this.name = 'EnderecoDeConversaOcupadoError';
  }
}

/** A outra Conversa direta da Fonte e Configuracao que ja tem este endereco, ou undefined. */
function outraDiretaComEndereco(acervo: Acervo, c: ConversaLida, endereco: string): string | undefined {
  const linha = acervo
    .preparar(
      `SELECT id FROM conversas
        WHERE fonte = ? AND id_externo = ? AND configuracao_id = ? AND coletiva = 0 AND id <> ? LIMIT 1`,
    )
    .get(c.fonte, endereco, c.configuracao_id, c.id) as { id: string } | undefined;
  return linha?.id;
}

/**
 * Troca o endereco de UMA Conversa direta (a promocao). Confere o indice unico das diretas ANTES de escrever e recusa com
 * `EnderecoDeConversaOcupadoError`, nunca com o erro cru do indice: quem chama reclassifica (promover vira mover). Nao toca o
 * Conteudo Bruto. Endereco atual diferente de `de` e erro de quem chama (o plano envelheceu sem ser relido). O endereco novo tem
 * de ser a forma CANONICA (`resolverEndereco` o devolve igual): a forma alternativa criaria uma segunda identidade. So aqui: o
 * `desfazer` devolve legitimamente o endereco de antes, que pode ser a forma alternativa.
 */
export function trocarEnderecoDeConversaDireta(
  acervo: Acervo,
  e: { conversaId: string; de: string; para: string },
  op: Operacao,
): void {
  acervo.db.transaction(() => {
    const c = lerConversa(acervo, e.conversaId);
    if (c === undefined) throw new RangeError(`Conversa inexistente: ${e.conversaId}`);
    if (c.coletiva !== 0) throw new RangeError('so a Conversa direta troca de endereco');
    if (c.id_externo !== e.de) throw new RangeError('a Conversa ja nao tem o endereco de origem; releia antes de trocar');
    if (e.de === e.para) throw new RangeError('o endereco novo e o mesmo');
    if (resolverEndereco(acervo, c.fonte as Fonte, e.para) !== e.para) {
      throw new RangeError('o endereco novo nao e a forma canonica; resolva antes de promover');
    }
    if (outraDiretaComEndereco(acervo, c, e.para) !== undefined) {
      throw new EnderecoDeConversaOcupadoError(e.conversaId, e.para);
    }
    acervo.preparar('UPDATE conversas SET id_externo = ? WHERE id = ?').run(e.para, e.conversaId);
    op.valor({ tabela: 'conversas', chave: e.conversaId, campo: 'id_externo', antes: e.de, depois: e.para });
  })();
}

/**
 * Registra o Identificador do endereco, sem Pessoa, sem nome e sem Participacao, pela porta que a recepcao ja usa. Idempotente:
 * o que ja existe nao e relatado (o `desfazer` so remove o que esta Operacao criou).
 */
export function registrarIdentificadorComEfeito(
  acervo: Acervo,
  e: { fonte: Fonte; valor: string },
  op: Operacao,
): { id: string; criado: boolean } {
  return acervo.db.transaction(() => {
    const r = registrarIdentificador(acervo, { fonte: e.fonte, valor: e.valor });
    if (r.criado) op.valor({ tabela: 'identificadores', chave: r.id, campo: 'id', antes: null, depois: r.id });
    return { id: r.id, criado: r.criado };
  })();
}

/**
 * O que faz um Identificador estar EM USO: Pessoa, cada referencia do inventario da resolucao retroativa e o autor de uma
 * Chegada. Conferido por EXISTS, e nunca deixado a chave estrangeira: as de `identificadores` sao em cascata ou anulam
 * (`ON DELETE CASCADE`, `SET NULL`), entao um DELETE cru passaria e levaria junto, em silencio, o nome, a Participacao ou o autor
 * da Mensagem. `chegadas.autor_id` nao tem chave nenhuma: sem a linha dele, a Chegada da Mensagem que ja saiu ficaria com autor
 * orfao. `desvinculos` fica de fora de proposito: o registro do desfeito sobrevive ao Identificador.
 */
export const SQL_REMOVER_IDENTIFICADOR_SEM_USO = `DELETE FROM identificadores
  WHERE id = ?
    AND pessoa_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM atribuicoes_de_nome        WHERE identificador_id = identificadores.id)
    AND NOT EXISTS (SELECT 1 FROM cartoes_de_catalogo        WHERE identificador_id = identificadores.id)
    AND NOT EXISTS (SELECT 1 FROM etiquetas_de_participacao  WHERE identificador_id = identificadores.id)
    AND NOT EXISTS (SELECT 1 FROM participacoes              WHERE identificador_id = identificadores.id)
    AND NOT EXISTS (SELECT 1 FROM transicoes_de_participacao WHERE identificador_id = identificadores.id)
    AND NOT EXISTS (SELECT 1 FROM mensagens                  WHERE autor_id = identificadores.id)
    AND NOT EXISTS (SELECT 1 FROM mensagens                  WHERE citada_autor_id = identificadores.id)
    AND NOT EXISTS (SELECT 1 FROM chegadas                   WHERE autor_id = identificadores.id)`;

/** Remove o Identificador SO se nada o referencia. Usado pelo `desfazer` da linha que a uniao criou. */
export function removerIdentificadorSemUso(
  acervo: Acervo,
  identificadorId: string,
): 'removido' | 'em-uso' | 'ja-nao-existe' {
  if (acervo.preparar(SQL_REMOVER_IDENTIFICADOR_SEM_USO).run(identificadorId).changes === 1) return 'removido';
  return acervo.preparar('SELECT 1 FROM identificadores WHERE id = ?').get(identificadorId) === undefined
    ? 'ja-nao-existe'
    : 'em-uso';
}

// ---------------------------------------------------------------------------------------------------------------------------
// As guardas do `desfazer`, uma por linha de efeito. `de` e `para` sao os da linha (antes e depois): devolver leva de `para` a
// `de`. Devolvem `null` (desfeito) ou a causa da recusa, e nunca lancam por estado mudado.

/**
 * Linha `mensagens.conversa_id`: devolve a Mensagem a `de`, SO se ela ainda esta em `para` (a Conversa que a Operacao gravou).
 */
export function devolverMensagemDeConversa(
  acervo: Acervo,
  e: { mensagemId: string; de: string; para: string },
): string | null {
  if (lerConversa(acervo, e.de) === undefined) return 'a Conversa de origem ja nao existe';
  const r = acervo
    .preparar('UPDATE mensagens SET conversa_id = ? WHERE id = ? AND conversa_id = ?')
    .run(e.de, e.mensagemId, e.para);
  if (r.changes === 1) return null;
  return acervo.preparar('SELECT 1 FROM mensagens WHERE id = ?').get(e.mensagemId) === undefined
    ? 'a Mensagem ja nao existe'
    : 'a Mensagem ja nao esta na Conversa que a Operacao gravou (mudou depois) e fica onde esta';
}

/**
 * Linha `marcas_de_conversa.conversa_id`: devolve a marca a `de`, SO se ela ainda esta em `para` e `de` ainda nao tem a mesma
 * (a chave primaria colidiria).
 */
export function devolverMarcaDeConversa(
  acervo: Acervo,
  e: { de: string; para: string; marca: string; configuracaoId: string },
): string | null {
  if (lerConversa(acervo, e.de) === undefined) return 'a Conversa de origem ja nao existe';
  const jaNaOrigem = acervo
    .preparar('SELECT 1 FROM marcas_de_conversa WHERE conversa_id = ? AND marca = ? AND configuracao_id = ?')
    .get(e.de, e.marca, e.configuracaoId);
  if (jaNaOrigem !== undefined) return 'a Conversa de origem ja tem essa marca de novo; a do destino fica';
  const r = acervo
    .preparar('UPDATE marcas_de_conversa SET conversa_id = ? WHERE conversa_id = ? AND marca = ? AND configuracao_id = ?')
    .run(e.de, e.para, e.marca, e.configuracaoId);
  return r.changes === 1 ? null : 'a marca ja nao esta na Conversa que a Operacao gravou (foi desfeita ou desmarcada)';
}

/**
 * Linha `conversas.id_externo`: devolve o endereco `de` a Conversa, SO se ela ainda tem o `para` (o que a Operacao gravou) e
 * nenhuma outra Conversa direta da mesma Configuracao passou a ter o `de`.
 */
export function devolverEnderecoDeConversaDireta(
  acervo: Acervo,
  e: { conversaId: string; de: string; para: string },
): string | null {
  const c = lerConversa(acervo, e.conversaId);
  if (c === undefined) return 'a Conversa ja nao existe';
  if (c.coletiva !== 0 || c.id_externo !== e.para) {
    return 'a Conversa ja nao tem o endereco que a Operacao gravou (mudou depois) e fica como esta';
  }
  if (outraDiretaComEndereco(acervo, c, e.de) !== undefined) {
    return 'o endereco anterior ja e de outra Conversa direta na mesma Configuracao; a Conversa fica com o endereco novo';
  }
  acervo.preparar('UPDATE conversas SET id_externo = ? WHERE id = ? AND id_externo = ?').run(e.de, e.conversaId, e.para);
  return null;
}
