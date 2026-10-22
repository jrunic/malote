import type { Acervo } from '../../nucleo/acervo.js';
import {
  aplicarCitacao,
  colunasDaCitacao,
  configuracaoDaConversa,
  contarSemTrecho,
  listarCandidatasDeCitacao,
} from '../../nucleo/citacao.js';
import { emOperacao } from '../../nucleo/trilha.js';
import { citacaoParaGravar, resolverCitacao } from './citacao.js';

export interface RelatorioDeExtracaoDeCitacoes {
  /** Mensagens cujo bruto continha o trecho da citacao (a consulta nao decide se e Citacao de verdade). */
  examinadas: number;
  /** As que de fato citam outra: as que ganhariam (ou ganharam) Citacao. */
  citam: number;
  /** Das que citam, as que tem a citada no Acervo, na mesma Conversa. */
  comVinculo: number;
  /** Das que citam, as que ficam so pelo id externo da citada. */
  soPeloIdExterno: number;
  /** Bruto que nao e JSON: segue candidato em toda passada. */
  ilegiveis: number;
  /**
   * Mensagens de WhatsApp com Conteudo Bruto e SEM o trecho da citacao, no recorte: o bruto de importacao de backup (outra
   * forma, sem esse contexto) e as que simplesmente nao citam. O comando as ignora; o ensaio as conta a parte.
   */
  semContexto: number;
  /** As que ganharam Citacao de verdade. Zero no ensaio. */
  gravadas: number;
  gravou: boolean;
}

export interface OpcoesDeExtracaoDeCitacoes {
  comEfeito: boolean;
  /**
   * Os enderecos canonicos da propria conta para uma Conversa, dada a Configuracao dela (`null` na coletiva): a citada com
   * autor em um deles e da propria conta. A Conversa direta tem dona; a coletiva so tem resposta quando o Inquilino tem
   * UMA conta com endereco conhecido. Lista vazia deixa a direcao da citada que o Acervo nao tem nula.
   */
  enderecosDaConta: (configuracaoId: string | null) => readonly string[];
  /** Recorte por instante da Mensagem, ambos inclusivos. */
  de?: number;
  ate?: number;
  /** No maximo esta quantidade de Mensagens que citam. Inteiro maior que zero. */
  limite?: number;
  /** Candidatas por pagina da leitura. */
  tamanhoDaPagina?: number;
}

/** O trecho que o bruto de uma Mensagem que cita carrega. So serve de pre-filtro da consulta. */
const TRECHO_DA_CITACAO = '"stanzaId"';
const PAGINA = 500;

/**
 * Preenche o ESTOQUE (#1334): le o Conteudo Bruto das Mensagens de WhatsApp que ainda nao tem Citacao e grava a das que citam,
 * pela MESMA leitura da recepcao ao vivo. O bruto de importacao nao tem esse contexto e fica de fora, sem erro. Ensaio por
 * padrao: conta e nao escreve (nem Identificador). A leitura do Acervo todo roda FORA da transacao, em paginas, para nao
 * segurar o escritor do ouvinte; so a gravacao e uma Operacao so, com um efeito por Mensagem, que `desfazer` reverte.
 */
export function extrairCitacoes(acervo: Acervo, opcoes: OpcoesDeExtracaoDeCitacoes): RelatorioDeExtracaoDeCitacoes {
  const relatorio: RelatorioDeExtracaoDeCitacoes = {
    examinadas: 0,
    citam: 0,
    comVinculo: 0,
    soPeloIdExterno: 0,
    ilegiveis: 0,
    semContexto: 0,
    gravadas: 0,
    gravou: false,
  };
  if (opcoes.limite !== undefined && (!Number.isInteger(opcoes.limite) || opcoes.limite <= 0)) {
    throw new RangeError('o limite precisa ser um inteiro maior que zero');
  }
  const plano: Array<{ mensagemId: string; conversaId: string; message: Record<string, unknown> }> = [];
  const donas = new Map<string, string | null>();
  const enderecosDa = (conversaId: string): readonly string[] => {
    if (!donas.has(conversaId)) donas.set(conversaId, configuracaoDaConversa(acervo, conversaId) ?? null);
    return opcoes.enderecosDaConta(donas.get(conversaId) ?? null);
  };
  const pagina = opcoes.tamanhoDaPagina ?? PAGINA;
  let cursor = 0;
  for (;;) {
    const candidatas = listarCandidatasDeCitacao(acervo, {
      fonte: 'whatsapp',
      contem: TRECHO_DA_CITACAO,
      depoisDe: cursor,
      limite: pagina,
      ...(opcoes.de !== undefined ? { de: opcoes.de } : {}),
      ...(opcoes.ate !== undefined ? { ate: opcoes.ate } : {}),
    });
    if (candidatas.length === 0) break;
    cursor = candidatas[candidatas.length - 1]!.rowid;
    for (const candidata of candidatas) {
      relatorio.examinadas += 1;
      let message: Record<string, unknown> | undefined;
      try {
        const evento = JSON.parse(candidata.bruto) as { message?: Record<string, unknown> | null };
        message = evento.message ?? undefined;
      } catch {
        relatorio.ilegiveis += 1;
        continue;
      }
      const citacao = resolverCitacao(acervo, message, enderecosDa(candidata.conversaId));
      if (citacao === undefined || message === undefined) continue;
      relatorio.citam += 1;
      const colunas = colunasDaCitacao(acervo, { fonte: 'whatsapp', conversaId: candidata.conversaId }, { idExterno: citacao.idExterno });
      if (colunas.citadaId !== null) relatorio.comVinculo += 1;
      else relatorio.soPeloIdExterno += 1;
      plano.push({ mensagemId: candidata.mensagemId, conversaId: candidata.conversaId, message });
      if (opcoes.limite !== undefined && plano.length >= opcoes.limite) break;
    }
    if (opcoes.limite !== undefined && plano.length >= opcoes.limite) break;
  }

  relatorio.semContexto = contarSemTrecho(acervo, {
    fonte: 'whatsapp',
    contem: TRECHO_DA_CITACAO,
    ...(opcoes.de !== undefined ? { de: opcoes.de } : {}),
    ...(opcoes.ate !== undefined ? { ate: opcoes.ate } : {}),
  });
  if (!opcoes.comEfeito || plano.length === 0) return relatorio;

  emOperacao(acervo, { natureza: 'extrair-citacoes', reversibilidade: 'por-efeito' }, (op) => {
    for (const item of plano) {
      const entrada = citacaoParaGravar(acervo, item.message, enderecosDa(item.conversaId), { conversaId: item.conversaId });
      if (entrada === undefined) continue;
      const gravada = aplicarCitacao(acervo, item.mensagemId, { fonte: 'whatsapp', conversaId: item.conversaId }, entrada);
      if (gravada === null) continue;
      op.valor({ tabela: 'mensagens', chave: item.mensagemId, campo: 'citada_id_externo', antes: null, depois: gravada.idExterno });
      relatorio.gravadas += 1;
    }
  });
  relatorio.gravou = relatorio.gravadas > 0;
  return relatorio;
}
