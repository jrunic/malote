import type { Acervo } from '../../nucleo/acervo.js';
import {
  listarMensagensSemCartao,
  registrarContatosCompartilhados,
  type CartaoCompartilhado,
} from '../../nucleo/contato-compartilhado.js';
import { emOperacao } from '../../nucleo/trilha.js';
import { lerCartaoAoVivo, lerCartoesDoAnexoDeBackup, type RecursoDeNome } from './contato-compartilhado.js';

export interface RelatorioDeExtracaoDeContatos {
  /** Mensagens que ganhariam (ou ganharam) ao menos um cartao. */
  mensagensComCartao: number;
  /** Cartoes que o ensaio criaria. */
  cartoesACriar: number;
  /** Cartoes que nasceram de verdade. Zero no ensaio. */
  criados: number;
  /** Cartoes ilegiveis ou sem nome por caminho nenhum. Seguem candidatos em toda passada. */
  recusados: number;
  /** De onde veio o nome de cada cartao aceito. */
  nomesPorRecurso: Partial<Record<RecursoDeNome, number>>;
  gravou: boolean;
}

function topoDoEvento(bruto: string): { vcard: string; nome: string | undefined } | null {
  try {
    const evento = JSON.parse(bruto) as { message?: { contactMessage?: Record<string, unknown> } };
    const c = evento.message?.contactMessage;
    if (c === undefined || c === null || typeof c !== 'object') return null;
    return {
      vcard: typeof c['vcard'] === 'string' ? c['vcard'] : '',
      nome: typeof c['displayName'] === 'string' ? c['displayName'] : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Preenche o ESTOQUE: le o Conteudo Bruto das Mensagens que ainda nao tem Contato Compartilhado
 * gravado (o Anexo `contact` do backup e o `contactMessage` do topo do evento ao vivo) e grava os
 * cartoes. A Mensagem que esta nos dois lados sai UMA vez, pelo backup. Ensaio por padrao: conta
 * o que criaria e nao escreve. Com efeito, UMA Operacao para o lote, com um efeito por cartao
 * criado, que `desfazer` remove. Nao abre Operacao quando nao ha o que gravar.
 */
export function extrairContatosCompartilhados(
  acervo: Acervo,
  opcoes: { comEfeito: boolean },
): RelatorioDeExtracaoDeContatos {
  const relatorio: RelatorioDeExtracaoDeContatos = {
    mensagensComCartao: 0,
    cartoesACriar: 0,
    criados: 0,
    recusados: 0,
    nomesPorRecurso: {},
    gravou: false,
  };
  const plano = new Map<string, CartaoCompartilhado[]>();
  const somar = (nomes: Partial<Record<RecursoDeNome, number>>): void => {
    for (const [recurso, n] of Object.entries(nomes) as Array<[RecursoDeNome, number]>) {
      relatorio.nomesPorRecurso[recurso] = (relatorio.nomesPorRecurso[recurso] ?? 0) + n;
    }
  };

  const { doBackup, aoVivo } = listarMensagensSemCartao(acervo);
  for (const candidata of doBackup) {
    const leitura = lerCartoesDoAnexoDeBackup(candidata.bruto);
    relatorio.recusados += leitura.recusados;
    if (leitura.cartoes.length > 0) {
      plano.set(candidata.mensagemId, leitura.cartoes);
      somar(leitura.nomesPorRecurso);
    }
  }
  for (const candidata of aoVivo) {
    if (plano.has(candidata.mensagemId)) continue;
    const evento = topoDoEvento(candidata.bruto);
    if (evento === null) continue; // citacao, ou outro tipo: nao e cartao enviado
    const leitura = lerCartaoAoVivo(evento.vcard, evento.nome);
    relatorio.recusados += leitura.recusados;
    if (leitura.cartoes.length > 0) {
      plano.set(candidata.mensagemId, leitura.cartoes);
      somar(leitura.nomesPorRecurso);
    }
  }

  relatorio.mensagensComCartao = plano.size;
  relatorio.cartoesACriar = [...plano.values()].reduce((n, c) => n + c.length, 0);
  if (!opcoes.comEfeito || plano.size === 0) return relatorio;

  emOperacao(acervo, { natureza: 'extrair-contatos-compartilhados', reversibilidade: 'por-efeito' }, (op) => {
    for (const [mensagemId, cartoes] of plano) {
      const r = registrarContatosCompartilhados(acervo, mensagemId, cartoes);
      for (const id of r.criados) {
        op.valor({ tabela: 'contatos_compartilhados', chave: id, campo: 'id', antes: null, depois: id });
      }
      relatorio.criados += r.criados.length;
    }
  });
  relatorio.gravou = true;
  return relatorio;
}
