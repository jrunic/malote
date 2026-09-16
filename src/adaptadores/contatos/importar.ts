import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import type { Acervo } from '../../nucleo/acervo.js';
import { registrarCartaoDeCatalogo, registrarIdentificador } from '../../nucleo/escrita.js';
import { registrarNome } from '../../nucleo/identidade.js';
import { materialJaEntrou, registrarMaterialConcluido } from '../../nucleo/sincronizacao.js';
import { lerVCard } from './vcard.js';
import { soDigitos } from './telefone.js';
import { normalizarEmail } from './email.js';
import { relatorioDeCatalogoVazio, type RelatorioDeCatalogo } from './relatorio.js';
import { emOperacao } from '../../nucleo/trilha.js';

/**
 * Traduz o catalogo para chamadas da porta do nucleo. Nao toca tabela, nao
 * cria Pessoa e nao vincula: contribui endereco e nome, e para ai. Unir
 * Identificadores numa Pessoa e a Proposta, que e do plano 2.
 */

export interface OpcoesDeCatalogo {
  agora: number;
  /**
   * OBRIGATORIA. Opcional, ela desligava em toda a suite o check de material ja
   * registrado — medido em 08/09/2026, quando torna-la obrigatoria ligou a
   * guarda e derrubou onze testes que exercitavam um caminho que producao nao
   * toma. Agora ela tambem diz de qual catalogo cada evidencia veio.
   */
  configuracaoId: string;
  reprocessar?: boolean;
}

/** Impressao de Material: identifica o lote por nome e tamanho, sem abrir. */
function impressaoDoCatalogo(arquivoDoCatalogo: string): string {
  const s = statSync(arquivoDoCatalogo);
  return createHash('sha256')
    .update(`${basename(arquivoDoCatalogo)}:${s.size}`)
    .digest('hex');
}

/**
 * Identidade do cartao. O material NAO traz UID — medido, zero nos 6.693
 * cartoes reais —, entao ela e derivada do conjunto ORDENADO de enderecos
 * normalizados: telefones E E-MAILS. Escolha deliberada: editar o nome do
 * contato, que e a edicao comum, nao reagrupa nada; mudar os enderecos e outro
 * cartao mesmo.
 *
 * O e-mail entrou no conjunto em 12/09/2026, e a mudanca e IRREVERSIVEL na
 * pratica: 1.839 dos 6.693 cartoes reais mudam de identidade com ele dentro.
 * Fazer isso depois do primeiro import produziria ausencia e renascimento em
 * massa — por isso e agora, antes de qualquer adocao.
 */
function identidadeDoCartao(enderecos: Set<string>): string {
  return createHash('sha256')
    .update([...enderecos].sort().join('|'))
    .digest('hex')
    .slice(0, 32);
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
export function importarCatalogo(
  acervo: Acervo,
  arquivoDoCatalogo: string,
  opcoes: OpcoesDeCatalogo,
): RelatorioDeCatalogo {
  return emOperacao(
    acervo,
    {
      natureza: 'importar-material',
      reversibilidade: 'irreversivel',
      registraEfeito: false,
      // A importacao e retomavel: interrompida, o que entrou fica.
      emTransacao: false,
    },
    () => importarCatalogoInterno(acervo, arquivoDoCatalogo, opcoes),
  );
}

function importarCatalogoInterno(
  acervo: Acervo,
  arquivoDoCatalogo: string,
  opcoes: OpcoesDeCatalogo,
): RelatorioDeCatalogo {
  const r = relatorioDeCatalogoVazio();
  const impressao = impressaoDoCatalogo(arquivoDoCatalogo);

  if (
    opcoes.reprocessar !== true &&
    materialJaEntrou(acervo, opcoes.configuracaoId, impressao) !== null
  ) {
    r.jaRegistrado = true;
    return r;
  }

  const quando = new Date(opcoes.agora).toISOString();
  for (const cartao of lerVCard(readFileSync(arquivoDoCatalogo, 'utf8'))) {
    r.cartoesLidos += 1;

    // Normaliza e deduplica DENTRO do cartao: dois formatos do mesmo numero
    // sao um endereco so, e conta-los como dois mentiria no relatorio.
    const telefones = new Set<string>();
    for (const t of cartao.telefones) {
      const d = soDigitos(t);
      if (d.length > 0) telefones.add(d);
    }
    const emails = new Set<string>();
    for (const e of cartao.emails) {
      const n = normalizarEmail(e);
      if (n.length > 0) emails.add(n);
    }
    const enderecos = new Set<string>([...telefones, ...emails]);

    // As duas contagens respondem perguntas diferentes, e desde 12/09/2026 so
    // a segunda e descarte: cartao sem telefone MAS com e-mail entra.
    if (telefones.size === 0) r.cartoesSemTelefone += 1;
    if (enderecos.size === 0) {
      r.cartoesSemContatoAlgum += 1;
      continue;
    }

    const cartaoId = identidadeDoCartao(enderecos);
    for (const endereco of enderecos) {
      const { id: identificadorId, criado } = registrarIdentificador(acervo, {
        fonte: 'contatos',
        valor: endereco,
      });
      registrarCartaoDeCatalogo(acervo, identificadorId, cartaoId, opcoes.configuracaoId, quando);
      if (criado) r.identificadoresCriados += 1;
      else r.identificadoresJaExistentes += 1;

      if (cartao.nome === null || cartao.nome.length === 0) continue;
      const nomeNovo = registrarNome(acervo, {
        identificadorId,
        // A FONTE, nunca a Fonte com o apelido colado: quem distingue
        // catalogos e a Configuracao, na coluna propria.
        origem: 'contatos',
        configuracaoId: opcoes.configuracaoId,
        nome: cartao.nome,
        // `titular`: o cartao E a agenda do proprio Titular. Na pratica nao muda
        // o desempate, porque `contatos` ja vence por peso de Fonte — declarar e
        // o que impede a porta de aceitar omissao.
        autoridade: 'titular',
        atribuidoEm: quando,
      });
      if (nomeNovo) r.nomesCriados += 1;
      else r.nomesJaExistentes += 1;
    }
  }

  {
    registrarMaterialConcluido(acervo, {
      configuracaoId: opcoes.configuracaoId,
      fonte: 'contatos',
      impressao,
      // O catalogo nao produz nenhuma das duas, e dizer zero e a verdade.
      conversasCriadas: 0,
      mensagensCriadas: 0,
    });
  }
  return r;
}
