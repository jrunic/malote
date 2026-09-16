import { rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { Acervo } from './acervo.js';
import { DestinoInacessivelError } from './arquivo-de-anexo.js';
import { descartarAnexo } from './escrita.js';
import {
  descreverPolitica,
  type CriteriosDeRetencao,
} from '../registro/politica-de-retencao.js';
import { destinoAcessivel } from '../registro/destino-midia.js';

/**
 * A Política vive no Registro; a projeção e a aplicação leem o Acervo. As duas
 * moram no MESMO módulo de propósito: elas compartilham a seleção de alvos, e
 * é a discordância entre uma seleção de ensaio e outra de aplicação que faria
 * o ensaio mentir sobre o que a aplicação vai fazer.
 */

export interface AlvoDeRetencao {
  id: string;
  caminho: string | null;
  tamanho: number | null;
}

export interface Contagem {
  anexos: number;
  bytes: number;
}

export interface ProjecaoDeRetencao extends Contagem {
  /** O que cada critério alcançaria SOZINHO. Serve para calibrar. */
  porCriterio: Record<string, Contagem>;
}

export interface OpcoesDeProjecao {
  politica: CriteriosDeRetencao;
  /** Instante de referência da idade. Injetado, nunca `Date.now()`. */
  agora: number;
}

interface LinhaCandidata extends AlvoDeRetencao {
  tipo: string;
  ocorrida_em: number;
}

/**
 * Candidato é só o Anexo `presente`: `descartado` já saiu do disco e
 * `nunca-obtido` nunca teve arquivo. Reaplicar não os alcança, e é daí que
 * sai a idempotência — sem contador e sem estado novo.
 */
function candidatos(acervo: Acervo): LinhaCandidata[] {
  return acervo.preparar(
      `SELECT a.id, a.caminho, a.tamanho, a.tipo, m.ocorrida_em
         FROM anexos a
         JOIN mensagens m ON m.id = a.mensagem_id
        WHERE a.presenca = 'presente'`,
    )
    .all() as LinhaCandidata[];
}

function velhoDemais(l: LinhaCandidata, dias: number, agora: number): boolean {
  return (agora - l.ocorrida_em) / 86_400_000 > dias;
}

function grandeDemais(l: LinhaCandidata, bytes: number): boolean {
  return (l.tamanho ?? 0) > bytes;
}

function doTipo(l: LinhaCandidata, tipos: string[]): boolean {
  return tipos.includes(l.tipo);
}

/**
 * Os critérios declarados combinam por E. A Política sem critério algum é
 * recusada em `definirPoliticaDeRetencao`, e esta função repete a recusa: a
 * conjunção vazia alcança todo Anexo presente, e quem chamar por outro caminho
 * merece o mesmo erro, não o Acervo apagado.
 */
export function selecionarAlvos(acervo: Acervo, opcoes: OpcoesDeProjecao): AlvoDeRetencao[] {
  const { politica: p, agora } = opcoes;
  const tipos = p.tipos ?? [];
  const dias = p.maisVelhoQueDias;
  const bytes = p.maiorQueBytes;
  if (dias === undefined && bytes === undefined && tipos.length === 0) {
    throw new Error('Politica de Retencao sem criterio alcancaria todo Anexo presente.');
  }

  return candidatos(acervo)
    .filter((l) => (dias === undefined ? true : velhoDemais(l, dias, agora)))
    .filter((l) => (bytes === undefined ? true : grandeDemais(l, bytes)))
    .filter((l) => (tipos.length === 0 ? true : doTipo(l, tipos)))
    .map((l) => ({ id: l.id, caminho: l.caminho, tamanho: l.tamanho }));
}

function contar(linhas: Array<{ tamanho: number | null }>): Contagem {
  return {
    anexos: linhas.length,
    bytes: linhas.reduce((soma, l) => soma + (l.tamanho ?? 0), 0),
  };
}

export function projetarRetencao(acervo: Acervo, opcoes: OpcoesDeProjecao): ProjecaoDeRetencao {
  const { politica: p, agora } = opcoes;
  const todos = candidatos(acervo);
  const porCriterio: Record<string, Contagem> = {};

  const dias = p.maisVelhoQueDias;
  const bytes = p.maiorQueBytes;
  const tipos = p.tipos ?? [];

  if (dias !== undefined) {
    porCriterio['idade'] = contar(todos.filter((l) => velhoDemais(l, dias, agora)));
  }
  if (bytes !== undefined) {
    porCriterio['tamanho'] = contar(todos.filter((l) => grandeDemais(l, bytes)));
  }
  if (tipos.length > 0) {
    porCriterio['tipos'] = contar(todos.filter((l) => doTipo(l, tipos)));
  }

  return { ...contar(selecionarAlvos(acervo, opcoes)), porCriterio };
}

export interface OpcoesDeAplicar extends OpcoesDeProjecao {
  /** Raiz do Destino de Mídia deste Inquilino. */
  destino: string;
  /**
   * Ensaio sem efeito é o PADRÃO, e a ausência da bandeira é a proteção real —
   * não a documentação pedindo cuidado. Descartar arquivo é a primeira
   * operação irreversível do produto.
   */
  comEfeito?: boolean;
}

export interface RelatorioDeAplicacao {
  comEfeito: boolean;
  descartados: number;
  bytesLiberados: number;
  falhas: number;
  projecao: ProjecaoDeRetencao;
}

/**
 * O caminho absoluto de um Anexo, garantidamente DENTRO da subárvore deste
 * Inquilino. Devolve `null` quando não está — e não estar é caso de falha
 * contada, nunca de arquivo apagado por via das dúvidas.
 *
 * A guarda é contra o caminho gravado no Acervo, que é dado, não constante: um
 * `caminho` com `..` faria o `join` sair da subárvore e alcançar arquivo de
 * outro Inquilino apontado para a mesma raiz.
 */
function dentroDaSubarvore(destino: string, inquilinoId: string, caminho: string): string | null {
  const raiz = resolve(join(destino, inquilinoId));
  const alvo = resolve(join(destino, caminho));
  return alvo.startsWith(raiz + sep) ? alvo : null;
}

export function aplicarRetencao(acervo: Acervo, opcoes: OpcoesDeAplicar): RelatorioDeAplicacao {
  const projecao = projetarRetencao(acervo, opcoes);
  const comEfeito = opcoes.comEfeito === true;

  if (!comEfeito) {
    return { comEfeito: false, descartados: 0, bytesLiberados: 0, falhas: 0, projecao };
  }

  // O gate vem ANTES de qualquer escrita, e vale so para o caminho com efeito.
  // `DestinoInacessivelError` e o mesmo tipo que a gravacao usa: para quem
  // opera, "o disco nao esta ai" e uma condicao so, em qualquer operacao.
  if (!destinoAcessivel(opcoes.destino)) {
    throw new DestinoInacessivelError(opcoes.destino);
  }

  const marca = descreverPolitica(opcoes.politica);

  let descartados = 0;
  let bytesLiberados = 0;
  let falhas = 0;

  for (const alvo of selecionarAlvos(acervo, opcoes)) {
    if (alvo.caminho === null) {
      falhas += 1;
      continue;
    }
    const absoluto = dentroDaSubarvore(opcoes.destino, acervo.inquilinoId, alvo.caminho);
    if (absoluto === null) {
      falhas += 1;
      continue;
    }

    // `force: true` nao estoura em arquivo ausente, e isso so e seguro porque
    // o gate acima ja garantiu que o Destino esta acessivel. Sem ele, um
    // Destino desmontado faria TODO alvo parecer ja apagado.
    try {
      rmSync(absoluto, { force: true });
    } catch {
      falhas += 1;
      continue;
    }

    // O arquivo sai ANTES da linha transitar. Na ordem inversa, uma queda no
    // meio deixaria o Acervo dizendo `descartado` com o arquivo ainda em disco
    // — orfao que nada reivindica, porque a busca de orfaos parte do `caminho`
    // que acabou de virar NULL.
    //
    // Pela PORTA do nucleo, nunca por UPDATE proprio: a transicao de descarte
    // ja existe em `escrita.ts` desde o ciclo 1, e reescreve-la aqui seria a
    // divida da tarefa #670 outra vez — dois lugares que precisam concordar
    // para sempre sobre o que "descartado" significa.
    descartarAnexo(acervo, alvo.id, { politica: marca, quando: opcoes.agora });
    descartados += 1;
    bytesLiberados += alvo.tamanho ?? 0;
  }

  return { comEfeito: true, descartados, bytesLiberados, falhas, projecao };
}
