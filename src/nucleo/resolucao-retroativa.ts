import type { Acervo } from './acervo.js';
import type { Fonte } from './tipos.js';
import { emOperacao, type Operacao } from './trilha.js';
import { registrarIdentificador } from './escrita.js';
import { lerVinculo, vincularIdentificador } from './identidade.js';

/**
 * Resolucao retroativa de endereco.
 *
 * O WhatsApp entrega o mesmo endereco em duas formas, e o produto so aprende a
 * correspondencia entre elas quando um evento traz as duas juntas. Ate la, o
 * que chega na forma alternativa e gravado nela. A correspondencia que chega
 * depois nao volta atras sozinha — e essa a divida que este modulo paga.
 *
 * O algoritmo e uniforme e sem ramo: garante que o Identificador da forma
 * canonica exista, repoe nele tudo que apontava para o alternativo, e deixa o
 * alternativo de pe. Renomear o valor do alternativo seria mais curto e
 * apagaria o registro de que aquela forma foi vista.
 */

/**
 * As tabelas que referenciam `identificadores`. Declarada aqui e conferida
 * contra o banco por teste — nao derivada do banco em runtime. Derivar faria a
 * porta tratar tabela nova automaticamente e ERRADO: cada uma tem regra de
 * colisao propria, e adivinha-la e pior que falhar.
 */
export const TABELAS_QUE_APONTAM_PARA_IDENTIFICADOR = [
  'atribuicoes_de_nome',
  'cartoes_de_catalogo',
  'mensagens',
  'participacoes',
  'transicoes_de_participacao',
] as const;

export interface OpcoesDeResolucao {
  comEfeito: boolean;
}

export interface RelatorioDeResolucao {
  /** Ausente no ensaio: ensaio nao abre Operacao porque nao escreve. */
  operacaoId: string | null;
  correspondenciasVistas: number;
  paresReconciliados: number;
  semNadaAResolver: number;
  linhasRepontadas: Record<string, number>;
  linhasFundidas: Record<string, number>;
  vinculosMigrados: number;
  /**
   * Pares que cruzam fronteira de Pessoa. Nao sao reconciliados: sao propostos.
   * Quem aplica e `pessoa propostas aplicar`, que e ato humano.
   */
  propostasDeMesclagem: { alternativo: string; canonico: string }[];
}

interface Par {
  fonte: Fonte;
  alternativo: string;
  canonico: string;
}

/**
 * Tabelas cuja chave primaria e uma coluna so e em que o Identificador nao
 * entra em nenhuma restricao de unicidade: repontar e UPDATE direto, sem
 * chance de colisao.
 */
const CHAVE_SIMPLES: ReadonlyArray<{ tabela: string; campo: string }> = [
  { tabela: 'mensagens', campo: 'autor_id' },
  { tabela: 'atribuicoes_de_nome', campo: 'identificador_id' },
];

/**
 * Tabelas em que repontar pode colidir, e como reconhecer a linha equivalente.
 *
 * `pk` e a chave primaria da tabela, na ordem declarada no schema — e ela que
 * vai para a linha de efeito. `irmas` sao as colunas que, junto do
 * Identificador, identificam a MESMA coisa nos dois enderecos.
 *
 * Em `participacoes` e `cartoes_de_catalogo` o Identificador esta DENTRO da
 * chave primaria, entao a colisao e possivel sempre; em
 * `transicoes_de_participacao` ela vem da restricao de unicidade.
 *
 * Havendo colisao, prevalece a linha do CANONICO — e a que o resto do Acervo
 * ja alcanca. Escolher pela data faria o resultado depender da ordem de
 * chegada, que e da Fonte e nao nossa.
 */
const COM_COLISAO: ReadonlyArray<{
  tabela: string;
  pk: readonly string[];
  irmas: readonly string[];
}> = [
  { tabela: 'transicoes_de_participacao', pk: ['id'], irmas: ['fonte', 'id_externo'] },
  { tabela: 'participacoes', pk: ['conversa_id', 'identificador_id'], irmas: ['conversa_id'] },
  { tabela: 'cartoes_de_catalogo', pk: ['identificador_id', 'cartao'], irmas: ['cartao'] },
];

/**
 * Chave composta na linha de efeito: JSON das colunas da chave primaria, na
 * ordem declarada.
 *
 * `RelatoDeValor.chave` e uma cadeia so, e tres das cinco tabelas tem chave
 * composta. Nao ha precedente no repositorio — todo relato existente usa
 * coluna unica —, entao a convencao nasce aqui. JSON e nao separador, porque
 * separador colide com valor que o contenha, e `JSON.parse` devolve a chave
 * inteira sem heuristica.
 */
export function chaveDaLinha(pk: readonly string[], linha: Record<string, unknown>): string {
  if (pk.length === 1) return String(linha[pk[0] as string]);
  return JSON.stringify(pk.map((coluna) => String(linha[coluna])));
}

function texto(valor: unknown): string | null {
  return valor === null || valor === undefined ? null : String(valor);
}

function fundirOuRepontar(
  acervo: Acervo,
  op: Operacao,
  de: string,
  para: string,
  repontadas: Record<string, number>,
  fundidas: Record<string, number>,
): void {
  for (const { tabela, pk, irmas } of COM_COLISAO) {
    const linhas = acervo.preparar(`SELECT * FROM "${tabela}" WHERE identificador_id = ?`)
      .all(de) as Array<Record<string, unknown>>;

    for (const linha of linhas) {
      const condicao = irmas.map((c) => `"${c}" = ?`).join(' AND ');
      const gemea = acervo.preparar(`SELECT 1 FROM "${tabela}" WHERE identificador_id = ? AND ${condicao} LIMIT 1`)
        .get(para, ...irmas.map((c) => linha[c] as never));

      const chave = chaveDaLinha(pk, linha);

      if (gemea !== undefined) {
        // A gemea do canonico ja existe: a do alternativo sai. Relata UMA linha
        // por coluna, com `depois` vazio — e o que permite reinserir no desfazer.
        const alvo = pk.map((c) => `"${c}" = ?`).join(' AND ');
        acervo.preparar(`DELETE FROM "${tabela}" WHERE ${alvo}`)
          .run(...pk.map((c) => linha[c] as never));
        for (const [coluna, valor] of Object.entries(linha)) {
          op.valor({ tabela, chave, campo: coluna, antes: texto(valor), depois: null });
        }
        fundidas[tabela] = (fundidas[tabela] ?? 0) + 1;
        continue;
      }

      const alvo = pk.map((c) => `"${c}" = ?`).join(' AND ');
      acervo.preparar(`UPDATE "${tabela}" SET identificador_id = ? WHERE ${alvo}`)
        .run(para, ...pk.map((c) => linha[c] as never));
      // A chave do relato e a da linha DEPOIS do UPDATE quando o Identificador
      // faz parte dela: e por ela que o desfazer vai encontrar a linha.
      const depoisDaTroca = { ...linha, identificador_id: para };
      op.valor({
        tabela,
        chave: chaveDaLinha(pk, depoisDaTroca),
        campo: 'identificador_id',
        antes: de,
        depois: para,
      });
      repontadas[tabela] = (repontadas[tabela] ?? 0) + 1;
    }
  }
}

function idDoEndereco(acervo: Acervo, fonte: Fonte, valor: string): string | null {
  const linha = acervo.preparar('SELECT id FROM identificadores WHERE fonte = ? AND valor = ?')
    .get(fonte, valor) as { id: string } | undefined;
  return linha?.id ?? null;
}

/** Quantas linhas apontam para este Identificador, por tabela. */
function referenciasDe(acervo: Acervo, identificadorId: string): Record<string, number> {
  const conta: Record<string, number> = {};
  const alvos = [
    ...CHAVE_SIMPLES,
    ...COM_COLISAO.map((t) => ({ tabela: t.tabela, campo: 'identificador_id' })),
  ];
  for (const { tabela, campo } of alvos) {
    const linha = acervo.preparar(`SELECT COUNT(*) AS n FROM "${tabela}" WHERE "${campo}" = ?`)
      .get(identificadorId) as { n: number };
    if (linha.n > 0) conta[tabela] = linha.n;
  }
  return conta;
}

/**
 * Garante que o Identificador da forma canonica exista.
 *
 * A criacao e relatada com `referencia()`, nao com `valor()`: o produto nunca
 * remove Identificador, entao um relato de valor faria o desfazer cair no
 * fallback "nao tem porta de restauracao" e reprovar a reversibilidade por um
 * efeito colateral inerte — Identificador sem referencia nenhuma nao faz mal.
 */
function garantirCanonico(acervo: Acervo, op: Operacao, par: Par): string {
  const registrado = registrarIdentificador(acervo, { fonte: par.fonte, valor: par.canonico });
  if (registrado.criado) {
    op.referencia({ tabela: 'identificadores', chave: registrado.id });
  }
  return registrado.id;
}

function repontarChaveSimples(
  acervo: Acervo,
  op: Operacao,
  de: string,
  para: string,
  conta: Record<string, number>,
): void {
  for (const { tabela, campo } of CHAVE_SIMPLES) {
    const linhas = acervo.preparar(`SELECT id FROM "${tabela}" WHERE "${campo}" = ?`)
      .all(de) as Array<{ id: string }>;
    for (const { id } of linhas) {
      acervo.preparar(`UPDATE "${tabela}" SET "${campo}" = ? WHERE id = ?`).run(para, id);
      // A linha de efeito e o que torna isto reversivel. Sem ela o desfazer nao
      // tem o que restaurar, e "reversivel" seria so uma palavra na spec.
      op.valor({ tabela, chave: id, campo, antes: de, depois: para });
      conta[tabela] = (conta[tabela] ?? 0) + 1;
    }
  }
}

/**
 * Reconcilia o que foi gravado numa forma de endereco com a correspondencia
 * que chegou depois.
 *
 * `emTransacao: false` e uma transacao por par: uma transacao unica sobre
 * dezenas de milhares de correspondencias seguraria o lock contra a espera do
 * ouvinte, que fica NO AR durante a conversao. E retomabilidade vale mais que
 * atomicidade global numa varredura longa — interrompida, o que ja reconciliou
 * fica.
 */
export function resolverRetroativamente(
  acervo: Acervo,
  opcoes: OpcoesDeResolucao,
): RelatorioDeResolucao {
  const pares = acervo.preparar('SELECT fonte, alternativo, canonico FROM correspondencias_de_endereco')
    .all() as Par[];

  const linhasRepontadas: Record<string, number> = {};
  const linhasFundidas: Record<string, number> = {};
  const propostasDeMesclagem: { alternativo: string; canonico: string }[] = [];
  let vinculosMigrados = 0;
  let paresReconciliados = 0;
  let semNadaAResolver = 0;

  const executar = (op: Operacao | null): void => {
    for (const par of pares) {
      const altId = idDoEndereco(acervo, par.fonte, par.alternativo);
      if (altId === null) {
        semNadaAResolver += 1;
        continue;
      }
      // A regra de Pessoa vem ANTES de qualquer escrita: repontar Mensagem de
      // um lado para o outro quando os dois pertencem a Pessoas DIFERENTES
      // moveria mensagens de uma Pessoa para outra sem mesclagem — desfazendo
      // afirmacao humana em silencio, que e o que a Procedencia do Vinculo
      // existe para impedir. O par e pulado inteiro e vira proposta.
      const canonExistente = idDoEndereco(acervo, par.fonte, par.canonico);
      const vinculoAlt = lerVinculo(acervo, altId);
      const vinculoCanon = canonExistente === null ? null : lerVinculo(acervo, canonExistente);
      if (
        vinculoAlt !== null &&
        vinculoCanon !== null &&
        vinculoAlt.pessoaId !== vinculoCanon.pessoaId
      ) {
        propostasDeMesclagem.push({ alternativo: par.alternativo, canonico: par.canonico });
        continue;
      }

      const referencias = referenciasDe(acervo, altId);
      if (Object.keys(referencias).length === 0) {
        semNadaAResolver += 1;
        continue;
      }
      paresReconciliados += 1;
      if (op === null) {
        for (const [tabela, n] of Object.entries(referencias)) {
          linhasRepontadas[tabela] = (linhasRepontadas[tabela] ?? 0) + n;
        }
        continue;
      }
      // Uma transacao por par, dentro da Operacao aberta sem transacao global.
      acervo.db.transaction(() => {
        const canonId = garantirCanonico(acervo, op, par);
        // O vinculo migra ANTES das referencias: reconciliar sem ele moveria as
        // Mensagens para um endereco sem Pessoa e deixaria a afirmacao humana
        // pendurada num Identificador orfao — o oposto do que a regra protege.
        if (vinculoAlt !== null && vinculoCanon === null) {
          vincularIdentificador(acervo, {
            identificadorId: canonId,
            pessoaId: vinculoAlt.pessoaId,
            procedencia: vinculoAlt.procedencia,
          });
          // NAO relata aqui: `vincularIdentificador` ja emite as proprias
          // linhas de efeito (pessoa_id, procedencia, vinculado_em), dentro da
          // Operacao aberta. Relatar de novo faria o desfazer desvincular duas
          // vezes — a segunda sobre um Identificador que ja nao tem vinculo.
          vinculosMigrados += 1;
        }
        repontarChaveSimples(acervo, op, altId, canonId, linhasRepontadas);
        fundirOuRepontar(acervo, op, altId, canonId, linhasRepontadas, linhasFundidas);
      })();
    }
  };

  if (!opcoes.comEfeito) {
    executar(null);
    return {
      operacaoId: null,
      correspondenciasVistas: pares.length,
      paresReconciliados,
      semNadaAResolver,
      linhasRepontadas,
      linhasFundidas,
      vinculosMigrados,
      propostasDeMesclagem,
    };
  }

  const operacaoId = emOperacao(
    acervo,
    { natureza: 'resolver-enderecos', reversibilidade: 'por-efeito', emTransacao: false },
    (op) => {
      executar(op);
      return op.id;
    },
  );

  return {
    operacaoId,
    correspondenciasVistas: pares.length,
    paresReconciliados,
    semNadaAResolver,
    linhasRepontadas,
    linhasFundidas,
    vinculosMigrados,
    propostasDeMesclagem,
  };
}
