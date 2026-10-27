import type { Acervo } from '../../nucleo/acervo.js';
import { contarMensagensDeModelo, listarMensagensDeModeloSemAnexo } from '../../nucleo/anexo-de-modelo.js';
import { registrarAnexo } from '../../nucleo/escrita.js';
import { emOperacao } from '../../nucleo/trilha.js';
import { leituraDoModelo } from './imagem-de-modelo.js';

export interface RelatorioDeExtracaoDeImagemDeModelo {
  /** Mensagens de WhatsApp com mensagem de modelo no bruto. */
  mensagensDeModelo: number;
  /** Dessas, as que ja tem Anexo (nunca-obtido ou presente) e por isso nao entram. */
  jaComAnexo: number;
  /** As sem Anexo cujo cabecalho tem a imagem na forma medida. */
  comImagem: number;
  /** As sem Anexo com imagem em lugar nao medido, ou sem chave legivel: contadas, deixadas no bruto. */
  formaNaoReconhecida: number;
  /** Anexos que o ensaio criaria. */
  aCriar: number;
  /** Anexos que nasceram de verdade. Zero no ensaio. */
  criados: number;
  gravou: boolean;
}

/**
 * Cria o Anexo `nunca-obtido` da imagem do cabecalho das Mensagens de modelo ja gravadas (#1242). Ensaio por padrao: conta e
 * nao escreve. Com efeito, UMA Operacao para o lote, com um efeito por Anexo criado, que `desfazer` remove enquanto ele
 * estiver `nunca-obtido`. Nao abre Operacao quando nao ha o que criar. Idempotente: quem ja tem Anexo nao entra. O download
 * e do `midia reprocessar`, nao daqui.
 */
export function extrairImagensDeModelo(acervo: Acervo, opcoes: { comEfeito: boolean }): RelatorioDeExtracaoDeImagemDeModelo {
  const { total, comAnexo } = contarMensagensDeModelo(acervo);
  const relatorio: RelatorioDeExtracaoDeImagemDeModelo = {
    mensagensDeModelo: total,
    jaComAnexo: comAnexo,
    comImagem: 0,
    formaNaoReconhecida: 0,
    aCriar: 0,
    criados: 0,
    gravou: false,
  };

  const plano: Array<{ mensagemId: string; conteudo: Record<string, unknown> }> = [];
  for (const candidata of listarMensagensDeModeloSemAnexo(acervo)) {
    let message: unknown;
    try {
      message = (JSON.parse(candidata.bruto) as { message?: unknown }).message;
    } catch {
      continue;
    }
    const leitura = leituraDoModelo(message);
    if (leitura.tipo === 'imagem') plano.push({ mensagemId: candidata.mensagemId, conteudo: leitura.conteudo });
    else if (leitura.tipo === 'nao-reconhecida') relatorio.formaNaoReconhecida += 1;
  }
  relatorio.comImagem = plano.length;
  relatorio.aCriar = plano.length;
  if (!opcoes.comEfeito || plano.length === 0) return relatorio;

  emOperacao(acervo, { natureza: 'extrair-imagem-de-modelo', reversibilidade: 'por-efeito' }, (op) => {
    for (const { mensagemId, conteudo } of plano) {
      const anexoId = registrarAnexo(acervo, { origemDaChegada: 'reprocesso', mensagemId, tipo: 'image', presenca: 'nunca-obtido', bruto: JSON.stringify(conteudo) });
      op.valor({ tabela: 'anexos', chave: anexoId, campo: 'id', antes: null, depois: anexoId });
      relatorio.criados += 1;
    }
  });
  relatorio.gravou = true;
  return relatorio;
}
