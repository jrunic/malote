// src/cli/estado-dos-pendentes.ts
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type {
  Anunciados,
  Desfecho,
  EstadoDosPendentes,
} from '../adaptadores/whatsapp/pendentes.js';

/**
 * O ESTADO DOS PENDENTES DA PLATAFORMA DA ULTIMA CONEXAO (#1151).
 *
 * Fica em arquivo, ao lado do `ultimo-evento` e do sinal da Conexao, e `ouvinte estado --json` o le
 * sem abrir o Acervo. So TIPOS e NUMEROS: nenhum JID, id de Mensagem ou conteudo. Quem alarma
 * "Conexao aberta sem fim declarado" e a frota; o produto mede e nao decide limiar.
 *
 * COMO LER, e isto e parte do contrato: `em-andamento` com `atualizadoEm` velho e o sinal da Conexao
 * (`ultimoSinalDaConexao`) tambem parado e PROCESSO MORTO, nao Pendentes presos. Ausente ou ilegivel e
 * `null` (indisponivel), nunca "sem pendentes".
 *
 * MORA em `src/cli/`, e nao sob `adaptadores/`, porque quem decide onde o arquivo cai e quem monta a
 * instalacao. A escrita e por troca atomica, porque o arquivo e lido de fora.
 */
export const INTERVALO_DO_ESTADO_DOS_PENDENTES_MS = 5_000;

const DESFECHOS: ReadonlySet<string> = new Set<Desfecho>([
  'em-andamento',
  'fim-natural',
  'recolheu',
  'sem-resposta',
  'teto',
  'prazo',
  'falha-de-envio',
  'encerrou-antes',
]);

/** Grava o estado por troca atomica: quem le ve o arquivo antigo inteiro ou o novo inteiro. */
export function gravarEstadoDosPendentes(caminho: string, estado: EstadoDosPendentes): void {
  const parcial = `${caminho}.parcial`;
  writeFileSync(parcial, `${JSON.stringify(estado)}\n`);
  renameSync(parcial, caminho);
}

const ehInteiro = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0;
const ehInteiroOuNulo = (v: unknown): v is number | null => v === null || ehInteiro(v);

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * O estado gravado, ou `null`: arquivo ausente, JSON ilegivel ou forma que nao e a do contrato.
 *
 * Devolve um objeto RECONSTRUIDO, so com os campos do contrato: chave desconhecida no arquivo (um texto
 * plantado, um identificador) nao passa para o `--json`, que e o que a frota le. Contagens e instantes
 * tem de ser inteiros nao negativos.
 */
export function lerEstadoDosPendentes(caminho: string): EstadoDosPendentes | null {
  let lido: unknown;
  try {
    lido = JSON.parse(readFileSync(caminho, 'utf8'));
  } catch {
    return null;
  }
  const e = objeto(lido);
  if (e === null) return null;
  const r = objeto(e['recebidos']);
  const anunciadosBruto = e['anunciados'];
  const a = anunciadosBruto === null ? null : objeto(anunciadosBruto);
  if (r === null || (anunciadosBruto !== null && a === null)) return null;

  let anunciados: Anunciados | null = null;
  if (a !== null) {
    const { total, mensagens, recibos, notificacoes, status, chamadas, outros } = a;
    if (
      !ehInteiro(total) ||
      !ehInteiro(mensagens) ||
      !ehInteiro(recibos) ||
      !ehInteiro(notificacoes) ||
      !ehInteiro(status) ||
      !ehInteiro(chamadas) ||
      !ehInteiro(outros)
    ) {
      return null;
    }
    anunciados = { total, mensagens, recibos, notificacoes, status, chamadas, outros };
  }
  const { mensagens, notificacoes, recibos, chamadas } = r;
  if (
    !ehInteiro(mensagens) ||
    !ehInteiro(notificacoes) ||
    !ehInteiro(recibos) ||
    !ehInteiro(chamadas)
  ) {
    return null;
  }
  const nos = e['nosPorPedido'];
  if (!Array.isArray(nos) || !nos.every(ehInteiro)) return null;
  const { desfecho, socketCriadoEm, atualizadoEm, pedidos, abertoEm, liberadoEm, fimDeclaradoEm } =
    e;
  if (typeof desfecho !== 'string' || !DESFECHOS.has(desfecho)) return null;
  if (!ehInteiro(socketCriadoEm) || !ehInteiro(atualizadoEm) || !ehInteiro(pedidos)) return null;
  if (
    !ehInteiroOuNulo(abertoEm) ||
    !ehInteiroOuNulo(liberadoEm) ||
    !ehInteiroOuNulo(fimDeclaradoEm)
  ) {
    return null;
  }
  const falhasDeDecifra = e['falhasDeDecifra'];
  if (!ehInteiroOuNulo(falhasDeDecifra)) return null;
  return {
    socketCriadoEm,
    abertoEm,
    atualizadoEm,
    anunciados,
    recebidos: { mensagens, notificacoes, recibos, chamadas },
    falhasDeDecifra,
    pedidos,
    nosPorPedido: [...nos],
    liberadoEm,
    fimDeclaradoEm,
    desfecho: desfecho as Desfecho,
  };
}

let falhasNoProcesso = 0;

/** Quantas vezes gravar o estado falhou NESTE processo. Em memoria, de proposito: o destino que falhou e o mesmo que o guardaria. */
export function falhasDoEstadoDosPendentes(): number {
  return falhasNoProcesso;
}

/**
 * Devolve a funcao que o gancho dos Pendentes chama. Grava no maximo uma vez por `intervaloMs`, EXCETO o
 * evento final, que grava sempre: e o que fica no arquivo depois da Conexao. A janela conta da TENTATIVA,
 * nao do sucesso, para que um disco que falha nao leve uma tentativa por evento. Falha nunca propaga: vira
 * contagem e UM aviso, so com o codigo do erro (a mensagem de sistema carrega caminho).
 */
export function criarGravadorDosPendentes(opcoes: {
  caminho: string;
  agora: () => number;
  avisar: (texto: string) => void;
  intervaloMs?: number;
}): (estado: EstadoDosPendentes, final: boolean) => void {
  const intervalo = opcoes.intervaloMs ?? INTERVALO_DO_ESTADO_DOS_PENDENTES_MS;
  let ultimaTentativa = Number.NEGATIVE_INFINITY;
  let avisou = false;
  return (estado, final): void => {
    const t = opcoes.agora();
    // `t >= ultimaTentativa`: relogio que volta para tras nao pode congelar o estado.
    if (!final && t >= ultimaTentativa && t - ultimaTentativa < intervalo) return;
    ultimaTentativa = t;
    try {
      gravarEstadoDosPendentes(opcoes.caminho, estado);
    } catch (erro) {
      falhasNoProcesso += 1;
      if (avisou) return;
      avisou = true;
      const codigo = (erro as NodeJS.ErrnoException).code ?? 'erro';
      opcoes.avisar(
        `[ouvinte] estado dos pendentes: falha ao gravar (${codigo}); a recepcao segue`,
      );
    }
  };
}

/** A linha do anuncio: so tipos e numeros. */
export function linhaDoAnuncio(estado: EstadoDosPendentes): string {
  const a = estado.anunciados;
  if (a === null) return '[ouvinte] pendentes anunciados: sem anuncio';
  return (
    `[ouvinte] pendentes anunciados: ${a.total} (mensagens ${a.mensagens}, recibos ${a.recibos}, ` +
    `notificacoes ${a.notificacoes}, status ${a.status}, chamadas ${a.chamadas}, outros ${a.outros})`
  );
}

const ENTRADAS_NA_LINHA = 10;

/** A linha de resumo de cada Conexao: so tipos e numeros, nunca JID nem conteudo. */
export function linhaDeResumo(estado: EstadoDosPendentes): string {
  const r = estado.recebidos;
  const lotes = estado.nosPorPedido;
  const mostrados = lotes.slice(0, ENTRADAS_NA_LINHA).join(',');
  const resto = lotes.length > ENTRADAS_NA_LINHA ? `,+${lotes.length - ENTRADAS_NA_LINHA}` : '';
  const duracao = Math.max(0, Math.round((estado.atualizadoEm - estado.socketCriadoEm) / 1000));
  return (
    `[ouvinte] pendentes: desfecho=${estado.desfecho} conexao=${estado.socketCriadoEm} anunciados=${estado.anunciados?.total ?? 'sem-anuncio'} ` +
    `recebidos=mensagens ${r.mensagens}/notificacoes ${r.notificacoes}/recibos ${r.recibos}/chamadas ${r.chamadas} ` +
    `falhasDeDecifra=${estado.falhasDeDecifra ?? 'indisponivel'} pedidos=${estado.pedidos} ` +
    `nosPorPedido=${mostrados === '' ? '-' : mostrados}${resto} duracao=${duracao}s`
  );
}
