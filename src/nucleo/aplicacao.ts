import type { Acervo } from './acervo.js';
import type { PessoaId } from './tipos.js';
import { mestreDe, SQL_FAMILIA } from './familia.js';
import {
  criarPessoa,
  desfazerMesclagem,
  desvincularIdentificador,
  lerVinculo,
  mesclarPessoas,
  vincularIdentificador,
  type RegraDeMestre,
} from './identidade.js';

/**
 * Aplica um conjunto de Identificadores como sendo a mesma Pessoa.
 *
 * Nao sabe o que e Proposta: recebe ids. Quem produz Proposta e o adaptador,
 * e quem escreve e o nucleo — a mesma fronteira do ciclo 6.
 */

export interface OpcoesDeAplicacao {
  /** Instante do ato. Injetado, nunca `Date.now()` por dentro. */
  quando?: number;
  /**
   * A Configuracao de catalogo que sustenta esta aplicacao, quando ha UMA.
   *
   * Ausente quando a Proposta atravessa mais de uma base: o vinculo fica sem
   * Configuracao, que e a verdade sobre ele.
   */
  configuracaoId?: string;
}

export interface MesclagemAplicada {
  atoId: string;
  absorvidaId: PessoaId;
  mestreId: PessoaId;
  regra: RegraDeMestre;
}

export interface ResultadoDaAplicacao {
  vinculos: Array<{ identificadorId: string; pessoaId: PessoaId }>;
  mesclagens: MesclagemAplicada[];
  /** Nascem aqui e FICAM depois de desfazer: a Pessoa e registro. */
  pessoasCriadas: PessoaId[];
  preservadoPorProcedencia: number;
  recusadoPorConflito: number;
  motivo: string | null;
}

/**
 * Ha vinculo humano em qualquer lugar da familia desta Pessoa?
 *
 * A pergunta e sobre a FAMILIA e nao sobre os membros da Proposta: uma Pessoa
 * construida a mao por um Identificador e ampliada por um lote anterior tem
 * membros de procedencia `catalogo`, e olhar so para eles a entregaria a uma
 * fusao automatica.
 */
function temVinculoHumano(acervo: Acervo, pessoaId: PessoaId): boolean {
  const l = acervo.preparar(
      `SELECT 1 AS ok FROM identificadores
        WHERE procedencia = 'humano' AND pessoa_id IN (${SQL_FAMILIA}) LIMIT 1`,
    )
    .get(pessoaId, pessoaId) as { ok: number } | undefined;
  return l !== undefined;
}

function vazio(): ResultadoDaAplicacao {
  return {
    vinculos: [],
    mesclagens: [],
    pessoasCriadas: [],
    preservadoPorProcedencia: 0,
    recusadoPorConflito: 0,
    motivo: null,
  };
}

export function aplicarConjunto(
  acervo: Acervo,
  identificadores: string[],
  opcoes: OpcoesDeAplicacao = {},
): ResultadoDaAplicacao {
  const r = vazio();
  if (identificadores.length < 2) return r;

  const vinculoDe = new Map(identificadores.map((i) => [i, lerVinculo(acervo, i)]));
  const pessoas = new Set<PessoaId>();
  for (const v of vinculoDe.values()) {
    if (v !== null) pessoas.add(mestreDe(acervo, v.pessoaId) ?? v.pessoaId);
  }

  // Vinculo humano so vira conflito quando ha DUAS Pessoas em jogo: fundir o
  // que um humano construiu e decisao de gente. Com uma Pessoa so, nada e
  // rebaixado — o solto entra e o humano continua humano.
  if (pessoas.size > 1) {
    const comHumano = [...pessoas].find((p) => temVinculoHumano(acervo, p));
    if (comHumano !== undefined) {
      r.preservadoPorProcedencia = 1;
      r.motivo = 'vinculo humano na familia';
      return r;
    }
  }

  const aplicar = acervo.db.transaction(() => {
    let destino: PessoaId;
    const listaDePessoas = [...pessoas];
    if (listaDePessoas.length === 0) {
      destino = criarPessoa(acervo);
      r.pessoasCriadas.push(destino);
    } else {
      destino = listaDePessoas[0] as PessoaId;
      for (const outra of listaDePessoas.slice(1)) {
        // Sem `mestreId`: a preferencia de catalogo e que decide, e e por
        // isso que a ordem dos argumentos nao pode mudar o resultado.
        const m = mesclarPessoas(acervo, {
          pessoaA: destino,
          pessoaB: outra,
          ...(opcoes.quando !== undefined ? { quando: opcoes.quando } : {}),
        });
        r.mesclagens.push({
          atoId: m.atoId,
          absorvidaId: m.absorvidaId,
          mestreId: m.mestreId,
          regra: m.regra,
        });
        destino = m.mestreId;
      }
    }

    for (const [id, v] of vinculoDe) {
      if (v !== null) continue;
      vincularIdentificador(acervo, {
        identificadorId: id,
        pessoaId: destino,
        procedencia: 'catalogo',
        ...(opcoes.configuracaoId !== undefined
          ? { configuracaoId: opcoes.configuracaoId }
          : {}),
      });
      r.vinculos.push({ identificadorId: id, pessoaId: destino });
    }
  });

  try {
    aplicar();
  } catch (erro) {
    // Atomico por Proposta (criterio 17): a transacao ja desfez tudo, e o
    // relatorio devolve o resultado VAZIO com a causa nomeada.
    const limpo = vazio();
    limpo.recusadoPorConflito = 1;
    // A CAUSA, nao a mensagem: a mensagem traz UUID e nao agrupa nada.
    limpo.motivo = erro instanceof Error ? erro.name : 'erro desconhecido';
    return limpo;
  }
  return r;
}

/**
 * Desfaz o que uma aplicacao fez, consumindo o que ela devolveu.
 *
 * Nao apaga rastro: o desvinculo grava sua linha e o desfazer de mesclagem
 * ACRESCENTA um ato. A Pessoa criada permanece — e ela que guarda o registro.
 */
export function desfazerAplicacao(
  acervo: Acervo,
  feito: ResultadoDaAplicacao,
  opcoes: OpcoesDeAplicacao = {},
): void {
  const desfazer = acervo.db.transaction(() => {
    for (const v of feito.vinculos) desvincularIdentificador(acervo, v.identificadorId);
    // Ordem inversa: a ultima mesclagem foi a que empilhou por cima.
    for (const m of [...feito.mesclagens].reverse()) {
      desfazerMesclagem(acervo, {
        absorvidaId: m.absorvidaId,
        ...(opcoes.quando !== undefined ? { quando: opcoes.quando } : {}),
      });
    }
  });
  desfazer();
}
