import { Worker } from 'node:worker_threads';
import type { MensagemDoTrabalhador, PedidoDeLeitura, RespostaDeLeitura } from './contrato-da-leitura.js';

export interface OpcoesDoDespachante {
  trabalhadores: number;
  /** Desde a CHEGADA do pedido, incluindo a espera na fila. */
  prazoMs: number;
  /** Pedidos esperando; acima disso, `fila-cheia`. */
  filaMaxima: number;
  /** SO O TESTE muda: outro arquivo, inexistente, para provar que a subida falha sem laco. */
  arquivoDoTrabalhador?: URL;
  /** Uma linha de log (stderr em producao). */
  aoLogar?: (linha: string) => void;
  /** Leitura mais lenta que isto escreve uma linha. */
  limiarDeLogMs?: number;
  /** Pedidos de UM Inquilino esperando; acima disso, `fila-cheia` so para ele (padrao: metade de `filaMaxima`, no minimo 1). */
  filaPorInquilino?: number;
}

export type ResultadoDoDespacho =
  | { tipo: 'resposta'; resposta: RespostaDeLeitura }
  | { tipo: 'prazo' }
  | { tipo: 'fila-cheia' }
  | { tipo: 'abandonado' }
  | { tipo: 'erro'; mensagem: string }
  | { tipo: 'indisponivel' };

interface Slot {
  worker: Worker;
  atual: Item | null;
  /** A casca postou `pronto`: os imports resolveram. Antes disso, morrer e falha de SUBIDA. */
  pronto: boolean;
  morto: boolean;
  /** Quem espera o `pronto` (o `aquecer`). */
  aoPronto?: (() => void) | undefined;
}

interface Item {
  id: number;
  pedido: PedidoDeLeitura;
  chegouEm: number;
  resolver: (r: ResultadoDoDespacho) => void;
  relogio: NodeJS.Timeout;
  abandono: AbortSignal;
  aoAbandonar: () => void;
  slot: Slot | null;
  concluido: boolean;
  falhasDeSubida: number;
}

const extensao = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
const TRABALHADOR_PADRAO = new URL(`./trabalhador-de-leitura${extensao}`, import.meta.url);

/**
 * O pool de leituras. A thread principal despacha e o worker le: uma consulta lenta ocupa UM worker, nao o
 * servidor. Cinco garantias (ver a spec do ciclo 32): isolamento, prazo duro (`terminate`, medido em 2 ms mesmo com
 * a thread presa num laco sincrono), abandono, reserva (um Inquilino ocupa no maximo N-1, para sempre sobrar um
 * worker aos outros) e contencao da falha.
 */
export class DespachanteDeLeituras {
  // Na fase vermelha do Task 3, confirmar que `new Worker(urlInexistente)` EMITE `error` e `exit` e nao lanca sincrono
  // no construtor; se lancar, `criarSlot` envolve o `new Worker` em `try` e trata como falha de subida.
  private readonly slots: Slot[] = [];
  private readonly fila: Item[] = [];
  private proximoId = 1;
  private parando = false;

  constructor(private readonly opcoes: OpcoesDoDespachante) {}

  get vivos(): number {
    return this.slots.length;
  }
  get ocupados(): number {
    return this.slots.filter((s) => s.atual !== null).length;
  }
  get naFila(): number {
    return this.fila.length;
  }

  executar(pedido: PedidoDeLeitura, abandono: AbortSignal): Promise<ResultadoDoDespacho> {
    return new Promise((resolver) => {
      if (this.parando) return resolver({ tipo: 'indisponivel' });
      if (abandono.aborted) return resolver({ tipo: 'abandonado' });
      const item: Item = {
        id: this.proximoId++,
        pedido,
        chegouEm: Date.now(),
        resolver,
        relogio: setTimeout(() => this.concluir(item, { tipo: 'prazo' }), this.opcoes.prazoMs),
        abandono,
        aoAbandonar: () => this.concluir(item, { tipo: 'abandonado' }),
        slot: null,
        concluido: false,
        falhasDeSubida: 0,
      };
      abandono.addEventListener('abort', item.aoAbandonar, { once: true });
      this.fila.push(item);
      this.despachar();
      if (!item.concluido && item.slot === null) {
        const doInquilino = this.fila.filter((f) => f.pedido.inquilinoId === pedido.inquilinoId).length;
        const tetoDoInquilino = this.opcoes.filaPorInquilino ?? Math.max(1, Math.floor(this.opcoes.filaMaxima / 2));
        if (this.fila.length > this.opcoes.filaMaxima || doInquilino > tetoDoInquilino) {
          this.concluir(item, { tipo: 'fila-cheia' });
        }
      }
    });
  }

  /**
   * Sobe um worker e espera o `pronto` (os imports resolveram). `false` se nao ficar pronto em `ateMs`: o `servir`
   * recusa subir, em vez de aceitar pedidos que todos viram 503. O worker aquecido fica ocioso e e reusado.
   * SO ANTES de aceitar pedidos: no timeout ele mata o slot sem olhar `atual`, o que, com pedido em andamento,
   * deixaria o item orfao ate o prazo.
   */
  aquecer(ateMs: number): Promise<boolean> {
    if (this.parando) return Promise.resolve(false);
    const slot = this.slots.find((s) => !s.morto) ?? this.criarSlot();
    if (slot.pronto) return Promise.resolve(true);
    return new Promise((resolver) => {
      const limite = setTimeout(() => {
        slot.aoPronto = undefined;
        // Mutante equivalente declarado (matar sempre): `aquecer` so roda antes de aceitar pedidos, quando `atual` e sempre null.
        if (slot.atual === null) this.matar(slot);
        resolver(false);
      }, ateMs);
      slot.aoPronto = () => {
        clearTimeout(limite);
        resolver(true);
      };
      slot.worker.once('exit', () => {
        clearTimeout(limite);
        resolver(false);
      });
    });
  }

  /** Para de aceitar, espera as leituras em andamento por `esperaMs`, e termina tudo. */
  async parar(esperaMs: number): Promise<void> {
    this.parando = true;
    for (const item of [...this.fila]) this.concluir(item, { tipo: 'indisponivel' });
    const limite = Date.now() + esperaMs;
    while (this.slots.some((s) => s.atual !== null) && Date.now() < limite) {
      await new Promise((r) => setTimeout(r, 25));
    }
    for (const slot of [...this.slots]) {
      const item = slot.atual;
      slot.atual = null;
      if (item !== null) this.concluir(item, { tipo: 'indisponivel' });
      this.matar(slot);
    }
  }

  // --- internos ---

  private tetoPorInquilino(): number {
    return Math.max(1, this.opcoes.trabalhadores - 1);
  }

  /** O primeiro pedido elegivel: o de quem esta abaixo do teto, e entre eles o de quem MENOS workers ocupa. */
  private proximoElegivel(): Item | undefined {
    const ocupadosPor = new Map<string, number>();
    for (const s of this.slots) {
      if (s.atual !== null) {
        const inq = s.atual.pedido.inquilinoId;
        ocupadosPor.set(inq, (ocupadosPor.get(inq) ?? 0) + 1);
      }
    }
    let melhor: Item | undefined;
    let melhorOcupados = Infinity;
    for (const item of this.fila) {
      const ocupados = ocupadosPor.get(item.pedido.inquilinoId) ?? 0;
      if (ocupados >= this.tetoPorInquilino()) continue;
      if (ocupados < melhorOcupados) {
        melhor = item;
        melhorOcupados = ocupados;
      }
    }
    return melhor;
  }

  private slotLivre(): Slot | undefined {
    if (this.parando) return undefined;
    const ocioso = this.slots.find((s) => s.atual === null && !s.morto);
    if (ocioso !== undefined) return ocioso;
    if (this.slots.length < this.opcoes.trabalhadores) return this.criarSlot();
    return undefined;
  }

  private criarSlot(): Slot {
    // `--test` no execArgv faria o worker rodar a casca como arquivo de teste. Medido: sob `node --test` o execArgv
    // e so ['--import','tsx'], e o filtro e defensivo.
    const worker = new Worker(this.opcoes.arquivoDoTrabalhador ?? TRABALHADOR_PADRAO, {
      execArgv: process.execArgv.filter((a) => !a.startsWith('--test')),
    });
    worker.unref(); // o laco do servidor e quem segura o processo vivo, nao o pool
    const slot: Slot = { worker, atual: null, pronto: false, morto: false };
    worker.on('message', (m: MensagemDoTrabalhador) => this.aoMensagem(slot, m));
    worker.on('error', (e) => this.aoMorrer(slot, e instanceof Error ? e.message : String(e)));
    worker.on('exit', () => this.aoMorrer(slot, 'o trabalhador terminou'));
    this.slots.push(slot);
    return slot;
  }

  private despachar(): void {
    if (this.parando) return;
    for (;;) {
      const item = this.proximoElegivel();
      if (item === undefined) return;
      const slot = this.slotLivre();
      if (slot === undefined) return;
      this.fila.splice(this.fila.indexOf(item), 1);
      slot.atual = item;
      item.slot = slot;
      slot.worker.postMessage({ id: item.id, pedido: item.pedido });
    }
  }

  private aoMensagem(slot: Slot, m: MensagemDoTrabalhador): void {
    if ('pronto' in m) {
      slot.pronto = true;
      slot.aoPronto?.();
      return;
    }
    const item = slot.atual;
    // Mutante equivalente declarado (remover a comparacao de `id`): um slot so recebe um pedido por vez, e o pedido que
    // conclui por prazo ou abandono MATA o slot (`terminate` descarta a mensagem tardia). Uma resposta de id diferente
    // do `atual` nao chega de um worker vivo; a comparacao e defesa, nao comportamento observavel.
    if (item === null || item.id !== m.id) return;
    slot.atual = null;
    this.concluir(item, 'resposta' in m ? { tipo: 'resposta', resposta: m.resposta } : { tipo: 'erro', mensagem: m.erro });
  }

  private aoMorrer(slot: Slot, motivo: string): void {
    if (slot.morto) return;
    slot.morto = true;
    const i = this.slots.indexOf(slot);
    if (i >= 0) this.slots.splice(i, 1);
    const item = slot.atual;
    slot.atual = null;
    if (item !== null && !item.concluido) {
      if (!slot.pronto && item.falhasDeSubida < 1) {
        // falhou ao SUBIR: uma nova tentativa, na frente da fila; na segunda, indisponivel (sem laco)
        item.falhasDeSubida += 1;
        item.slot = null;
        this.fila.unshift(item);
      } else if (!slot.pronto) {
        this.concluir(item, { tipo: 'indisponivel' });
      } else {
        this.concluir(item, { tipo: 'erro', mensagem: motivo });
      }
    }
    this.despachar();
  }

  private matar(slot: Slot): void {
    if (slot.morto) return;
    slot.morto = true;
    const i = this.slots.indexOf(slot);
    if (i >= 0) this.slots.splice(i, 1);
    void slot.worker.terminate();
  }

  private concluir(item: Item, resultado: ResultadoDoDespacho): void {
    if (item.concluido) return;
    item.concluido = true;
    clearTimeout(item.relogio);
    item.abandono.removeEventListener('abort', item.aoAbandonar);
    const naFila = this.fila.indexOf(item);
    if (naFila >= 0) this.fila.splice(naFila, 1);
    if ((resultado.tipo === 'prazo' || resultado.tipo === 'abandonado') && item.slot !== null && item.slot.atual === item) {
      item.slot.atual = null;
      this.matar(item.slot);
    }
    const decorrido = Date.now() - item.chegouEm;
    const caminho = item.pedido.url.split('?')[0];
    if (resultado.tipo === 'prazo') {
      this.opcoes.aoLogar?.(`[leitura] prazo estourado: ${item.pedido.metodo} ${caminho} (${(this.opcoes.prazoMs / 1000).toFixed(0)} s)`);
    } else if (decorrido > (this.opcoes.limiarDeLogMs ?? 2000) && (resultado.tipo === 'resposta' || resultado.tipo === 'erro')) {
      this.opcoes.aoLogar?.(`[leitura] lenta: ${item.pedido.metodo} ${caminho} ${(decorrido / 1000).toFixed(1)} s`);
    }
    item.resolver(resultado);
    this.despachar();
  }
}
