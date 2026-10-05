import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * O que a thread principal manda ao worker. So o que ja foi VERIFICADO: o worker nunca ve a Chave, so o
 * `chaveId` e o `inquilinoId` que a verificacao devolveu.
 */
export interface PedidoDeLeitura {
  metodo: string;
  /** Caminho e query, como veio. */
  url: string;
  chaveId: string;
  inquilinoId: string;
  /** A raiz de dados da instalacao. */
  dados: string;
  /** SO PARA TESTE: o que a thread principal decidiu que este pedido faz de estranho. */
  instrucao?: InstrucaoDeTeste;
}

/** Serializavel de proposito: funcao nao atravessa para o worker. Producao nunca a define. */
export interface InstrucaoDeTeste {
  /** Bloqueia a THREAD por N ms, como o SQLite sincrono — `setTimeout` cederia o laco e esconderia o defeito. */
  dormirMs?: number;
  lancar?: string;
  /** Escreve o cabecalho e DEPOIS lanca: a resposta nao pode sair pela metade. */
  lancarDepoisDoCabecalho?: string;
  /**
   * Mata o worker. Implementada na CASCA como excecao nao capturada, e nao com `process.exit`: a varredura da #1125
   * (`sem-exit-direto`) proibe `process.exit` em todo `src/`, e a excecao nao capturada termina o worker do mesmo jeito.
   */
  sair?: boolean;
}

export interface RespostaDeLeitura {
  status: number;
  cabecalhos: Record<string, string>;
  corpo: string | Uint8Array;
}

export type MensagemDoTrabalhador =
  | { pronto: true }
  | { id: number; resposta: RespostaDeLeitura }
  | { id: number; erro: string };

/**
 * O corpo binario como um `Uint8Array` que e DONO do `ArrayBuffer` inteiro — a condicao para transferi-lo pelo
 * `postMessage` sem copia. `readFileSync` de arquivo grande ja devolve um Buffer assim (ArrayBuffer proprio, offset 0):
 * esse passa direto, e o `GET /midia` de um documento de 890 MB nao vira 4 copias. Buffer do pool interno do Node (arquivo
 * pequeno) e fatia de ArrayBuffer maior nao podem ser transferidos inteiros, e esses SAO copiados.
 */
function corpoBinario(dado: Uint8Array): Uint8Array {
  // `byteLength` igual ao do ArrayBuffer ja implica `byteOffset` 0: uma condicao so (o mutante que tira `byteOffset === 0` era equivalente)
  if (dado.buffer instanceof ArrayBuffer && dado.byteLength === dado.buffer.byteLength) {
    return new Uint8Array(dado.buffer, 0, dado.byteLength);
  }
  return new Uint8Array(dado);
}

/** A lista de transferencia do `postMessage`: o `ArrayBuffer` do corpo binario (sempre inteiro, ver `corpoBinario`). */
export function transferiveis(resposta: RespostaDeLeitura): ArrayBuffer[] {
  return typeof resposta.corpo === 'string' ? [] : [resposta.corpo.buffer as ArrayBuffer];
}

function proibido(objeto: string, membro: string | symbol): never {
  throw new Error(
    `rota de leitura usou ${objeto}.${String(membro)}, que o worker nao oferece ` +
      '(o contrato e method/url no req e writeHead/end/headersSent no res)',
  );
}

/**
 * O `req` que o worker entrega a `responder`: so `method` e `url`. Qualquer outro membro LANCA — rota `GET` nova
 * que use `req.headers` ou `req.on` falha alto no proprio teste, em vez de quebrar so em producao. (Uma varredura
 * estatica de `rotas.ts` nao separaria as rotas `GET` dos ajudantes de `POST` do mesmo arquivo.)
 */
export function criarReqDeLeitura(pedido: PedidoDeLeitura): IncomingMessage {
  const oferecido: Record<string, unknown> = { method: pedido.metodo, url: pedido.url };
  return new Proxy({} as IncomingMessage, {
    get(_alvo, membro) {
      if (typeof membro === 'symbol') return undefined;
      if (membro in oferecido) return oferecido[membro];
      return proibido('req', membro);
    },
    set(_alvo, membro) {
      return proibido('req', membro);
    },
  });
}

/**
 * O `res` do worker: captura `writeHead` e `end`, expoe `headersSent`, e LANCA em qualquer outro membro. O corpo em
 * Buffer e COPIADO: `readFileSync` de arquivo pequeno devolve um Buffer do pool interno do Node, e transferir o
 * `ArrayBuffer` dele o quebraria.
 */
export function criarResDeLeitura(): { res: ServerResponse; capturar: () => RespostaDeLeitura | undefined } {
  let status = 200;
  let cabecalhos: Record<string, string> = {};
  let cabecalhoEscrito = false;
  let corpo: string | Uint8Array | undefined;

  const res = new Proxy({} as ServerResponse, {
    get(_alvo, membro) {
      if (typeof membro === 'symbol') return undefined;
      if (membro === 'writeHead') {
        return (codigo: number, c?: Record<string, string>) => {
          status = codigo;
          cabecalhos = { ...(c ?? {}) };
          cabecalhoEscrito = true;
        };
      }
      if (membro === 'end') {
        return (dado?: string | Uint8Array) => {
          if (corpo !== undefined) return;
          corpo = typeof dado === 'string' ? dado : dado === undefined ? '' : corpoBinario(dado);
        };
      }
      if (membro === 'headersSent') return cabecalhoEscrito;
      return proibido('res', membro);
    },
    set(_alvo, membro) {
      return proibido('res', membro);
    },
  });

  return { res, capturar: () => (corpo === undefined ? undefined : { status, cabecalhos, corpo }) };
}
