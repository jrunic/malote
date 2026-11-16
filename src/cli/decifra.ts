import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Causa, Direcao, FalhaCapturada, TipoDeConversa } from '../adaptadores/whatsapp/falha-de-decifra.js';

/**
 * O REGISTRO DAS FALHAS DE DECIFRA E A SITUACAO DE CADA MENSAGEM (#1537).
 *
 * Arquivo por conta, FORA do Acervo (sem mudanca de forma), no molde da guarda de descartes e do contador de reenvios. O
 * que ele guarda: o identificador externo da mensagem, os enderecos da conversa e do autor, a direcao, o tipo, a causa
 * agrupada e o instante. NUNCA texto de mensagem. Os enderecos sao dado pessoal declarado: modo 0600, nunca em log,
 * fora do backup.
 *
 * O ouvinte, que ja tem o Acervo aberto, consulta na HORA da falha se a mensagem ja esta gravada e, depois, reconfere as
 * que nao estavam. `ouvinte estado --json` so le o arquivo: nunca abre o Acervo.
 */
export const PRAZO_DE_PERDA_MS = 60 * 60 * 1000;
export const TETO_DO_REGISTRO_DA_DECIFRA = 5 * 1024 * 1024;
export const INTERVALO_DA_RECONFERENCIA_MS = 5 * 60 * 1000;
/** Reconferencia ate esta folga depois do prazo ainda vale `recuperada`; depois disso o ouvinte esteve parado e vale `incerta`. */
export const FOLGA_DA_RECONFERENCIA_MS = 2 * INTERVALO_DA_RECONFERENCIA_MS;
const MAXIMO_DE_RESOLVIDAS = 10_000;

export type SituacaoFinal = 'recuperada' | 'perdida' | 'incerta';
export interface LinhaDaFalha extends FalhaCapturada {
  t: 'falha';
  em: string;
  jaGravada: boolean;
}
export interface LinhaDaSituacao {
  t: 'situacao';
  em: string;
  id: string;
  situacao: SituacaoFinal;
}

export interface OpcoesDoRegistro {
  caminho: string;
  caminhoDosContadores: string;
  agora: () => number;
  /** A mensagem de identificador externo `id` ja esta no Acervo? (`mensagemJaExiste` do nucleo.) */
  existe: (id: string) => boolean;
  teto?: number;
  avisar: (linha: string) => void;
}

export interface RegistroDaDecifra {
  /** Cria o arquivo de contadores se nao existe, ou le o que ha. */
  abrir: () => void;
  /** Reconstroi as abertas do arquivo (anterior e atual). Na subida. */
  carregar: () => void;
  registrar: (falha: FalhaCapturada) => void;
  /** Confere as abertas: entrou => recuperada; passou o prazo sem entrar => perdida. Nunca lanca. */
  reconferir: () => void;
  /** Depois de chamado, registrar e reconferir nao fazem nada (o Acervo pode ja estar fechado). */
  encerrar: () => void;
  falhasDeRegistro: () => number;
  abertas: () => number;
}

export function caminhoDoRegistroAnterior(caminho: string): string {
  return caminho.endsWith('.jsonl') ? caminho.replace(/\.jsonl$/, '.anterior.jsonl') : `${caminho}.anterior`;
}

export function criarRegistroDaDecifra(o: OpcoesDoRegistro): RegistroDaDecifra {
  const teto = o.teto ?? TETO_DO_REGISTRO_DA_DECIFRA;
  const abertas = new Map<string, number>(); // identificador externo -> instante da primeira falha
  const resolvidas = new Set<string>();
  let ativo = true;
  let falhasDeRegistro = 0;
  let avisou = false;
  let desde = '';

  const anexar = (linha: LinhaDaFalha | LinhaDaSituacao): void => {
    mkdirSync(dirname(o.caminho), { recursive: true, mode: 0o700 });
    if (existsSync(o.caminho) && statSync(o.caminho).size >= teto) renameSync(o.caminho, caminhoDoRegistroAnterior(o.caminho));
    appendFileSync(o.caminho, `${JSON.stringify(linha)}\n`, { mode: 0o600 });
  };

  const gravarContadores = (): void => {
    mkdirSync(dirname(o.caminhoDosContadores), { recursive: true, mode: 0o700 });
    const tmp = `${o.caminhoDosContadores}.tmp`;
    writeFileSync(tmp, JSON.stringify({ desde, falhasDeRegistro }), { mode: 0o600 });
    renameSync(tmp, o.caminhoDosContadores);
  };

  const avisarUmaVez = (texto: string): void => {
    if (avisou) return;
    avisou = true;
    try {
      o.avisar(texto);
    } catch {
      /* o aviso nunca derruba quem o emite: o estrangulamento da saida (EPIPE) nao pode chegar ao ouvinte */
    }
  };

  const contarFalhaDeRegistro = (erro: unknown): void => {
    falhasDeRegistro += 1;
    avisarUmaVez(`[ouvinte] registro da decifra indisponivel (${(erro as Error).message ?? String(erro)}); o ouvinte segue`);
    if (desde === '') return;
    try {
      gravarContadores();
    } catch {
      // Os dois arquivos falharam: um contador antigo diria "zero" de um registro que perde tudo. Sem o arquivo, o
      // estado mostra o bloco como indisponivel (nunca zero). Se nem apagar e possivel, o aviso no log e o sinal.
      try {
        unlinkSync(o.caminhoDosContadores);
      } catch {
        /* nada mais a fazer */
      }
    }
  };

  const lembrarResolvida = (id: string): void => {
    if (resolvidas.size >= MAXIMO_DE_RESOLVIDAS) resolvidas.clear();
    resolvidas.add(id);
  };

  return {
    abrir(): void {
      try {
        const lido = JSON.parse(readFileSync(o.caminhoDosContadores, 'utf8')) as { desde?: unknown; falhasDeRegistro?: unknown };
        if (typeof lido.desde === 'string' && Number.isInteger(lido.falhasDeRegistro)) {
          desde = lido.desde;
          falhasDeRegistro = lido.falhasDeRegistro as number;
          return;
        }
      } catch {
        /* ausente ou ilegivel: recomeca */
      }
      desde = new Date(o.agora()).toISOString();
      try {
        gravarContadores();
      } catch (erro) {
        contarFalhaDeRegistro(erro);
      }
    },
    carregar(): void {
      const falhas = new Map<string, number>();
      for (const caminho of [caminhoDoRegistroAnterior(o.caminho), o.caminho]) {
        let conteudo: string;
        try {
          conteudo = readFileSync(caminho, 'utf8');
        } catch {
          continue;
        }
        for (const l of conteudo.split('\n')) {
          if (l.trim() === '') continue;
          try {
            const v = JSON.parse(l) as { t?: unknown; id?: unknown; em?: unknown; jaGravada?: unknown };
            if (typeof v.id !== 'string' || typeof v.em !== 'string') continue;
            if (v.t === 'situacao') lembrarResolvida(v.id);
            else if (v.t === 'falha' && v.jaGravada === false && !falhas.has(v.id)) falhas.set(v.id, Date.parse(v.em));
          } catch {
            /* linha invalida: nao conta */
          }
        }
      }
      for (const [id, em] of falhas) if (!resolvidas.has(id) && !Number.isNaN(em)) abertas.set(id, em);
    },
    registrar(f: FalhaCapturada): void {
      if (!ativo) return;
      try {
        let jaGravada = false;
        try {
          jaGravada = o.existe(f.id);
        } catch {
          jaGravada = false;
        }
        anexar({ t: 'falha', em: new Date(o.agora()).toISOString(), ...f, jaGravada });
        if (!jaGravada && !resolvidas.has(f.id) && !abertas.has(f.id)) abertas.set(f.id, o.agora());
      } catch (erro) {
        contarFalhaDeRegistro(erro);
      }
    },
    reconferir(): void {
      if (!ativo) return;
      const agora = o.agora();
      for (const [id, em] of [...abertas]) {
        try {
          const idade = agora - em;
          const existe = o.existe(id);
          let situacao: SituacaoFinal | undefined;
          if (idade < PRAZO_DE_PERDA_MS) situacao = existe ? 'recuperada' : undefined;
          else if (!existe) situacao = 'perdida';
          else situacao = idade < PRAZO_DE_PERDA_MS + FOLGA_DA_RECONFERENCIA_MS ? 'recuperada' : 'incerta';
          if (situacao === undefined) continue;
          anexar({ t: 'situacao', em: new Date(agora).toISOString(), id, situacao });
          abertas.delete(id);
          lembrarResolvida(id);
        } catch (erro) {
          contarFalhaDeRegistro(erro);
        }
      }
    },
    encerrar(): void {
      ativo = false;
    },
    falhasDeRegistro: () => falhasDeRegistro,
    abertas: () => abertas.size,
  };
}

// --- A leitura do bloco do `ouvinte estado --json`: SO dos arquivos.

export interface ContagemPorSituacao {
  jaGravada: number;
  recuperada: number;
  perdida: number;
  incerta: number;
  aberta: number;
}
export interface DiaDaDecifra {
  /** Mensagens (identificadores distintos), pela primeira falha, no dia UTC dela. */
  total: ContagemPorSituacao;
  porDirecao: Record<Direcao, ContagemPorSituacao>;
  porTipo: Record<TipoDeConversa, ContagemPorSituacao>;
  /** Mensagens por causa. */
  porCausa: Record<string, number>;
  /** Perdidas RECEBIDAS de conversa que vira Mensagem (fora status e outros): o numero que se le como perda. */
  perdaRecebida: number;
  /** Perdidas escritas por outro aparelho da propria conta. */
  perdaEnviadaPorOutroAparelho: number;
}
export interface BlocoDaDecifra {
  desde: string;
  /** `null` = o contador esta ilegivel (indisponivel), nunca zero. */
  falhasDeRegistro: number | null;
  linhasInvalidas: number;
  /** Mensagens ainda abertas com mais de 1 hora: o ouvinte esteve parado e ainda nao reconferiu. */
  vencidasSemReconferencia: number;
  /** Os 10 textos mais frequentes da causa `outra`, sem digitos. */
  textosDaCausaOutra: Record<string, number>;
  dias: Record<string, DiaDaDecifra>;
}
export interface LeituraDoBloco {
  bloco: BlocoDaDecifra | null;
  /** Presente quando `bloco` e `null`. */
  motivo?: string;
}

const zero = (): ContagemPorSituacao => ({ jaGravada: 0, recuperada: 0, perdida: 0, incerta: 0, aberta: 0 });
const TIPOS: readonly TipoDeConversa[] = ['grupo', 'direta-opaca', 'direta-telefone', 'status-e-outros'];

interface Falha {
  em: number;
  jaGravada: boolean;
  direcao: Direcao;
  tipo: TipoDeConversa;
  causa: Causa | string;
  texto?: string;
}

export function lerBlocoDaDecifra(c: { registro: string; contadores: string }, agora: number): LeituraDoBloco {
  let desde: string;
  let falhasDeRegistro: number | null;
  try {
    const lido = JSON.parse(readFileSync(c.contadores, 'utf8')) as { desde?: unknown; falhasDeRegistro?: unknown };
    if (typeof lido.desde !== 'string' || Number.isNaN(Date.parse(lido.desde))) {
      return { bloco: null, motivo: 'o arquivo dos contadores nao tem `desde`' };
    }
    desde = lido.desde;
    falhasDeRegistro = Number.isInteger(lido.falhasDeRegistro) ? (lido.falhasDeRegistro as number) : null;
  } catch {
    return { bloco: null, motivo: 'o arquivo dos contadores esta ausente ou ilegivel' };
  }

  const falhas = new Map<string, Falha>();
  const situacoes = new Map<string, SituacaoFinal>();
  let linhasInvalidas = 0;
  for (const caminho of [caminhoDoRegistroAnterior(c.registro), c.registro]) {
    let conteudo: string;
    try {
      conteudo = readFileSync(caminho, 'utf8');
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === 'ENOENT') continue;
      return { bloco: null, motivo: `o registro esta ilegivel (${(erro as NodeJS.ErrnoException).code ?? 'erro'})` };
    }
    for (const l of conteudo.split('\n')) {
      if (l.trim() === '') continue;
      let v: Record<string, unknown>;
      try {
        v = JSON.parse(l) as Record<string, unknown>;
      } catch {
        linhasInvalidas += 1;
        continue;
      }
      const id = v['id'];
      const em = typeof v['em'] === 'string' ? Date.parse(v['em']) : Number.NaN;
      if (typeof id !== 'string' || Number.isNaN(em)) {
        linhasInvalidas += 1;
        continue;
      }
      if (v['t'] === 'falha') {
        const direcao = v['direcao'] === 'enviada' ? 'enviada' : v['direcao'] === 'recebida' ? 'recebida' : undefined;
        const tipo = TIPOS.find((t) => t === v['tipo']);
        if (direcao === undefined || tipo === undefined || typeof v['causa'] !== 'string' || typeof v['jaGravada'] !== 'boolean') {
          linhasInvalidas += 1;
          continue;
        }
        const anterior = falhas.get(id);
        if (anterior === undefined || em < anterior.em) {
          falhas.set(id, {
            em,
            jaGravada: v['jaGravada'],
            direcao,
            tipo,
            causa: v['causa'],
            ...(typeof v['textoDaCausa'] === 'string' ? { texto: v['textoDaCausa'] } : {}),
          });
        }
      } else if (v['t'] === 'situacao') {
        const s = v['situacao'];
        if ((s === 'recuperada' || s === 'perdida' || s === 'incerta') && !situacoes.has(id)) situacoes.set(id, s);
        else if (s !== 'recuperada' && s !== 'perdida' && s !== 'incerta') linhasInvalidas += 1;
      } else {
        linhasInvalidas += 1;
      }
    }
  }

  const dias: Record<string, DiaDaDecifra> = {};
  const textos = new Map<string, number>();
  let vencidasSemReconferencia = 0;
  for (const [id, f] of falhas) {
    const dia = new Date(f.em).toISOString().slice(0, 10);
    const d = (dias[dia] ??= {
      total: zero(),
      porDirecao: { recebida: zero(), enviada: zero() },
      porTipo: { grupo: zero(), 'direta-opaca': zero(), 'direta-telefone': zero(), 'status-e-outros': zero() },
      porCausa: {},
      perdaRecebida: 0,
      perdaEnviadaPorOutroAparelho: 0,
    });
    const situacao: keyof ContagemPorSituacao = f.jaGravada ? 'jaGravada' : (situacoes.get(id) ?? 'aberta');
    if (situacao === 'aberta' && agora - f.em >= PRAZO_DE_PERDA_MS) vencidasSemReconferencia += 1;
    d.total[situacao] += 1;
    d.porDirecao[f.direcao][situacao] += 1;
    d.porTipo[f.tipo][situacao] += 1;
    d.porCausa[f.causa] = (d.porCausa[f.causa] ?? 0) + 1;
    if (situacao === 'perdida') {
      if (f.direcao === 'recebida' && f.tipo !== 'status-e-outros') d.perdaRecebida += 1;
      if (f.direcao === 'enviada') d.perdaEnviadaPorOutroAparelho += 1;
    }
    if (f.causa === 'outra' && f.texto !== undefined) textos.set(f.texto, (textos.get(f.texto) ?? 0) + 1);
  }
  const textosDaCausaOutra = Object.fromEntries([...textos].sort((a, b) => b[1] - a[1]).slice(0, 10));
  return { bloco: { desde, falhasDeRegistro, linhasInvalidas, vencidasSemReconferencia, textosDaCausaOutra, dias } };
}
