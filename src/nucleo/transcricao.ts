import type { Acervo } from './acervo.js';
import type { EstadoDeTranscricao } from './tipos.js';
import { emOperacao } from './trilha.js';

export interface AnexoElegivel {
  anexoId: string;
  mensagemId: string;
  caminho: string;
}

/**
 * O proximo Anexo de audio elegivel para transcricao, ou `undefined` se a
 * fila esta vazia.
 *
 * Elegivel = SEM linha em transcricoes (nunca visto) OU linha `pendente`
 * (marcado, mas o processo morreu antes de concluir/falhar — o `LEFT JOIN`
 * e o que alcanca esse orfao; `NOT IN` sozinho nunca o devolveria de volta,
 * e reenfileirarFalhas ficaria no-op em producao).
 *
 * PRIORIDADE (spec #1103, parte 3): quem foi explicitamente solicitado
 * (`solicitada_em` nao-nulo) vence quem nao foi, e entre dois solicitados
 * vence quem pediu primeiro (por `solicitada_em`). Sem solicitacao nenhuma,
 * cai no desempate por `anexo_id` que ja existia — NAO e ordem de chegada
 * (`anexo_id` e UUID aleatorio, `registrarAnexo` usa `randomUUID()`), e
 * nunca foi: e so um criterio estavel para a consulta nao repetir ordem
 * entre chamadas. O `(t.solicitada_em IS NULL) ASC` e o que separa os dois
 * grupos antes de desempatar dentro de cada um.
 */
export function proximoElegivel(acervo: Acervo): AnexoElegivel | undefined {
  const linha = acervo.preparar(
      `SELECT a.id AS anexoId, a.mensagem_id AS mensagemId, a.caminho AS caminho
         FROM anexos a
         LEFT JOIN transcricoes t ON t.anexo_id = a.id
        WHERE a.tipo = 'audio' AND a.presenca = 'presente' AND a.caminho IS NOT NULL
          AND (t.anexo_id IS NULL OR t.estado = 'pendente')
        ORDER BY (t.solicitada_em IS NULL) ASC, t.solicitada_em ASC, a.id ASC
        LIMIT 1`,
    )
    .get() as { anexoId: string; mensagemId: string; caminho: string } | undefined;
  return linha;
}

/** Enfileira. Idempotente: chamar de novo sobre o mesmo Anexo nao duplica nem lanca. */
export function marcarPendente(acervo: Acervo, anexoId: string): void {
  acervo
    .preparar(
      `INSERT INTO transcricoes (anexo_id, estado) VALUES (?, 'pendente') ON CONFLICT (anexo_id) DO NOTHING`,
    )
    .run(anexoId);
}

/** Grava a Transcricao concluida. Sobrescreve o que houver, inclusive uma falha anterior. */
export function marcarConcluida(
  acervo: Acervo,
  anexoId: string,
  texto: string,
  motor: string,
  modelo: string,
): void {
  acervo
    .preparar(
      `UPDATE transcricoes
          SET estado = 'concluida', texto = ?, motor = ?, modelo = ?, gerada_em = ?, motivo_falha = NULL
        WHERE anexo_id = ?`,
    )
    .run(texto, motor, modelo, new Date().toISOString(), anexoId);
}

/** Grava a falha, com o motivo. Estado terminal — nunca tentado de novo sem reenfileirarFalhas. */
export function marcarFalhou(acervo: Acervo, anexoId: string, motivo: string): void {
  acervo
    .preparar(`UPDATE transcricoes SET estado = 'falhou', motivo_falha = ? WHERE anexo_id = ?`)
    .run(motivo, anexoId);
}

export interface TranscricaoFalha {
  anexoId: string;
  motivoFalha: string | null;
}

export function listarFalhas(acervo: Acervo): TranscricaoFalha[] {
  return acervo
    .preparar(
      `SELECT anexo_id AS anexoId, motivo_falha AS motivoFalha FROM transcricoes WHERE estado = 'falhou' ORDER BY anexo_id`,
    )
    .all() as TranscricaoFalha[];
}

/**
 * Contagem de Transcricoes por estado — o "sinal proprio" que o criterio 4
 * da spec exige (nunca embutido na saida default de outro comando).
 */
export interface ContagemDeTranscricao {
  estado: EstadoDeTranscricao;
  n: number;
}

export function contarTranscricoesPorEstado(acervo: Acervo): ContagemDeTranscricao[] {
  return acervo
    .preparar(`SELECT estado, COUNT(*) AS n FROM transcricoes GROUP BY estado ORDER BY estado`)
    .all() as ContagemDeTranscricao[];
}

/**
 * Volta toda falha para pendente, para o worker tentar de novo — GRAVADO NA
 * TRILHA, porque e um comando de DECISAO do operador (docs/dominio/malote.md,
 * agregado Operacao: "um comando de decisao grava exatamente uma Operacao").
 * Mesmo espirito de `reprocessar-derrame`: nao acontece sozinho.
 *
 * Uma Linha de Efeito por Anexo reenfileirado (natureza 'valor', antes/depois
 * do campo estado) — mesmo grao que `configurarDestinoDeMidia` ja usa.
 */
export function reenfileirarFalhas(acervo: Acervo): number {
  const falhas = listarFalhas(acervo);
  if (falhas.length === 0) return 0;
  emOperacao(acervo, { natureza: 'reprocessar-transcricao', reversibilidade: 'por-efeito' }, (op) => {
    for (const f of falhas) {
      acervo
        .preparar(`UPDATE transcricoes SET estado = 'pendente', motivo_falha = NULL WHERE anexo_id = ?`)
        .run(f.anexoId);
      op.valor({ tabela: 'transcricoes', chave: f.anexoId, campo: 'estado', antes: 'falhou', depois: 'pendente' });
    }
  });
  return falhas.length;
}

export interface ResultadoDeInclusaoDeEstoque {
  promovidos: number;
}

/**
 * Promove até `limite` Anexos `fora-de-escopo` para `pendente` — a mesma
 * fila normal, sem prioridade (ver `solicitarTranscricao`, parte 3 da spec
 * #1103, para prioridade individual). Só promove quem já bate a MESMA
 * condição de elegibilidade de `proximoElegivel` (`presenca='presente' AND
 * caminho IS NOT NULL`) — sem isso, um Anexo cujo arquivo a Política de
 * Retenção descartou depois da migração do ciclo 23 viraria `pendente` para
 * sempre: o worker nunca o escolhe (não bate a condição dele), nunca falha
 * (nunca chega a tentar). Achado na revisão desta spec (`dev-10`, 01/10/2026).
 *
 * Ordem por `anexo_id`: mesmo critério de desempate de `proximoElegivel`,
 * para que chamadas sucessivas avancem pelo estoque de forma previsível.
 *
 * Comando de decisão do operador — uma Operação por chamada, com efeito;
 * chamada sem nada a promover não abre Operação (mesmo cuidado de
 * `reenfileirarFalhas`, que só abre quando `falhas.length > 0`).
 */
export function incluirEstoqueEmTranscricao(
  acervo: Acervo,
  limite: number,
): ResultadoDeInclusaoDeEstoque {
  const candidatos = acervo.preparar(
      `SELECT t.anexo_id AS anexoId
         FROM transcricoes t
         JOIN anexos a ON a.id = t.anexo_id
        WHERE t.estado = 'fora-de-escopo' AND a.presenca = 'presente' AND a.caminho IS NOT NULL
        ORDER BY t.anexo_id
        LIMIT ?`,
    )
    .all(limite) as Array<{ anexoId: string }>;

  if (candidatos.length === 0) return { promovidos: 0 };

  emOperacao(
    acervo,
    { natureza: 'incluir-estoque-em-transcricao', reversibilidade: 'por-efeito' },
    (op) => {
      for (const c of candidatos) {
        acervo
          .preparar(`UPDATE transcricoes SET estado = 'pendente' WHERE anexo_id = ?`)
          .run(c.anexoId);
        op.valor({
          tabela: 'transcricoes',
          chave: c.anexoId,
          campo: 'estado',
          antes: 'fora-de-escopo',
          depois: 'pendente',
        });
      }
    },
  );

  return { promovidos: candidatos.length };
}

export type MotivoDeRecusaDeSolicitacao =
  | 'anexo-inexistente'
  | 'nao-e-audio'
  | 'arquivo-ausente'
  | 'ja-concluida';

export interface ResultadoDeSolicitacao {
  aceita: boolean;
  motivoDeRecusa?: MotivoDeRecusaDeSolicitacao;
}

/**
 * Pede a Transcricao de UM Anexo especifico, na frente da fila normal —
 * parte 3 da spec #1103. Funciona sobre Anexo nunca visto, `fora-de-escopo`
 * ou `falhou`; sobre `concluida`, recusa — nao existe, nesta spec, forma de
 * forcar nova Transcricao de algo que ja tem uma. Mesma condicao de
 * elegibilidade de `proximoElegivel` (tipo audio, arquivo presente): a
 * solicitacao nao contorna nada que a fila normal ja exige.
 *
 * Chamada tanto pelo comando CLI local quanto pela rota de rede — os dois
 * convergem aqui, sem duplicar regra.
 *
 * `opcoes.quando` existe para o TESTE fixar o instante — mesmo precedente de
 * `descartarAnexo(acervo, anexoId, { politica, quando? })` e de
 * `AberturaDeOperacao.quando`. Sem ele, duas chamadas sincronas no mesmo
 * milissegundo gravariam o mesmo `solicitada_em` e o desempate entre elas
 * ficaria indefinido.
 *
 * Comando de decisao — grava Operacao, com o Anexo como Linha de Efeito.
 */
export function solicitarTranscricao(
  acervo: Acervo,
  anexoId: string,
  opcoes: { quando?: number } = {},
): ResultadoDeSolicitacao {
  const anexo = acervo
    .preparar('SELECT tipo, presenca, caminho FROM anexos WHERE id = ?')
    .get(anexoId) as { tipo: string; presenca: string; caminho: string | null } | undefined;
  if (anexo === undefined) return { aceita: false, motivoDeRecusa: 'anexo-inexistente' };
  if (anexo.tipo !== 'audio') return { aceita: false, motivoDeRecusa: 'nao-e-audio' };
  if (anexo.presenca !== 'presente' || anexo.caminho === null) {
    return { aceita: false, motivoDeRecusa: 'arquivo-ausente' };
  }

  const atual = acervo
    .preparar('SELECT estado FROM transcricoes WHERE anexo_id = ?')
    .get(anexoId) as { estado: EstadoDeTranscricao } | undefined;
  if (atual?.estado === 'concluida') return { aceita: false, motivoDeRecusa: 'ja-concluida' };

  emOperacao(acervo, { natureza: 'solicitar-transcricao', reversibilidade: 'por-efeito' }, (op) => {
    const agora = new Date(opcoes.quando ?? Date.now()).toISOString();
    acervo
      .preparar(
        `INSERT INTO transcricoes (anexo_id, estado, solicitada_em)
         VALUES (?, 'pendente', ?)
         ON CONFLICT (anexo_id) DO UPDATE SET
           estado = 'pendente', solicitada_em = excluded.solicitada_em, motivo_falha = NULL`,
      )
      .run(anexoId, agora);
    op.valor({
      tabela: 'transcricoes',
      chave: anexoId,
      campo: 'estado',
      antes: atual?.estado ?? null,
      depois: 'pendente',
    });
  });

  return { aceita: true };
}
