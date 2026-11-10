import type { Acervo } from '../../nucleo/acervo.js';
import { resolverEndereco } from '../../nucleo/correspondencia.js';
import { listarConversasDiretasDoEndereco } from '../../nucleo/enderecos-do-acervo.js';
import { emOperacao, type Operacao } from '../../nucleo/trilha.js';
import {
  identificadorDoEndereco,
  levarMarcasDeConversa,
  listarConversasDiretasComContagem,
  marcasDaConversa,
  moverMensagensDeConversa,
  registrarIdentificadorComEfeito,
  trocarEnderecoDeConversaDireta,
} from '../../nucleo/uniao-de-conversas.js';
import { formasDoNumero } from './aprender-pares-da-conversa-direta.js';

const FONTE = 'whatsapp' as const;
/** A forma opaca do endereco: vocabulario do Adaptador, passado ao nucleo como sufixo. */
const SUFIXO_OPACO = '@lid';
const PAGINA = 200;

/**
 * Por que uma Conversa opaca com par NAO e tocada (achado, nunca interrupcao):
 * - `alvo-ambiguo`: mais de uma Conversa do numero na mesma Configuracao (as duas formas do nono digito, por exemplo);
 * - `varias-opacas-para-o-numero`: duas Conversas opacas da mesma Configuracao apontam para o mesmo numero.
 */
export type MotivoDoConflitoDaUniao = 'alvo-ambiguo' | 'varias-opacas-para-o-numero';

export interface ConflitoDaUniao {
  motivo: MotivoDoConflitoDaUniao;
  configuracaoId: string;
  /** Ids de Conversa, nunca endereco: a opaca primeiro, depois as outras envolvidas em ordem de id. */
  conversas: string[];
}

export interface OpcoesDaUniao {
  comEfeito: boolean;
  /** No maximo este numero de Conversas opacas (inteiro maior que zero). */
  limite?: number;
  /** Os enderecos da propria conta (jid e lid das Configuracoes do Inquilino): so para o relatorio contar a Conversa da conta consigo mesma. */
  enderecosDaConta?: readonly string[];
  /** SO PARA TESTE: simula o ouvinte entre o plano e a escrita. */
  ganchoDeTeste?: { aposOPlano?: () => void; antesDeUma?: (conversaOpacaId: string) => void };
}

export interface RelatorioDaUniao {
  /** Conversas diretas por endereco opaco cujo endereco tem par gravado. */
  opacasComPar: number;
  aMover: { conversas: number; mensagens: number };
  aPromover: { conversas: number; mensagens: number; identificadoresARegistrar: number; perdemONome: number };
  marcasALevar: number;
  conflitos: ConflitoDaUniao[];
  porConfiguracao: Record<string, { aMover: number; aPromover: number; conflitos: number }>;
  movidas: number;
  mensagensMovidas: number;
  promovidas: number;
  identificadoresRegistrados: number;
  marcasLevadas: number;
  /** A Conversa do numero nasceu entre o plano e a escrita: a promocao virou mover (criterio 11). */
  promovidasQueViraramMover: number;
  /** Das Conversas a mover ou promover, quantas sao a da propria conta consigo mesma (so contagem, sem endereco). */
  daPropriaConta: number;
  operacaoId: string | null;
  gravou: boolean;
}

/**
 * Uma Conversa a escrever falhou de verdade (o escritor do ouvinte nao liberou o banco, por exemplo) com a Operacao ja
 * aberta: as anteriores ficaram, e o `desfazer` da Operacao parcial as devolve. Conflito NAO chega aqui.
 */
export class UniaoInterrompidaError extends Error {
  constructor(
    readonly operacaoId: string,
    readonly relatorio: RelatorioDaUniao,
    readonly causa: unknown,
  ) {
    super(
      `a uniao parou com ${relatorio.movidas} Conversa(s) movida(s) e ${relatorio.promovidas} promovida(s) ` +
        `na Operacao ${operacaoId}: ${String(causa)}`,
    );
    this.name = 'UniaoInterrompidaError';
  }
}

/** Uma Conversa opaca do plano. `destino` e o endereco do numero que a recepcao grava hoje para o contato. */
interface Item {
  opacaId: string;
  opaco: string;
  configuracaoId: string;
  destino: string;
  acao: 'mover' | 'promover';
}

/** O que a classificacao devolve para uma opaca: mover para um alvo, promover, ou o conflito de alvo. */
type Classe = { acao: 'mover'; alvo: string } | { acao: 'promover' } | { acao: 'alvo-ambiguo'; alvos: string[] };

const ordem = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Une, no estoque, a Conversa direta por endereco opaco e a Conversa do numero do mesmo contato (#1440), na MESMA
 * Configuracao, seguindo o par JA GRAVADO (nunca aprende par, nunca cria Conversa). A Conversa do numero se acha pelas formas
 * do numero (com e sem o 9). Uma: as Mensagens da opaca passam a ela (a opaca fica, vazia, com as Participacoes). Nenhuma: a
 * opaca e promovida, trocando o endereco pelo do numero, e o Identificador do numero e registrado. Mais de uma, ou duas opacas
 * para o mesmo numero: conflito, nada e tocado. Ensaio por padrao (so le). Com efeito, UMA Operacao `por-efeito`, sem
 * transacao externa, e uma transacao `immediate` por Conversa, que rele e reclassifica sob o lock.
 */
export function unirConversasDoContato(acervo: Acervo, opcoes: OpcoesDaUniao): RelatorioDaUniao {
  if (opcoes.limite !== undefined && (!Number.isInteger(opcoes.limite) || opcoes.limite <= 0)) {
    throw new RangeError('o limite precisa ser um inteiro maior que zero');
  }
  const relatorio: RelatorioDaUniao = {
    opacasComPar: 0,
    aMover: { conversas: 0, mensagens: 0 },
    aPromover: { conversas: 0, mensagens: 0, identificadoresARegistrar: 0, perdemONome: 0 },
    marcasALevar: 0,
    conflitos: [],
    porConfiguracao: {},
    movidas: 0,
    mensagensMovidas: 0,
    promovidas: 0,
    identificadoresRegistrados: 0,
    marcasLevadas: 0,
    promovidasQueViraramMover: 0,
    daPropriaConta: 0,
    operacaoId: null,
    gravou: false,
  };
  const daConta = new Set(opcoes.enderecosDaConta ?? []);
  const contaPropria = (o: { opaco: string; destino: string }): boolean => daConta.has(o.opaco) || daConta.has(o.destino);
  const daConfiguracao = (cfg: string): { aMover: number; aPromover: number; conflitos: number } =>
    (relatorio.porConfiguracao[cfg] ??= { aMover: 0, aPromover: 0, conflitos: 0 });

  // 1. A leitura, em paginas de Conversa, fora de transacao: as opacas com par, agrupadas pelo numero na Configuracao.
  const grupos = new Map<string, Array<{ id: string; opaco: string; configuracaoId: string; mensagens: number; destino: string }>>();
  let cursor = '';
  for (;;) {
    const pagina = listarConversasDiretasComContagem(acervo, FONTE, SUFIXO_OPACO, cursor, PAGINA);
    if (pagina.length === 0) break;
    cursor = pagina[pagina.length - 1]!.id;
    for (const c of pagina) {
      const destino = resolverEndereco(acervo, FONTE, c.endereco);
      if (destino === c.endereco) continue;
      relatorio.opacasComPar += 1;
      const chave = `${c.configuracaoId}\n${formasDoNumero(acervo, destino).join('|')}`;
      const grupo = grupos.get(chave) ?? [];
      grupos.set(chave, grupo);
      grupo.push({ id: c.id, opaco: c.endereco, configuracaoId: c.configuracaoId, mensagens: c.mensagens, destino });
    }
  }

  // 2. O plano: so le. Ordem: varias opacas para o numero; alvo ambiguo; nada a fazer; mover ou promover.
  const plano: Item[] = [];
  for (const grupo of [...grupos.values()].sort((a, b) => ordem(a[0]!.id, b[0]!.id))) {
    if (grupo.length > 1) {
      for (const o of grupo) {
        const outras = grupo.filter((x) => x.id !== o.id).map((x) => x.id).sort(ordem);
        relatorio.conflitos.push({ motivo: 'varias-opacas-para-o-numero', configuracaoId: o.configuracaoId, conversas: [o.id, ...outras] });
        daConfiguracao(o.configuracaoId).conflitos += 1;
      }
      continue;
    }
    const o = grupo[0]!;
    const classe = classificar(acervo, o.configuracaoId, o.destino);
    if (classe.acao === 'alvo-ambiguo') {
      relatorio.conflitos.push({ motivo: 'alvo-ambiguo', configuracaoId: o.configuracaoId, conversas: [o.id, ...classe.alvos] });
      daConfiguracao(o.configuracaoId).conflitos += 1;
      continue;
    }
    if (classe.acao === 'mover') {
      const marcas = marcasALevar(acervo, o.id, classe.alvo);
      // A opaca ja vazia e sem marca a levar: nada a fazer (e o que torna o segundo ensaio 0, criterio 9).
      if (o.mensagens === 0 && marcas === 0) continue;
      if (opcoes.limite !== undefined && plano.length >= opcoes.limite) continue;
      plano.push({ opacaId: o.id, opaco: o.opaco, configuracaoId: o.configuracaoId, destino: o.destino, acao: 'mover' });
      relatorio.aMover.conversas += 1;
      if (contaPropria(o)) relatorio.daPropriaConta += 1;
      relatorio.aMover.mensagens += o.mensagens;
      relatorio.marcasALevar += marcas;
      daConfiguracao(o.configuracaoId).aMover += 1;
      continue;
    }
    if (opcoes.limite !== undefined && plano.length >= opcoes.limite) continue;
    plano.push({ opacaId: o.id, opaco: o.opaco, configuracaoId: o.configuracaoId, destino: o.destino, acao: 'promover' });
    relatorio.aPromover.conversas += 1;
    if (contaPropria(o)) relatorio.daPropriaConta += 1;
    relatorio.aPromover.mensagens += o.mensagens;
    const doNumero = identificadorDoEndereco(acervo, FONTE, o.destino);
    if (doNumero === null) relatorio.aPromover.identificadoresARegistrar += 1;
    // O nome que a listagem mostra sai do Identificador cujo valor e o endereco da Conversa (nunca pela Correspondencia).
    if (identificadorDoEndereco(acervo, FONTE, o.opaco)?.comNome === true && doNumero?.comNome !== true) {
      relatorio.aPromover.perdemONome += 1;
    }
    daConfiguracao(o.configuracaoId).aPromover += 1;
  }
  if (!opcoes.comEfeito || plano.length === 0) return relatorio;

  // 3. A escrita: UMA Operacao, sem transacao externa, uma transacao `immediate` por Conversa (o ouvinte nunca espera um
  //    lock longo; o Acervo espera 5 s por escrita, e acima disso o lote do ouvinte derrama).
  opcoes.ganchoDeTeste?.aposOPlano?.();
  const operacaoId = emOperacao(
    acervo,
    { natureza: 'unir-conversas-do-contato', reversibilidade: 'por-efeito', emTransacao: false },
    (op) => {
      try {
        for (const item of plano) {
          opcoes.ganchoDeTeste?.antesDeUma?.(item.opacaId);
          acervo.db.transaction(() => unirUma(acervo, item, op, relatorio)).immediate();
        }
      } catch (causa) {
        relatorio.operacaoId = op.id;
        relatorio.gravou = relatorio.movidas + relatorio.promovidas > 0;
        throw new UniaoInterrompidaError(op.id, relatorio, causa);
      }
      return op.id;
    },
  );
  relatorio.gravou = relatorio.movidas + relatorio.promovidas > 0;
  relatorio.operacaoId = relatorio.gravou ? operacaoId : null;
  return relatorio;
}

/**
 * Uma Conversa opaca do plano, SOB O LOCK da transacao. Rele tudo: a opaca pode ter perdido o endereco (outra uniao), o par
 * pode ter sido desfeito ou apontar para outro numero, e o ouvinte pode ter criado a Conversa do numero entre o plano e aqui
 * (a promocao vira mover, nunca o erro do indice unico das diretas). O que mudou para conflito vira achado.
 */
function unirUma(acervo: Acervo, item: Item, op: Operacao, relatorio: RelatorioDaUniao): void {
  const ainda = listarConversasDiretasDoEndereco(acervo, FONTE, item.opaco).some(
    (c) => c.id === item.opacaId && c.configuracaoId === item.configuracaoId,
  );
  if (!ainda) return;
  const destino = resolverEndereco(acervo, FONTE, item.opaco);
  if (destino !== item.destino) return;

  const classe = classificar(acervo, item.configuracaoId, destino);
  if (classe.acao === 'alvo-ambiguo') {
    relatorio.conflitos.push({ motivo: 'alvo-ambiguo', configuracaoId: item.configuracaoId, conversas: [item.opacaId, ...classe.alvos] });
    return;
  }
  if (classe.acao === 'mover') {
    const mensagens = moverMensagensDeConversa(acervo, { de: item.opacaId, para: classe.alvo }, op);
    const marcas = levarMarcasDeConversa(acervo, { de: item.opacaId, para: classe.alvo }, op);
    // Outra execucao ja moveu tudo no intervalo: nada aconteceu aqui, e nao se conta.
    if (mensagens + marcas === 0) return;
    relatorio.mensagensMovidas += mensagens;
    relatorio.marcasLevadas += marcas;
    relatorio.movidas += 1;
    if (item.acao === 'promover') relatorio.promovidasQueViraramMover += 1;
    return;
  }
  if (registrarIdentificadorComEfeito(acervo, { fonte: FONTE, valor: destino }, op).criado) relatorio.identificadoresRegistrados += 1;
  trocarEnderecoDeConversaDireta(acervo, { conversaId: item.opacaId, de: item.opaco, para: destino }, op);
  relatorio.promovidas += 1;
}

/** A Conversa do numero na Configuracao, pelas formas do numero (com e sem o 9). */
function classificar(acervo: Acervo, configuracaoId: string, destino: string): Classe {
  const alvos = new Set<string>();
  for (const forma of formasDoNumero(acervo, destino)) {
    for (const c of listarConversasDiretasDoEndereco(acervo, FONTE, forma)) if (c.configuracaoId === configuracaoId) alvos.add(c.id);
  }
  if (alvos.size === 0) return { acao: 'promover' };
  if (alvos.size === 1) return { acao: 'mover', alvo: [...alvos][0]! };
  return { acao: 'alvo-ambiguo', alvos: [...alvos].sort(ordem) };
}

/** Quantas marcas da opaca o alvo ainda nao tem (as que o alvo ja tem ficam na opaca: a do alvo vale). */
function marcasALevar(acervo: Acervo, opacaId: string, alvoId: string): number {
  const doAlvo = new Set(marcasDaConversa(acervo, alvoId).map((m) => `${m.marca}\n${m.configuracaoId}`));
  return marcasDaConversa(acervo, opacaId).filter((m) => !doAlvo.has(`${m.marca}\n${m.configuracaoId}`)).length;
}
