import type { Acervo } from './acervo.js';
import type { Fonte, PessoaId } from './tipos.js';

/**
 * Leitura de acervo inteiro, para quem precisa cruzar tudo com tudo.
 *
 * Existe porque os produtores de Proposta sao do ADAPTADOR e adaptador nao le
 * tabela do nucleo (tarefa #670). Sem esta porta, o plano 2 recriaria a
 * divida que o plano 1 acabou de pagar.
 */
export interface IdentificadorNoInventario {
  id: string;
  fonte: Fonte;
  valor: string;
  /**
   * A Pessoa MESTRE, nunca a absorvida: para quem cruza identidade, duas
   * absorvidas da mesma familia sao a mesma Pessoa, e e isso que impede a
   * Proposta ja resolvida de ser oferecida outra vez.
   */
  pessoaId: PessoaId | null;
  /** Nomes pendurados NESTE endereco. Nome de Pessoa nao entra. */
  nomes: string[];
  /**
   * TODOS os cartoes de catalogo de onde este endereco veio, com a
   * Configuracao de cada. Lista VAZIA fora de `contatos` — e nao nula: o tipo
   * nao precisa de dois estados para dizer "nenhum".
   *
   * E o laco que impede o produtor por multiplos enderecos de fundir
   * homonimos, e a unica coisa que distingue duas bases quando o endereco e o
   * mesmo: `UNIQUE (fonte, valor)` faz o e-mail compartilhado ser UMA linha
   * em `identificadores`, entao quem liga uma base a outra e o par de cartoes.
   *
   * Ate 12/09/2026 vinha UM SO, o mais recente. Com N bases, o endereco
   * presente em duas ficava so com o cartao da ultima — e a Proposta perdia o
   * membro da outra, em silencio.
   */
  cartoes: Array<{ cartao: string; configuracaoId: string }>;
}

interface Linha {
  id: string;
  fonte: Fonte;
  valor: string;
  pessoa_id: string | null;
  mestre_id: string | null;
}

export function listarIdentificadores(acervo: Acervo): IdentificadorNoInventario[] {
  const linhas = acervo.preparar(
      `SELECT i.id, i.fonte, i.valor, i.pessoa_id,
              COALESCE(p.absorvida_por, i.pessoa_id) AS mestre_id
         FROM identificadores i
         LEFT JOIN pessoas p ON p.id = i.pessoa_id
        ORDER BY i.fonte, i.valor`,
    )
    .all() as Linha[];

  // Consulta agrupada em memoria, e nao subconsulta correlacionada: a forma
  // antiga rodava um SELECT por Identificador, e sao 43.061 deles no acervo
  // real. Mesma forma que os nomes ja usam, logo abaixo.
  const cartoes = acervo.preparar(
      `SELECT identificador_id, cartao, configuracao_id
         FROM cartoes_de_catalogo ORDER BY visto_em, cartao`,
    )
    .all() as Array<{ identificador_id: string; cartao: string; configuracao_id: string }>;

  const porIdentificadorCartao = new Map<string, Array<{ cartao: string; configuracaoId: string }>>();
  for (const c of cartoes) {
    const atual = porIdentificadorCartao.get(c.identificador_id);
    const entrada = { cartao: c.cartao, configuracaoId: c.configuracao_id };
    if (atual === undefined) porIdentificadorCartao.set(c.identificador_id, [entrada]);
    else atual.push(entrada);
  }

  const nomes = acervo.preparar(
      `SELECT identificador_id, nome FROM atribuicoes_de_nome
        WHERE identificador_id IS NOT NULL`,
    )
    .all() as Array<{ identificador_id: string; nome: string }>;

  const porIdentificador = new Map<string, string[]>();
  for (const n of nomes) {
    const atual = porIdentificador.get(n.identificador_id);
    if (atual === undefined) porIdentificador.set(n.identificador_id, [n.nome]);
    else atual.push(n.nome);
  }

  return linhas.map((l) => ({
    id: l.id,
    fonte: l.fonte,
    valor: l.valor,
    pessoaId: l.mestre_id,
    nomes: porIdentificador.get(l.id) ?? [],
    cartoes: porIdentificadorCartao.get(l.id) ?? [],
  }));
}

/** Um Anexo que o Acervo declara e o disco ainda nao tem. */
export interface AnexoPendente {
  anexoId: string;
  /**
   * A Referencia Externa da MENSAGEM, e nao um caminho gravado: o caminho na
   * origem carrega apelido e numero, e nunca entra no Acervo. E por ela que
   * quem traz o arquivo reencontra a linha no material.
   */
  mensagemIdExterno: string;
}

export interface FiltroDeAnexoPendente {
  fonte: Fonte;
}

/**
 * O cursor dos Anexos por obter, de UMA Fonte.
 *
 * Porta do nucleo porque quem precisa dela e o ADAPTADOR, e adaptador nao le
 * tabela do nucleo (tarefa #670).
 *
 * O JOIN com `mensagens` nao e detalhe de implementacao: `anexos` nao tem
 * coluna de Fonte, e num Inquilino com as duas Fontes o trazer do WhatsApp
 * capturaria os Anexos do Instagram e os contaria como ausentes do proprio
 * material — numero falso num relatorio de operacao.
 *
 * A Presenca E o cursor: `nunca-obtido` e exatamente o que falta. Interromper
 * e reexecutar retoma sozinho, sem tabela de progresso.
 */
export function listarAnexosPendentes(
  acervo: Acervo,
  filtro: FiltroDeAnexoPendente,
): AnexoPendente[] {
  const linhas = acervo.preparar(
      `SELECT a.id AS anexo_id, m.id_externo AS mensagem_id_externo
         FROM anexos a
         JOIN mensagens m ON m.id = a.mensagem_id
        WHERE m.fonte = ? AND a.presenca = 'nunca-obtido'`,
    )
    .all(filtro.fonte) as Array<{ anexo_id: string; mensagem_id_externo: string }>;

  return linhas.map((l) => ({ anexoId: l.anexo_id, mensagemIdExterno: l.mensagem_id_externo }));
}
