// src/adaptadores/whatsapp/pendentes.ts

/**
 * OS PENDENTES DA PLATAFORMA E O RECOLHIMENTO (#1151).
 *
 * Ao criar a Conexao, a plataforma anuncia quantos itens guardou para o ouvinte (mensagens,
 * recibos, notificacoes, status, chamadas) e a biblioteca pede UMA parte, de 100 itens. A plataforma
 * entrega essa parte e espera; o aviso de FIM, que fecha o buffer inicial da biblioteca, pode nao
 * vir. Com o buffer aberto nenhuma Mensagem chega a gravacao, e o que ja foi confirmado a
 * plataforma morre com a Conexao. Medido em outubro de 2026 numa instalacao em producao: 48,8 h sem
 * Mensagem no Acervo. ("Lote" e palavra do Derrame; aqui se diz "parte".)
 *
 * Este modulo e a DECISAO, pura: recebe os sinais da Conexao, um relogio injetado, e devolve a acao
 * (liberar o buffer, pedir mais) que quem o liga executa. Nao conhece a biblioteca. O vocabulario da
 * biblioteca (buffer, flush, offline_batch) mora em `pendentes-na-conexao.ts`; o nucleo nunca o ve.
 */

export type TipoDeNo = 'mensagem' | 'notificacao' | 'recibo' | 'chamada';

export type Desfecho =
  | 'em-andamento'
  | 'fim-natural'
  | 'recolheu'
  | 'sem-resposta'
  | 'teto'
  | 'prazo'
  | 'falha-de-envio'
  | 'encerrou-antes';

export interface Anunciados {
  total: number;
  mensagens: number;
  recibos: number;
  notificacoes: number;
  status: number;
  chamadas: number;
  outros: number;
}

export interface RecebidosPorTipo {
  mensagens: number;
  notificacoes: number;
  recibos: number;
  chamadas: number;
}

/** O estado dos Pendentes de UMA Conexao. So tipos e numeros: nunca JID, id de Mensagem ou conteudo. */
export interface EstadoDosPendentes {
  socketCriadoEm: number;
  abertoEm: number | null;
  atualizadoEm: number;
  anunciados: Anunciados | null;
  recebidos: RecebidosPorTipo;
  /** `null` e INDISPONIVEL (a biblioteca nao deixou observar), nunca zero. */
  falhasDeDecifra: number | null;
  pedidos: number;
  /** Quantos nos chegaram depois de cada pedido, ate o pedido seguinte (ou o fim). */
  nosPorPedido: number[];
  liberadoEm: number | null;
  fimDeclaradoEm: number | null;
  desfecho: Desfecho;
}

export interface ConstantesDoRecolhimento {
  /** Pausa sem nenhum no que da a parte inicial por assentada e autoriza o pedido seguinte. */
  silencioMs: number;
  /** Espera maxima da parte inicial, contada da criacao do socket. */
  esperaDaParteInicialMs: number;
  /** Quantos itens a plataforma entrega por pedido (o `count` do pedido). */
  itensPorPedido: number;
  pisoDoTeto: number;
  folgaDoTeto: number;
  fatorDoTeto: number;
  /** Prazo do recolhimento, contado da liberacao do buffer. */
  prazoMs: number;
  pedidosSemRespostaMax: number;
}

export const CONSTANTES_PADRAO: ConstantesDoRecolhimento = {
  silencioMs: 4_000,
  esperaDaParteInicialMs: 60_000,
  itensPorPedido: 100,
  pisoDoTeto: 20,
  folgaDoTeto: 10,
  fatorDoTeto: 2,
  prazoMs: 600_000,
  pedidosSemRespostaMax: 3,
};

/** Quantas entradas de `nosPorPedido` o estado guarda: teto de tamanho do arquivo de estado. */
export const MAXIMO_DE_ENTRADAS_POR_PEDIDO = 200;

/**
 * O teto de pedidos e FOLGA, nao modelo: a plataforma pode entregar mais que o `count` de um pedido
 * (07/10/2026: um pedido de 100 trouxe 859 itens). 3.583 itens anunciados dao 82; o piso cobre fila pequena.
 */
export function tetoDePedidos(
  anunciados: number,
  c: ConstantesDoRecolhimento = CONSTANTES_PADRAO,
): number {
  return Math.max(
    c.pisoDoTeto,
    c.fatorDoTeto * Math.ceil(anunciados / c.itensPorPedido) + c.folgaDoTeto,
  );
}

export interface NoDoTransporte {
  tag?: string;
  attrs?: Record<string, string>;
  content?: unknown;
}

function inteiro(valor: string | undefined): number | undefined {
  if (valor === undefined || !/^\d+$/.test(valor)) return undefined;
  return Number(valor);
}

/** Le o no de aviso de pendentes. `null` quando nao traz uma contagem total legivel. */
export function lerAnunciados(no: NoDoTransporte): Anunciados | null {
  const filhos = Array.isArray(no.content) ? (no.content as NoDoTransporte[]) : [];
  const aviso = filhos.find((f) => f.tag === 'offline_preview');
  const a = aviso?.attrs;
  if (a === undefined) return null;
  const total = inteiro(a['count']);
  if (total === undefined) return null;
  const n = (chave: string): number => inteiro(a[chave]) ?? 0;
  return {
    total,
    mensagens: n('message'),
    recibos: n('receipt'),
    notificacoes: n('notification'),
    status: n('status'),
    chamadas: n('call'),
    outros: n('appdata'),
  };
}

export type Acao = 'liberar' | 'pedir';

export interface Recolhedor {
  abriu: () => void;
  anuncio: (anunciados: Anunciados) => void;
  no: (tipo: TipoDeNo) => void;
  /** O aviso de FIM da plataforma. A unica prova de que os Pendentes acabaram. */
  fim: () => void;
  falhaDeDecifra: () => void;
  envioFalhou: () => void;
  /** O socket fechou ou a Conexao parou: o que estava em andamento termina como `encerrou-antes`. */
  fechou: () => void;
  /** Um passo do relogio. Devolve a acao que quem liga executa, ou nada. `bufferAtivo` diz se ha o que liberar. */
  passo: (bufferAtivo: boolean) => Acao | undefined;
  estado: () => EstadoDosPendentes;
  /** Muda a cada alteracao do estado: quem emite compara para nao repetir. */
  versao: () => number;
}

export interface OpcoesDoRecolhedor {
  agora: () => number;
  constantes?: Partial<ConstantesDoRecolhimento>;
  /** `true` quando a biblioteca deixa observar as falhas de decifra; sem isso o campo fica `null`. */
  contaFalhasDeDecifra?: boolean;
}

/** Desfechos que um aviso de fim posterior corrige: a plataforma declarou o fim, so que depois do esforco. */
const CORRIGIDOS_PELO_FIM_TARDIO: ReadonlySet<Desfecho> = new Set<Desfecho>([
  'sem-resposta',
  'teto',
  'prazo',
  'falha-de-envio',
]);

export function criarRecolhedor(opcoes: OpcoesDoRecolhedor): Recolhedor {
  const c: ConstantesDoRecolhimento = { ...CONSTANTES_PADRAO, ...opcoes.constantes };
  const agora = opcoes.agora;
  const criadoEm = agora();

  let abertoEm: number | null = null;
  let anunciados: Anunciados | null = null;
  let teto = c.pisoDoTeto;
  const recebidos: RecebidosPorTipo = { mensagens: 0, notificacoes: 0, recibos: 0, chamadas: 0 };
  let falhas: number | null = opcoes.contaFalhasDeDecifra === true ? 0 : null;
  let pedidos = 0;
  const nosPorPedido: number[] = [];
  let liberadoEm: number | null = null;
  let fimEm: number | null = null;
  let desfecho: Desfecho = 'em-andamento';
  let ultimoNoEm = criadoEm;
  let ultimoPedidoEm = Number.NEGATIVE_INFINITY;
  let nosNoUltimoPedido = 0;
  let pedidoSemContar = false;
  let semResposta = 0;
  let falhouOEnvio = false;
  let versao = 0;

  const mudou = (): void => {
    versao += 1;
  };
  const nosTotais = (): number =>
    recebidos.mensagens + recebidos.notificacoes + recebidos.recibos + recebidos.chamadas;
  const emAndamento = (): boolean => desfecho === 'em-andamento';

  // Fecha a conta do pedido em voo: quantos nos vieram depois dele. Zero e uma resposta que nao veio.
  const contarPedido = (): void => {
    if (!pedidoSemContar) return;
    pedidoSemContar = false;
    const delta = nosTotais() - nosNoUltimoPedido;
    if (nosPorPedido.length < MAXIMO_DE_ENTRADAS_POR_PEDIDO) nosPorPedido.push(delta);
    semResposta = delta === 0 ? semResposta + 1 : 0;
  };

  const finalizar = (novo: Desfecho): void => {
    contarPedido();
    desfecho = novo;
    mudou();
  };

  return {
    abriu: () => {
      if (abertoEm !== null) return;
      abertoEm = agora();
      mudou();
    },

    anuncio: (a) => {
      if (!emAndamento()) return;
      ultimoNoEm = agora();
      // Um segundo anuncio na mesma Conexao nao muda a conta ja feita (assumption 10 da spec).
      if (anunciados === null) {
        anunciados = a;
        teto = tetoDePedidos(a.total, c);
      }
      mudou();
    },

    no: (tipo) => {
      if (!emAndamento()) return;
      ultimoNoEm = agora();
      if (tipo === 'mensagem') recebidos.mensagens += 1;
      else if (tipo === 'notificacao') recebidos.notificacoes += 1;
      else if (tipo === 'recibo') recebidos.recibos += 1;
      else recebidos.chamadas += 1;
      mudou();
    },

    fim: () => {
      if (fimEm !== null) return;
      fimEm = agora();
      if (CORRIGIDOS_PELO_FIM_TARDIO.has(desfecho)) desfecho = 'recolheu';
      mudou();
    },

    falhaDeDecifra: () => {
      if (!emAndamento()) return;
      falhas = (falhas ?? 0) + 1;
      mudou();
    },

    envioFalhou: () => {
      if (!emAndamento()) return;
      falhouOEnvio = true;
      mudou();
    },

    fechou: () => {
      if (!emAndamento()) return;
      // O fim pode ter chegado depois do ultimo passo do relogio: a plataforma declarou, e isso vale.
      if (fimEm !== null) finalizar(pedidos > 0 ? 'recolheu' : 'fim-natural');
      else finalizar('encerrou-antes');
    },

    passo: (bufferAtivo) => {
      if (!emAndamento()) return undefined;
      const t = agora();
      if (fimEm !== null) {
        finalizar(pedidos > 0 ? 'recolheu' : 'fim-natural');
        return undefined;
      }
      if (falhouOEnvio) {
        finalizar('falha-de-envio');
        return undefined;
      }
      if (liberadoEm === null) {
        const assentou = anunciados !== null && t - ultimoNoEm >= c.silencioMs;
        const esgotou = t - criadoEm >= c.esperaDaParteInicialMs;
        if (!assentou && !esgotou) return undefined;
        liberadoEm = t;
        mudou();
        return bufferAtivo ? 'liberar' : undefined;
      }
      // Sem anuncio nao ha indicio de pendencia: nao ha o que pedir, e entao nao ha recolhimento nem prazo dele.
      if (anunciados === null) return undefined;
      if (t - liberadoEm >= c.prazoMs) {
        finalizar('prazo');
        return undefined;
      }
      if (t - Math.max(ultimoNoEm, ultimoPedidoEm) < c.silencioMs) return undefined;
      contarPedido();
      if (semResposta >= c.pedidosSemRespostaMax) {
        finalizar('sem-resposta');
        return undefined;
      }
      if (pedidos >= teto) {
        finalizar('teto');
        return undefined;
      }
      pedidos += 1;
      ultimoPedidoEm = t;
      nosNoUltimoPedido = nosTotais();
      pedidoSemContar = true;
      mudou();
      return 'pedir';
    },

    estado: () => ({
      socketCriadoEm: criadoEm,
      abertoEm,
      atualizadoEm: agora(),
      anunciados: anunciados === null ? null : { ...anunciados },
      recebidos: { ...recebidos },
      falhasDeDecifra: falhas,
      pedidos,
      nosPorPedido: [...nosPorPedido],
      liberadoEm,
      fimDeclaradoEm: fimEm,
      desfecho,
    }),

    versao: () => versao,
  };
}
