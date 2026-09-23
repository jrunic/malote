import type { Database } from 'better-sqlite3';
import { emOperacao } from './trilha.js';

/**
 * Um passo de migracao: uma forma vira a seguinte.
 *
 * O DDL de um passo e FOTOGRAFIA CONGELADA e NUNCA compartilha codigo com o
 * schema fresco. Parece duplicacao e nao e: quando um passo futuro alterar a
 * tabela que este cria, este aqui tem de continuar criando a forma de ENTAO,
 * enquanto o schema fresco evolui. Compartilhar faria o passo antigo produzir
 * a forma nova, e a cadeia deixaria de reconstruir a historia. Quem paga por
 * essa duplicacao ficar honesta e o teste de equivalencia.
 */
/**
 * O que um passo pode precisar e que NAO esta no banco que ele migra.
 *
 * O caso que a criou: o passo 13 -> 14 preenche `conversas.configuracao_id`, e
 * as Configuracoes de Adaptador vivem no REGISTRO, que e outro arquivo. Migrar
 * acontece ao ABRIR o Acervo para escrita, e quem abre nem sempre tem o
 * Registro — o ouvinte nao tem.
 *
 * Passo que exige contexto e nao o recebe RECUSA, em vez de escolher um valor.
 * E a mesma regra que o produto aplica ao ouvinte, virada para a propria
 * maquina: recusar quando nao sabe, nunca adivinhar.
 */
export interface ContextoDeMigracao {
  configuracoes?: readonly { id: string; fonte: string }[];
  /**
   * Nome do Titular na Fonte, por Configuracao — a mesma declaracao que vive
   * em Pasta de Entrada (`entradas_de_adaptador.nome_do_titular_na_fonte`).
   * So o passo 19 -> 20 (backfill de Direcao do Instagram) usa isto; os
   * demais continuam olhando so `configuracoes`.
   */
  nomeDoTitularNaFonte?: ReadonlyMap<string, string>;
}

export interface PassoDeMigracao {
  /** Forma de origem. */
  de: number;
  /** Forma de destino. Sempre `de + 1`. */
  para: number;
  /** O que o passo faz, em uma frase, para o relatorio e a contabilidade. */
  descricao: string;
  /** Aplica o passo. Roda DENTRO da transacao da execucao. */
  aplicar(db: Database, contexto: ContextoDeMigracao): void;
  /**
   * Este passo precisa de `ContextoDeMigracao` para decidir o que escrever.
   *
   * O executor recusa ANTES de abrir a transacao quando o contexto nao vem, e a
   * mensagem nomeia o comando que o tem — `malote acervo migrar`, o unico
   * caminho que abre o Registro junto.
   */
  exigeContexto?: boolean;
  /**
   * Divergencia de contagem que este passo produz DE PROPOSITO.
   *
   * A conferencia nao exige igualdade estrita: o primeiro passo legitimo que
   * remova linha derivada a quebraria. Exige que toda divergencia esteja
   * declarada aqui — divergencia nao declarada reprova.
   */
  divergenciasEsperadas?: readonly DivergenciaDeclarada[];
  /** Tabelas que este passo cria. Tabela nova nao declarada reprova. */
  tabelasNovas?: readonly string[];
  /**
   * Marca que o passo recria tabela referenciada por chave estrangeira.
   *
   * Quando verdadeiro, o executor desliga o enforcement de FK ANTES de abrir a
   * transacao e o religa depois — `PRAGMA foreign_keys` e ignorado EM SILENCIO
   * dentro de transacao, que e pior que erro. Precedente da frota: ADR
   * 20260519.
   */
  recriaTabelaReferenciada?: boolean;
  /**
   * Acao sobre o Destino de Midia que este passo deixa pendente.
   *
   * Arquivo nao participa da transacao do banco. O passo grava a pendencia na
   * MESMA transacao que muda o banco; quem executa a acao e o chamador, depois
   * do commit, e ele baixa a pendencia ao terminar. A janela entre as duas
   * coisas e banco novo com midia velha, e ela e OBSERVAVEL — quem abrir a
   * base encontra a pendencia.
   */
  midiaPendente?: string;
}

export interface DivergenciaDeclarada {
  tabela: string;
  /** Linhas acrescentadas (positivo) ou removidas (negativo). */
  delta: number;
}

/**
 * O plano de uma base: de onde ela pode subir, ate onde, e por quais passos.
 *
 * O executor nao sabe se esta migrando Acervo ou Registro. E o que permite as
 * duas bases usarem a mesma maquina sem um condicional por base.
 */
export interface PlanoDeMigracao {
  /** Para mensagem de erro e contabilidade: `Acervo` ou `Registro`. */
  nome: string;
  /** Forma mais antiga que a maquina alcanca. Abaixo dela, recusa. */
  piso: number;
  /** Forma que este codigo espera. */
  corrente: number;
  passos: readonly PassoDeMigracao[];
  /**
   * O que dizer a quem chega com forma ABAIXO do piso.
   *
   * E por base, e nao generico, porque a saida honesta difere: o Acervo tem
   * `acervo recriar` e o material como fonte; o Registro nao tem nem uma coisa
   * nem outra, e mandar recriar seria apontar para um comando que nao existe.
   */
  instrucaoAbaixoDoPiso: string;
}

/** Contagem de linhas de toda tabela do banco, exceto as internas do SQLite. */
export function contarTabelas(db: Database): Map<string, number> {
  const nomes = (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((l) => l.name);

  const contagem = new Map<string, number>();
  for (const nome of nomes) {
    // Identificador citado: nome de tabela nao entra por parametro em SQL, e
    // estes nomes vem do catalogo do proprio banco — nunca de fora.
    const linha = db.prepare(`SELECT COUNT(*) AS n FROM "${nome}"`).get() as { n: number };
    contagem.set(nome, linha.n);
  }
  return contagem;
}

/**
 * Confere as contagens de depois contra as de antes.
 *
 * O criterio NAO e igualdade estrita: o primeiro passo legitimo que remova
 * linha derivada a quebraria. O criterio e que toda divergencia esteja
 * DECLARADA pelo passo, e que a declarada bata exatamente com a real —
 * declaracao e contrato, nao teto.
 *
 * Devolve a lista de queixas. Vazia = passou.
 */
export function conferir(
  antes: Map<string, number>,
  depois: Map<string, number>,
  divergencias: readonly DivergenciaDeclarada[],
  tabelasNovas: readonly string[] = [],
): string[] {
  const queixas: string[] = [];
  const esperado = new Map(divergencias.map((d) => [d.tabela, d.delta]));
  const sinal = (v: number): string => (v >= 0 ? `+${v}` : `${v}`);

  for (const [tabela, n] of antes) {
    const agora = depois.get(tabela);
    if (agora === undefined) {
      // Sumir NAO e o mesmo que esvaziar, e nenhuma declaracao de delta cobre
      // isso: um passo que apaga tabela teria de dizer outra coisa, e hoje nao
      // existe passo assim.
      queixas.push(`tabela ${tabela} desapareceu (tinha ${n} linhas)`);
      continue;
    }
    const delta = agora - n;
    const declarado = esperado.get(tabela) ?? 0;
    if (delta !== declarado) {
      queixas.push(
        `tabela ${tabela}: ${n} linhas antes, ${agora} depois ` +
          `(diferenca ${sinal(delta)}, declarada ${sinal(declarado)})`,
      );
    }
  }

  for (const tabela of depois.keys()) {
    if (antes.has(tabela)) continue;
    if (!tabelasNovas.includes(tabela)) {
      queixas.push(`tabela ${tabela} apareceu sem ser declarada pelo passo`);
    }
  }

  return queixas;
}

/**
 * Violacoes de chave estrangeira, como conjunto comparavel.
 *
 * Existe para ser tomada ANTES e comparada DEPOIS. `PRAGMA foreign_key_check`
 * sem argumento varre o banco inteiro e nao distingue dano herdado de dano
 * proprio — reprovar por sujeira alheia derrubou uma API por 11 minutos na
 * V006 do jd-tasks. Estreitar para `foreign_key_check(tabela)` NAO e a
 * correcao: com argumento ele checa as FKs declaradas NA tabela, nao as que
 * apontam PARA ela, e deixaria de ver justamente o dano que o rebuild causa.
 * ADR 20260519, bug 3.
 */
export function violacoesDeChave(db: Database): Set<string> {
  const linhas = db.pragma('foreign_key_check') as Record<string, unknown>[];
  return new Set(linhas.map((l) => JSON.stringify(l)));
}

export class MigracaoReprovadaError extends Error {
  constructor(
    readonly caminho: string,
    readonly queixas: readonly string[],
  ) {
    super(
      `Migracao de ${caminho} REPROVADA na conferencia e foi desfeita. ` +
        `Nada mudou. Queixas: ${queixas.join('; ')}`,
    );
    this.name = 'MigracaoReprovadaError';
  }
}

export class FormaAbaixoDoPisoError extends Error {
  constructor(
    readonly caminho: string,
    readonly gravada: number,
    readonly piso: number,
    instrucao: string,
  ) {
    super(
      `${caminho} esta na forma ${gravada}, anterior ao piso de migracao ${piso}. ` +
        `Esta forma e de antes do lancamento e nao tem passo escrito. ${instrucao}`,
    );
    this.name = 'FormaAbaixoDoPisoError';
  }
}

export interface PassoAplicado {
  de: number;
  para: number;
  descricao: string;
  midiaPendente?: string | undefined;
}

export interface ResultadoDeMigracao {
  de: number;
  para: number;
  passosAplicados: PassoAplicado[];
}

/** Forma gravada, ou `undefined` se a base e nova (sem a tabela de versao). */
export function versaoGravada(db: Database): number | undefined {
  const tabela = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'versao_schema'")
    .get() as { name: string } | undefined;
  if (tabela === undefined) return undefined;
  const linha = db.prepare('SELECT versao FROM versao_schema').get() as
    | { versao: number }
    | undefined;
  return linha?.versao;
}

/**
 * Sobe a base da forma gravada ate a corrente, pelos passos do plano.
 *
 * UMA transacao por EXECUCAO, e nao por passo: o criterio e "falha no meio
 * deixa a forma de ORIGEM", nao "deixa o ultimo passo completado". Cada passo
 * grava a propria linha de contabilidade DENTRO dessa transacao.
 */
export function migrar(
  db: Database,
  caminho: string,
  plano: PlanoDeMigracao,
  contexto: ContextoDeMigracao = {},
): ResultadoDeMigracao {
  const gravada = versaoGravada(db);
  if (gravada === undefined) {
    throw new Error(`${caminho} nao tem forma gravada: nao ha o que migrar.`);
  }
  if (gravada > plano.corrente) {
    throw new Error(
      `${caminho} esta na forma ${gravada}, POSTERIOR a ${plano.corrente} que este codigo espera.`,
    );
  }
  if (gravada < plano.piso) {
    throw new FormaAbaixoDoPisoError(caminho, gravada, plano.piso, plano.instrucaoAbaixoDoPiso);
  }
  if (gravada === plano.corrente) {
    return { de: gravada, para: gravada, passosAplicados: [] };
  }

  const pendentes = plano.passos.filter((p) => p.de >= gravada).sort((a, b) => a.de - b.de);

  // Buraco na sequencia recusa ANTES de tocar na base. Sem esta checagem, uma
  // lista de passos incompleta rodaria o que tem e carimbaria a forma final —
  // que e exatamente a mentira que esta maquina existe para impedir.
  let esperada = gravada;
  for (const passo of pendentes) {
    if (passo.de !== esperada || passo.para !== esperada + 1) {
      throw new Error(
        `Sequencia de passos de ${plano.nome} tem buraco: esperava ${esperada} para ` +
          `${esperada + 1}, achei ${passo.de} para ${passo.para}.`,
      );
    }
    esperada = passo.para;
  }
  if (esperada !== plano.corrente) {
    throw new Error(
      `Sequencia de passos de ${plano.nome} tem buraco: termina em ${esperada}, ` +
        `e a forma corrente e ${plano.corrente}.`,
    );
  }

  // Recusa por contexto ausente vem ANTES de desligar FK e de abrir transacao:
  // abortar no meio deixaria o enforcement de FK desligado e a base tocada.
  const semContexto = pendentes.filter(
    (p) => p.exigeContexto === true && contexto.configuracoes === undefined,
  );
  if (semContexto.length > 0) {
    throw new Error(
      `${caminho}: o passo ${semContexto[0]?.de} para ${semContexto[0]?.para} precisa das ` +
        'Configuracoes de Adaptador, que vivem no Registro. Rode ' +
        '`malote acervo migrar --inquilino <id>`, que abre as duas bases.',
    );
  }

  // FORA da transacao, e por necessidade: `PRAGMA foreign_keys` dentro de
  // transacao e ignorado EM SILENCIO — pior que erro. ADR 20260519.
  const precisaDesligarFk = pendentes.some((p) => p.recriaTabelaReferenciada === true);
  const fkEstavaLigada = (db.pragma('foreign_keys', { simple: true }) as number) === 1;
  if (precisaDesligarFk && fkEstavaLigada) db.pragma('foreign_keys = OFF');

  try {
    const contagemAntes = contarTabelas(db);
    const violacoesAntes = violacoesDeChave(db);
    const aplicados: PassoAplicado[] = [];
    const agora = new Date().toISOString();

    db.transaction(() => {
      for (const passo of pendentes) {
        passo.aplicar(db, contexto);
        db.prepare('UPDATE versao_schema SET versao = ?').run(passo.para);
        db.prepare(
          `INSERT INTO migracoes_aplicadas
             (de, para, descricao, aplicada_em, conferencia, midia_pendente)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(passo.de, passo.para, passo.descricao, agora, 'pendente', passo.midiaPendente ?? null);
        aplicados.push({
          de: passo.de,
          para: passo.para,
          descricao: passo.descricao,
          midiaPendente: passo.midiaPendente,
        });
      }

      // Conferencia DENTRO da transacao e ANTES do commit: reprovar aqui
      // desfaz tudo, inclusive as linhas de contabilidade acima.
      const divergencias = pendentes.flatMap((p) => p.divergenciasEsperadas ?? []).slice();
      const tabelasNovas = pendentes.flatMap((p) => p.tabelasNovas ?? []);
      // A contabilidade cresce uma linha por passo, e nenhum passo declara
      // isso: e a maquina medindo o proprio rastro. Somar aqui e mais honesto
      // que exigir de cada passo que declare o que a maquina faz por ele.
      divergencias.push({ tabela: 'migracoes_aplicadas', delta: pendentes.length });
      const queixas = conferir(contagemAntes, contarTabelas(db), divergencias, tabelasNovas);

      const violacoesNovas = [...violacoesDeChave(db)].filter((v) => !violacoesAntes.has(v));
      if (violacoesNovas.length > 0) {
        queixas.push(`${violacoesNovas.length} violacao(oes) NOVA(S) de chave estrangeira`);
      }

      if (queixas.length > 0) throw new MigracaoReprovadaError(caminho, queixas);

      db.prepare('UPDATE migracoes_aplicadas SET conferencia = ? WHERE aplicada_em = ?').run(
        `ok: ${contagemAntes.size} tabelas conferidas`,
        agora,
      );
    })();

    return { de: gravada, para: plano.corrente, passosAplicados: aplicados };
  } finally {
    if (precisaDesligarFk && fkEstavaLigada) db.pragma('foreign_keys = ON');
  }
}

/**
 * A migracao, dentro de uma Operacao da trilha.
 *
 * A Operacao e gravada na forma NOVA: `emOperacao` abre a transacao, o
 * trabalho corre dentro dela, e o INSERT em `operacoes` acontece no comeco
 * dessa transacao. Observacionalmente isso e o mesmo que "no fim", com UMA
 * limitacao que fica declarada: nenhum passo pode recriar as tabelas da
 * propria trilha, porque o INSERT ja teria acontecido na forma velha delas.
 * Se um dia for preciso, a maquina ganha caminho proprio nesse dia — nao um
 * remendo agora para um caso que nao existe.
 *
 * `irreversivel` porque desfazer uma migracao nao e reverter linhas: seria
 * outro passo, escrito de proposito. Declarar reversivel o que nao tem
 * desfazer e o tipo de afirmacao que, em registro de auditoria, se le como
 * garantia.
 */
export function migrarComTrilha(
  db: Database,
  caminho: string,
  plano: PlanoDeMigracao,
  inquilinoId?: string,
  contexto: ContextoDeMigracao = {},
): ResultadoDeMigracao {
  // Sem trabalho a fazer, nao abre Operacao. Gravar uma Operacao por abertura
  // de base encheria a trilha de linhas que nao registram decisao nenhuma — e
  // TODA abertura passa por aqui.
  if (versaoGravada(db) === plano.corrente) return migrar(db, caminho, plano, contexto);

  // A MIGRACAO ACONTECE ANTES DA TRILHA, e a ordem nao e livre.
  //
  // A trilha vive em `operacoes`, e uma migracao pode estar ALTERANDO essa
  // tabela — foi o que aconteceu em 03/09/2026, ao entrar a coluna do Ator: a
  // Operacao era inserida com a coluna nova antes de o passo cria-la, e a
  // migracao inteira falhava com "table operacoes has no column named ator".
  // Nao e caso de borda: vale para toda migracao futura que toque a trilha.
  //
  // O que se perde ao inverter: se o processo morrer entre a migracao e o
  // registro dela, a base fica migrada sem a linha na trilha. Isso e tolerado
  // porque nao e a unica prova — `migracoes_aplicadas` e escrita DENTRO da
  // transacao da migracao, e e ela a contabilidade. A trilha e o segundo
  // registro, para quem audita.
  const resultado = migrar(db, caminho, plano, contexto);

  emOperacao(
    // Sem cache aqui, e de proposito: a migracao roda UMA vez por passo, entao
    // nao ha o que amortizar — e guardar statement compilado atravessaria um
    // passo que troca a propria tabela a que ele se refere.
    { db, preparar: (sql: string) => db.prepare(sql) },
    {
      natureza: 'migrar-base',
      reversibilidade: 'irreversivel',
      ...(inquilinoId !== undefined ? { inquilinoId } : {}),
    },
    (op) => {
      for (const passo of resultado.passosAplicados) {
        op.valor({
          tabela: 'versao_schema',
          chave: plano.nome,
          campo: 'versao',
          antes: String(passo.de),
          depois: String(passo.para),
        });
      }
    },
  );

  return resultado;
}

export interface PassoNaContabilidade {
  de: number;
  para: number;
  descricao: string;
  conferencia: string;
}

/**
 * Os passos que ja foram aplicados a esta base, em ordem.
 *
 * Existe como PORTA porque a CLI precisa relatar o que a migracao fez, e a
 * Restricao do repo diz que so o nucleo e o registro tocam em tabela. A
 * primeira versao deste relatorio preparava o SQL na propria CLI, e a
 * varredura canonica NAO acusou — ela busca `.db.prepare` numa linha so, e o
 * formatador quebra a cadeia quando ela passa da largura maxima.
 */
export function passosAplicados(db: Database): PassoNaContabilidade[] {
  return db
    .prepare('SELECT de, para, descricao, conferencia FROM migracoes_aplicadas ORDER BY de')
    .all() as PassoNaContabilidade[];
}

export interface PendenciaDeMidia {
  de: number;
  para: number;
  acao: string;
}

/**
 * Pendencias de midia em aberto.
 *
 * Arquivo nao entra na transacao do banco, entao existe uma janela entre o
 * commit e a acao sobre os arquivos. O desenho NAO a elimina — ela e
 * inelutavel enquanto houver dois meios sem transacao comum. O que ele faz e
 * torna-la OBSERVAVEL: a pendencia e gravada na mesma transacao que muda o
 * banco, e so e baixada quando a acao termina. Quem abre a base no meio da
 * janela encontra a pendencia, em vez de um banco que se declara pronto com os
 * arquivos ainda na forma velha.
 */
export function pendenciasDeMidia(db: Database): PendenciaDeMidia[] {
  return db
    .prepare(
      `SELECT de, para, midia_pendente AS acao FROM migracoes_aplicadas
        WHERE midia_pendente IS NOT NULL ORDER BY de`,
    )
    .all() as PendenciaDeMidia[];
}

/** Baixa a pendencia de um passo. Idempotente: baixar o que ja foi baixado nao e erro. */
export function baixarPendenciaDeMidia(db: Database, de: number, para: number): void {
  db.prepare('UPDATE migracoes_aplicadas SET midia_pendente = NULL WHERE de = ? AND para = ?').run(
    de,
    para,
  );
}
