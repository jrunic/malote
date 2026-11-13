import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';

/**
 * O portao do rclone: o UNICO modulo que o invoca e o unico que le as
 * variaveis dele (guarda em `tests/fronteira-de-dependencia.test.ts`). O
 * rclone e dependencia de EXECUCAO, declarada pelo Operador e opcional (ADR
 * `20261112-rclone-como-dependencia-nativa-do-armazenamento-remoto`).
 *
 * Fala com um `rclone rcd` aquecido em localhost, autenticado por variavel de
 * ambiente: um processo `rclone` novo por chamada custa de 4 a 6 s (medido em
 * 11/11/2026), contra 0,3 s do `rcd` quente. A senha nasce a cada subida, vai
 * so por ambiente e NUNCA por argumento de linha de comando (o `ps` a mostraria).
 * O acesso ao remoto (token) e do ambiente do rclone, nao do produto.
 *
 * As formas de resposta abaixo foram MEDIDAS contra o rclone 1.76 e o Google
 * Drive: `operations/stat` devolve `{item: {...}}` ou `{item: null}`;
 * `operations/list` devolve `{list: [...]}`; `copyfile` e `deletefile` devolvem
 * `{}`; o erro vem com o status HTTP e `{error, status}`. Os itens trazem
 * `Hashes.sha256` e `ID` quando o remoto os da.
 */

export const VARIAVEIS_DO_RCLONE = ['MALOTE_RCLONE_BINARIO', 'MALOTE_RCLONE_PORTA'] as const;

/** A mensagem de quem tenta subir o servico sem o binario declarado: so o portao conhece os nomes das variaveis. */
export const MENSAGEM_RCLONE_NAO_DECLARADO =
  'O rclone nao esta declarado (MALOTE_RCLONE_BINARIO): o armazenamento remoto fica parado. ' +
  'Declare o binario no ambiente do servico.';

const PORTA_PADRAO = 5599;
const USUARIO_DO_RCD = 'malote';

export interface ConfiguracaoDoRclone {
  binario: string;
  porta: number;
}

/** `undefined` quando o binario nao foi declarado: o armazenamento remoto fica parado, o resto do produto nao muda. */
export function configuracaoDoRclone(env: Record<string, string | undefined>): ConfiguracaoDoRclone | undefined {
  const binario = env['MALOTE_RCLONE_BINARIO'];
  if (binario === undefined || binario === '') return undefined;
  const bruta = env['MALOTE_RCLONE_PORTA'];
  const porta = bruta === undefined ? PORTA_PADRAO : Number(bruta);
  return { binario, porta: Number.isInteger(porta) && porta >= 1024 && porta <= 65_535 ? porta : PORTA_PADRAO };
}

export interface ItemRemoto {
  /** Relativo ao remoto consultado, como o rclone o devolve. */
  caminho: string;
  tamanho: number;
  sha256: string | null;
  /** Identificador do arquivo no remoto, quando o remoto o da (Google Drive). */
  id: string | null;
}

export interface OrigemLocal {
  /** Raiz do Destino de Midia local. */
  raiz: string;
  /** Caminho do arquivo relativo a essa raiz. */
  relativo: string;
}

export interface AlvoRemoto {
  /** Nome do remoto do rclone. */
  remoto: string;
  /** Pasta-base; vazia = raiz do remoto. */
  pasta: string;
  relativo: string;
}

/** O que o Servico de Armazenamento usa do remoto: a interface que os testes substituem. */
export interface Remoto {
  copiarArquivo(origem: OrigemLocal, destino: AlvoRemoto, tamanho: number): Promise<void>;
  statArquivo(alvo: AlvoRemoto): Promise<ItemRemoto | null>;
  /** Todos os arquivos sob `relativo` (recursivo), com hash e identificador. */
  listarArquivos(alvo: AlvoRemoto): Promise<ItemRemoto[]>;
  apagarArquivo(alvo: AlvoRemoto): Promise<void>;
  /** Os bytes do arquivo, ou `null` quando o remoto nao o tem. Recusa o que passa de `tamanhoMaximo` sem le-lo inteiro. */
  lerArquivo(alvo: AlvoRemoto, opcoes: OpcoesDeLeitura): Promise<Buffer | null>;
  parar(): Promise<void>;
}

export interface OpcoesDeLeitura {
  tamanhoMaximo: number;
  /** Prazo total da leitura, em ms. */
  prazoMs: number;
  /** O cliente que pediu foi embora: a leitura para. */
  sinal?: AbortSignal | undefined;
}

export class ErroDoRemoto extends Error {
  constructor(
    mensagem: string,
    readonly status: number | undefined,
    /** O remoto pediu para ir mais devagar: o servico reduz o ritmo e tenta depois. */
    readonly limiteDeCota: boolean,
  ) {
    super(mensagem);
    this.name = 'ErroDoRemoto';
  }
}

function ehLimiteDeCota(status: number, mensagem: string): boolean {
  // Armazenamento ESGOTADO do remoto tambem vem como 403 com "quota", mas nao e pedido para ir mais devagar:
  // reduzir o ritmo nao adianta e o diagnostico seria errado. E erro comum, com a mensagem do remoto no log.
  if (/storageQuota|storage quota/i.test(mensagem)) return false;
  if (status === 429) return true;
  if (/rateLimitExceeded|userRateLimitExceeded|too many requests/i.test(mensagem)) return true;
  return status === 403 && /rate|quota/i.test(mensagem);
}

const FS = (remoto: string, pasta: string): string => (pasta === '' ? `${remoto}:` : `${remoto}:${pasta}`);

const OPCOES_DE_ITEM = { showHash: true, hashTypes: ['sha256'], showOrigIDs: true, noMimeType: true, noModTime: true };

/** 60 s de base mais 1 s por MiB (piso de 1 MiB/s), no maximo 1 h. */
function prazoDaCopiaMs(tamanho: number): number {
  return Math.min(3_600_000, 60_000 + Math.ceil(tamanho / (1024 * 1024)) * 1000);
}

interface ItemDoRc {
  Path: string;
  Size: number;
  Hashes?: { sha256?: string };
  ID?: string;
}

function itemDe(i: ItemDoRc): ItemRemoto {
  return { caminho: i.Path, tamanho: i.Size, sha256: i.Hashes?.sha256 ?? null, id: i.ID ?? null };
}

export interface OpcoesDoRclone {
  /** Quanto esperar o `rcd` responder depois de iniciado. */
  prontoEmMs?: number;
}

/** Sobe o `rcd` e devolve o Remoto. Falha alto se o binario nao sobe ou nao responde. */
export async function iniciarRclone(
  config: ConfiguracaoDoRclone,
  env: Record<string, string | undefined>,
  opcoes: OpcoesDoRclone = {},
): Promise<Remoto> {
  const senha = randomBytes(16).toString('hex');
  const filho: ChildProcess = spawn(config.binario, ['rcd', '--rc-addr', `127.0.0.1:${config.porta}`, '--rc-serve'], {
    env: { ...env, RCLONE_RC_USER: USUARIO_DO_RCD, RCLONE_RC_PASS: senha },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let ultimaSaida = '';
  filho.stderr?.on('data', (pedaco: Buffer) => {
    ultimaSaida = (ultimaSaida + pedaco.toString()).slice(-2_000);
  });
  let encerrouCom: number | null | undefined;
  filho.once('exit', (codigo) => {
    encerrouCom = codigo;
  });
  let naoExecutou: string | undefined;
  filho.once('error', (e) => {
    naoExecutou = e.message;
  });

  const base = `http://127.0.0.1:${config.porta}`;
  const autorizacao = `Basic ${Buffer.from(`${USUARIO_DO_RCD}:${senha}`).toString('base64')}`;

  async function chamar(caminho: string, corpo: unknown, prazoMs: number): Promise<Record<string, unknown>> {
    let resposta: Response;
    let texto: string;
    try {
      resposta = await fetch(`${base}/${caminho}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: autorizacao },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(prazoMs),
      });
      // O corpo tambem pode cair no meio (conexao cortada): e o mesmo erro de "nao respondeu", nunca um TypeError cru.
      texto = await resposta.text();
    } catch (causa) {
      throw new ErroDoRemoto(`rclone nao respondeu em ${caminho}: ${(causa as Error).message}`, undefined, false);
    }
    let json: Record<string, unknown>;
    try {
      json = texto === '' ? {} : (JSON.parse(texto) as Record<string, unknown>);
    } catch {
      json = { error: texto };
    }
    if (!resposta.ok) {
      const mensagem = String(json['error'] ?? texto).slice(0, 300);
      throw new ErroDoRemoto(mensagem, resposta.status, ehLimiteDeCota(resposta.status, mensagem));
    }
    return json;
  }

  const limite = Date.now() + (opcoes.prontoEmMs ?? 15_000);
  for (;;) {
    if (naoExecutou !== undefined) throw new ErroDoRemoto(`rclone nao executou: ${naoExecutou}`, undefined, false);
    if (encerrouCom !== undefined) {
      throw new ErroDoRemoto(`rclone encerrou ao subir (codigo ${String(encerrouCom)}): ${ultimaSaida.trim()}`, undefined, false);
    }
    try {
      await chamar('core/version', {}, 1_500);
      // Outro rcd na mesma porta, sem autenticacao, tambem responde `core/version`: so vale o que e o MEU filho.
      const { pid } = await chamar('core/pid', {}, 1_500);
      if (pid !== filho.pid) {
        filho.kill('SIGKILL');
        throw new ErroDoRemoto(
          `a porta ${config.porta} ja responde por outro processo rclone (nao e o que este servico subiu)`,
          undefined,
          false,
        );
      }
      break;
    } catch (erro) {
      if (erro instanceof ErroDoRemoto && /ja responde por outro/.test(erro.message)) throw erro;
      if (Date.now() > limite) {
        filho.kill('SIGKILL');
        throw new ErroDoRemoto(`rclone nao ficou pronto em ${opcoes.prontoEmMs ?? 15_000} ms: ${ultimaSaida.trim()}`, undefined, false);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return {
    async copiarArquivo(origem, destino, tamanho) {
      await chamar(
        'operations/copyfile',
        {
          srcFs: origem.raiz,
          srcRemote: origem.relativo,
          dstFs: FS(destino.remoto, destino.pasta),
          dstRemote: destino.relativo,
        },
        prazoDaCopiaMs(tamanho),
      );
    },
    async statArquivo(alvo) {
      const r = await chamar(
        'operations/stat',
        { fs: FS(alvo.remoto, alvo.pasta), remote: alvo.relativo, opt: OPCOES_DE_ITEM },
        60_000,
      );
      const item = r['item'] as ItemDoRc | null | undefined;
      return item === null || item === undefined ? null : itemDe(item);
    },
    async listarArquivos(alvo) {
      const r = await chamar(
        'operations/list',
        {
          fs: FS(alvo.remoto, alvo.pasta),
          remote: alvo.relativo,
          opt: { ...OPCOES_DE_ITEM, recurse: true, filesOnly: true },
        },
        15 * 60_000,
      );
      return ((r['list'] as ItemDoRc[] | undefined) ?? []).map(itemDe);
    },
    async apagarArquivo(alvo) {
      await chamar('operations/deletefile', { fs: FS(alvo.remoto, alvo.pasta), remote: alvo.relativo }, 60_000);
    },
    async lerArquivo(alvo, opcoes) {
      // `--rc-serve` serve o arquivo em `/[<remoto>:<pasta>]/<caminho>`; o `encodeURI` cuida de espaco e acento, e o
      // rclone decodifica o caminho da URL. Sem autenticacao e 401: a senha e a mesma do rcd, so por cabecalho.
      const url = `${base}/${encodeURI(`[${FS(alvo.remoto, alvo.pasta)}]/${alvo.relativo}`)}`;
      const prazo = AbortSignal.timeout(opcoes.prazoMs);
      let resposta: Response;
      try {
        resposta = await fetch(url, {
          headers: { authorization: autorizacao },
          signal: opcoes.sinal === undefined ? prazo : AbortSignal.any([prazo, opcoes.sinal]),
        });
        if (resposta.status === 404) {
          await resposta.arrayBuffer();
          return null;
        }
        if (!resposta.ok) {
          const mensagem = (await resposta.text()).slice(0, 300);
          throw new ErroDoRemoto(mensagem === '' ? `HTTP ${resposta.status}` : mensagem, resposta.status, ehLimiteDeCota(resposta.status, mensagem));
        }
        const declarado = Number(resposta.headers.get('content-length') ?? '0');
        if (declarado > opcoes.tamanhoMaximo) {
          await resposta.body?.cancel();
          throw new ErroDoRemoto(`o arquivo (${declarado} bytes) passa do maximo de ${opcoes.tamanhoMaximo}`, undefined, false);
        }
        const bytes = Buffer.from(await resposta.arrayBuffer());
        if (bytes.length > opcoes.tamanhoMaximo) {
          throw new ErroDoRemoto(`o arquivo (${bytes.length} bytes) passa do maximo de ${opcoes.tamanhoMaximo}`, undefined, false);
        }
        return bytes;
      } catch (causa) {
        if (causa instanceof ErroDoRemoto) throw causa;
        throw new ErroDoRemoto(`rclone nao entregou o arquivo: ${(causa as Error).message}`, undefined, false);
      }
    },
    async parar() {
      if (encerrouCom !== undefined) return;
      const saiu = new Promise<void>((resolver) => filho.once('exit', () => resolver()));
      filho.kill('SIGTERM');
      const matador = setTimeout(() => filho.kill('SIGKILL'), 5_000);
      await saiu;
      clearTimeout(matador);
    },
  };
}
