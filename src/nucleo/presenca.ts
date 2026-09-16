import type { Acervo } from './acervo.js';
import type { ConversaId } from './tipos.js';

/**
 * A janela dentro da qual esta Conversa TEM evento declarado.
 *
 * Fora dela o produto nao sabe — e nao saber e diferente de nada ter
 * acontecido. E por isso que o Alcance e por Conversa e medido no material,
 * em vez de ser promessa fixa do produto: a cobertura varia por conta em
 * ordens de grandeza, medido em 30/08/2026.
 */
export interface Alcance {
  de: number;
  ate: number;
}

/** Nulo quando a Conversa nao tem evento algum: ela nao tem alcance. */
export function alcanceDaConversa(acervo: Acervo, conversaId: ConversaId): Alcance | null {
  const linha = acervo.preparar(
      `SELECT MIN(ocorrida_em) de, MAX(ocorrida_em) ate
         FROM transicoes_de_participacao WHERE conversa_id = ?`,
    )
    .get(conversaId) as { de: number | null; ate: number | null };
  if (linha.de === null || linha.ate === null) return null;
  return { de: linha.de, ate: linha.ate };
}

/**
 * O que se pode afirmar sobre um Identificador numa data.
 *
 * `presente` afirma presenca de VERDADE, e isso so passou a ser possivel em
 * 30/08/2026, quando a medicao mostrou que a Fonte declara entrada. Ate ali o
 * grupo se chamava `nao-havia-saido`, porque sem entrada declarada a ausencia
 * de saida nao prova nada.
 */
export type SituacaoNaData = 'presente' | 'saiu-antes' | 'ainda-nao-entrou' | 'sem-informacao';

export interface PresencaDeIdentificador {
  identificadorId: string;
  situacao: SituacaoNaData;
  /** Presente so em `saiu-antes`. O instante que a Fonte declarou. */
  saiuEm?: number;
  /** Presente so em `presente`, quando ha entrada declarada ate a data. */
  entrouEm?: number;
}

/**
 * A ressalva viaja DENTRO da resposta, e nao no texto de quem a imprime.
 *
 * E a diferenca entre uma ressalva e uma decoracao: posta na apresentacao,
 * ela sumiria no `--json`, que e justamente a superficie que o agente le.
 */
export interface RessalvaDePresenca {
  /** O que o Alcance limita. */
  soDentroDoAlcance: string;
  /** O que `sem-informacao` significa, para nao ser lido como ausencia. */
  semInformacaoNaoEAusencia: string;
}

export interface RespostaDePresenca {
  conversaId: string;
  em: number;
  alcance: Alcance | null;
  dentroDoAlcance: boolean;
  presentes: PresencaDeIdentificador[];
  sairamAntes: PresencaDeIdentificador[];
  aindaNaoEntraram: PresencaDeIdentificador[];
  semInformacao: PresencaDeIdentificador[];
  ressalva: RessalvaDePresenca;
}

const RESSALVA: RessalvaDePresenca = Object.freeze({
  soDentroDoAlcance:
    'A Fonte so declara entrada e saida dentro do Alcance desta Conversa; fora dele nada e afirmavel.',
  semInformacaoNaoEAusencia:
    'Sem informacao NAO quer dizer ausente: quer dizer que a Fonte nao declarou o que essa Pessoa fez.',
});

export interface PerguntaDePresenca {
  conversaId: ConversaId;
  /** O instante sobre o qual se pergunta. */
  em: number;
}

/**
 * Quem estava nesta Conversa nesta data — ate onde a Fonte permite afirmar.
 *
 * O universo e a UNIAO do retrato com quem alguma Transicao nomeia: so o
 * retrato deixaria de fora quem a Fonte ja nao lista, e so as Transicoes
 * deixaria de fora quem nunca teve evento.
 *
 * A rota e o ULTIMO evento ate a data. Ele responde sozinho e trata readicao
 * de graca: entrou, saiu, entrou de novo — o ultimo ate a data e o que vale.
 *
 * Nao havendo evento ate a data, decide o PRIMEIRO evento depois dela: se for
 * uma saida, a pessoa estava (ninguem sai de onde nao esta); se for uma
 * entrada, ela ainda nao tinha entrado. Sem nenhum dos dois, nada e afirmavel.
 *
 * Fora do alcance, todos caem em `sem-informacao` — nas DUAS direcoes. Antes
 * do primeiro evento a Fonte ainda nao registrava; depois do ultimo ela pode
 * ter parado. Nos dois casos o silencio nada afirma.
 *
 * E de leitura: nao abre Operacao, nao escreve linha nenhuma.
 */
export function quemEstavaEm(acervo: Acervo, pergunta: PerguntaDePresenca): RespostaDePresenca {
  const alcance = alcanceDaConversa(acervo, pergunta.conversaId);
  const dentroDoAlcance =
    alcance !== null && pergunta.em >= alcance.de && pergunta.em <= alcance.ate;

  const universo = acervo.preparar(
      `SELECT identificador_id FROM participacoes WHERE conversa_id = ?
       UNION
       SELECT identificador_id FROM transicoes_de_participacao WHERE conversa_id = ?
       ORDER BY identificador_id`,
    )
    .all(pergunta.conversaId, pergunta.conversaId) as Array<{ identificador_id: string }>;

  const resposta: RespostaDePresenca = {
    conversaId: pergunta.conversaId,
    em: pergunta.em,
    alcance,
    dentroDoAlcance,
    presentes: [],
    sairamAntes: [],
    aindaNaoEntraram: [],
    semInformacao: [],
    ressalva: RESSALVA,
  };

  const ultimaAte = acervo.preparar(
    `SELECT natureza, ocorrida_em FROM transicoes_de_participacao
      WHERE conversa_id = ? AND identificador_id = ? AND ocorrida_em <= ?
      ORDER BY ocorrida_em DESC LIMIT 1`,
  );
  const primeiraDepois = acervo.preparar(
    `SELECT natureza FROM transicoes_de_participacao
      WHERE conversa_id = ? AND identificador_id = ? AND ocorrida_em > ?
      ORDER BY ocorrida_em ASC LIMIT 1`,
  );

  for (const { identificador_id: id } of universo) {
    if (!dentroDoAlcance) {
      resposta.semInformacao.push({ identificadorId: id, situacao: 'sem-informacao' });
      continue;
    }

    const ultima = ultimaAte.get(pergunta.conversaId, id, pergunta.em) as
      | { natureza: string; ocorrida_em: number }
      | undefined;

    if (ultima !== undefined) {
      if (ultima.natureza === 'entrou') {
        resposta.presentes.push({
          identificadorId: id,
          situacao: 'presente',
          entrouEm: ultima.ocorrida_em,
        });
      } else {
        resposta.sairamAntes.push({
          identificadorId: id,
          situacao: 'saiu-antes',
          saiuEm: ultima.ocorrida_em,
        });
      }
      continue;
    }

    // Sem evento ate a data: o PRIMEIRO evento depois dela decide. Ninguem sai
    // de onde nao esta, entao uma saida posterior prova presenca; uma entrada
    // posterior prova que a pessoa ainda nao tinha entrado.
    const proxima = primeiraDepois.get(pergunta.conversaId, id, pergunta.em) as
      | { natureza: string }
      | undefined;

    if (proxima?.natureza === 'saiu') {
      resposta.presentes.push({ identificadorId: id, situacao: 'presente' });
    } else if (proxima?.natureza === 'entrou') {
      resposta.aindaNaoEntraram.push({ identificadorId: id, situacao: 'ainda-nao-entrou' });
    } else {
      // Nenhum evento, em direcao nenhuma. O retrato diz onde a pessoa esta
      // HOJE, e nao onde estava — e usa-lo aqui seria apresentar o quadro
      // atual como historico, que e o defeito central que este ciclo impede.
      resposta.semInformacao.push({ identificadorId: id, situacao: 'sem-informacao' });
    }
  }

  return resposta;
}
