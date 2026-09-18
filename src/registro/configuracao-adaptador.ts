import { randomUUID } from 'node:crypto';
import type { InquilinoId } from '../nucleo/tipos.js';
import type { Registro } from './registro.js';
import { emOperacao } from '../nucleo/trilha.js';

/**
 * A Configuração de Adaptador é a conta de plataforma que um Inquilino
 * alimenta. Existia no schema desde o ciclo 1 sem nenhum uso; passa a ser a
 * chave do Estado de Sincronização, e por isso precisa nascer por demanda em
 * vez de exigir um ato do Titular que ninguém tinha de fazer até agora.
 */

/** Apelido da Configuração que nasce sozinha quando ninguém nomeia uma. */
export const APELIDO_PADRAO = 'padrao';

export interface ConfiguracaoDeAdaptador {
  id: string;
  inquilinoId: InquilinoId;
  fonte: string;
  apelido: string;
  /** Qual conta dentro da Fonte. Vocabulário do Adaptador; nulo até declarada. */
  conta: string | null;
  criadaEm: string;
}

interface LinhaConfiguracao {
  id: string;
  inquilino_id: string;
  fonte: string;
  apelido: string;
  criada_em: string;
  conta: string | null;
}

const SELECAO = `
  SELECT c.id, c.inquilino_id, c.fonte, c.apelido, c.criada_em, a.conta
    FROM configuracoes_de_adaptador c
    LEFT JOIN contas_de_adaptador a ON a.configuracao_id = c.id`;

function paraConfiguracao(l: LinhaConfiguracao): ConfiguracaoDeAdaptador {
  return {
    id: l.id,
    inquilinoId: l.inquilino_id,
    fonte: l.fonte,
    apelido: l.apelido,
    conta: l.conta,
    criadaEm: l.criada_em,
  };
}

/**
 * Devolve a Configuração de (Inquilino, Fonte, apelido), criando-a se não
 * existir. Idempotente: chamar duas vezes devolve a mesma.
 */
export function resolverConfiguracao(
  registro: Registro,
  inquilinoId: InquilinoId,
  fonte: string,
  apelido: string = APELIDO_PADRAO,
): ConfiguracaoDeAdaptador {
  const existeInquilino = registro.preparar('SELECT 1 AS ok FROM inquilinos WHERE id = ?')
    .get(inquilinoId) as { ok: number } | undefined;
  if (existeInquilino === undefined) throw new Error(`Inquilino desconhecido: ${inquilinoId}`);

  const achada = registro.preparar(`${SELECAO} WHERE c.inquilino_id = ? AND c.fonte = ? AND c.apelido = ?`)
    .get(inquilinoId, fonte, apelido) as LinhaConfiguracao | undefined;
  if (achada !== undefined) return paraConfiguracao(achada);

  const id = randomUUID();
  const criadaEm = new Date().toISOString();
  // O envoltorio vai AQUI, depois do retorno antecipado que devolve a
  // existente: resolver o que ja existe nao e ato.
  emOperacao(
    registro,
    { natureza: 'resolver-configuracao', reversibilidade: 'por-efeito', inquilinoId },
    (op) => {
      registro.preparar(
          `INSERT INTO configuracoes_de_adaptador (id, inquilino_id, fonte, apelido, criada_em)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(id, inquilinoId, fonte, apelido, criadaEm);
      op.valor({
        tabela: 'configuracoes_de_adaptador',
        chave: id,
        campo: 'id',
        antes: null,
        depois: id,
      });
    },
  );

  return { id, inquilinoId, fonte, apelido, conta: null, criadaEm };
}

/** Declara qual conta da Fonte esta Configuração representa. */
export function definirContaDaConfiguracao(
  registro: Registro,
  configuracaoId: string,
  conta: string,
): void {
  const existe = registro.preparar('SELECT 1 AS ok FROM configuracoes_de_adaptador WHERE id = ?')
    .get(configuracaoId) as { ok: number } | undefined;
  if (existe === undefined) throw new Error(`Configuracao desconhecida: ${configuracaoId}`);

  const dono = registro.preparar('SELECT inquilino_id FROM configuracoes_de_adaptador WHERE id = ?')
    .get(configuracaoId) as { inquilino_id: string } | undefined;
  const antes = registro.preparar('SELECT conta FROM contas_de_adaptador WHERE configuracao_id = ?')
    .get(configuracaoId) as { conta: string } | undefined;

  emOperacao(
    registro,
    {
      natureza: 'definir-conta',
      reversibilidade: 'por-efeito',
      ...(dono !== undefined ? { inquilinoId: dono.inquilino_id } : {}),
    },
    (op) => {
      registro.preparar(
          `INSERT INTO contas_de_adaptador (configuracao_id, conta, definida_em)
           VALUES (?, ?, ?)
           ON CONFLICT (configuracao_id) DO UPDATE SET
             conta = excluded.conta, definida_em = excluded.definida_em`,
        )
        .run(configuracaoId, conta, new Date().toISOString());

      if (antes?.conta !== conta) {
        op.valor({
          tabela: 'contas_de_adaptador',
          chave: configuracaoId,
          campo: 'conta',
          antes: antes?.conta ?? null,
          depois: conta,
        });
      }
    },
  );
}

/**
 * Acha a Configuração pelo apelido, ou devolve `undefined`. NUNCA cria.
 *
 * É a irmã de `resolverConfiguracao`, e a diferença é o ponto: aquela cria
 * quando não acha, o que serve à importação — material novo pode ser de uma
 * conta que ainda não existe no Registro. No caminho AO VIVO criar é o defeito:
 * uma Configuração vazia passaria a receber Conversa, a captura gravaria na
 * conta errada, e nada alarmaria. Ouvinte que não sabe de qual conta é o evento
 * não escuta.
 */
export function configuracaoPorApelido(
  registro: Registro,
  inquilinoId: InquilinoId,
  fonte: string,
  apelido: string,
): ConfiguracaoDeAdaptador | undefined {
  const linha = registro
    .preparar(`${SELECAO} WHERE c.inquilino_id = ? AND c.fonte = ? AND c.apelido = ?`)
    .get(inquilinoId, fonte, apelido) as LinhaConfiguracao | undefined;
  return linha === undefined ? undefined : paraConfiguracao(linha);
}

/**
 * Todas as Configuracoes com este apelido, em qualquer Fonte — usado quando o
 * chamador NAO informou a Fonte e o contexto nao a implica. Zero, uma ou mais:
 * quem decide o que fazer com cada contagem e `resolverFiltroDeConfiguracao`,
 * nao esta funcao — ela so lista.
 */
export function configuracoesPorApelido(
  registro: Registro,
  inquilinoId: InquilinoId,
  apelido: string,
): ConfiguracaoDeAdaptador[] {
  const linhas = registro
    .preparar(`${SELECAO} WHERE c.inquilino_id = ? AND c.apelido = ?`)
    .all(inquilinoId, apelido) as LinhaConfiguracao[];
  return linhas.map(paraConfiguracao);
}

export type ResultadoDoFiltroDeConfiguracao =
  | { ok: true; configuracao: ConfiguracaoDeAdaptador }
  | { ok: false; erro: string };

/**
 * A resolucao que as rotas de LEITURA usam — nunca cria, ao contrario de
 * `resolverConfiguracao` (que e da INGESTAO). Apelido pode repetir entre
 * Fontes diferentes (medido em producao: "orlando" existe em whatsapp E
 * instagram), entao sem Fonte o resultado pode ser ambiguo — e a ambiguidade
 * vira erro nomeado, nunca escolha silenciosa.
 */
export function resolverFiltroDeConfiguracao(
  registro: Registro,
  inquilinoId: InquilinoId,
  apelido: string,
  fonte?: string,
): ResultadoDoFiltroDeConfiguracao {
  if (fonte !== undefined) {
    const cfg = configuracaoPorApelido(registro, inquilinoId, fonte, apelido);
    if (cfg === undefined) {
      return { ok: false, erro: `Configuracao desconhecida: ${fonte}/${apelido}` };
    }
    return { ok: true, configuracao: cfg };
  }

  const candidatas = configuracoesPorApelido(registro, inquilinoId, apelido);
  if (candidatas.length === 0) {
    return { ok: false, erro: `Configuracao desconhecida: ${apelido}` };
  }
  if (candidatas.length > 1) {
    const fontes = candidatas.map((c) => c.fonte).sort().join(', ');
    return {
      ok: false,
      erro: `apelido ambiguo: "${apelido}" existe em mais de uma Fonte (${fontes}) — informe fonte`,
    };
  }
  return { ok: true, configuracao: candidatas[0]! };
}

export function listarConfiguracoes(
  registro: Registro,
  inquilinoId: InquilinoId,
): ConfiguracaoDeAdaptador[] {
  const linhas = registro.preparar(`${SELECAO} WHERE c.inquilino_id = ? ORDER BY c.fonte, c.apelido`)
    .all(inquilinoId) as LinhaConfiguracao[];
  return linhas.map(paraConfiguracao);
}
