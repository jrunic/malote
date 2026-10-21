import type { Acervo } from './acervo.js';
import { nomesEmLote } from './nomes-em-lote.js';
import type { ConversaId, Fonte } from './tipos.js';
import type { PrecedenciaDeNome } from '../registro/precedencia-de-nome.js';

/**
 * Os Metadados de Coletiva como o Acervo os guarda. O instante e o da LINHA, e nao o de cada campo: o Acervo
 * grava um `alterado_em` por Conversa (risco aceito da #1160), entao depois de uma remocao da descricao ele e o
 * da ultima alteracao de qualquer campo.
 */
export interface MetadadosDaConversa {
  assunto: string | null;
  descricao: string | null;
  alteradoPor: string | null;
  alteradoEm: string | null;
}

export interface DetalheDaConversa {
  id: ConversaId;
  fonte: Fonte;
  coletiva: boolean;
  /**
   * O APELIDO da Configuracao (e nao o id interno), como a listagem `conversas` o mostra. Null para Conversa
   * coletiva — ela pertence ao Inquilino, nao a uma Configuracao — e para Configuracao que o Registro nao conhece.
   */
  configuracao: string | null;
  /** Nome corrente (e origem) do outro lado da Conversa DIRETA. Null na coletiva e na direta sem nome. */
  nome: string | null;
  origemDoNome: string | null;
  mensagens: number;
  primeiraMensagemEm: number | null;
  ultimaMensagemEm: number | null;
  /** So na coletiva (nulos quando a Fonte nunca entregou nada). A direta NAO leva o campo. */
  metadados?: MetadadosDaConversa;
  /**
   * So na coletiva (#1323): o endereco do grupo na Fonte, o mesmo valor que `enviar --para` aceita. E a Referencia
   * Externa da Conversa. A direta NAO leva o campo: o endereco de uma Pessoa sai por `identificar`, `participantes`
   * e `autores`.
   */
  endereco?: string;
}

interface LinhaDaConversa {
  id: string;
  fonte: Fonte;
  coletiva: number;
  configuracao_id: string | null;
  id_externo: string;
  assunto: string | null;
  descricao: string | null;
  alterado_por: string | null;
  alterado_em: string | null;
  identificador_id: string | null;
  mensagens: number;
  primeira: number | null;
  ultima: number | null;
}

/**
 * O que o Acervo sabe de UMA Conversa (#1203). Uma consulta: a contagem e os dois instantes saem do indice
 * `(conversa_id, ocorrida_em)`, sem varrer as Mensagens. Descricao e assunto sao texto de conversa: quem chama
 * nao os loga.
 */
export function detalharConversa(
  acervo: Acervo,
  conversaId: ConversaId,
  precedencia: PrecedenciaDeNome,
  /** Apelido de cada Configuracao do Inquilino, por id (vem do Registro). Ausente: `configuracao` sai nula. */
  apelidoPorId: ReadonlyMap<string, string> = new Map(),
): DetalheDaConversa | undefined {
  const l = acervo
    .preparar(
      `SELECT c.id, c.fonte, c.coletiva, c.configuracao_id, c.id_externo,
              md.assunto, md.descricao, md.alterado_por, md.alterado_em,
              i.id AS identificador_id,
              (SELECT COUNT(*) FROM mensagens x WHERE x.conversa_id = c.id) AS mensagens,
              (SELECT MIN(x.ocorrida_em) FROM mensagens x WHERE x.conversa_id = c.id) AS primeira,
              (SELECT MAX(x.ocorrida_em) FROM mensagens x WHERE x.conversa_id = c.id) AS ultima
         FROM conversas c
         LEFT JOIN metadados_de_coletiva md ON md.conversa_id = c.id
         LEFT JOIN identificadores i ON i.fonte = c.fonte AND i.valor = c.id_externo AND c.coletiva = 0
        WHERE c.id = ?`,
    )
    .get(conversaId) as LinhaDaConversa | undefined;
  if (l === undefined) return undefined;

  const coletiva = l.coletiva === 1;
  const nome = l.identificador_id === null ? undefined : nomesEmLote(acervo, [l.identificador_id], precedencia).get(l.identificador_id);
  const detalhe: DetalheDaConversa = {
    id: l.id,
    fonte: l.fonte,
    coletiva,
    configuracao: l.configuracao_id === null ? null : (apelidoPorId.get(l.configuracao_id) ?? null),
    nome: nome?.nome ?? null,
    origemDoNome: nome?.origem ?? null,
    mensagens: l.mensagens,
    primeiraMensagemEm: l.primeira,
    ultimaMensagemEm: l.ultima,
  };
  if (coletiva) {
    detalhe.endereco = l.id_externo;
    detalhe.metadados = {
      assunto: l.assunto,
      descricao: l.descricao,
      alteradoPor: l.alterado_por,
      alteradoEm: l.alterado_em,
    };
  }
  return detalhe;
}
