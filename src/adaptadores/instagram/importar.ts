import { createHash } from 'node:crypto';
import type { Acervo } from '../../nucleo/acervo.js';
import {
  conversaJaExiste,
  InstanteImplausivelError,
  mensagemJaExiste,
  participacaoJaExiste,
  registrarAnexo,
  registrarConversa,
  registrarIdentificador,
  registrarMensagem,
  registrarParticipacao,
} from '../../nucleo/escrita.js';
import { registrarNome } from '../../nucleo/identidade.js';
import { materialJaEntrou, registrarMaterialConcluido } from '../../nucleo/sincronizacao.js';
import { contarRejeicao, relatorioVazio, type RelatorioDeImportacao } from '../relatorio.js';
import { emOperacao } from '../../nucleo/trilha.js';
import {
  impressaoDoMaterial,
  lerMaterial,
  type ConversaDoMaterial,
  type MensagemDoMaterial,
} from './material.js';

/**
 * Traduz o material do Instagram para chamadas da porta do núcleo.
 * Esta camada NÃO toca tabela para escrever: tudo passa pela porta.
 */

export interface OpcoesDeImportacao {
  agora: number;
  /**
   * Nome de exibição do Titular nesta Fonte, declarado por quem importa.
   * Nunca inferido: lista de nomes próprios embutida no código é o que o
   * repo de origem faz, e é impossível num produto que terceiros instalam.
   */
  titular: string;
  /** Configuração de Adaptador sob a qual este Material entra. OBRIGATÓRIA. */
  configuracao: { id: string; fonte: 'instagram' };
  /** Percorre o material mesmo que ele já tenha sido registrado. */
  reprocessar?: boolean;
}

/** Erro próprio da guarda do Titular, com o número da Conversa na mensagem. */
export class TitularAusenteError extends Error {
  constructor(
    readonly conversaIdExterno: string,
    readonly titular: string,
  ) {
    super(`Titular "${titular}" ausente da conversa direta ${conversaIdExterno}`);
    this.name = 'TitularAusenteError';
  }
}

/**
 * O material não traz identidade de Mensagem — medido sobre 20.000 registros
 * reais. Derivar de conversa, instante, autor e conteúdo é o que torna a
 * reimportação idempotente; o ordinal desempata registros indistinguíveis,
 * para que nenhum suma em silêncio.
 */
function identidadeDerivada(m: MensagemDoMaterial): string {
  const digest = createHash('sha256')
    .update([m.conversaIdExterno, m.ocorridaEm, m.autorExibicao, m.texto ?? ''].join('\u0000'))
    .digest('hex')
    .slice(0, 32);
  return m.ordinal === 0 ? digest : `${digest}-${m.ordinal}`;
}

/**
 * A escada de Identificador. Dois degraus, escolhidos pela natureza da
 * Conversa — nunca pelo estado da conta.
 *
 * O nome do diretório é o título normalizado em 460 de 460 conversas do
 * material real: não há endereço a preservar. O número da Conversa é o único
 * identificador durável que o material oferece.
 */
function enderecoDaContraparte(c: ConversaDoMaterial): string {
  return `conversa:${c.idExterno}`;
}

function enderecoDeParticipante(nomeExibicao: string): string {
  return `nome-exibicao:${nomeExibicao}`;
}

/**
 * A Operacao da ingestao e do MATERIAL, nunca do nome de cada Conversa.
 *
 * Sem este envelope, `registrarNome` — chamado uma vez por Conversa — abre
 * uma Operacao por nome: medido em 29/08/2026, 30 Cartoes produziam 30
 * Operacoes, e o catalogo real tem 6.693. Aqui a reentrancia junta tudo
 * numa so, e `registraEfeito: false` impede que o efeito de cada nome seja
 * gravado — o que dobraria o Acervo.
 */
export function importarMaterialDeInstagram(
  acervo: Acervo,
  raiz: string,
  opcoes: OpcoesDeImportacao,
): RelatorioDeImportacao {
  return emOperacao(
    acervo,
    {
      natureza: 'importar-material',
      reversibilidade: 'irreversivel',
      registraEfeito: false,
      // A importacao e retomavel: interrompida, o que entrou fica.
      emTransacao: false,
    },
    () => importarMaterialDeInstagramInterno(acervo, raiz, opcoes),
  );
}

function importarMaterialDeInstagramInterno(
  acervo: Acervo,
  raiz: string,
  opcoes: OpcoesDeImportacao,
): RelatorioDeImportacao {
  // Antes de abrir o material: se ele ja entrou, nao ha o que percorrer.
  const impressao = impressaoDoMaterial(raiz);
  if (opcoes.reprocessar !== true) {
    if (materialJaEntrou(acervo, opcoes.configuracao.id, impressao) !== null) {
      return { ...relatorioVazio(), jaRegistrado: true };
    }
  }

  const material = lerMaterial(raiz);

  // Antes de escrever qualquer coisa: o Titular declarado precisa aparecer
  // como participante de toda Conversa direta. Nome errado na linha de
  // comando é o defeito mais provável desta operação, e é silencioso sem
  // esta guarda — produz um acervo inteiro com o lado errado marcado.
  for (const c of material.conversas) {
    if (c.coletiva) continue;
    if (!c.participantesExibicao.includes(opcoes.titular)) {
      throw new TitularAusenteError(c.idExterno, opcoes.titular);
    }
  }

  const relatorio = relatorioVazio();
  relatorio.conversasSemArquivo = material.conversasSemArquivo.length;
  const observadaEm = new Date(opcoes.agora).toISOString();

  for (const c of material.conversas) {
    relatorio.mensagensLidas += c.mensagens.length;
    relatorio.conversasPorCaixa[c.caixa] = (relatorio.conversasPorCaixa[c.caixa] ?? 0) + 1;

    // "Criada" precisa querer dizer criada: `registrarConversa` é idempotente
    // e devolve a existente, então contar sem perguntar reporta como novidade
    // o que já estava lá — e a reimportação passaria a mentir.
    const conversaJaExistia = conversaJaExiste(acervo, 'instagram', c.idExterno);

    const conversaId = registrarConversa(acervo, {
      fonte: 'instagram',
      idExterno: c.idExterno,
      coletiva: c.coletiva,
      // Condicional: a porta recusa coletiva com Configuração.
      ...(c.coletiva ? {} : { configuracao: opcoes.configuracao }),
      ...(c.coletiva && c.titulo !== null ? { metadadosDeColetiva: { assunto: c.titulo } } : {}),
          bruto: c.bruto,
    });
    if (conversaJaExistia) relatorio.conversasJaExistentes += 1;
    else relatorio.conversasCriadas += 1;

    // Conversa direta: os dois lados são deriváveis — a contraparte pelo
    // número da Conversa, o Titular pelo nome declarado.
    // Conversa coletiva: só o que a Fonte informar. Vazio é válido.
    // NENHUMA data de entrada é gravada: o material não a tem.
    const enderecos = c.coletiva
      ? c.participantesExibicao.map(enderecoDeParticipante)
      : [enderecoDaContraparte(c), enderecoDeParticipante(opcoes.titular)];

    for (const endereco of enderecos) {
      const { id: identificadorId } = registrarIdentificador(acervo, {
        fonte: 'instagram',
        valor: endereco,
      });
      const participacaoJaEstava = participacaoJaExiste(acervo, conversaId, identificadorId);
      registrarParticipacao(acervo, { conversaId, identificadorId, observadaEm });
      if (participacaoJaEstava) relatorio.participacoesJaExistentes += 1;
      else relatorio.participacoesCriadas += 1;

      // Na Conversa direta o titulo E o nome de exibicao da contraparte — foi
      // medido em 460 de 460 conversas do material real. E o unico nome que o
      // material do Instagram oferece para quem nao esta em grupo.
      if (!c.coletiva && c.titulo !== null && endereco === enderecoDaContraparte(c)) {
        // `terceiro`: titulo e nome de exibicao sao escolha de quem e dono do
        // perfil, nao do Titular.
        registrarNome(acervo, {
          identificadorId,
          origem: 'instagram',
          nome: c.titulo,
          autoridade: 'terceiro',
        });
      }
    }

    for (const m of c.mensagens) {
      const idExterno = identidadeDerivada(m);

      const jaExistia = mensagemJaExiste(acervo, 'instagram', idExterno);

      const daPropriaPessoa = m.autorExibicao === opcoes.titular;
      const enderecoDoAutor = c.coletiva
        ? enderecoDeParticipante(m.autorExibicao)
        : daPropriaPessoa
          ? enderecoDeParticipante(opcoes.titular)
          : enderecoDaContraparte(c);
      const { id: autorId } = registrarIdentificador(acervo, {
        fonte: 'instagram',
        valor: enderecoDoAutor,
      });

      let mensagemId: string;
      try {
        mensagemId = registrarMensagem(acervo, {
          conversaId,
          fonte: 'instagram',
          idExterno,
          autorId,
          ocorridaEm: m.ocorridaEm,
          ...(m.texto !== null ? { conteudo: m.texto } : {}),
          bruto: m.bruto,
          agora: opcoes.agora,
        });
      } catch (causa) {
        if (causa instanceof InstanteImplausivelError) {
          contarRejeicao(relatorio, causa.motivo);
          continue;
        }
        throw causa;
      }

      if (jaExistia) {
        relatorio.mensagensJaExistentes += 1;
        // Nesta Fonte a Mensagem tem N Anexos, e a tabela nao tem restricao de
        // unicidade — quem impede duplicata e este desvio. Logo a contagem de
        // Anexo ja existente e por Mensagem, e nao por Anexo como no WhatsApp,
        // onde ha no maximo um. Anexo so nasce junto da Mensagem: se ela ja
        // estava, os dela tambem estavam.
        relatorio.anexosJaExistentes += m.anexos.length;
        continue;
      }
      relatorio.mensagensCriadas += 1;
      // Contado só quando a Mensagem entrou de fato: antes da rejeição por
      // instante, a contagem incluiria quem nunca foi gravado; sem o
      // `continue` acima, cresceria de novo a cada reimportação.
      if (m.ordinal > 0) relatorio.colisoesDesempatadas += 1;

      for (const anexo of m.anexos) {
        // Presença explícita e SEM caminho: quem decide onde o arquivo cai é
        // o núcleo, e só quando o arquivo existe — o que é ciclo 5.
        registrarAnexo(acervo, {
          mensagemId,
          tipo: anexo.tipo,
          nomeOriginal: anexo.nomeNaOrigem,
          presenca: 'nunca-obtido',
        });
        relatorio.anexosCriados += 1;
      }
    }
  }

  // So aqui: registrado quando a importacao TERMINA. Falha no meio nao deixa
  // registro, e a execucao seguinte processa o material inteiro.
  {
    registrarMaterialConcluido(acervo, {
      configuracaoId: opcoes.configuracao.id,
      fonte: 'instagram',
      impressao,
      conversasCriadas: relatorio.conversasCriadas,
      mensagensCriadas: relatorio.mensagensCriadas,
    });
  }

  return relatorio;
}
