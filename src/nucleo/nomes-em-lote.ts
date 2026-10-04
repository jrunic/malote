import type { Acervo } from './acervo.js';
import type { PrecedenciaDeNome } from '../registro/precedencia-de-nome.js';
import { montarNomes, nomeEscolhido, type LinhaDeNome } from './identidade.js';
import type { PresencaDeIdentificador, RespostaDePresenca } from './presenca.js';

export interface NomeEmLote {
  nome: string;
  origem: string;
}

/**
 * O nome corrente (e a origem) de um CONJUNTO de Identificadores, com UMA consulta e a mesma
 * precedencia aplicada em memoria. O handler do servidor e sincrono: consulta por linha, em
 * listagem de milhares, e o que esta funcao existe para nao fazer. Identificador sem Atribuicao
 * nao tem entrada no resultado.
 */
export function nomesEmLote(
  acervo: Acervo,
  identificadorIds: string[],
  precedencia: PrecedenciaDeNome,
): Map<string, NomeEmLote> {
  const saida = new Map<string, NomeEmLote>();
  if (identificadorIds.length === 0) return saida;
  const linhas = acervo
    .preparar(
      `SELECT identificador_id, origem, nome, atribuido_em, autoridade, configuracao_id, pessoa_id
         FROM atribuicoes_de_nome
        WHERE identificador_id IN (SELECT value FROM json_each(?))
        ORDER BY atribuido_em DESC`,
    )
    .all(JSON.stringify(identificadorIds)) as Array<LinhaDeNome & { identificador_id: string }>;

  const porId = new Map<string, LinhaDeNome[]>();
  for (const l of linhas) {
    const lista = porId.get(l.identificador_id);
    if (lista === undefined) porId.set(l.identificador_id, [l]);
    else lista.push(l);
  }
  for (const [id, lista] of porId) {
    const escolhido = nomeEscolhido(montarNomes(lista), precedencia);
    if (escolhido !== null) saida.set(id, { nome: escolhido.nome, origem: escolhido.origem });
  }
  return saida;
}

export interface PresencaComNome extends PresencaDeIdentificador {
  valor: string | null;
  nome: string | null;
  origemDoNome: string | null;
  pessoaId: string | null;
}

export type RespostaDePresencaComNomes = Omit<
  RespostaDePresenca,
  'presentes' | 'sairamAntes' | 'aindaNaoEntraram' | 'semInformacao'
> & {
  presentes: PresencaComNome[];
  sairamAntes: PresencaComNome[];
  aindaNaoEntraram: PresencaComNome[];
  semInformacao: PresencaComNome[];
};

/**
 * Acrescenta a cada participante o valor do Identificador, o nome corrente (do PROPRIO
 * Identificador — o ramo "nome da Pessoa" ficou fora da v1, medido: 0 de 5.581 ganhariam), a
 * origem do nome e o id da Pessoa. Nome e Pessoa sao `null` quando nao ha; os campos que a
 * resposta ja tinha nao mudam.
 */
export function enriquecerPresenca(
  acervo: Acervo,
  resposta: RespostaDePresenca,
  precedencia: PrecedenciaDeNome,
): RespostaDePresencaComNomes {
  const todos = [
    ...resposta.presentes,
    ...resposta.sairamAntes,
    ...resposta.aindaNaoEntraram,
    ...resposta.semInformacao,
  ];
  const ids = [...new Set(todos.map((p) => p.identificadorId))];
  const nomes = nomesEmLote(acervo, ids, precedencia);
  const dados = new Map<string, { valor: string; pessoaId: string | null }>();
  if (ids.length > 0) {
    const linhas = acervo
      .preparar('SELECT id, valor, pessoa_id FROM identificadores WHERE id IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(ids)) as Array<{ id: string; valor: string; pessoa_id: string | null }>;
    for (const l of linhas) dados.set(l.id, { valor: l.valor, pessoaId: l.pessoa_id });
  }
  const enriquecer = (p: PresencaDeIdentificador): PresencaComNome => {
    const d = dados.get(p.identificadorId);
    const n = nomes.get(p.identificadorId);
    return {
      ...p,
      valor: d?.valor ?? null,
      nome: n?.nome ?? null,
      origemDoNome: n?.origem ?? null,
      pessoaId: d?.pessoaId ?? null,
    };
  };
  return {
    ...resposta,
    presentes: resposta.presentes.map(enriquecer),
    sairamAntes: resposta.sairamAntes.map(enriquecer),
    aindaNaoEntraram: resposta.aindaNaoEntraram.map(enriquecer),
    semInformacao: resposta.semInformacao.map(enriquecer),
  };
}
