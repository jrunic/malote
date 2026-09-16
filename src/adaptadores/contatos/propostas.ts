import type { IdentificadorNoInventario } from '../../nucleo/inventario.js';
import type { Fonte } from '../../nucleo/tipos.js';
import { variantesDeEndereco } from './telefone.js';
import { normalizarNome } from './nome.js';

/**
 * Os tres produtores, na ordem de forca da evidencia. Puro: recebe o
 * inventario e devolve Propostas. Nao le, nao escreve, nao guarda — Proposta
 * e calculada a cada listagem (assumption 4 da spec), e por isso nao existe
 * proposta obsoleta.
 */

/**
 * Na ordem de FORCA da evidencia, e a ordem importa: o primeiro a chegar vence
 * o mesmo conjunto. E-mail unico entre bases e evidencia mais forte que nome
 * — o nome se repete, o endereco de e-mail nao — e mais fraca que telefone.
 */
export const PRODUTORES = ['telefone', 'email', 'nome', 'multiplos-enderecos'] as const;
export type ProdutorDeProposta = (typeof PRODUTORES)[number];

export interface Proposta {
  produtor: ProdutorDeProposta;
  identificadores: string[];
  /** A evidencia concreta, legivel por quem decide. */
  evidencia: string;
  /**
   * As Configuracoes de catalogo que sustentam esta Proposta.
   *
   * Vazia fora de `contatos`. UMA significa que o vinculo pode declarar de
   * onde veio; DUAS OU MAIS significa que nao ha uma Configuracao que o
   * sustente, e o vinculo grava nulo — escolher a primeira em ordem estavel
   * diria uma coisa que nao e verdade.
   */
  configuracoes: string[];
}

/** O que e e-mail: tem arroba. O telefone nunca tem, e o perfil tampouco. */
function ehEmail(valor: string): boolean {
  return valor.includes('@');
}

/** As Configuracoes de catalogo tocadas por um conjunto de Identificadores. */
function configuracoesDe(
  ids: string[],
  porId: Map<string, IdentificadorNoInventario>,
): string[] {
  const achadas = new Set<string>();
  for (const id of ids) {
    for (const c of porId.get(id)?.cartoes ?? []) achadas.add(c.configuracaoId);
  }
  return [...achadas].sort();
}

/** Chave estavel de um conjunto, para fundir e deduplicar. */
function chave(ids: string[]): string {
  return [...ids].sort().join('|');
}

/**
 * Verdadeiro quando o conjunto ja esta resolvido: todos pertencem a MESMA
 * Pessoa. Endereco sem Pessoa nunca resolve nada — aplicar e que cria.
 */
function jaResolvido(ids: string[], pessoaDe: Map<string, string | null>): boolean {
  const pessoas = ids.map((i) => pessoaDe.get(i) ?? null);
  if (pessoas.some((p) => p === null)) return false;
  return new Set(pessoas).size === 1;
}

export function propor(inventario: IdentificadorNoInventario[]): Proposta[] {
  const pessoaDe = new Map(inventario.map((i) => [i.id, i.pessoaId]));
  const porId = new Map(inventario.map((i) => [i.id, i]));
  const doCatalogo = inventario.filter((i) => i.fonte === 'contatos');
  const deFora = inventario.filter((i) => i.fonte !== 'contatos');

  /**
   * E-MAIL COMPARTILHADO: aparece em mais de um cartao da MESMA Configuracao.
   *
   * A regra e POR CONFIGURACAO, e nao global, porque o caso legitimo — o que
   * liga duas bases — e justamente um e-mail em dois cartoes, um por base.
   * "Em mais de um cartao" excluiria exatamente o que se quer achar.
   *
   * Medido no catalogo real: 20 e-mails em mais de um cartao, tocando 37
   * cartoes, com pares de pessoas distintas. Sem esta regra,
   * contato@empresa.com num punhado de cartoes funde gente distinta — e funde
   * POR TRANSITIVIDADE na aplicacao, sem que nenhuma Proposta pareca errada
   * sozinha.
   *
   * Sai de TODA producao, inclusive do laco de cartao: excluir de um lado so
   * deixa a fusao entrar pela porta dos fundos.
   */
  const compartilhados = new Set<string>();
  for (const i of doCatalogo) {
    if (!ehEmail(i.valor)) continue;
    const porConfiguracao = new Map<string, number>();
    for (const c of i.cartoes) {
      porConfiguracao.set(c.configuracaoId, (porConfiguracao.get(c.configuracaoId) ?? 0) + 1);
    }
    if ([...porConfiguracao.values()].some((n) => n > 1)) compartilhados.add(i.id);
  }

  const propostas = new Map<string, Proposta>();
  /** Primeiro produtor a chegar vence: a ordem de chamada e a de forca. */
  const oferecer = (p: Omit<Proposta, 'configuracoes'>): void => {
    if (jaResolvido(p.identificadores, pessoaDe)) return;
    const k = chave(p.identificadores);
    if (!propostas.has(k)) {
      propostas.set(k, { ...p, configuracoes: configuracoesDe(p.identificadores, porId) });
    }
  };

  // 1. Telefone — indice das variantes de cada endereco de fora.
  // So Fontes cujo endereco E telefone: `soDigitos('conversa:42')` da '42', e
  // um identificador de perfil de Instagram nao e endereco telefonico mesmo
  // quando os digitos coincidem com uma variante brasileira.
  const FONTES_DE_TELEFONE = new Set<Fonte>(['whatsapp']);
  const porVariante = new Map<string, string[]>();
  for (const i of deFora.filter((x) => FONTES_DE_TELEFONE.has(x.fonte))) {
    for (const v of variantesDeEndereco(i.valor)) {
      const atual = porVariante.get(v);
      if (atual === undefined) porVariante.set(v, [i.id]);
      else atual.push(i.id);
    }
  }
  for (const k of doCatalogo) {
    // `variantesDeEndereco` extrai digitos de QUALQUER cadeia: um e-mail com
    // ano ou numero no nome casaria com uma variante brasileira e produziria
    // Proposta plausivel e errada — o pior tipo, porque quem julga nao tem como
    // desconfiar.
    if (ehEmail(k.valor)) continue;
    for (const v of variantesDeEndereco(k.valor)) {
      for (const outro of porVariante.get(v) ?? []) {
        oferecer({
          produtor: 'telefone',
          identificadores: [k.id, outro],
          evidencia: `mesmo endereco ${v}`,
        });
      }
    }
  }

  // 2. E-mail — a PONTE entre bases.
  //
  // Nao ha como parear dois Identificadores de e-mail: `UNIQUE (fonte, valor)`
  // faz o mesmo e-mail em duas bases ser UMA linha. O que se liga sao os
  // CARTOES — base A tem {telefone T, e-mail E} e base B tem {e-mail E,
  // telefone U}, e o que falta ligar e T a U, atraves de E.
  //
  // A Proposta do laco de cartao ([T,E] e [E,U]) alcanca o mesmo resultado por
  // transitividade, e as tres convivem numa mesma listagem. A diferenca e a
  // EVIDENCIA: so esta nomeia o e-mail e as duas bases, e e por ela que quem
  // julga sabe que o vinculo atravessa catalogos. Aplicada, as outras duas
  // somem sozinhas na listagem seguinte — Proposta e calculada, nao guardada.
  for (const e of doCatalogo) {
    if (!ehEmail(e.valor) || compartilhados.has(e.id)) continue;
    const bases = new Set(e.cartoes.map((c) => c.configuracaoId));
    if (bases.size < 2) continue;

    const chavesDosCartoes = new Set(e.cartoes.map((c) => `${c.configuracaoId}\u0000${c.cartao}`));
    const membros = new Set<string>([e.id]);
    for (const outro of doCatalogo) {
      if (outro.id === e.id || compartilhados.has(outro.id)) continue;
      for (const c of outro.cartoes) {
        if (chavesDosCartoes.has(`${c.configuracaoId}\u0000${c.cartao}`)) membros.add(outro.id);
      }
    }
    if (membros.size < 2) continue;
    oferecer({
      produtor: 'email',
      identificadores: [...membros],
      evidencia: `mesmo e-mail ${e.valor} em ${bases.size} catalogos`,
    });
  }

  // 3. Nome — unicidade POR FONTE, e uma Proposta com todos os lados.
  const nomesDe = (i: IdentificadorNoInventario): Set<string> =>
    new Set(i.nomes.map(normalizarNome).filter((n) => n.length > 0));

  /** nome -> Fonte -> Identificadores daquela Fonte com aquele nome. */
  const porNomeEFonte = new Map<string, Map<Fonte, string[]>>();
  for (const i of inventario) {
    for (const n of nomesDe(i)) {
      let porFonte = porNomeEFonte.get(n);
      if (porFonte === undefined) {
        porFonte = new Map();
        porNomeEFonte.set(n, porFonte);
      }
      const atual = porFonte.get(i.fonte);
      if (atual === undefined) porFonte.set(i.fonte, [i.id]);
      else atual.push(i.id);
    }
  }

  for (const [nome, porFonte] of porNomeEFonte) {
    const noCatalogo = porFonte.get('contatos') ?? [];
    // Unico no catalogo. Sem isto, um nome repetido fundiria gente distinta.
    if (noCatalogo.length !== 1) continue;
    // Unico em CADA outra Fonte, medido separadamente: somar as Fontes
    // descartaria 91 nomes, que sao justamente as pontes entre elas.
    const outras = [...porFonte].filter(([f]) => f !== 'contatos');
    if (outras.length === 0) continue;
    if (outras.some(([, ids]) => ids.length !== 1)) continue;
    oferecer({
      produtor: 'nome',
      identificadores: [noCatalogo[0] as string, ...outras.map(([, ids]) => ids[0] as string)],
      evidencia: `mesmo nome "${nome}", unico em cada Fonte`,
    });
  }

  // 4. Multiplos enderecos — pelo LACO DE CARTAO, nunca pelo nome.
  //
  // A chave e (cartao, Configuracao), e nao so o cartao: duas bases podem
  // gerar o mesmo identificador de cartao para pessoas diferentes, porque ele
  // deriva do conjunto de enderecos e nada impede a coincidencia entre bases.
  // Com uma base so, e a mesma regra de antes.
  const porCartao = new Map<string, string[]>();
  for (const i of doCatalogo) {
    // O e-mail compartilhado sai TAMBEM daqui. Excluir so do produtor de
    // e-mail deixaria [T,E] e [E,U] serem oferecidas por este laco — e aplicar
    // as duas funde pessoas distintas por transitividade.
    if (compartilhados.has(i.id)) continue;
    for (const c of i.cartoes) {
      const chaveDoCartao = `${c.configuracaoId}\u0000${c.cartao}`;
      const atual = porCartao.get(chaveDoCartao);
      if (atual === undefined) porCartao.set(chaveDoCartao, [i.id]);
      else atual.push(i.id);
    }
  }
  for (const [, ids] of porCartao) {
    if (ids.length < 2) continue;
    oferecer({
      produtor: 'multiplos-enderecos',
      identificadores: ids,
      evidencia: `${ids.length} enderecos no mesmo contato`,
    });
  }

  return [...propostas.values()];
}
