// src/cli/reenvios.ts
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { EventoDeReenvio, GanchoDoReenvio } from '../adaptadores/whatsapp/conexao.js';
import { DIAS_GUARDADOS } from './vigilancia.js';

/**
 * O CONTADOR DOS PEDIDOS DE REENVIO (#1420).
 *
 * Fica em arquivo, ao lado do `ultimo-evento` e do estado dos Pendentes, e `ouvinte estado --json` o le sem abrir o
 * Acervo. So TIPOS e NUMEROS: nenhum JID, nome, texto nem identificador de Mensagem.
 *
 * NAO e o padrao dos Pendentes sozinho nem o dos descartes sozinho: e a SOMA dos dois.
 * - Dos descartes vem a SERIE POR DIA, acumulada entre Conexoes e reinicios (le o balde do dia, soma e regrava; balde
 *   por dia UTC; 30 dias). O estado dos Pendentes e o retrato da ULTIMA Conexao e se sobrescreve: aqui isso apagaria a
 *   semana que a medicao de campo precisa ler.
 * - Dos Pendentes vem o `null`: arquivo ausente, ilegivel ou sem `desde` e INDISPONIVEL, nunca "zero". Os descartes leem
 *   ausente como vazio, e aqui isso diria "nenhum pedido" de um ouvinte que talvez nem tenha sido medido.
 *
 * COMO LER, e isto e parte do contrato: `desde` presente e `dias` sem o dia e "nenhum pedido desde `desde`". `desde` e o
 * instante em que o malote comecou a contar (gravado uma vez, na abertura da primeira Conexao em que o arquivo nao existe).
 * Atencao: um arquivo ilegivel e recomecado no primeiro pedido seguinte, com `desde` novo; perder o contador e barato.
 *
 * ESCRITA: estrangulada (no maximo uma a cada 5 s, contada da TENTATIVA) e tambem ao parar. Sem a agenda do que ficou
 * estrangulado, um pedido isolado esperaria o proximo evento, que pode ser horas depois: o `kill` perderia horas, nao 5 s.
 * Por troca atomica, porque o arquivo e lido de fora.
 */
export const INTERVALO_DOS_REENVIOS_MS = 5_000;

export interface ContagemDeReenvios {
  pedidos: number;
  achadosNaMemoria: number;
  achadosNoAcervo: number;
  naoAchados: number;
  erros: number;
  enderecoDiferente: number;
  reciboFalhou: number;
  recusadosPorLimite: number;
  recusadosNaoPropria: number;
}

export interface EstadoDosReenvios {
  /** Instante ISO em que o malote comecou a contar. */
  desde: string;
  /** Por dia UTC (`AAAA-MM-DD`). */
  dias: Record<string, ContagemDeReenvios>;
}

const CAMPOS: ReadonlyArray<keyof ContagemDeReenvios> = [
  'pedidos',
  'achadosNaMemoria',
  'achadosNoAcervo',
  'naoAchados',
  'erros',
  'enderecoDiferente',
  'reciboFalhou',
  'recusadosPorLimite',
  'recusadosNaoPropria',
];

const RESULTADOS: Readonly<Record<string, keyof ContagemDeReenvios>> = {
  'achada-na-memoria': 'achadosNaMemoria',
  'achada-no-acervo': 'achadosNoAcervo',
  'nao-achada': 'naoAchados',
  erro: 'erros',
};
const ENDERECOS: ReadonlySet<string> = new Set(['igual', 'diferente', 'desconhecido']);
const MOTIVOS: Readonly<Record<string, keyof ContagemDeReenvios>> = {
  limite: 'recusadosPorLimite',
  'nao-propria': 'recusadosNaoPropria',
};

const zero = (): ContagemDeReenvios => ({
  pedidos: 0,
  achadosNaMemoria: 0,
  achadosNoAcervo: 0,
  naoAchados: 0,
  erros: 0,
  enderecoDiferente: 0,
  reciboFalhou: 0,
  recusadosPorLimite: 0,
  recusadosNaoPropria: 0,
});

const diaDe = (instante: number): string => new Date(instante).toISOString().slice(0, 10);
const ehInteiro = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const EH_DIA = /^\d{4}-\d{2}-\d{2}$/;

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Grava por troca atomica: quem le ve o arquivo antigo inteiro ou o novo inteiro. */
function gravar(caminho: string, estado: EstadoDosReenvios): void {
  const parcial = `${caminho}.parcial`;
  writeFileSync(parcial, `${JSON.stringify(estado)}\n`);
  renameSync(parcial, caminho);
}

/**
 * O contador gravado, ou `null`: arquivo ausente, JSON ilegivel, sem `desde` valido ou fora do contrato.
 *
 * Devolve um objeto RECONSTRUIDO, so com os campos do contrato: chave desconhecida no arquivo (um texto plantado, um
 * identificador) nao passa para o `--json`, que e o que a frota le.
 */
export function lerReenvios(caminho: string): EstadoDosReenvios | null {
  let lido: unknown;
  try {
    lido = JSON.parse(readFileSync(caminho, 'utf8'));
  } catch {
    return null;
  }
  const e = objeto(lido);
  if (e === null) return null;
  const { desde } = e;
  if (typeof desde !== 'string' || Number.isNaN(Date.parse(desde))) return null;
  const bruto = objeto(e['dias']);
  if (bruto === null) return null;
  const dias: Record<string, ContagemDeReenvios> = {};
  for (const [dia, balde] of Object.entries(bruto)) {
    const b = objeto(balde);
    if (!EH_DIA.test(dia) || b === null) return null;
    const conta = zero();
    for (const campo of CAMPOS) {
      const v = b[campo];
      if (!ehInteiro(v)) return null;
      conta[campo] = v;
    }
    dias[dia] = conta;
  }
  return { desde, dias };
}

/** O resto do contrato do evento: so enumeracoes conhecidas viram contagem ou texto. */
function ehEventoConhecido(e: unknown): e is EventoDeReenvio {
  const o = objeto(e);
  if (o === null) return false;
  if (o['tipo'] === 'recibo-falhou') return true;
  if (o['tipo'] === 'recusa') return typeof o['motivo'] === 'string' && Object.hasOwn(MOTIVOS, o['motivo']);
  if (o['tipo'] === 'pedido') {
    return (
      typeof o['resultado'] === 'string' &&
      Object.hasOwn(RESULTADOS, o['resultado']) &&
      typeof o['enderecoDoRecibo'] === 'string' &&
      ENDERECOS.has(o['enderecoDoRecibo'])
    );
  }
  return false;
}

/**
 * A linha de log de um evento, ou `undefined` para o que nao e do contrato. Montada SO de enumeracoes e de um numero:
 * nenhum campo extra do evento (endereco, nome, texto, identificador) entra, mesmo que alguem o ponha la.
 */
export function linhaDoEventoDeReenvio(evento: EventoDeReenvio): string | undefined {
  if (!ehEventoConhecido(evento)) return undefined;
  if (evento.tipo === 'recibo-falhou') return '[ouvinte] reenvio: o recibo falhou';
  if (evento.tipo === 'recusa') return `[ouvinte] reenvio: recusado pela biblioteca (${evento.motivo})`;
  const s = evento.idadeSegundos;
  const idade = typeof s === 'number' && Number.isFinite(s) && s >= 0 ? `${Math.round(s)}s` : 'desconhecida';
  return `[ouvinte] pedido de reenvio: ${evento.resultado} idade=${idade} endereco=${evento.enderecoDoRecibo}`;
}

function somar(destino: ContagemDeReenvios, evento: EventoDeReenvio): void {
  if (evento.tipo === 'recibo-falhou') {
    destino.reciboFalhou += 1;
  } else if (evento.tipo === 'recusa') {
    destino[MOTIVOS[evento.motivo] as keyof ContagemDeReenvios] += 1;
  } else {
    destino.pedidos += 1;
    destino[RESULTADOS[evento.resultado] as keyof ContagemDeReenvios] += 1;
    if (evento.enderecoDoRecibo === 'diferente') destino.enderecoDiferente += 1;
  }
}

export interface GravadorDosReenvios {
  /** Grava `desde` se o arquivo nao existe. Nao lanca. */
  abrir: () => void;
  /** Soma ao balde do dia do evento e grava, estrangulado. Nao lanca. */
  aoEvento: (evento: EventoDeReenvio) => void;
  /** Grava o que estiver pendente e cancela a agenda. Idempotente. Nao lanca. */
  parar: () => void;
}

/**
 * Cria o gravador do contador. Nada aqui propaga erro: falha de gravacao vira UM aviso so com o codigo (a mensagem de
 * sistema carrega caminho), e o que nao foi gravado fica em memoria para a proxima tentativa.
 */
export function criarGravadorDosReenvios(opcoes: {
  caminho: string;
  agora: () => number;
  avisar: (texto: string) => void;
  intervaloMs?: number;
  /** Injetavel para teste. Por padrao, `setTimeout` sem segurar o processo; devolve o cancelamento. */
  agendar?: (f: () => void, ms: number) => () => void;
}): GravadorDosReenvios {
  const intervalo = opcoes.intervaloMs ?? INTERVALO_DOS_REENVIOS_MS;
  const agendar =
    opcoes.agendar ??
    ((f: () => void, ms: number): (() => void) => {
      const t = setTimeout(f, ms);
      t.unref();
      return () => clearTimeout(t);
    });
  // O que foi contado e ainda nao gravou, por dia do EVENTO (nao do momento da escrita).
  const pendente = new Map<string, ContagemDeReenvios>();
  let ultimaTentativa = Number.NEGATIVE_INFINITY;
  let cancelarAgenda: (() => void) | undefined;
  let avisou = false;

  const avisarUmaVez = (o_que: string, erro: unknown): void => {
    if (avisou) return;
    avisou = true;
    // So o codigo do erro: a mensagem de sistema carrega caminho.
    const codigo = (erro as NodeJS.ErrnoException).code ?? 'erro';
    opcoes.avisar(`[ouvinte] reenvios: falha ao gravar ${o_que} (${codigo}); o ouvinte segue`);
  };

  const descarregar = (): void => {
    cancelarAgenda?.();
    cancelarAgenda = undefined;
    if (pendente.size === 0) return;
    const t = opcoes.agora();
    // A janela conta da TENTATIVA, nao do sucesso: um disco que falha nao leva uma tentativa por evento.
    ultimaTentativa = t;
    try {
      // Le e regrava a cada escrita (como os descartes): outro processo ou o arquivo refeito nao e esmagado por memoria.
      const estado = lerReenvios(opcoes.caminho) ?? { desde: new Date(t).toISOString(), dias: {} };
      for (const [dia, delta] of pendente) {
        const balde = estado.dias[dia] ?? zero();
        for (const campo of CAMPOS) balde[campo] += delta[campo];
        estado.dias[dia] = balde;
      }
      const corte = diaDe(t - DIAS_GUARDADOS * 86_400_000);
      for (const dia of Object.keys(estado.dias)) {
        if (dia < corte) delete estado.dias[dia];
      }
      gravar(opcoes.caminho, estado);
      pendente.clear();
    } catch (erro) {
      avisarUmaVez('o contador', erro);
    }
  };

  return {
    abrir: (): void => {
      try {
        if (existsSync(opcoes.caminho)) return;
        gravar(opcoes.caminho, { desde: new Date(opcoes.agora()).toISOString(), dias: {} });
      } catch (erro) {
        avisarUmaVez('a abertura do contador', erro);
      }
    },
    aoEvento: (evento): void => {
      try {
        if (!ehEventoConhecido(evento)) return;
        const t = opcoes.agora();
        const dia = diaDe(t);
        const balde = pendente.get(dia) ?? zero();
        somar(balde, evento);
        pendente.set(dia, balde);
        // `t >= ultimaTentativa`: relogio que volta para tras nao pode congelar o contador.
        const decorrido = t - ultimaTentativa;
        if (t >= ultimaTentativa && decorrido < intervalo) {
          cancelarAgenda ??= agendar(descarregar, intervalo - decorrido);
          return;
        }
        descarregar();
      } catch (erro) {
        avisarUmaVez('o contador', erro);
      }
    },
    parar: (): void => {
      try {
        descarregar();
      } catch (erro) {
        avisarUmaVez('o contador', erro);
      }
    },
  };
}

/**
 * O gancho que o `ouvir` passa a `conectar` (#1420). Compoe: a leitura do Acervo (a porta do nucleo, que so devolve a
 * Mensagem de um Envio DESTA Configuracao) e o destino de cada evento (o contador e UMA linha de log, sem endereco).
 * Mora aqui, e nao dentro do `ouvir`, para que o teste veja a Configuracao que chega a porta.
 */
export function montarGanchoDoReenvio(o: {
  configuracaoId: string;
  lerBruto: (configuracaoId: string, referenciaExterna: string) => string | undefined;
  gravador: Pick<GravadorDosReenvios, 'aoEvento'>;
  escrever: (linha: string) => void;
}): GanchoDoReenvio {
  return {
    lerDoAcervo: (referenciaExterna) => o.lerBruto(o.configuracaoId, referenciaExterna),
    aoEvento: (evento) => {
      o.gravador.aoEvento(evento);
      const linha = linhaDoEventoDeReenvio(evento);
      if (linha !== undefined) o.escrever(linha);
    },
  };
}
