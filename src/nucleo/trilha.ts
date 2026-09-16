import { randomUUID } from 'node:crypto';
import { atorAtual } from './ator.js';
import type { Database, Statement } from 'better-sqlite3';

/**
 * Qualquer banco do produto: o AlvoDeTrilha de um Inquilino ou o Registro da
 * instalacao. A trilha mora JUNTO do efeito que registra, porque e a unica
 * forma de gravar as duas coisas na mesma transacao — e os dois sao bancos
 * separados, sem transacao entre eles.
 */
export interface AlvoDeTrilha {
  db: Database;
  /**
   * Compila uma vez por conexao e reusa. A trilha e escrita por operacao, entao
   * compilar por chamada aqui vaza na mesma proporcao que vazava na escrita —
   * ver `Acervo.preparar`.
   */
  preparar(sql: string): Statement;
}

/**
 * Como uma Operacao pode ser desfeita. Declarada no ato, NUNCA inferida na
 * hora de desfazer: inferir e o que produz "achei que tinha desfeito".
 *
 *  - `por-efeito`     — as linhas de valor bastam para reconstruir o anterior.
 *  - `por-delegacao`  — o desfazer chama o mecanismo que ja existe (mesclagem).
 *  - `irreversivel`   — descarte de arquivo, ingestao. Desfazer recusa.
 */
export type Reversibilidade = 'por-efeito' | 'por-delegacao' | 'irreversivel';

export interface AberturaDeOperacao {
  natureza: string;
  reversibilidade: Reversibilidade;
  /** Instante em milissegundos. Ausente = agora. Existe para o teste fixar. */
  quando?: number;
  /**
   * Quando esta Operacao DESFAZ outra. O indice unico do schema garante que a
   * mesma Operacao nao seja desfeita duas vezes — a segunda tentativa esbarra
   * no banco, nao numa checagem que alguem pode contornar. Usado no plano 3.
   */
  desfazId?: string;
  /**
   * Se as linhas de efeito de VALOR devem ser gravadas. Padrao `true`.
   *
   * A ingestao abre com `false`: ela chama `registrarNome` uma vez por Conversa
   * — sao milhares no material real — e gravar o efeito de cada uma dobraria o
   * AlvoDeTrilha, que e exatamente o que a premissa 1 da spec proibe. O ponteiro para
   * a trilha semantica CONTINUA sendo gravado: `referencia()` nao e afetada,
   * porque e ela que substitui o efeito linha a linha na ingestao.
   *
   * NAO e o mesmo que `irreversivel`: descartar Anexo e irreversivel E grava
   * efeito, porque e o unico registro do caminho que se perdeu.
   */
  registraEfeito?: boolean;
  /**
   * Se o trabalho inteiro roda dentro de UMA transacao. Padrao `true`.
   *
   * A ingestao abre com `false`, por duas razoes medidas em 29/08/2026:
   *
   *  - A importacao e RETOMAVEL por desenho — interrompida no meio, o que ja
   *    entrou fica, e a execucao seguinte completa sem duplicar. Envolve-la
   *    numa transacao unica trocaria retomabilidade por atomicidade e apagaria
   *    todo o progresso a cada falha.
   *  - O material real tem mais de um milhao de Mensagens. Uma transacao so
   *    para tudo isso e um WAL do tamanho do alvo.
   *
   * A Operacao e gravada mesmo assim, no comeco: importacao interrompida deixa
   * o registro de que foi TENTADA, sem a referencia ao Material que so o
   * termino escreve. E a leitura honesta do que aconteceu.
   */
  emTransacao?: boolean;
  /**
   * O Inquilino a que esta Operacao pertence. So o REGISTRO usa: la a trilha e
   * da instalacao inteira, e decisao de configuracao — Destino, Politica,
   * Precedencia, Intervalo — e de um Inquilino, enquanto criar Inquilino e
   * gerir Chave de Operador nao sao de nenhum.
   *
   * No Acervo fica sempre ausente, e a tabela de la NAO tem a coluna: o Acervo
   * e de um Inquilino so, e a coluna seria a afirmacao de que poderia nao ser.
   * E por isso que o INSERT tem dois caminhos.
   */
  inquilinoId?: string;
}

export interface RelatoDeValor {
  tabela: string;
  chave: string;
  campo: string;
  antes: string | null;
  depois: string | null;
}

export interface RelatoDeReferencia {
  tabela: string;
  chave: string;
}

/** O que o trabalho recebe para relatar o que fez. Nao sabe abrir nem fechar. */
export interface Operacao {
  readonly id: string;
  valor(relato: RelatoDeValor): void;
  referencia(relato: RelatoDeReferencia): void;
}

interface Aberta {
  id: string;
  ordem: number;
  registraEfeito: boolean;
}

/**
 * Operacao aberta por banco, para a reentrancia.
 *
 * Em WeakMap e nao em campo do `AlvoDeTrilha`: a interface `AlvoDeTrilha` e contrato lido
 * por todo o nucleo, e estado transitorio de uma chamada nao pertence a ela.
 * A chave e o `Database` porque e ele que a transacao amarra.
 */
const abertas = new WeakMap<Database, Aberta>();

/**
 * Envolve um comando de decisao numa Operacao.
 *
 * REENTRANTE de proposito: se ja ha Operacao aberta neste AlvoDeTrilha, o trabalho
 * se junta a ela e nenhuma Operacao nova nasce. E o que faz a aplicacao em
 * lote — que chama vincular e mesclar centenas de vezes — gravar UMA Operacao
 * com centenas de linhas, em vez de centenas de Operacoes.
 *
 * A Operacao e o efeito sao gravados na MESMA transacao do trabalho: abortar o
 * trabalho nao deixa Operacao orfa, e abortar a Operacao nao deixa efeito sem
 * registro.
 */
export function emOperacao<T>(
  alvo: AlvoDeTrilha,
  abertura: AberturaDeOperacao,
  trabalho: (op: Operacao) => T,
): T {
  const jaAberta = abertas.get(alvo.db);
  if (jaAberta !== undefined) {
    // Transacao AQUI tambem, ainda que ja haja uma de fora: o better-sqlite3
    // aninha como SAVEPOINT, e sem ela um trecho que lanca e cujo erro o
    // chamador ENGOLE deixa os relatos ja inseridos de pe. E exatamente o que
    // a aplicacao em lote do plano 3 faz — atomica por item, recusa nao aborta
    // o lote —, e sem o savepoint o item recusado deixaria linha de efeito
    // afirmando um efeito que foi revertido.
    return alvo.db.transaction(() => trabalho(punho(alvo, jaAberta)))();
  }

  const id = randomUUID();
  const estado: Aberta = { id, ordem: 0, registraEfeito: abertura.registraEfeito ?? true };

  const gravarEExecutar = (): T => {
    // Dois caminhos, e nao um INSERT com a coluna sempre: a tabela do ACERVO
    // nao tem `inquilino_id`, e citar a coluna quebraria la. O Acervo nunca
    // passa `inquilinoId`, entao nunca toca o caminho que a nomeia.
    if (abertura.inquilinoId === undefined) {
      alvo.preparar(
          `INSERT INTO operacoes (id, natureza, reversibilidade, ocorrida_em, desfaz_id, ator)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          abertura.natureza,
          abertura.reversibilidade,
          new Date(abertura.quando ?? Date.now()).toISOString(),
          abertura.desfazId ?? null,
          // Da SESSAO, e nao da abertura: o Ator descreve quem pediu, e nenhuma
          // das 28 chamadas de `emOperacao` tem — nem deve ter — esse
          // conhecimento.
          atorAtual(),
        );
    } else {
      alvo.preparar(
          `INSERT INTO operacoes
             (id, natureza, reversibilidade, ocorrida_em, desfaz_id, inquilino_id, ator)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          abertura.natureza,
          abertura.reversibilidade,
          new Date(abertura.quando ?? Date.now()).toISOString(),
          abertura.desfazId ?? null,
          abertura.inquilinoId,
          // OS DOIS caminhos. Acrescentar num e esquecer no outro produz
          // Operacao sem Ator exatamente onde a decisao de configuracao
          // acontece — que e o caminho com Inquilino, so do Registro.
          atorAtual(),
        );
    }
    return trabalho(punho(alvo, estado));
  };

  const executar =
    (abertura.emTransacao ?? true) ? alvo.db.transaction(gravarEExecutar) : gravarEExecutar;

  abertas.set(alvo.db, estado);
  try {
    return executar();
  } finally {
    // Sai SEMPRE, inclusive quando o trabalho lanca: deixar a Operacao marcada
    // como aberta faria a chamada seguinte se juntar a uma transacao revertida.
    abertas.delete(alvo.db);
  }
}

function punho(alvo: AlvoDeTrilha, estado: Aberta): Operacao {
  return {
    id: estado.id,
    valor(relato: RelatoDeValor): void {
      // A ingestao abre com `registraEfeito: false`. Descartar o relato AQUI, e
      // nao em cada chamador, e o que mantem `registrarNome` sem saber se esta
      // sendo chamado por um comando de decisao ou por um importador.
      if (!estado.registraEfeito) return;
      estado.ordem += 1;
      alvo.preparar(
          `INSERT INTO linhas_de_efeito
             (id, operacao_id, ordem, natureza, tabela, chave, campo, antes, depois)
           VALUES (?, ?, ?, 'valor', ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          estado.id,
          estado.ordem,
          relato.tabela,
          relato.chave,
          relato.campo,
          relato.antes,
          relato.depois,
        );
    },
    referencia(relato: RelatoDeReferencia): void {
      estado.ordem += 1;
      alvo.preparar(
          `INSERT INTO linhas_de_efeito
             (id, operacao_id, ordem, natureza, tabela, chave, campo, antes, depois)
           VALUES (?, ?, ?, 'referencia', ?, ?, NULL, NULL, NULL)`,
        )
        .run(randomUUID(), estado.id, estado.ordem, relato.tabela, relato.chave);
    },
  };
}

export interface OperacaoCrua {
  id: string;
  natureza: string;
  reversibilidade: Reversibilidade;
  ocorridaEm: string;
  desfazId: string | null;
}

export interface LinhaDeEfeito {
  natureza: 'valor' | 'referencia';
  tabela: string;
  chave: string;
  campo: string | null;
  antes: string | null;
  depois: string | null;
}

/**
 * Leitura crua da trilha, para teste e para o plano 3 construir a leitura de
 * verdade em cima. Mais recente primeiro.
 */
export function listarOperacoesCruas(alvo: AlvoDeTrilha): OperacaoCrua[] {
  const linhas = alvo.preparar(
      `SELECT id, natureza, reversibilidade, ocorrida_em, desfaz_id
         FROM operacoes ORDER BY ocorrida_em DESC, rowid DESC`,
    )
    .all() as Array<{
    id: string;
    natureza: string;
    reversibilidade: Reversibilidade;
    ocorrida_em: string;
    desfaz_id: string | null;
  }>;
  return linhas.map((l) => ({
    id: l.id,
    natureza: l.natureza,
    reversibilidade: l.reversibilidade,
    ocorridaEm: l.ocorrida_em,
    desfazId: l.desfaz_id,
  }));
}

export function linhasDaOperacao(alvo: AlvoDeTrilha, operacaoId: string): LinhaDeEfeito[] {
  return alvo.preparar(
      `SELECT natureza, tabela, chave, campo, antes, depois
         FROM linhas_de_efeito WHERE operacao_id = ? ORDER BY ordem`,
    )
    .all(operacaoId) as LinhaDeEfeito[];
}

export interface OperacaoListada {
  id: string;
  natureza: string;
  reversibilidade: Reversibilidade;
  ocorridaEm: string;
  inquilinoId: string | null;
  /**
   * Por ordem de quem. `null` nas Operacoes anteriores ao ciclo 11 — nao havia
   * campo —, e essa ausencia e distinguivel de `indeterminado`, que diz que o
   * caminho de execucao nao declarou.
   */
  ator: string | null;
  /** Quantas Linhas de Efeito ela tem. */
  linhas: number;
  /** A Operacao que a desfez, se houve. Nulo = ainda de pe. */
  desfeitaPor: string | null;
}

export interface OperacaoVista extends OperacaoListada {
  efeito: LinhaDeEfeito[];
}

interface LinhaListada {
  id: string;
  natureza: string;
  reversibilidade: Reversibilidade;
  ocorrida_em: string;
  ator: string | null;
  inquilino_id: string | null;
  linhas: number;
  desfeita_por: string | null;
}

/**
 * `desfeita_por` sai de subconsulta e nao de coluna: quem aponta e a Operacao
 * que DESFAZ, pelo `desfaz_id`. Guardar o inverso numa coluna criaria a segunda
 * fonte de verdade que o indice unico ja impede de existir.
 *
 * `inquilino_id` so existe no Registro — a consulta o pede pelo catalogo antes
 * de cita-lo, para servir as duas bases sem duas consultas.
 */
function selecaoDeOperacao(temInquilino: boolean): string {
  return `
  SELECT o.id, o.natureza, o.reversibilidade, o.ocorrida_em, o.ator,
         ${temInquilino ? 'o.inquilino_id' : 'NULL AS inquilino_id'},
         (SELECT COUNT(*) FROM linhas_de_efeito l WHERE l.operacao_id = o.id) AS linhas,
         (SELECT d.id FROM operacoes d WHERE d.desfaz_id = o.id) AS desfeita_por
    FROM operacoes o`;
}

function temColunaDeInquilino(alvo: AlvoDeTrilha): boolean {
  const linhas = alvo.preparar('PRAGMA table_info(operacoes)').all() as Array<{ name: string }>;
  return linhas.some((l) => l.name === 'inquilino_id');
}

function paraListada(l: LinhaListada): OperacaoListada {
  return {
    id: l.id,
    natureza: l.natureza,
    reversibilidade: l.reversibilidade,
    ocorridaEm: l.ocorrida_em,
    inquilinoId: l.inquilino_id,
    ator: l.ator,
    linhas: l.linhas,
    desfeitaPor: l.desfeita_por,
  };
}

/** Mais recente primeiro. `inquilinoId` filtra — usado so no Registro. */
export function listarOperacoes(
  alvo: AlvoDeTrilha,
  filtro: { inquilinoId?: string; limite?: number } = {},
): OperacaoListada[] {
  const temInq = temColunaDeInquilino(alvo);
  const onde = filtro.inquilinoId !== undefined && temInq ? ' WHERE o.inquilino_id = ?' : '';
  const sql = `${selecaoDeOperacao(temInq)}${onde} ORDER BY o.ocorrida_em DESC, o.rowid DESC LIMIT ?`;
  const args: unknown[] = [];
  if (onde !== '') args.push(filtro.inquilinoId);
  args.push(filtro.limite ?? 50);
  return (alvo.preparar(sql).all(...args) as LinhaListada[]).map(paraListada);
}

export function lerOperacao(alvo: AlvoDeTrilha, operacaoId: string): OperacaoVista | null {
  const temInq = temColunaDeInquilino(alvo);
  const l = alvo.preparar(`${selecaoDeOperacao(temInq)} WHERE o.id = ?`).get(operacaoId) as
    | LinhaListada
    | undefined;
  if (l === undefined) return null;
  return { ...paraListada(l), efeito: linhasDaOperacao(alvo, operacaoId) };
}
