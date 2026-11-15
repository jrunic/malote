import type { Acervo } from './acervo.js';
import type { PrecedenciaDeNome } from '../registro/precedencia-de-nome.js';
import { familiasDeIdentificadores } from './familia-de-endereco.js';
import { montarNomes, nomeEscolhido, type LinhaDeNome } from './identidade.js';

/**
 * Quem escreveu a Mensagem, por endereco (#1517): a forma gravada, a canonica (nula quando nenhuma Correspondencia
 * liga o endereco a outra forma: nunca se inventa) e o nome do CONTATO, resolvido pelas formas ligadas e pela
 * precedencia do Inquilino. `nome` e nulo sem precedencia (quem le sem ela nao resolve nome) e quando nenhuma forma
 * tem Atribuicao de Nome.
 */
export interface AutorDaMensagem {
  valor: string;
  canonico: string | null;
  nome: string | null;
}

/**
 * O autor de cada Identificador do conjunto, em lote: a leitura da familia de formas e UMA leitura de Atribuicoes de
 * Nome para a pagina inteira. O handler do servidor e sincrono; uma consulta por Mensagem e o que esta funcao existe
 * para nao fazer. A chave do mapa e o id do Identificador autor; id que nao existe nao entra.
 */
export function autoresDeIdentificadores(
  acervo: Acervo,
  autorIds: readonly string[],
  precedencia?: PrecedenciaDeNome,
): Map<string, AutorDaMensagem> {
  const saida = new Map<string, AutorDaMensagem>();
  const familias = familiasDeIdentificadores(acervo, autorIds);
  if (familias.size === 0) return saida;

  const linhasPorId = new Map<string, LinhaDeNome[]>();
  if (precedencia !== undefined) {
    const todos = [...new Set([...familias.values()].flatMap((f) => f.identificadorIds))];
    const linhas = acervo
      .preparar(
        `SELECT identificador_id, origem, nome, atribuido_em, autoridade, configuracao_id, pessoa_id
           FROM atribuicoes_de_nome
          WHERE identificador_id IN (SELECT value FROM json_each(?))
          ORDER BY atribuido_em DESC`,
      )
      .all(JSON.stringify(todos)) as Array<LinhaDeNome & { identificador_id: string }>;
    for (const l of linhas) {
      const lista = linhasPorId.get(l.identificador_id);
      if (lista === undefined) linhasPorId.set(l.identificador_id, [l]);
      else lista.push(l);
    }
  }

  for (const [id, f] of familias) {
    let nome: string | null = null;
    if (precedencia !== undefined) {
      // As Atribuicoes das formas juntas, na mesma ordem de recencia que a leitura de um Identificador so usa.
      const juntas = f.identificadorIds
        .flatMap((i) => linhasPorId.get(i) ?? [])
        .sort((a, b) =>
          a.atribuido_em < b.atribuido_em ? 1 : a.atribuido_em > b.atribuido_em ? -1 : 0,
        );
      nome = nomeEscolhido(montarNomes(juntas), precedencia)?.nome ?? null;
    }
    saida.set(id, { valor: f.valor, canonico: f.canonico, nome });
  }
  return saida;
}
