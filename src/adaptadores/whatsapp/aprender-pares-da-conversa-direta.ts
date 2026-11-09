import type { Acervo } from '../../nucleo/acervo.js';
import { aprenderCorrespondencia, enderecoEhCanonico, resolverEndereco } from '../../nucleo/correspondencia.js';
import {
  listarConversasDiretasComRecebidas,
  listarConversasDiretasDoEndereco,
} from '../../nucleo/enderecos-do-acervo.js';
import { emOperacao, type Operacao } from '../../nucleo/trilha.js';
import { outraFormaDoCelular } from './celular-br.js';
import { resolverEnderecoDeWhatsapp, situacaoNoEstoque } from './resolver-celular.js';

const FONTE = 'whatsapp' as const;
/** A forma opaca do endereco: vocabulario do Adaptador, passado ao nucleo como sufixo. */
const SUFIXO_OPACO = '@lid';
/** O telefone do companheiro so vale nesta forma: digitos e o sufixo do usuario, sem sufixo de dispositivo. */
const TELEFONE = /^\d+@s\.whatsapp\.net$/;
const PAGINA = 200;
const LOTE_PADRAO = 500;

/**
 * Por que um endereco opaco fica sem par (achado, nunca interrupcao):
 * - `mais-de-um-telefone-no-cru`: o cru traz mais de um numero, comparados depois do resolvedor;
 * - `par-existente-com-outro-canonico`: o opaco ja aponta para outro numero;
 * - `opaco-ja-canonico`: o opaco e o canonico de outro par (o par novo faria cadeia de dois passos, que a resolucao nao segue);
 * - `celular-em-conflito`: a outra forma do celular aponta para um terceiro endereco, ou as duas sao canonicas (o par do celular
 *   nao nasce, e a leitura pela outra forma nao alcancaria o opaco);
 * - `conflito-na-escrita`: o ouvinte aprendeu o opaco com outro numero entre o plano e o lote.
 */
export type MotivoDoConflitoDoPar =
  | 'mais-de-um-telefone-no-cru'
  | 'par-existente-com-outro-canonico'
  | 'opaco-ja-canonico'
  | 'celular-em-conflito'
  | 'conflito-na-escrita';

export interface ConflitoDoPar {
  opaco: string;
  motivo: MotivoDoConflitoDoPar;
  /** Os telefones em disputa: o gravado e o do cru, ou os distintos do cru. */
  telefones: string[];
}

export interface OpcoesDoEstoqueDoPar {
  comEfeito: boolean;
  /** No maximo este numero de pares do opaco. Inteiro maior que zero. */
  limite?: number;
  /** Enderecos opacos por transacao (padrao 500). */
  tamanhoDoLote?: number;
  /** Chamado ao fim de cada lote, com quantos enderecos ele tinha. */
  aoTerminarLote?: (enderecos: number) => void;
  /** SO PARA TESTE: chamado depois do plano e antes da Operacao, para simular o ouvinte que aprende pares nesse intervalo. */
  ganchoDeTeste?: { antesDosLotes?: () => void };
}

/** As duas especies de par, sempre contadas a parte: o do opaco (opaco para telefone) e o do celular (as duas formas). */
export interface ParesCriados {
  doOpaco: number;
  doCelular: number;
}

/**
 * Um lote falhou de verdade (o escritor do ouvinte nao liberou, por exemplo) com a Operacao ja aberta: os lotes anteriores
 * ficaram. Conflito NAO chega aqui: e achado, listado no relatorio, e o lote continua.
 */
export class EstoqueDoParInterrompidoError extends Error {
  constructor(
    readonly operacaoId: string,
    readonly criados: ParesCriados,
    readonly causa: unknown,
  ) {
    super(
      `o estoque do par parou com ${criados.doOpaco} par(es) do opaco e ${criados.doCelular} do celular ja criado(s) ` +
        `na Operacao ${operacaoId}: ${String(causa)}`,
    );
    this.name = 'EstoqueDoParInterrompidoError';
  }
}

export interface RelatorioDoEstoqueDoPar {
  /** Conversas diretas por forma opaca examinadas. */
  examinadas: number;
  /** Delas, as que tem ao menos uma Mensagem recebida. */
  comRecebida: number;
  /** Delas, as sem Mensagem recebida (so enviadas, ou vazias): nao ha o que aprender. */
  soComEnviadas: number;
  /** Mensagens recebidas sem o telefone no cru (o cru de importacao, de colunas, inclusive). */
  recebidasSemOCampo: number;
  /** Conversas com Mensagem recebida e nenhuma com o telefone. */
  conversasSemOCampo: number;
  /** Enderecos opacos distintos (as Conversas do mesmo opaco em duas Configuracoes contam uma vez). */
  enderecosOpacos: number;
  /** Deles, os com telefone no cru. */
  enderecosComTelefone: number;
  paresDoOpacoJaIguais: number;
  paresDoOpacoACriar: number;
  /** O par das duas formas do celular que o resolvedor aprende junto, quando falta. */
  paresDoCelularACriar: number;
  conflitos: ConflitoDoPar[];
  /** O telefone tem as duas formas gravadas como Identificador: sem par (decisao do operador). */
  duasFormasGravadas: Array<{ opaco: string; formas: [string, string] }>;
  /** Por Configuracao: as Conversas opacas que deixam de receber com o par (que vale para o Inquilino inteiro). */
  conversasOpacasQueCongelam: Record<string, number>;
  /** A Conversa opaca e a por telefone da MESMA Configuracao: o historico do contato fica em duas. */
  conversasPartidas: Array<{ configuracaoId: string; conversaOpaca: string; conversaPorTelefone: string }>;
  criados: ParesCriados;
  operacaoId: string | null;
  gravou: boolean;
}

/** O que dura enquanto a leitura do Acervo corre: por endereco opaco, as Conversas dele e os telefones do cru. */
interface Opaco {
  conversas: Array<{ conversaId: string; configuracaoId: string }>;
  telefones: Array<{ ocorridaEm: number; telefone: string }>;
}

/**
 * O par da forma opaca com o telefone, para o ESTOQUE das Conversas diretas (#1439): o telefone do companheiro (o campo
 * `senderPn` do cru de cada Mensagem recebida, o mais recente) vira o canonico, resolvido pelo MESMO resolvedor do celular
 * da recepcao, e o opaco vira o alternativo. Ensaio por padrao: so le (nem o resolvedor e chamado). Com efeito, uma Operacao
 * `por-efeito`, com uma transacao por lote, que cria so linhas da tabela de correspondencias: o `desfazer` remove as duas
 * especies.
 */
export function aprenderParesDaConversaDireta(acervo: Acervo, opcoes: OpcoesDoEstoqueDoPar): RelatorioDoEstoqueDoPar {
  if (opcoes.limite !== undefined && (!Number.isInteger(opcoes.limite) || opcoes.limite <= 0)) {
    throw new RangeError('o limite precisa ser um inteiro maior que zero');
  }
  const lote = opcoes.tamanhoDoLote ?? LOTE_PADRAO;
  if (!Number.isInteger(lote) || lote <= 0) throw new RangeError('o tamanho do lote precisa ser um inteiro maior que zero');

  const relatorio: RelatorioDoEstoqueDoPar = {
    examinadas: 0,
    comRecebida: 0,
    soComEnviadas: 0,
    recebidasSemOCampo: 0,
    conversasSemOCampo: 0,
    enderecosOpacos: 0,
    enderecosComTelefone: 0,
    paresDoOpacoJaIguais: 0,
    paresDoOpacoACriar: 0,
    paresDoCelularACriar: 0,
    conflitos: [],
    duasFormasGravadas: [],
    conversasOpacasQueCongelam: {},
    conversasPartidas: [],
    criados: { doOpaco: 0, doCelular: 0 },
    operacaoId: null,
    gravou: false,
  };

  // 1. A leitura, em paginas de Conversa, fora de transacao.
  const opacos = new Map<string, Opaco>();
  let cursor = '';
  for (;;) {
    const pagina = listarConversasDiretasComRecebidas(acervo, FONTE, SUFIXO_OPACO, { depoisDe: cursor, limite: PAGINA });
    if (pagina.length === 0) break;
    cursor = pagina[pagina.length - 1]!.conversaId;
    for (const c of pagina) {
      relatorio.examinadas += 1;
      const estado = opacos.get(c.idExterno) ?? { conversas: [], telefones: [] };
      opacos.set(c.idExterno, estado);
      estado.conversas.push({ conversaId: c.conversaId, configuracaoId: c.configuracaoId });
      if (c.recebidas.length === 0) {
        relatorio.soComEnviadas += 1;
        continue;
      }
      relatorio.comRecebida += 1;
      let comCampo = 0;
      for (const m of c.recebidas) {
        const telefone = telefoneDoCru(m.bruto);
        if (telefone === undefined) {
          relatorio.recebidasSemOCampo += 1;
          continue;
        }
        comCampo += 1;
        estado.telefones.push({ ocorridaEm: m.ocorridaEm, telefone });
      }
      if (comCampo === 0) relatorio.conversasSemOCampo += 1;
    }
  }

  // 2. O plano: so le. Nenhuma chamada do resolvedor que escreve. A ORDEM da classificacao e contrato com o script de
  //    conferencia: cru com dois numeros; par existente (igual ou outro numero); opaco ja canonico; duas formas gravadas;
  //    celular em conflito; o resto entra no plano.
  relatorio.enderecosOpacos = opacos.size;
  const plano: Array<{ opaco: string; telefone: string }> = [];
  const celularesPrevistos = new Set<string>();
  for (const [opaco, estado] of [...opacos].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (estado.telefones.length === 0) continue;
    relatorio.enderecosComTelefone += 1;
    let telefone = estado.telefones[0]!;
    for (const t of estado.telefones) if (t.ocorridaEm >= telefone.ocorridaEm) telefone = t;

    const distintos = new Map<string, string>();
    for (const t of estado.telefones) if (!distintos.has(numeroDe(acervo, t.telefone))) distintos.set(numeroDe(acervo, t.telefone), t.telefone);
    if (distintos.size > 1) {
      relatorio.conflitos.push({ opaco, motivo: 'mais-de-um-telefone-no-cru', telefones: [...distintos.values()].sort() });
      continue;
    }

    const gravado = resolverEndereco(acervo, FONTE, opaco);
    if (gravado !== opaco) {
      if (numeroDe(acervo, gravado) === numeroDe(acervo, telefone.telefone)) relatorio.paresDoOpacoJaIguais += 1;
      else relatorio.conflitos.push({ opaco, motivo: 'par-existente-com-outro-canonico', telefones: [gravado, telefone.telefone] });
      continue;
    }

    if (enderecoEhCanonico(acervo, FONTE, opaco)) {
      relatorio.conflitos.push({ opaco, motivo: 'opaco-ja-canonico', telefones: [telefone.telefone] });
      continue;
    }

    const situacao = situacaoNoEstoque(acervo, telefone.telefone);
    if (situacao === 'duas-formas') {
      const outra = outraFormaDoCelular(telefone.telefone) as string;
      const formas: [string, string] = telefone.telefone < outra ? [telefone.telefone, outra] : [outra, telefone.telefone];
      relatorio.duasFormasGravadas.push({ opaco, formas });
      continue;
    }
    if (situacao === 'conflito') {
      relatorio.conflitos.push({ opaco, motivo: 'celular-em-conflito', telefones: [telefone.telefone] });
      continue;
    }

    if (opcoes.limite !== undefined && plano.length >= opcoes.limite) continue;
    plano.push({ opaco, telefone: telefone.telefone });
    const numero = numeroDe(acervo, telefone.telefone);
    if (situacao.startsWith('cria') && !celularesPrevistos.has(numero)) {
      celularesPrevistos.add(numero);
      relatorio.paresDoCelularACriar += 1;
    }
    for (const c of estado.conversas) {
      relatorio.conversasOpacasQueCongelam[c.configuracaoId] = (relatorio.conversasOpacasQueCongelam[c.configuracaoId] ?? 0) + 1;
      for (const forma of formasDoNumero(acervo, telefone.telefone)) {
        for (const t of listarConversasDiretasDoEndereco(acervo, FONTE, forma)) {
          if (t.configuracaoId === c.configuracaoId) {
            relatorio.conversasPartidas.push({ configuracaoId: c.configuracaoId, conversaOpaca: c.conversaId, conversaPorTelefone: t.id });
          }
        }
      }
    }
  }
  relatorio.paresDoOpacoACriar = plano.length;
  if (!opcoes.comEfeito || plano.length === 0) return relatorio;

  // 3. A escrita: UMA Operacao, uma transacao `immediate` por lote (o ouvinte nao aprende o par entre a leitura e a escrita).
  opcoes.ganchoDeTeste?.antesDosLotes?.();
  const operacaoId = emOperacao(
    acervo,
    { natureza: 'aprender-pares-da-conversa-direta', reversibilidade: 'por-efeito', emTransacao: false },
    (op) => {
      try {
        for (let i = 0; i < plano.length; i += lote) {
          const dosLote = plano.slice(i, i + lote);
          acervo.db
            .transaction(() => {
              for (const item of dosLote) aprenderUm(acervo, item, op, relatorio);
            })
            .immediate();
          opcoes.aoTerminarLote?.(dosLote.length);
        }
      } catch (causa) {
        throw new EstoqueDoParInterrompidoError(op.id, { ...relatorio.criados }, causa);
      }
      return op.id;
    },
  );
  const total = relatorio.criados.doOpaco + relatorio.criados.doCelular;
  relatorio.operacaoId = total > 0 ? operacaoId : null;
  relatorio.gravou = total > 0;
  return relatorio;
}

/**
 * Um endereco opaco do plano. O ouvinte pode ter aprendido o par entre o plano e o lote: do mesmo numero, nada a criar; de
 * outro, achado (`conflito-na-escrita`) e o lote continua. A conferencia e feita aqui, sob o lock do lote, e por isso
 * `aprenderCorrespondencia` nao chega a recusar.
 */
function aprenderUm(
  acervo: Acervo,
  item: { opaco: string; telefone: string },
  op: Operacao,
  relatorio: RelatorioDoEstoqueDoPar,
): void {
  const gravado = resolverEndereco(acervo, FONTE, item.opaco);
  if (gravado !== item.opaco) {
    if (numeroDe(acervo, gravado) !== numeroDe(acervo, item.telefone)) {
      relatorio.conflitos.push({ opaco: item.opaco, motivo: 'conflito-na-escrita', telefones: [gravado, item.telefone] });
    }
    return;
  }
  let nasceram = 0;
  const contador: Operacao = {
    id: op.id,
    valor(relato) {
      nasceram += 1;
      op.valor(relato);
    },
    referencia: (relato) => op.referencia(relato),
  };
  // Com `op`, SEMPRE: sem ele, dentro desta Operacao, o par do celular entraria sem linha de efeito e o `desfazer` nao o removeria.
  const canonico = resolverEnderecoDeWhatsapp(acervo, item.telefone, contador);
  relatorio.criados.doCelular += nasceram;
  nasceram = 0;
  aprenderCorrespondencia(acervo, { fonte: FONTE, alternativo: item.opaco, canonico }, contador);
  relatorio.criados.doOpaco += nasceram;
}

/** O telefone do companheiro no cru de uma Mensagem recebida, ou `undefined` (sem o campo, cru de importacao, cru ilegivel). */
function telefoneDoCru(bruto: string | null): string | undefined {
  if (bruto === null) return undefined;
  let cru: unknown;
  try {
    cru = JSON.parse(bruto);
  } catch {
    return undefined;
  }
  const chave = (cru as { key?: { senderPn?: unknown } } | null)?.key;
  const telefone = chave?.senderPn;
  return typeof telefone === 'string' && TELEFONE.test(telefone) ? telefone : undefined;
}

/** O numero de um telefone, DEPOIS do resolvedor: o par que ja existe e seguido, e as formas com e sem o 9 sao o mesmo. */
function numeroDe(acervo: Acervo, telefone: string): string {
  return formasDoNumero(acervo, telefone).join('|');
}

function formasDoNumero(acervo: Acervo, telefone: string): string[] {
  const resolvido = resolverEndereco(acervo, FONTE, telefone);
  const outra = outraFormaDoCelular(resolvido);
  return outra === null ? [resolvido] : [resolvido, outra].sort();
}
