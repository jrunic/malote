import { once } from 'node:events';
import { closeSync, existsSync, openSync, renameSync, writeSync } from 'node:fs';
import type { Acervo } from '../nucleo/acervo.js';
import { autoresDaConversa } from '../nucleo/autores-da-conversa.js';
import { expandirData, fonteDaConversa, lerMensagens, type MensagemLida } from '../nucleo/consulta.js';
import type { CursorDePaginacao } from '../nucleo/cursor.js';
import { identificadoresDoRemetente } from '../nucleo/remetente.js';
import type { PrecedenciaDeNome } from '../registro/precedencia-de-nome.js';
import { pedirGet } from './cliente.js';
import { opcao } from './bandeiras.js';
import { MENSAGEM_SEM_INQUILINO_NA_REDE } from './sem-inquilino-na-rede.js';

/**
 * A pagina do export. 500 e a medida em que o custo foi tirado (0,45 s e 276 KB por pagina na
 * maior Conversa); o contrato nao depende do valor.
 */
export const LIMITE_DA_PAGINA = 500;

export interface PedidoDeExport {
  conversaId: string;
  formato: 'txt' | 'json';
  saida: string | undefined;
  sobrescrever: boolean;
  remetente: string | undefined;
  desde: string | undefined;
  ate: string | undefined;
}

/** Le e valida a linha de comando. Valor errado na linha de comando e erro de uso (codigo 2). */
export function lerPedidoDeExport(argumentos: string[]): { pedido: PedidoDeExport } | { erro: string } {
  const conversaId = opcao(argumentos, 'conversa');
  if (conversaId === undefined || conversaId === '') return { erro: 'Informe --conversa <id>.' };
  const formatoOpcao = opcao(argumentos, 'formato');
  const json = argumentos.includes('--json');
  if (formatoOpcao !== undefined && formatoOpcao !== 'txt' && formatoOpcao !== 'json') {
    return { erro: '--formato aceita txt ou json.' };
  }
  if (json && formatoOpcao === 'txt') return { erro: '--json e --formato txt se contradizem.' };
  const remetente = opcao(argumentos, 'remetente');
  if (remetente === '') return { erro: '--remetente precisa do valor do Identificador.' };
  const desde = opcao(argumentos, 'desde');
  const ate = opcao(argumentos, 'ate');
  try {
    if (desde !== undefined) expandirData(desde, 'inicio');
    if (ate !== undefined) expandirData(ate, 'fim');
  } catch (e) {
    return { erro: (e as Error).message };
  }
  return {
    pedido: {
      conversaId,
      formato: json || formatoOpcao === 'json' ? 'json' : 'txt',
      saida: opcao(argumentos, 'saida'),
      sobrescrever: argumentos.includes('--sobrescrever'),
      remetente,
      desde,
      ate,
    },
  };
}

/** A recusa de `--saida` que ja existe, ou `undefined`. O produto nao apaga nada com outro nome. */
export function conferirDestino(saida: string | undefined, sobrescrever: boolean): string | undefined {
  if (saida === undefined || sobrescrever || !existsSync(saida)) return undefined;
  return `${saida} ja existe. Escolha outro --saida, ou passe --sobrescrever.`;
}

export interface AutorDeExport {
  identificadorId: string;
  valor: string | null;
  nome: string | null;
}

export interface Exportador {
  acrescentar: (mensagens: MensagemLida[]) => void;
  /** Fecha o arquivo e o torna definitivo. */
  concluir: () => { mensagens: number };
  /** Fecha sem tornar definitivo; devolve o caminho do parcial, se ha arquivo. */
  falhar: () => string | undefined;
}

export interface ConfigDoExportador {
  formato: 'txt' | 'json';
  conversaId: string;
  filtros: Record<string, string>;
  exportadoEm: string;
  autores: AutorDeExport[];
  /** A saida padrao, quando nao ha `saida`. Uma linha por chamada. */
  escrever: (linha: string) => void;
  saida?: string;
}

const instante = (t: number): string => new Date(t).toISOString().slice(0, 19).replace('T', ' ');

function rotulo(m: MensagemLida, nomes: Map<string, AutorDeExport>): string {
  if (m.autorId === null) return '(sistema)';
  if (m.direcao === 'enviada') return 'Eu';
  const p = nomes.get(m.autorId);
  if (p === undefined) return '(remetente desconhecido)';
  return p.nome ?? p.valor ?? '(remetente desconhecido)';
}

function linhasDeTxt(m: MensagemLida, nomes: Map<string, AutorDeExport>): string[] {
  const texto = m.conteudo ?? '(sem texto)';
  const [primeira, ...resto] = texto.split('\n');
  const linhas = [`${instante(m.ocorridaEm)}  ${rotulo(m, nomes)}: ${primeira}`, ...resto.map((l) => `    ${l}`)];
  for (const a of m.anexos) {
    linhas.push(`    [${a.tipo} ${a.presenca} ${a.id}${a.nomeOriginal !== null ? ` ${a.nomeOriginal}` : ''}]`);
  }
  return linhas;
}

/**
 * O formatador e o arquivo parcial, UM so para os dois modos: o laco que busca as paginas e que
 * muda (assincrono por rede, sincrono local). Escreve linha a linha, sem juntar a Conversa em
 * memoria. Com `saida`, o arquivo nasce como `<saida>.parcial` e so vira `<saida>` em `concluir`.
 */
export function criarExportador(cfg: ConfigDoExportador): Exportador {
  const nomes = new Map(cfg.autores.map((p) => [p.identificadorId, p]));
  const parcial = cfg.saida === undefined ? undefined : `${cfg.saida}.parcial`;
  const fd = parcial === undefined ? undefined : openSync(parcial, 'w');
  const emitir = (linha: string): void => {
    if (fd !== undefined) writeSync(fd, `${linha}\n`);
    else cfg.escrever(linha);
  };
  let total = 0;
  if (cfg.formato === 'json') {
    emitir(
      `{"conversa":${JSON.stringify(cfg.conversaId)},"filtros":${JSON.stringify(cfg.filtros)},` +
        `"exportadoEm":${JSON.stringify(cfg.exportadoEm)},"mensagens":[`,
    );
  }
  return {
    acrescentar(mensagens) {
      for (const m of mensagens) {
        if (cfg.formato === 'json') emitir(`${total === 0 ? '' : ','}${JSON.stringify(m)}`);
        else for (const l of linhasDeTxt(m, nomes)) emitir(l);
        total += 1;
      }
    },
    concluir() {
      if (cfg.formato === 'json') emitir(']}');
      if (fd !== undefined && parcial !== undefined && cfg.saida !== undefined) {
        closeSync(fd);
        renameSync(parcial, cfg.saida);
      }
      return { mensagens: total };
    },
    falhar() {
      if (fd === undefined) return undefined;
      try {
        closeSync(fd);
      } catch {
        // ja fechado: o que interessa e dizer onde esta o parcial
      }
      return parcial;
    },
  };
}

/**
 * Os AUTORES da Conversa, e nao os participantes: medido numa Conversa de 101.527 Mensagens, 850 dos
 * 2.200 autores (39%, e 23% das Mensagens) nao constam de `participantes`. Quem escreveu tem nome.
 */
function autoresDaResposta(autores: AutorDeExport[]): AutorDeExport[] {
  return autores.map((a) => ({ identificadorId: a.identificadorId, valor: a.valor ?? null, nome: a.nome ?? null }));
}

function filtrosDoPedido(p: PedidoDeExport): Record<string, string> {
  return {
    ...(p.remetente !== undefined ? { remetente: p.remetente } : {}),
    ...(p.desde !== undefined ? { desde: p.desde } : {}),
    ...(p.ate !== undefined ? { ate: p.ate } : {}),
  };
}

export interface RedeDeExport {
  servidor: string;
  chave: string | undefined;
  /** Os dados: saida padrao quando nao ha `--saida`. */
  escrever: (t: string) => void;
  /** Diagnostico e erro: nunca a saida de dados. */
  erro: (t: string) => void;
  /**
   * Espera a saida padrao escoar. `console.log` ignora o retorno de `write()`, e num pipe lento a fila
   * cresceria sem limite — e o teto de 10 s de `encerrar` sairia 0 sobre uma saida cortada, que e
   * exatamente o que o criterio 10 diz que nunca acontece.
   */
  aguardarEscoamento: () => Promise<void>;
}

/** Espera o `drain` do fluxo quando o buffer dele esta cheio. Sem espera quando nao ha o que escoar. */
export async function esperarEscoamento(fluxo: NodeJS.WriteStream): Promise<void> {
  if (fluxo.writableNeedDrain) await once(fluxo, 'drain');
}

/**
 * `malote exportar` por REDE. Pagina `mensagens` da Conversa e manda `ordem=cronologica` em TODA
 * requisicao, inclusive as que levam cursor: o default da rota muda com o cursor (cronologica sem,
 * decrescente com), e uma pagina 1 ascendente seguida de uma 2 descendente repete e pula.
 */
export async function executarExportarRede(argumentos: string[], rede: RedeDeExport): Promise<number> {
  if (argumentos.includes('--inquilino')) {
    rede.erro(MENSAGEM_SEM_INQUILINO_NA_REDE);
    return 2;
  }
  const lido = lerPedidoDeExport(argumentos);
  if ('erro' in lido) {
    rede.erro(lido.erro);
    return 2;
  }
  const { pedido } = lido;
  if (rede.chave === undefined) {
    rede.erro('Informe MALOTE_CHAVE_DE_ACESSO: a Chave de Acesso e a identidade da consulta por rede.');
    return 2;
  }
  const recusa = conferirDestino(pedido.saida, pedido.sobrescrever);
  if (recusa !== undefined) {
    rede.erro(recusa);
    return 2;
  }
  let exportador: Exportador | undefined;
  try {
    const r = await pedirGet(rede.servidor, rede.chave, `/conversas/${pedido.conversaId}/autores`);
    const autores = autoresDaResposta((JSON.parse(r.corpo) as { autores: AutorDeExport[] }).autores);
    exportador = criarExportador({
      formato: pedido.formato,
      conversaId: pedido.conversaId,
      filtros: filtrosDoPedido(pedido),
      exportadoEm: new Date().toISOString(),
      autores,
      escrever: rede.escrever,
      ...(pedido.saida !== undefined ? { saida: pedido.saida } : {}),
    });
    let cursor: string | undefined;
    for (;;) {
      const q = new URLSearchParams({ limite: String(LIMITE_DA_PAGINA), ordem: 'cronologica' });
      if (pedido.remetente !== undefined) q.set('remetente', pedido.remetente);
      if (pedido.desde !== undefined) q.set('desde', pedido.desde);
      if (pedido.ate !== undefined) q.set('ate', pedido.ate);
      if (cursor !== undefined) q.set('antes', cursor);
      const p = await pedirGet(rede.servidor, rede.chave, `/conversas/${pedido.conversaId}/mensagens?${q.toString()}`);
      const pagina = JSON.parse(p.corpo) as { mensagens: MensagemLida[]; proximo?: string };
      exportador.acrescentar(pagina.mensagens);
      await rede.aguardarEscoamento();
      if (pagina.proximo === undefined) break;
      if (pagina.proximo === cursor) {
        throw new Error('O servidor devolveu o mesmo cursor duas vezes; parei para nao repetir para sempre.');
      }
      cursor = pagina.proximo;
    }
    const fim = exportador.concluir();
    if (pedido.saida !== undefined) rede.escrever(`Exportadas ${fim.mensagens} Mensagem(ns) para ${pedido.saida}.`);
    return 0;
  } catch (e) {
    const parcial = exportador?.falhar();
    rede.erro(`${(e as Error).message}${parcial !== undefined ? ` Arquivo parcial: ${parcial}` : ''}`);
    return (e as { codigoDeSaida?: number }).codigoDeSaida ?? 1;
  }
}

/** `malote exportar` LOCAL: o mesmo formatador, as paginas vindas direto do Acervo. */
export function executarExportarLocal(
  acervo: Acervo,
  precedencia: PrecedenciaDeNome,
  pedido: PedidoDeExport,
  saida: { escrever: (t: string) => void; erro: (t: string) => void },
  /** So o teste muda: uma fixture de 9 Mensagens nao atravessa a pagina de 500. */
  limiteDaPagina: number = LIMITE_DA_PAGINA,
): number {
  const recusa = conferirDestino(pedido.saida, pedido.sobrescrever);
  if (recusa !== undefined) {
    saida.erro(recusa);
    return 2;
  }
  const fonte = fonteDaConversa(acervo, pedido.conversaId);
  if (fonte === undefined) {
    saida.erro(`Conversa desconhecida: ${pedido.conversaId}`);
    return 2;
  }
  const autores = autoresDaResposta(autoresDaConversa(acervo, pedido.conversaId, precedencia));
  const autorIds =
    pedido.remetente === undefined ? undefined : identificadoresDoRemetente(acervo, { valor: pedido.remetente, fonte });
  const exportador = criarExportador({
    formato: pedido.formato,
    conversaId: pedido.conversaId,
    filtros: filtrosDoPedido(pedido),
    exportadoEm: new Date().toISOString(),
    autores,
    escrever: saida.escrever,
    ...(pedido.saida !== undefined ? { saida: pedido.saida } : {}),
  });
  try {
    // A guarda de cursor abaixo e cinto e suspensorio: o cursor sai da ultima Mensagem da pagina e a consulta o
    // exclui, entao ele sempre avanca. Mutante que sobrevive por EQUIVALENCIA: tirar a guarda nao muda resposta
    // alguma enquanto isso vale; ela so impede girar para sempre se um dia deixar de valer.
    let cursor: CursorDePaginacao | undefined;
    for (;;) {
      const mensagens = lerMensagens(acervo, {
        conversaId: pedido.conversaId,
        ordem: 'cronologica',
        limite: limiteDaPagina,
        ...(pedido.desde !== undefined ? { de: expandirData(pedido.desde, 'inicio') } : {}),
        ...(pedido.ate !== undefined ? { ate: expandirData(pedido.ate, 'fim') } : {}),
        ...(autorIds !== undefined ? { autorIds } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
      });
      exportador.acrescentar(mensagens);
      if (mensagens.length < limiteDaPagina) break;
      const ultima = mensagens[mensagens.length - 1]!;
      if (cursor !== undefined && cursor.id === ultima.id && cursor.ocorridaEm === ultima.ocorridaEm) {
        throw new Error('O cursor nao avancou; parei para nao repetir para sempre.');
      }
      cursor = { ocorridaEm: ultima.ocorridaEm, id: ultima.id };
    }
    const fim = exportador.concluir();
    if (pedido.saida !== undefined) saida.escrever(`Exportadas ${fim.mensagens} Mensagem(ns) para ${pedido.saida}.`);
    return 0;
  } catch (e) {
    const parcial = exportador.falhar();
    saida.erro(`${(e as Error).message}${parcial !== undefined ? ` Arquivo parcial: ${parcial}` : ''}`);
    return 1;
  }
}
