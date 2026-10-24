// src/adaptadores/whatsapp/pendentes-na-conexao.ts
import {
  CONSTANTES_PADRAO,
  criarRecolhedor,
  lerAnunciados,
  type ConstantesDoRecolhimento,
  type EstadoDosPendentes,
  type NoDoTransporte,
  type Recolhedor,
} from './pendentes.js';

/**
 * A FRONTEIRA FINA ENTRE O RECOLHEDOR E A BIBLIOTECA (#1151).
 *
 * O recolhedor (`pendentes.ts`) decide; aqui se executa. Este e o unico lugar que fala o vocabulario
 * da biblioteca para os Pendentes: assina os nos do transporte, libera o buffer inicial e envia o
 * pedido de mais Pendentes. Nao importa a biblioteca (o portao e `conexao.ts`): recebe o socket.
 *
 * Superficie que o socket precisa ter, toda ela exportada pela biblioteca: enviar no (`sendNode`),
 * perguntar e liberar o buffer (`ev.isBuffering`, `ev.flush`) e ouvir o transporte (`ws.on`). Faltando
 * qualquer uma, o modulo fica INERTE e a Conexao sobe e funciona como antes: a subida nunca recusa. O
 * que esta fora do contrato publico e so o CONTEUDO do no do pedido.
 */

export interface SocketDePendentes {
  ws?: { on?: (evento: string, ouvinte: (no: NoDoTransporte) => void) => unknown };
  sendNode?: (frame: unknown) => unknown;
  ev: {
    on: (fluxo: string, ouvinte: (dado: never) => void) => unknown;
    isBuffering?: () => boolean;
    flush?: () => boolean;
  };
}

export interface EventoDePendentes {
  tipo: 'abertura' | 'anuncio' | 'progresso' | 'final';
  estado: EstadoDosPendentes;
}

export interface OpcoesDePendentes {
  agora: () => number;
  aoPendentes: (evento: EventoDePendentes) => void;
  /** `true` quando o logger do socket foi embrulhado por `observarLogger`. */
  contaFalhasDeDecifra: boolean;
  constantes?: Partial<ConstantesDoRecolhimento>;
  /** De quanto em quanto o relogio do recolhedor anda. */
  passoMs?: number;
}

export interface PendentesLigados {
  /** Para o relogio. O que estava em andamento termina como `encerrou-antes`. Idempotente. */
  encerrar: () => void;
  falhaDeDecifra: () => void;
}

export const PASSO_PADRAO_MS = 1_000;

/** O pedido de mais Pendentes: o mesmo no que a biblioteca envia uma vez so, com 100 itens. */
export function pedidoDePendentes(itens: number): unknown {
  return {
    tag: 'ib',
    attrs: {},
    content: [{ tag: 'offline_batch', attrs: { count: String(itens) } }],
  };
}

/** `true` quando o socket tem tudo o que o recolhimento usa. */
export function temASuperficie(sock: SocketDePendentes): boolean {
  return (
    typeof sock.ws?.on === 'function' &&
    typeof sock.sendNode === 'function' &&
    typeof sock.ev.isBuffering === 'function' &&
    typeof sock.ev.flush === 'function'
  );
}

export function ligarPendentes(
  sock: SocketDePendentes,
  opcoes: OpcoesDePendentes,
): PendentesLigados | undefined {
  if (!temASuperficie(sock)) return undefined;
  const ws = sock.ws as { on: (evento: string, ouvinte: (no: NoDoTransporte) => void) => unknown };
  const sendNode = sock.sendNode as (frame: unknown) => unknown;
  const isBuffering = sock.ev.isBuffering as () => boolean;
  const flush = sock.ev.flush as () => boolean;

  const recolhedor: Recolhedor = criarRecolhedor({
    agora: opcoes.agora,
    ...(opcoes.constantes !== undefined ? { constantes: opcoes.constantes } : {}),
    contaFalhasDeDecifra: opcoes.contaFalhasDeDecifra,
  });
  const itens = opcoes.constantes?.itensPorPedido ?? CONSTANTES_PADRAO.itensPorPedido;

  // O consumidor nunca custa Mensagem: excecao do gancho e engolida.
  const emitir = (tipo: EventoDePendentes['tipo']): void => {
    try {
      opcoes.aoPendentes({ tipo, estado: recolhedor.estado() });
    } catch {
      // Gravar o estado e observacao: estourar aqui nao pode custar a recepcao.
    }
  };

  let versaoEmitida = -1;
  let finalEmitido = false;
  const emitirSeMudou = (): void => {
    const v = recolhedor.versao();
    if (v === versaoEmitida) return;
    versaoEmitida = v;
    const final = recolhedor.estado().desfecho !== 'em-andamento';
    if (final) {
      finalEmitido = true;
      emitir('final');
    } else {
      emitir('progresso');
    }
  };

  let encerrado = false;
  let relogio: NodeJS.Timeout | undefined;
  const parar = (): void => {
    if (relogio !== undefined) clearInterval(relogio);
    relogio = undefined;
  };

  // No que chega: so conta. O estado sai a cada passo do relogio, e nao a cada no (sao milhares).
  const contar = (f: () => void): (() => void) => {
    return (): void => {
      if (encerrado) return;
      f();
    };
  };

  ws.on('CB:ib,,offline_preview', (no) => {
    if (encerrado) return;
    const anunciados = lerAnunciados(no);
    if (anunciados === null) return;
    recolhedor.anuncio(anunciados);
    versaoEmitida = recolhedor.versao();
    emitir('anuncio');
  });
  ws.on(
    'CB:message',
    contar(() => recolhedor.no('mensagem')),
  );
  ws.on(
    'CB:notification',
    contar(() => recolhedor.no('notificacao')),
  );
  ws.on(
    'CB:receipt',
    contar(() => recolhedor.no('recibo')),
  );
  ws.on(
    'CB:call',
    contar(() => recolhedor.no('chamada')),
  );

  sock.ev.on('connection.update', ((u: {
    connection?: string;
    receivedPendingNotifications?: boolean;
  }) => {
    if (encerrado) return;
    if (u.connection === 'open') recolhedor.abriu();
    if (u.receivedPendingNotifications === true) recolhedor.fim();
    if (u.connection === 'close') {
      recolhedor.fechou();
      parar();
    }
    emitirSeMudou();
  }) as (dado: never) => void);

  const passo = (): void => {
    if (encerrado) return;
    let bufferAtivo: boolean;
    try {
      bufferAtivo = isBuffering();
    } catch {
      bufferAtivo = false;
    }
    const acao = recolhedor.passo(bufferAtivo);
    if (acao === 'liberar') {
      try {
        flush();
      } catch {
        // Liberar o buffer e melhor esforco; a proxima Conexao tenta de novo.
      }
    } else if (acao === 'pedir') {
      try {
        Promise.resolve(sendNode(pedidoDePendentes(itens))).catch(() => {
          recolhedor.envioFalhou();
        });
      } catch {
        recolhedor.envioFalhou();
      }
    }
    emitirSeMudou();
    if (finalEmitido) parar();
  };

  relogio = setInterval(passo, opcoes.passoMs ?? PASSO_PADRAO_MS);
  // O relogio nao pode manter o processo vivo: quem decide terminar e o ouvir.
  relogio.unref();
  emitir('abertura');
  versaoEmitida = recolhedor.versao();

  return {
    encerrar: () => {
      if (encerrado) return;
      encerrado = true;
      parar();
      const antes = recolhedor.versao();
      recolhedor.fechou();
      if (recolhedor.versao() !== antes) emitir('final');
    },
    falhaDeDecifra: () => {
      if (encerrado) return;
      recolhedor.falhaDeDecifra();
      emitirSeMudou();
    },
  };
}

const MENSAGEM_DE_FALHA_DE_DECIFRA = 'failed to decrypt message';

/**
 * Embrulha o logger da biblioteca para CONTAR as falhas de decifra (so o numero: nenhum argumento da
 * chamada, que traz a chave com JID, e guardado). Tudo o mais passa intacto, inclusive os filhos
 * (`child`). Devolve `undefined` quando nao ha logger para embrulhar, e quem chama nao passa nenhum:
 * o socket usa o dele, e as falhas ficam INDISPONIVEIS no estado.
 */
export function observarLogger(base: unknown, aoFalhaDeDecifra: () => void): object | undefined {
  if (base === null || typeof base !== 'object') return undefined;
  const envolver = (alvo: object): object =>
    new Proxy(alvo, {
      get(a, propriedade) {
        const valor: unknown = Reflect.get(a, propriedade, a);
        if (typeof valor !== 'function') return valor;
        const funcao = valor as (...args: unknown[]) => unknown;
        if (propriedade === 'error') {
          return (...args: unknown[]): unknown => {
            if (args.includes(MENSAGEM_DE_FALHA_DE_DECIFRA)) {
              try {
                aoFalhaDeDecifra();
              } catch {
                // Contar e observacao: nunca custa o log.
              }
            }
            return funcao.apply(a, args);
          };
        }
        if (propriedade === 'child') {
          return (...args: unknown[]): unknown => {
            const filho = funcao.apply(a, args);
            return filho !== null && typeof filho === 'object' ? envolver(filho) : filho;
          };
        }
        return funcao.bind(a);
      },
    });
  return envolver(base);
}
