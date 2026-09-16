import { randomUUID } from 'node:crypto';
import { chaveDeNome } from './chave-de-nome.js';
import { nomeRepeteOEndereco } from './nome-do-endereco.js';
import { SQL_FAMILIA, mestreDe } from './familia.js';
import type { Acervo } from './acervo.js';
import { emOperacao } from './trilha.js';
import type { PrecedenciaDeNome } from '../registro/precedencia-de-nome.js';
import {
  PESO_DA_PROCEDENCIA,
  type Fonte,
  type PessoaId,
  type ProcedenciaDeVinculo,
} from './tipos.js';

/**
 * Recusa de trocar a Pessoa de um Identificador que ja pertence a outra.
 * O modelo diz que conflito e "registrado e apresentado, nunca resolvido em
 * silencio" — mover Identificador entre Pessoas e operacao propria, explicita.
 */
export class IdentificadorDeOutraPessoaError extends Error {
  constructor(
    readonly identificadorId: string,
    readonly pessoaAtual: PessoaId,
    readonly pessoaPedida: PessoaId,
  ) {
    super(
      `Identificador ${identificadorId} ja pertence a Pessoa ${pessoaAtual}; ` +
        `vincular a ${pessoaPedida} seria roubar o vinculo. Mova-o explicitamente.`,
    );
    this.name = 'IdentificadorDeOutraPessoaError';
  }
}

/**
 * Recusa de rebaixamento: execucao automatica nao desfaz o que o humano
 * afirmou. Classe distinta da anterior para que o Adaptador conte por causa —
 * "recusado por conflito" e "preservado por procedencia" sao numeros
 * diferentes, e o relatorio de importacao precisa dos dois.
 */
export class VinculoDeProcedenciaMaiorError extends Error {
  constructor(
    readonly identificadorId: string,
    readonly procedenciaAtual: ProcedenciaDeVinculo,
    readonly procedenciaPedida: ProcedenciaDeVinculo,
  ) {
    super(
      `Identificador ${identificadorId} tem vinculo de procedencia ` +
        `'${procedenciaAtual}'; '${procedenciaPedida}' nao o altera.`,
    );
    this.name = 'VinculoDeProcedenciaMaiorError';
  }
}

export interface Vinculo {
  pessoaId: PessoaId;
  procedencia: ProcedenciaDeVinculo;
  vinculadoEm: string;
}

export function criarPessoa(acervo: Acervo): PessoaId {
  const id = randomUUID();
  emOperacao(acervo, { natureza: 'criar-pessoa', reversibilidade: 'por-efeito' }, (op) => {
    acervo.preparar('INSERT INTO pessoas (id, criada_em) VALUES (?, ?)')
      .run(id, new Date().toISOString());
    op.valor({ tabela: 'pessoas', chave: id, campo: 'id', antes: null, depois: id });
  });
  return id;
}

export function lerVinculo(acervo: Acervo, identificadorId: string): Vinculo | null {
  const linha = acervo.preparar('SELECT pessoa_id, procedencia, vinculado_em FROM identificadores WHERE id = ?')
    .get(identificadorId) as
    | {
        pessoa_id: string | null;
        procedencia: ProcedenciaDeVinculo | null;
        vinculado_em: string | null;
      }
    | undefined;
  if (linha === undefined || linha.pessoa_id === null) return null;
  if (linha.procedencia === null || linha.vinculado_em === null) return null;
  return {
    pessoaId: linha.pessoa_id,
    procedencia: linha.procedencia,
    vinculadoEm: linha.vinculado_em,
  };
}

export interface EntradaDeVinculo {
  identificadorId: string;
  pessoaId: PessoaId;
  procedencia: ProcedenciaDeVinculo;
  /**
   * Qual Configuracao de catalogo sustenta este vinculo.
   *
   * AUSENTE quando a evidencia atravessa mais de uma base — e nesse caso o
   * campo fica nulo de proposito. Escolher a primeira em ordem estavel diria
   * uma coisa que nao e verdade: nao ha UMA Configuracao que o sustente.
   */
  configuracaoId?: string;
}

/**
 * Liga um Identificador a uma Pessoa, declarando quem afirma o vinculo.
 *
 * Nunca escreve em Mensagem: o autor da Mensagem aponta para o Identificador,
 * e nao para a Pessoa, justamente para que resolver identidade depois nao
 * mexa no que ja foi importado.
 */
export function vincularIdentificador(acervo: Acervo, entrada: EntradaDeVinculo): void {
  const atual = lerVinculo(acervo, entrada.identificadorId);

  if (atual !== null && atual.pessoaId !== entrada.pessoaId) {
    if (PESO_DA_PROCEDENCIA[atual.procedencia] > PESO_DA_PROCEDENCIA[entrada.procedencia]) {
      throw new VinculoDeProcedenciaMaiorError(
        entrada.identificadorId,
        atual.procedencia,
        entrada.procedencia,
      );
    }
    throw new IdentificadorDeOutraPessoaError(
      entrada.identificadorId,
      atual.pessoaId,
      entrada.pessoaId,
    );
  }

  // Mesma Pessoa (ou nenhuma): a procedencia que fica e sempre a maior das duas.
  const manteveAtual =
    atual !== null &&
    PESO_DA_PROCEDENCIA[atual.procedencia] >= PESO_DA_PROCEDENCIA[entrada.procedencia];
  const procedencia = manteveAtual && atual !== null ? atual.procedencia : entrada.procedencia;

  // vinculado_em e a data da afirmacao que VALE, nao do ultimo toque. Reafirmar
  // com procedencia menor nao move a data: se movesse, o campo passaria a dizer
  // quando a rodada automatica passou por ali, e nao quando o dono do vinculo
  // o estabeleceu — e e esse campo que sustenta "humano nao e desfeito".
  const vinculadoEm =
    manteveAtual && atual !== null ? atual.vinculadoEm : new Date().toISOString();

  emOperacao(acervo, { natureza: 'vincular', reversibilidade: 'por-efeito' }, (op) => {
    // O valor ANTERIOR e o que este comando nao guardava — e sem ele desfazer
    // um vinculo e palpite sobre o que havia antes. So entra linha para campo
    // que MUDOU: relatar campo intocado faria a trilha afirmar mudanca que nao
    // houve, e desfazer regravaria por cima do que ja estava certo.
    const anterior = {
      pessoa_id: atual?.pessoaId ?? null,
      procedencia: atual?.procedencia ?? null,
      vinculado_em: atual?.vinculadoEm ?? null,
    };
    const novo = {
      pessoa_id: entrada.pessoaId,
      procedencia,
      vinculado_em: vinculadoEm,
    };
    for (const campo of ['pessoa_id', 'procedencia', 'vinculado_em'] as const) {
      if (anterior[campo] === novo[campo]) continue;
      op.valor({
        tabela: 'identificadores',
        chave: entrada.identificadorId,
        campo,
        antes: anterior[campo],
        depois: novo[campo],
      });
    }

    acervo.preparar(
        `UPDATE identificadores
            SET pessoa_id = ?, procedencia = ?, vinculado_em = ?, configuracao_id = ?
          WHERE id = ?`,
      )
      .run(
        entrada.pessoaId,
        procedencia,
        vinculadoEm,
        entrada.configuracaoId ?? null,
        entrada.identificadorId,
      );
  });
}

export interface Desvinculo {
  identificadorId: string;
  fonte: Fonte;
  valor: string;
  procedencia: ProcedenciaDeVinculo;
  desvinculadoEm: string;
}

/**
 * Desfaz o vinculo. A Pessoa PERMANECE, mesmo sem Identificador nenhum:
 * e ela que guarda o historico de nomes e o registro do que foi desfeito.
 *
 * Sem vinculo nao ha o que registrar, e a operacao e sem efeito — desvincular
 * duas vezes registra uma vez so.
 */
export function desvincularIdentificador(acervo: Acervo, identificadorId: string): void {
  const atual = lerVinculo(acervo, identificadorId);
  if (atual === null) return;

  const endereco = acervo.preparar('SELECT fonte, valor FROM identificadores WHERE id = ?')
    .get(identificadorId) as { fonte: Fonte; valor: string } | undefined;
  if (endereco === undefined) return;

  emOperacao(acervo, { natureza: 'desvincular', reversibilidade: 'por-efeito' }, (op) => {
    // O id sai para fora do `.run()`: a linha de efeito precisa referenciar a
    // MESMA linha inserida, e `randomUUID()` inline geraria outro valor.
    const desvinculoId = randomUUID();
    const quando = new Date().toISOString();

    acervo.preparar(
        `INSERT INTO desvinculos
           (id, pessoa_id, identificador_id, fonte, valor, procedencia, desvinculado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        desvinculoId,
        atual.pessoaId,
        identificadorId,
        endereco.fonte,
        endereco.valor,
        atual.procedencia,
        quando,
      );
    op.valor({
      tabela: 'desvinculos',
      chave: desvinculoId,
      campo: 'id',
      antes: null,
      depois: desvinculoId,
    });

    acervo.preparar(
        'UPDATE identificadores SET pessoa_id = NULL, procedencia = NULL, vinculado_em = NULL WHERE id = ?',
      )
      .run(identificadorId);
    for (const [campo, antes] of [
      ['pessoa_id', atual.pessoaId],
      ['procedencia', atual.procedencia],
      ['vinculado_em', atual.vinculadoEm],
    ] as const) {
      op.valor({ tabela: 'identificadores', chave: identificadorId, campo, antes, depois: null });
    }
  });
}

export function desvinculosDaPessoa(acervo: Acervo, pessoaId: PessoaId): Desvinculo[] {
  const linhas = acervo.preparar(
      `SELECT identificador_id, fonte, valor, procedencia, desvinculado_em
         FROM desvinculos WHERE pessoa_id = ? ORDER BY desvinculado_em DESC`,
    )
    .all(pessoaId) as Array<{
    identificador_id: string;
    fonte: Fonte;
    valor: string;
    procedencia: ProcedenciaDeVinculo;
    desvinculado_em: string;
  }>;
  return linhas.map((l) => ({
    identificadorId: l.identificador_id,
    fonte: l.fonte,
    valor: l.valor,
    procedencia: l.procedencia,
    desvinculadoEm: l.desvinculado_em,
  }));
}

/**
 * O nome pendura numa das duas ancoras, nunca nas duas.
 *
 * Os `?: never` NAO sao decoracao. Medido em 27/08/2026: a forma sem eles —
 * `Base & ({ pessoaId } | { identificadorId })` — ACEITA um objeto com as duas
 * chaves, porque a checagem de propriedade excedente contra uniao passa
 * qualquer chave conhecida por algum membro. Com `?: never`, o compilador
 * recusa; sem eles, a unica defesa seria a restricao do banco, em execucao.
 */
/**
 * QUEM afirmou o nome. Declarada pelo Adaptador, que e quem sabe de qual campo
 * do material o nome veio — o nucleo nao julga formato para adivinhar.
 *
 * Desempata DENTRO da mesma Fonte, como o Catalogo Preferido, e pela mesma
 * razao nunca atravessa Fontes: atravessar faria nome de plataforma ganhar de
 * nome de catalogo.
 *
 * Medido em 12/09/2026 no Acervo real: em 154 enderecos o nome que o outro
 * escolheu vencia o que o Titular cadastrou, so por ser mais recente.
 */
export const AUTORIDADES_DE_NOME = ['titular', 'terceiro'] as const;
export type AutoridadeDeNome = (typeof AUTORIDADES_DE_NOME)[number];

export type EntradaDeNome = {
  /**
   * A FONTE, e nunca a Fonte com a Configuracao colada.
   *
   * `melhorNome` faz lookup EXATO por origem contra a tabela de precedencia:
   * gravar 'contatos:um-catalogo' aqui faria o peso cair para zero e o nome
   * de catalogo ficar ABAIXO do nome de plataforma. Quem distingue catalogos e
   * a coluna de Configuracao, abaixo.
   */
  origem: string;
  nome: string;
  /** Quando a origem informa a data; sem isso, e o instante do registro. */
  atribuidoEm?: string;
  /** De qual Configuracao de catalogo veio. Ausente em nome de plataforma. */
  configuracaoId?: string;
  /**
   * Quem afirmou. OBRIGATORIO: opcional, o chamador decide por omissao — e foi
   * assim que um check de producao ficou desligado em toda a suite ate 08/09.
   */
  autoridade: AutoridadeDeNome;
} & (
  | { pessoaId: PessoaId; identificadorId?: never }
  | { identificadorId: string; pessoaId?: never }
);

export interface NomeAtribuido {
  origem: string;
  nome: string;
  atribuidoEm: string;
  /** Quem afirmou. Nulo nas linhas anteriores ao ciclo 18. */
  autoridade: AutoridadeDeNome | null;
  /** De qual Configuracao de catalogo veio. Nulo em nome de plataforma. */
  configuracaoId: string | null;
  /** Onde o nome esta pendurado — o que mesclar precisa saber. */
  ancora: 'pessoa' | 'identificador';
}

interface LinhaDeNome {
  origem: string;
  nome: string;
  atribuido_em: string;
  autoridade: AutoridadeDeNome | null;
  configuracao_id: string | null;
  pessoa_id: string | null;
}

/**
 * Acrescenta uma Atribuicao de Nome. Nome novo NAO apaga o anterior — a
 * unicidade e por (ancora, origem, nome), entao reprocessar o mesmo material
 * nao duplica e nome diferente da mesma origem entra como linha nova.
 *
 * Consequencia aceita: quem muda de nome de A para B e VOLTA para A tem o
 * retorno ignorado, e o nome corrente segue B. E o preco da idempotencia de
 * reprocessamento, e esta dito em vez de descoberto.
 */
export function registrarNome(acervo: Acervo, entrada: EntradaDeNome): boolean {
  const pessoaId = entrada.pessoaId ?? null;
  const identificadorId = entrada.identificadorId ?? null;
  // O id sai para fora do `.run()`: a linha de efeito precisa referenciar a
  // MESMA linha inserida, e `randomUUID()` inline geraria outro valor.
  const id = randomUUID();

  return emOperacao(acervo, { natureza: 'registrar-nome', reversibilidade: 'por-efeito' }, (op) => {
    const quando = entrada.atribuidoEm ?? new Date().toISOString();

    // A unicidade do banco e por texto EXATO, e marcado nao e igual a
    // desmarcado: sem este lookup, a segunda escrita do mesmo nome com marca
    // invisivel cria linha gemea e nada reclama. Medido em 12/09/2026: 1.609
    // Atribuicoes de origem whatsapp ja carregam marca, 1.014 delas em nome
    // humano.
    //
    // A busca e pela ancora, que e indexada, e a comparacao acontece aqui
    // porque SQL nao conhece a chave. O texto GRAVADO nao muda: normalizar e
    // para comparar, nunca para reescrever o que a Fonte declarou.
    const chave = chaveDeNome(entrada.nome);
    const irmas = acervo.preparar(
        `SELECT id, nome, autoridade FROM atribuicoes_de_nome
          WHERE origem = ? AND configuracao_id IS ?
            AND pessoa_id IS ? AND identificador_id IS ?`,
      )
      .all(entrada.origem, entrada.configuracaoId ?? null, pessoaId, identificadorId) as Array<{
      id: string;
      nome: string;
      autoridade: AutoridadeDeNome | null;
    }>;
    const gemea = irmas.find((i) => chaveDeNome(i.nome) === chave);
    if (gemea !== undefined) {
      // SUBIDA MONOTONA. `titular` sempre grava; `terceiro` so grava sobre
      // indeterminado. Resolver indeterminado para `terceiro` BAIXA o rank de
      // desempate (1 -> 0) e mesmo assim e correto: o que sobe e o
      // conhecimento, nao a confianca. Sem esta regra, o nome que a plataforma
      // reenvia todo dia rebaixaria o que o material afirmou uma vez.
      const sobe = gemea.autoridade === null || entrada.autoridade === 'titular';
      const depois = sobe ? entrada.autoridade : gemea.autoridade;
      acervo.preparar(
          'UPDATE atribuicoes_de_nome SET ultimo_avistamento = ?, autoridade = ? WHERE id = ?',
        )
        .run(quando, depois, gemea.id);
      // Mudanca de Autoridade e MUTACAO, e a trilha e como um agente descobre o
      // que outro fez. Reavistamento puro nao e efeito e nao entra; subida e.
      if (depois !== gemea.autoridade) {
        op.valor({
          tabela: 'atribuicoes_de_nome',
          chave: gemea.id,
          campo: 'autoridade',
          antes: gemea.autoridade,
          depois,
        });
      }
      // `false` continua significando "nao e nome novo": o relatorio conta
      // criacao, e subir Autoridade nao cria nome. Quem registra a subida e a
      // trilha, logo acima.
      return false;
    }

    const r = acervo.preparar(
        `INSERT OR IGNORE INTO atribuicoes_de_nome
           (id, pessoa_id, identificador_id, origem, configuracao_id, nome,
            atribuido_em, ultimo_avistamento, autoridade)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        pessoaId,
        identificadorId,
        entrada.origem,
        entrada.configuracaoId ?? null,
        entrada.nome,
        quando,
        quando,
        entrada.autoridade,
      );
    // NOME REPETIDO E REAVISTAMENTO, e o instante avanca.
    //
    // UPDATE separado, e nao upsert: `registrarNome` devolve `changes > 0` como
    // "nome novo", e `ON CONFLICT DO UPDATE` conta o update como change —
    // `nomesCriados` passaria a contar reavistamento como criacao, e o
    // relatorio mentiria sem nada acusar. Alem disso, upsert sobre INDICE
    // PARCIAL exige repetir o WHERE no alvo do conflito, e sao quatro indices.
    //
    // `IS` e nao `=` na Configuracao: ela e anulavel, e `= NULL` nunca casa.
    if (r.changes === 0) {
      acervo.preparar(
          `UPDATE atribuicoes_de_nome SET ultimo_avistamento = ?
            WHERE origem = ? AND nome = ? AND configuracao_id IS ?
              AND pessoa_id IS ? AND identificador_id IS ?`,
        )
        .run(quando, entrada.origem, entrada.nome, entrada.configuracaoId ?? null,
             pessoaId, identificadorId);
    }
    // `INSERT OR IGNORE` que ignora nao altera linha nenhuma: e o proprio driver
    // dizendo o que aconteceu, sem um SELECT a mais. Nome repetido nao e
    // mudanca, e relatar efeito ali faria a trilha afirmar o que nao houve.
    if (r.changes > 0) {
      op.valor({ tabela: 'atribuicoes_de_nome', chave: id, campo: 'id', antes: null, depois: id });
    }
    return r.changes > 0;
  });
}

function montarNomes(linhas: LinhaDeNome[]): NomeAtribuido[] {
  return linhas.map((l) => ({
    origem: l.origem,
    nome: l.nome,
    atribuidoEm: l.atribuido_em,
    autoridade: l.autoridade,
    configuracaoId: l.configuracao_id,
    ancora: l.pessoa_id === null ? ('identificador' as const) : ('pessoa' as const),
  }));
}

/**
 * O que esta pendurado na Pessoa — e, quando ela e mestre, na familia inteira.
 *
 * Mesclar nao copia mais nada: e ESTE alcance que torna a copia desnecessaria.
 */
export function nomesDaPessoa(acervo: Acervo, pessoaId: PessoaId): NomeAtribuido[] {
  return montarNomes(
    acervo.preparar(
        `SELECT origem, nome, atribuido_em, autoridade, pessoa_id FROM atribuicoes_de_nome
          WHERE pessoa_id IN (${SQL_FAMILIA}) ORDER BY atribuido_em DESC`,
      )
      .all(pessoaId, pessoaId) as LinhaDeNome[],
  );
}

/** So o que esta pendurado no endereco. Existe sem Pessoa nenhuma. */
export function nomesDoIdentificador(acervo: Acervo, identificadorId: string): NomeAtribuido[] {
  return montarNomes(
    acervo.preparar(
        `SELECT origem, nome, atribuido_em, autoridade, configuracao_id, pessoa_id
           FROM atribuicoes_de_nome
          WHERE identificador_id = ? ORDER BY atribuido_em DESC`,
      )
      .all(identificadorId) as LinhaDeNome[],
  );
}

/**
 * Tudo o que se sabe do nome de uma Pessoa: o que esta nela mais o que esta
 * nos enderecos dela. Desvincular um endereco tira o nome dele desta lista —
 * ele nunca foi da Pessoa, e e por isso que a conta bate.
 */
export function historicoDeNomes(acervo: Acervo, pessoaId: PessoaId): NomeAtribuido[] {
  return montarNomes(
    acervo.preparar(
        `SELECT a.origem, a.nome, a.atribuido_em, a.autoridade, a.configuracao_id, a.pessoa_id
           FROM atribuicoes_de_nome a
          WHERE a.pessoa_id IN (${SQL_FAMILIA})
             OR a.identificador_id IN
                (SELECT id FROM identificadores WHERE pessoa_id IN (${SQL_FAMILIA}))
          ORDER BY a.atribuido_em DESC`,
      )
      .all(pessoaId, pessoaId, pessoaId, pessoaId) as LinhaDeNome[],
  );
}

/**
 * DOIS NIVEIS, nesta ordem.
 *
 * 1. Peso da ORIGEM, que e a Fonte. Origem que a precedencia nao nomeia pesa
 *    zero — desconhecida perde para qualquer declarada.
 * 2. Empatou? O catalogo PREFERIDO vence. So desempata entre linhas do MESMO
 *    peso, entao a preferencia nunca atravessa Fontes: declarar um catalogo
 *    preferido nao pode fazer nome de catalogo perder para nome de plataforma.
 * 3. Empatou ainda? O mais recente. A lista chega do mais recente para o mais
 *    antigo, entao comparar so com `>` ja mantem o mais recente de cada peso.
 *
 * A Configuracao e COLUNA e nao parte da origem, e e este `melhorNome` que
 * explica por que: o lookup e EXATO. Gravar 'contatos:um-catalogo' na origem
 * faria o peso cair para zero e o nome de catalogo ficar abaixo do whatsapp.
 */
/**
 * Rank de desempate DENTRO da origem. Indeterminado fica NO MEIO de proposito:
 * nao se sabe quem falou, entao ele nao vence quem o Titular cadastrou nem
 * perde para o que o outro escolheu. E o que faz nenhum nome exibido mudar
 * enquanto so houver linhas anteriores ao ciclo 18.
 */
const RANK_DA_AUTORIDADE: Record<AutoridadeDeNome, number> = { titular: 2, terceiro: 0 };
const rankDe = (a: AutoridadeDeNome | null): number => (a === null ? 1 : RANK_DA_AUTORIDADE[a]);

function melhorNome(
  historico: NomeAtribuido[],
  precedencia: PrecedenciaDeNome,
): string | null {
  let melhor: NomeAtribuido | undefined;
  let melhorPeso = -1;
  let melhorEhPreferido = false;
  for (const atual of historico) {
    const peso = precedencia.porOrigem[atual.origem] ?? 0;
    const ehPreferido =
      precedencia.catalogoPreferido !== null &&
      atual.configuracaoId === precedencia.catalogoPreferido;

    if (peso > melhorPeso) {
      melhorPeso = peso;
      melhor = atual;
      melhorEhPreferido = ehPreferido;
      continue;
    }
    // Mesmo peso: so o preferido toma o lugar de quem nao e. Sem isto, a
    // recencia decidiria sozinha, e a declaracao do Titular nao valeria nada.
    if (peso === melhorPeso && ehPreferido && !melhorEhPreferido) {
      melhor = atual;
      melhorEhPreferido = true;
      continue;
    }
    // NIVEL 3, e so dentro do mesmo peso e da mesma preferencia de catalogo:
    // quem o Titular cadastrou vence quem escolheu o proprio nome. NUNCA
    // atravessa Fonte — quem impede e o `peso > melhorPeso` la em cima, que
    // decide antes e nao volta atras. Medido em 12/09/2026: em 154 enderecos do
    // Acervo real o endereco vencia o nome humano so por ser mais recente.
    //
    // Estritamente maior, e nao maior-ou-igual: com `>=` a recencia voltaria a
    // decidir entre autoridades iguais, que e o comportamento que este nivel
    // existe para nao ter.
    if (
      peso === melhorPeso &&
      ehPreferido === melhorEhPreferido &&
      rankDe(atual.autoridade) > rankDe(melhor?.autoridade ?? null)
    ) {
      melhor = atual;
    }
  }
  return melhor?.nome ?? null;
}

/**
 * O nome corrente e DERIVADO, nunca gravado. A precedencia entra por parametro
 * em vez de vir do Acervo, e e isso que faz troca-la mudar o nome exibido sem
 * escrever uma linha.
 */
export function nomeDaPessoa(
  acervo: Acervo,
  pessoaId: PessoaId,
  precedencia: PrecedenciaDeNome,
): string | null {
  return melhorNome(historicoDeNomes(acervo, pessoaId), precedencia);
}

/** Nome corrente de um endereco: mesma regra, uma ancora so. */
export function nomeDoIdentificador(
  acervo: Acervo,
  identificadorId: string,
  precedencia: PrecedenciaDeNome,
): string | null {
  return melhorNome(nomesDoIdentificador(acervo, identificadorId), precedencia);
}

export class MesclagemDeUmaPessoaSoError extends Error {
  constructor(readonly pessoaId: PessoaId) {
    super(`Pessoa ${pessoaId} nao pode absorver a si mesma.`);
    this.name = 'MesclagemDeUmaPessoaSoError';
  }
}

export type RegraDeMestre = 'indicacao-explicita' | 'preferencia-de-catalogo' | 'ordem-de-chamada';

export interface EntradaDeMesclagem {
  pessoaA: PessoaId;
  pessoaB: PessoaId;
  /** Indicacao explicita de quem deve ser a mestre. Vence a preferencia. */
  mestreId?: PessoaId;
  /** Instante do ato. Injetado, nunca `Date.now()` por dentro. */
  quando?: number;
}

export interface ResultadoDeMesclagem {
  mestreId: PessoaId;
  absorvidaId: PessoaId;
  regra: RegraDeMestre;
  /** Quantas absorvidas da que perdeu o posto foram reapontadas. */
  reapontadas: number;
  atoId: string;
}

/**
 * A preferencia de mestre e declarada, nao e "a que sobrou": prevalece quem tem
 * Identificador da Fonte de catalogo — a Fonte que existe justamente para dizer
 * quem e quem, e a unica que conhece uma pessoa por varios enderecos.
 *
 * Um agente mesclando em lote precisa de criterio deterministico, e "a que
 * ficou" nao e um.
 */
function temIdentificadorDeCatalogo(acervo: Acervo, pessoaId: PessoaId): boolean {
  const l = acervo.preparar(
      `SELECT 1 AS ok FROM identificadores
        WHERE fonte = 'contatos' AND pessoa_id IN (${SQL_FAMILIA}) LIMIT 1`,
    )
    .get(pessoaId, pessoaId) as { ok: number } | undefined;
  return l !== undefined;
}

/**
 * Junta duas Pessoas que se descobriu serem a mesma.
 *
 * NAO move nem copia: a absorvida mantem Identificadores e Atribuicoes de Nome,
 * e passa a apontar para a mestre. Ler a mestre alcanca a familia, e e esse
 * invariante que torna a copia desnecessaria.
 *
 * Revisado em 29/08/2026. Ate entao mesclar movia os Identificadores com um
 * UPDATE sobre o conjunto e copiava os nomes com OR IGNORE — duas escritas
 * silenciosas por construcao, que faziam da operacao de maior alcance do modelo
 * a unica irreversivel.
 */
export function mesclarPessoas(
  acervo: Acervo,
  entrada: EntradaDeMesclagem,
): ResultadoDeMesclagem {
  // Escrita que recebe absorvida resolve para a MESTRE: a familia e a Pessoa, e
  // o contrario esbarraria na guarda que exige mestre-raiz.
  const a = mestreDe(acervo, entrada.pessoaA);
  const b = mestreDe(acervo, entrada.pessoaB);
  if (a === null) throw new Error(`Pessoa desconhecida: ${entrada.pessoaA}`);
  if (b === null) throw new Error(`Pessoa desconhecida: ${entrada.pessoaB}`);
  if (a === b) throw new MesclagemDeUmaPessoaSoError(a);

  let mestre: PessoaId;
  let regra: RegraDeMestre;
  if (entrada.mestreId !== undefined) {
    const indicada = mestreDe(acervo, entrada.mestreId);
    if (indicada !== a && indicada !== b) {
      throw new Error(`A mestre indicada ${entrada.mestreId} nao e nenhuma das duas Pessoas.`);
    }
    mestre = indicada;
    regra = 'indicacao-explicita';
  } else {
    const catA = temIdentificadorDeCatalogo(acervo, a);
    const catB = temIdentificadorDeCatalogo(acervo, b);
    if (catA !== catB) {
      mestre = catA ? a : b;
      regra = 'preferencia-de-catalogo';
    } else {
      // Sem discriminante: a primeira da chamada. Deterministico e declarado.
      mestre = a;
      regra = 'ordem-de-chamada';
    }
  }
  const absorvida = mestre === a ? b : a;

  const quando = new Date(entrada.quando ?? Date.now()).toISOString();
  const atoId = randomUUID();
  const seguidores = (
    acervo.preparar('SELECT id FROM pessoas WHERE absorvida_por = ?').all(absorvida) as Array<{
      id: string;
    }>
  ).map((l) => l.id);

  emOperacao(acervo, { natureza: 'mesclar', reversibilidade: 'por-delegacao' }, (op) => {
    const mover = acervo.preparar(
      'UPDATE pessoas SET absorvida_por = ?, absorvida_em = ? WHERE id = ?',
    );
    // Reaponta os seguidores ANTES de absorver: a guarda recusa absorver quem
    // ainda e mestre de outras, e a recusa e a protecao — nao um obstaculo.
    for (const seguidor of seguidores) mover.run(mestre, quando, seguidor);
    mover.run(mestre, quando, absorvida);

    acervo.preparar(
        `INSERT INTO atos_de_mesclagem
           (id, tipo, absorvida_id, absorvida_por_id, regra, desfaz_id, ocorrido_em)
         VALUES (?, 'mesclagem', ?, ?, ?, NULL, ?)`,
      )
      .run(atoId, absorvida, mestre, regra, quando);

    // REFERENCIA, nunca valor: o ato ja guarda absorvida, mestre, regra e
    // instante. Copiar isso em linha de efeito criaria duas fontes de verdade
    // que divergem — e o desfazer delega ao mecanismo do ciclo 6, que existe.
    op.referencia({ tabela: 'atos_de_mesclagem', chave: atoId });
  });

  return { mestreId: mestre, absorvidaId: absorvida, regra, reapontadas: seguidores.length, atoId };
}

export interface EntradaDeDesfazer {
  absorvidaId: PessoaId;
  quando?: number;
}

/**
 * Desfaz uma mesclagem: a Pessoa volta a ser raiz com tudo que sempre teve.
 *
 * Nada precisa ser reconstruido, porque nada foi movido. O que exige cuidado e
 * a volta dos SEGUIDORES: so voltam os que esta Pessoa absorveu num ato que
 * continua ATIVO. Seguidor cuja propria mesclagem ja foi desfeita nao retorna —
 * devolve-lo reviveria uma mesclagem que o Titular ja desfez.
 */
export function desfazerMesclagem(acervo: Acervo, entrada: EntradaDeDesfazer): void {
  const ato = acervo.preparar(
      `SELECT a.id, a.absorvida_por_id FROM atos_de_mesclagem a
        WHERE a.tipo = 'mesclagem' AND a.absorvida_id = ?
          AND NOT EXISTS (SELECT 1 FROM atos_de_mesclagem d
                           WHERE d.tipo = 'desfazer' AND d.desfaz_id = a.id)
        ORDER BY a.ocorrido_em DESC LIMIT 1`,
    )
    .get(entrada.absorvidaId) as { id: string; absorvida_por_id: string } | undefined;
  if (ato === undefined) {
    throw new Error(`Pessoa ${entrada.absorvidaId} nao esta mesclada por nenhum ato ativo.`);
  }

  const quando = new Date(entrada.quando ?? Date.now()).toISOString();
  // Seguidores que voltam: os que ESTA Pessoa absorveu por ato ainda ativo.
  const voltam = (
    acervo.preparar(
        `SELECT a.absorvida_id FROM atos_de_mesclagem a
          WHERE a.tipo = 'mesclagem' AND a.absorvida_por_id = ?
            AND NOT EXISTS (SELECT 1 FROM atos_de_mesclagem d
                             WHERE d.tipo = 'desfazer' AND d.desfaz_id = a.id)`,
      )
      .all(entrada.absorvidaId) as Array<{ absorvida_id: string }>
  ).map((l) => l.absorvida_id);

  // O id sai para fora do `.run()`: a linha de efeito precisa referenciar a
  // MESMA linha inserida, e `randomUUID()` inline geraria outro valor.
  const atoDeDesfazerId = randomUUID();

  emOperacao(acervo, { natureza: 'desfazer-mesclagem', reversibilidade: 'por-delegacao' }, (op) => {
    const mover = acervo.preparar(
      'UPDATE pessoas SET absorvida_por = ?, absorvida_em = ? WHERE id = ?',
    );
    // A ordem importa: limpar PRIMEIRO, senao a guarda recusa apontar os
    // seguidores para quem ainda nao e raiz. A guarda esta certa; a ordem e que
    // era a errada.
    mover.run(null, null, entrada.absorvidaId);
    for (const volta of voltam) mover.run(entrada.absorvidaId, quando, volta);

    acervo.preparar(
        `INSERT INTO atos_de_mesclagem
           (id, tipo, absorvida_id, absorvida_por_id, regra, desfaz_id, ocorrido_em)
         VALUES (?, 'desfazer', ?, ?, NULL, ?, ?)`,
      )
      .run(atoDeDesfazerId, entrada.absorvidaId, ato.absorvida_por_id, ato.id, quando);

    op.referencia({ tabela: 'atos_de_mesclagem', chave: atoDeDesfazerId });
  });
}

export interface IdentificadorDaPessoa {
  id: string;
  fonte: Fonte;
  valor: string;
  procedencia: ProcedenciaDeVinculo;
  vinculadoEm: string;
}

export interface PessoaLida {
  id: PessoaId;
  nome: string | null;
  historico: NomeAtribuido[];
  identificadores: IdentificadorDaPessoa[];
  absorvidaPor: PessoaId | null;
  criadaEm: string;
}

export function identificadoresDaPessoa(
  acervo: Acervo,
  pessoaId: PessoaId,
): IdentificadorDaPessoa[] {
  const linhas = acervo.preparar(
      `SELECT id, fonte, valor, procedencia, vinculado_em
         FROM identificadores WHERE pessoa_id IN (${SQL_FAMILIA}) ORDER BY fonte, valor`,
    )
    .all(pessoaId, pessoaId) as Array<{
    id: string;
    fonte: Fonte;
    valor: string;
    procedencia: ProcedenciaDeVinculo;
    vinculado_em: string;
  }>;
  return linhas.map((l) => ({
    id: l.id,
    fonte: l.fonte,
    valor: l.valor,
    procedencia: l.procedencia,
    vinculadoEm: l.vinculado_em,
  }));
}

/**
 * Tudo o que se sabe sobre uma Pessoa numa leitura so. A precedencia entra
 * por parametro, como em `nomeDaPessoa`: o nome e derivado, nunca gravado.
 */
export function lerPessoa(
  acervo: Acervo,
  pessoaId: PessoaId,
  precedencia: PrecedenciaDeNome,
): PessoaLida | null {
  const linha = acervo.preparar('SELECT id, criada_em, absorvida_por FROM pessoas WHERE id = ?')
    .get(pessoaId) as { id: string; criada_em: string; absorvida_por: string | null } | undefined;
  if (linha === undefined) return null;

  return {
    id: linha.id,
    nome: nomeDaPessoa(acervo, pessoaId, precedencia),
    historico: historicoDeNomes(acervo, pessoaId),
    identificadores: identificadoresDaPessoa(acervo, pessoaId),
    absorvidaPor: linha.absorvida_por,
    criadaEm: linha.criada_em,
  };
}

export interface FiltroDePessoa {
  /** Absorvidas ficam FORA por padrao: elas sao registro, nao gente ativa. */
  incluirAbsorvidas?: boolean;
}

export function listarPessoas(
  acervo: Acervo,
  precedencia: PrecedenciaDeNome,
  filtro: FiltroDePessoa,
): PessoaLida[] {
  const onde = filtro.incluirAbsorvidas === true ? '' : 'WHERE absorvida_por IS NULL';
  const linhas = acervo.preparar(`SELECT id FROM pessoas ${onde} ORDER BY criada_em`)
    .all() as Array<{ id: string }>;

  const lidas: PessoaLida[] = [];
  for (const l of linhas) {
    const p = lerPessoa(acervo, l.id, precedencia);
    if (p !== null) lidas.push(p);
  }
  return lidas;
}

export interface RemocaoDeNomes {
  /** Quantas repetiam o proprio endereco. */
  repetemOEndereco: number;
  /** Quantas duplicavam outra por marca invisivel. */
  duplicamPorMarca: number;
  /** Verdadeiro quando foi ENSAIO: contou e nao apagou. */
  ensaio: boolean;
}

interface CandidataARemocao {
  id: string;
  nome: string;
  valor: string | null;
  grupo: string;
}

/**
 * Remove as Atribuicoes de Nome que NAO nomeiam ninguem.
 *
 * Duas classes, e o modelo nega as duas: nome que repete o proprio endereco —
 * a plataforma preenchendo o campo com o numero — e duplicata da mesma
 * afirmacao por marca invisivel. Medido em 12/09/2026 contra o Acervo real:
 * 1.271 e 1.609, com 595 que sao as duas coisas.
 *
 * A partir do ciclo 18 nenhuma das duas nasce; esta porta existe para o que ja
 * esta gravado — e nao so no acervo do Titular: quem instalar o produto e
 * importar material antigo tera as mesmas duas.
 *
 * A ORDEM DO PREDICADO IMPORTA. Classifica-se primeiro endereco-repetido, que
 * remove sem condicao; so depois marca-duplicata, que remove se sobrar uma irma
 * QUE NAO VA SER REMOVIDA TAMBEM. Invertido, as 595 que sao as duas coisas
 * ficariam — cada uma segurando a outra como irma.
 */
export function removerNomesInvalidos(
  acervo: Acervo,
  opcoes: { comEfeito: boolean },
): RemocaoDeNomes {
  const linhas = acervo
    .preparar(
      `SELECT a.id, a.nome, i.valor,
              a.origem || ' ' || COALESCE(a.configuracao_id, '') || ' '
                || COALESCE(a.pessoa_id, '') || ' '
                || COALESCE(a.identificador_id, '') AS grupo
         FROM atribuicoes_de_nome a
         LEFT JOIN identificadores i ON i.id = a.identificador_id`,
    )
    .all() as CandidataARemocao[];

  // 1. Endereco-repetido: incondicional, e so faz sentido em Atribuicao
  // pendurada em Identificador — nome de Pessoa nao tem endereco a repetir.
  const porEndereco = new Set(
    linhas
      .filter((l) => l.valor !== null && nomeRepeteOEndereco(l.nome, l.valor))
      .map((l) => l.id),
  );

  // 2. Marca-duplicata, entre as que SOBREVIVEM ao passo 1.
  const porMarca = new Set<string>();
  const grupos = new Map<string, CandidataARemocao[]>();
  for (const l of linhas) {
    if (porEndereco.has(l.id)) continue;
    const atual = grupos.get(l.grupo) ?? [];
    atual.push(l);
    grupos.set(l.grupo, atual);
  }
  for (const doGrupo of grupos.values()) {
    const porChave = new Map<string, CandidataARemocao[]>();
    for (const l of doGrupo) {
      const k = chaveDeNome(l.nome);
      const atual = porChave.get(k) ?? [];
      atual.push(l);
      porChave.set(k, atual);
    }
    for (const iguais of porChave.values()) {
      if (iguais.length < 2) continue;
      // A irma que fica e a que NAO tem marca. Sem nenhuma limpa, todas ficam:
      // a linha com marca e a unica afirmacao que existe.
      const temLimpa = iguais.some((l) => l.nome === chaveDeNome(l.nome));
      if (!temLimpa) continue;
      for (const l of iguais) if (l.nome !== chaveDeNome(l.nome)) porMarca.add(l.id);
    }
  }

  const contagem: RemocaoDeNomes = {
    repetemOEndereco: porEndereco.size,
    duplicamPorMarca: porMarca.size,
    ensaio: !opcoes.comEfeito,
  };
  // ENSAIO NAO ESCREVE NADA, nem Operacao: ler nao e escrever, e Operacao vazia
  // na trilha faria um agente concluir que houve ato onde nao houve.
  if (!opcoes.comEfeito) return contagem;

  const alvos = [...porEndereco, ...porMarca];
  if (alvos.length === 0) return contagem;

  emOperacao(
    acervo,
    { natureza: 'remover-nomes-invalidos', reversibilidade: 'por-efeito' },
    (op) => {
      const apagar = acervo.preparar('DELETE FROM atribuicoes_de_nome WHERE id = ?');
      const ler = acervo.preparar('SELECT nome FROM atribuicoes_de_nome WHERE id = ?');
      for (const id of alvos) {
        const antes = (ler.get(id) as { nome: string } | undefined)?.nome ?? null;
        apagar.run(id);
        // O nome REMOVIDO vai no antes: e ele que torna a reversao possivel.
        op.valor({
          tabela: 'atribuicoes_de_nome',
          chave: id,
          campo: 'nome',
          antes,
          depois: null,
        });
      }
    },
  );
  return contagem;
}
