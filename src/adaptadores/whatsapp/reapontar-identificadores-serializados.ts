import type { Acervo } from '../../nucleo/acervo.js';
import {
  aprenderCorrespondencia,
  enderecoEhCanonico,
  resolverEndereco,
} from '../../nucleo/correspondencia.js';
import { emOperacao, type Operacao } from '../../nucleo/trilha.js';
import {
  inventarioEmLote,
  listarIdentificadoresPorPrefixo,
  referenciasBaratas,
  reapontarTransicoes,
  removerIdentificadorSerializado,
} from '../../nucleo/reapontar-transicoes.js';
import { registrarIdentificadorComEfeito } from '../../nucleo/uniao-de-conversas.js';
import { enderecoDoParametro, ehEnderecoDeWhatsapp } from './endereco-de-whatsapp.js';
import { decidirEnderecoDeWhatsapp } from './resolver-celular.js';

const FONTE = 'whatsapp' as const;
const PAGINA = 500;

export interface OpcoesDoReaponto {
  comEfeito: boolean;
  limite?: number;
}

export interface RelatorioDoReaponto {
  serializados: number;
  ilegiveis: number;
  referenciados: Array<{ identificadorId: string; outras: Record<string, number> }>;
  conflitos: Array<{ identificadorId: string; motivo: string }>;
  /** Chegadas que citam os serializados do plano: informacao (a Operacao nao as toca). */
  chegadasQueCitam: number;
  transicoesAReapontar: number;
  paresAAprender: number;
  identificadoresACriar: number;
  serializadosRemovidos: number;
  transicoesReapontadas: number;
  transicoesFundidas: number;
  paresAprendidos: number;
  identificadoresCriados: number;
  operacaoId: string | null;
  gravou: boolean;
}

export class ReapontoInterrompidoError extends Error {
  constructor(
    readonly operacaoId: string,
    readonly relatorio: RelatorioDoReaponto,
    readonly causa: unknown,
  ) {
    super(`reaponto interrompido na Operacao ${operacaoId}`);
    this.name = 'ReapontoInterrompidoError';
  }
}

interface Item {
  id: string;
  /** O `id` do objeto. */
  endereco: string;
  /** O `phoneNumber` legivel, se houver. */
  numero: string | null;
}

interface Decisao {
  destino: string;
  pares: Array<{ alternativo: string; canonico: string }>;
  conflito: 'id-e-canonico-de-outro-par' | 'canonico-ja-e-alternativo' | null;
}

/**
 * Os pares que o ENSAIO ja decidiu aprender, em memoria: o mesmo participante aparece serializado em varios valores (o
 * `admin` muda, o telefone falta em alguns) e o efeito aprende o par no primeiro e o RESOLVE nos seguintes. Sem a previsao, o
 * ensaio contaria o mesmo par uma vez por valor e mandaria ao endereco opaco o valor sem telefone que o efeito manda ao numero.
 * No efeito ela e vazia: o par aprendido ja esta no Acervo.
 */
interface Previsao {
  pares: Map<string, string>;
  canonicos: Set<string>;
}

function ler(valor: string): { endereco: string; numero: string | null } | null {
  const endereco = enderecoDoParametro(valor);
  if (endereco === null) return null;
  let numero: string | null = null;
  try {
    const p = (JSON.parse(valor) as Record<string, unknown>)['phoneNumber'];
    if (typeof p === 'string' && ehEnderecoDeWhatsapp(p)) numero = p;
  } catch {
    /* o valor ja foi lido por enderecoDoParametro: aqui so o numero e opcional */
  }
  return { endereco, numero };
}

/**
 * O destino de um serializado e os pares a aprender. SO LE, e e a MESMA funcao no ensaio e no efeito (o ensaio nunca grava, e o
 * que ele preve e o que o efeito faz). O par existente do `id` vence e nunca se sobrescreve; o `id` que e canonico de outro par
 * montaria uma cadeia de dois passos, que a resolucao nao segue; o canonico do numero que ja e alternativa tambem e conflito.
 */
function decidirDestino(acervo: Acervo, item: Item, previsao?: Previsao): Decisao {
  const resolver = (endereco: string): string =>
    previsao?.pares.get(endereco) ?? resolverEndereco(acervo, FONTE, endereco);
  const jaResolve = resolver(item.endereco);
  if (jaResolve !== item.endereco) return { destino: jaResolve, pares: [], conflito: null };
  if (item.numero === null) return { destino: item.endereco, pares: [], conflito: null };
  if (
    enderecoEhCanonico(acervo, FONTE, item.endereco) ||
    previsao?.canonicos.has(item.endereco) === true
  ) {
    return { destino: item.endereco, pares: [], conflito: 'id-e-canonico-de-outro-par' };
  }
  const numeroResolvido = resolver(item.numero);
  const celular =
    numeroResolvido !== item.numero
      ? { usado: numeroResolvido, par: null }
      : decidirEnderecoDeWhatsapp(acervo, item.numero);
  const canonico = celular.usado;
  if (resolver(canonico) !== canonico) {
    return { destino: item.endereco, pares: [], conflito: 'canonico-ja-e-alternativo' };
  }
  const pares: Decisao['pares'] = [];
  if (celular.par !== null && previsao?.pares.has(celular.par.alternativo) !== true) {
    pares.push({ alternativo: celular.par.alternativo, canonico: celular.par.canonico });
  }
  pares.push({ alternativo: item.endereco, canonico });
  return { destino: canonico, pares, conflito: null };
}

/**
 * Reaponta as Transicoes de cada Identificador de valor serializado para o Identificador do endereco do objeto e o remove
 * (#1519). Ensaio por padrao (so le: nenhum par, nenhuma Operacao). Com efeito, UMA Operacao `por-efeito` sem transacao externa
 * e uma transacao `immediate` por Identificador, que so rele o que `referenciasBaratas` le (o inventario completo roda uma vez,
 * antes, fora do lock).
 */
export function reapontarIdentificadoresSerializados(
  acervo: Acervo,
  opcoes: OpcoesDoReaponto,
): RelatorioDoReaponto {
  if (opcoes.limite !== undefined && (!Number.isInteger(opcoes.limite) || opcoes.limite <= 0)) {
    throw new RangeError('o limite precisa ser um inteiro maior que zero');
  }
  const r: RelatorioDoReaponto = {
    serializados: 0,
    ilegiveis: 0,
    referenciados: [],
    conflitos: [],
    chegadasQueCitam: 0,
    transicoesAReapontar: 0,
    paresAAprender: 0,
    identificadoresACriar: 0,
    serializadosRemovidos: 0,
    transicoesReapontadas: 0,
    transicoesFundidas: 0,
    paresAprendidos: 0,
    identificadoresCriados: 0,
    operacaoId: null,
    gravou: false,
  };
  // 1. A leitura, em paginas, fora de transacao: todos os serializados (sao poucos milhares).
  let candidatos: Item[] = [];
  let cursor = '';
  for (;;) {
    const pagina = listarIdentificadoresPorPrefixo(acervo, FONTE, '{', cursor, PAGINA);
    if (pagina.length === 0) break;
    for (const p of pagina) {
      cursor = p.id;
      r.serializados += 1;
      const lido = ler(p.valor);
      if (lido === null) {
        r.ilegiveis += 1;
        continue;
      }
      candidatos.push({ id: p.id, endereco: lido.endereco, numero: lido.numero });
    }
  }
  // Os que trazem o telefone vao PRIMEIRO (ordenacao estavel, por id dentro de cada grupo): o mesmo participante aparece
  // serializado com e sem o telefone, e o valor sem telefone so chega ao numero se o par do endereco opaco ja foi aprendido
  // (no efeito) ou previsto (no ensaio). Na ordem de id, o sem telefone que viesse antes iria ao endereco opaco e o contato
  // ficaria partido entre os dois Identificadores.
  candidatos.sort((x, y) => Number(x.numero === null) - Number(y.numero === null));
  // O limite corta DEPOIS da ordem, pela mesma razao: um lote parcial nunca leva o valor sem telefone antes do irmao com.
  if (opcoes.limite !== undefined) candidatos = candidatos.slice(0, opcoes.limite);
  // 2. O inventario completo, UMA vez, em lote, fora de transacao (a unica varredura de `mensagens.citada_autor_id`).
  const inventario = inventarioEmLote(
    acervo,
    candidatos.map((c) => c.id),
  );
  const plano: Item[] = [];
  const aCriar = new Set<string>();
  const previsao: Previsao = { pares: new Map(), canonicos: new Set() };
  for (const item of candidatos) {
    const inv = inventario.get(item.id)!;
    r.chegadasQueCitam += inv.chegadas;
    if (Object.keys(inv.outras).length > 0) {
      r.referenciados.push({ identificadorId: item.id, outras: inv.outras });
      continue;
    }
    const d = decidirDestino(acervo, item, previsao);
    if (d.conflito !== null) {
      r.conflitos.push({ identificadorId: item.id, motivo: d.conflito });
      continue;
    }
    for (const par of d.pares) {
      previsao.pares.set(par.alternativo, par.canonico);
      previsao.canonicos.add(par.canonico);
    }
    r.transicoesAReapontar += inv.transicoes;
    r.paresAAprender += d.pares.length;
    if (
      acervo
        .preparar('SELECT 1 FROM identificadores WHERE fonte = ? AND valor = ?')
        .get(FONTE, d.destino) === undefined
    ) {
      aCriar.add(d.destino);
    }
    plano.push(item);
  }
  r.identificadoresACriar = aCriar.size;
  if (!opcoes.comEfeito || plano.length === 0) return r;

  // 3. A escrita: UMA Operacao, uma transacao immediate por Identificador.
  const operacaoId = emOperacao(
    acervo,
    {
      natureza: 'reapontar-identificadores-serializados',
      reversibilidade: 'por-efeito',
      emTransacao: false,
    },
    (op) => {
      try {
        for (const item of plano)
          acervo.db.transaction(() => reapontarUm(acervo, item, op, r)).immediate();
      } catch (causa) {
        r.operacaoId = op.id;
        r.gravou = r.serializadosRemovidos + r.transicoesReapontadas + r.transicoesFundidas > 0;
        throw new ReapontoInterrompidoError(op.id, r, causa);
      }
      return op.id;
    },
  );
  r.gravou = r.serializadosRemovidos + r.transicoesReapontadas + r.transicoesFundidas > 0;
  r.operacaoId = r.gravou ? operacaoId : null;
  return r;
}

/** Um Identificador serializado, SOB O LOCK: so as releituras de `referenciasBaratas`, e a mesma decisao do ensaio. */
function reapontarUm(acervo: Acervo, item: Item, op: Operacao, r: RelatorioDoReaponto): void {
  // Passou a ser referenciado desde o inventario: fica, e e achado do proximo ensaio.
  if (Object.keys(referenciasBaratas(acervo, item.id)).length > 0) return;
  const d = decidirDestino(acervo, item);
  if (d.conflito !== null) return;
  // Escolha 4 A: o par vem do que a Fonte declarou no objeto; SEMPRE com `op`, para o `desfazer` o remover.
  for (const par of d.pares) {
    aprenderCorrespondencia(
      acervo,
      { fonte: FONTE, alternativo: par.alternativo, canonico: par.canonico },
      op,
    );
    r.paresAprendidos += 1;
  }
  const registrado = registrarIdentificadorComEfeito(
    acervo,
    { fonte: FONTE, valor: d.destino },
    op,
  );
  if (registrado.criado) r.identificadoresCriados += 1;
  const { reapontadas, fundidas } = reapontarTransicoes(
    acervo,
    { de: item.id, para: registrado.id },
    op,
  );
  r.transicoesReapontadas += reapontadas;
  r.transicoesFundidas += fundidas;
  if (removerIdentificadorSerializado(acervo, item.id, op) === 'removido')
    r.serializadosRemovidos += 1;
}
