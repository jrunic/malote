import type { Acervo } from './acervo.js';
import type { ConversaId } from './tipos.js';
import { familiasDeIdentificadores } from './familia-de-endereco.js';
import { identificadoresDoRemetente } from './remetente.js';
import { fonteDaConversa } from './consulta.js';

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
  /**
   * A chave do contato (#1518): a forma canonica do endereco, ou o proprio endereco quando a Correspondencia nao o liga a
   * outra forma. Duas linhas com o mesmo `contato` sao o mesmo contato sob formas diferentes. Nulo so quando o
   * Identificador nao existe.
   */
  contato: string | null;
  /** As OUTRAS formas do endereco que a Correspondencia conhece, gravadas ou nao, ordenadas por valor. */
  formas: string[];
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
  /**
   * So o contato deste endereco, em qualquer das formas que a Correspondencia liga (#1518). Resolve pelo mesmo caminho do
   * filtro por remetente (`identificadoresDoRemetente`), na Fonte da Conversa.
   */
  endereco?: string;
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

  const base = acervo
    .preparar(
      `SELECT identificador_id FROM participacoes WHERE conversa_id = ?
       UNION
       SELECT identificador_id FROM transicoes_de_participacao WHERE conversa_id = ?`,
    )
    .all(pergunta.conversaId, pergunta.conversaId) as Array<{ identificador_id: string }>;
  const idsDeBase = new Set(base.map((l) => l.identificador_id));

  // O autor de Mensagem recebida desta Conversa cujo CONTATO tem Participacao ou Transicao sob OUTRA forma entra
  // tambem (#1518); quem nao tem nenhuma das duas, em forma nenhuma, NAO entra: a Presenca nunca se infere de ter
  // escrito.
  const autores = (
    acervo
      .preparar('SELECT DISTINCT autor_id FROM mensagens WHERE conversa_id = ? AND autor_id IS NOT NULL AND direcao = ?')
      .all(pergunta.conversaId, 'recebida') as Array<{ autor_id: string }>
  ).map((l) => l.autor_id);
  const familias = familiasDeIdentificadores(acervo, [...idsDeBase, ...autores]);
  const universoIds = new Set(idsDeBase);
  for (const autor of autores) {
    if (idsDeBase.has(autor)) continue;
    const f = familias.get(autor);
    if (f !== undefined && f.identificadorIds.some((i) => idsDeBase.has(i))) universoIds.add(autor);
  }
  let universo = [...universoIds].sort();
  if (pergunta.endereco !== undefined) {
    const fonte = fonteDaConversa(acervo, pergunta.conversaId);
    const alvo = new Set(
      identificadoresDoRemetente(acervo, { valor: pergunta.endereco, ...(fonte !== undefined ? { fonte } : {}) }),
    );
    universo = universo.filter((id) => alvo.has(id));
  }
  const doContato = (id: string): { contato: string | null; formas: string[] } => {
    const f = familias.get(id);
    return { contato: f === undefined ? null : (f.canonico ?? f.valor), formas: f?.outrasFormas ?? [] };
  };

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

  // Os eventos da Conversa, lidos UMA vez e agrupados por Identificador: a leitura por membro (duas consultas cada) custava ~4 s
  // na maior Conversa (3.666 membros). So se le dentro do Alcance; fora dele ninguem e afirmavel.
  type Evento = { natureza: string; ocorrida_em: number };
  const eventosPorIdentificador = new Map<string, Evento[]>();
  if (dentroDoAlcance) {
    const eventos = acervo
      .preparar(
        `SELECT identificador_id, natureza, ocorrida_em FROM transicoes_de_participacao
          WHERE conversa_id = ? ORDER BY ocorrida_em, id`,
      )
      .all(pergunta.conversaId) as Array<Evento & { identificador_id: string }>;
    for (const e of eventos) {
      const lista = eventosPorIdentificador.get(e.identificador_id);
      if (lista === undefined) eventosPorIdentificador.set(e.identificador_id, [e]);
      else lista.push(e);
    }
  }

  for (const id of universo) {
    const contato = doContato(id);
    if (!dentroDoAlcance) {
      resposta.semInformacao.push({ identificadorId: id, situacao: 'sem-informacao', ...contato });
      continue;
    }

    // A situacao da linha e a do CONTATO: o ultimo evento declarado entre os Identificadores gravados das formas dele.
    const doContatoEventos = (familias.get(id)?.identificadorIds ?? [id]).flatMap(
      (i) => eventosPorIdentificador.get(i) ?? [],
    );
    if (doContatoEventos.length > 1) doContatoEventos.sort((x, y) => x.ocorrida_em - y.ocorrida_em);
    let ultima: Evento | undefined;
    let proxima: Evento | undefined;
    for (const e of doContatoEventos) {
      if (e.ocorrida_em <= pergunta.em) ultima = e;
      else {
        proxima = e;
        break;
      }
    }

    if (ultima !== undefined) {
      if (ultima.natureza === 'entrou') {
        resposta.presentes.push({
          identificadorId: id,
          situacao: 'presente',
          entrouEm: ultima.ocorrida_em,
          ...contato,
        });
      } else {
        resposta.sairamAntes.push({
          identificadorId: id,
          situacao: 'saiu-antes',
          saiuEm: ultima.ocorrida_em,
          ...contato,
        });
      }
      continue;
    }

    // Sem evento ate a data: o PRIMEIRO evento depois dela decide. Ninguem sai
    // de onde nao esta, entao uma saida posterior prova presenca; uma entrada
    // posterior prova que a pessoa ainda nao tinha entrado.
    if (proxima?.natureza === 'saiu') {
      resposta.presentes.push({ identificadorId: id, situacao: 'presente', ...contato });
    } else if (proxima?.natureza === 'entrou') {
      resposta.aindaNaoEntraram.push({ identificadorId: id, situacao: 'ainda-nao-entrou', ...contato });
    } else {
      // Nenhum evento, em direcao nenhuma. O retrato diz onde a pessoa esta
      // HOJE, e nao onde estava — e usa-lo aqui seria apresentar o quadro
      // atual como historico, que e o defeito central que este ciclo impede.
      resposta.semInformacao.push({ identificadorId: id, situacao: 'sem-informacao', ...contato });
    }
  }

  return resposta;
}
