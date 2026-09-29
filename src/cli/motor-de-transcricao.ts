import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * O UNICO modulo autorizado a invocar `ffmpeg` e `whisper.cpp`.
 *
 * Mesma disciplina da fronteira que ja isola o Baileys (ADR
 * 20260824-adocao-de-biblioteca-nao-oficial-para-recepcao-ao-vivo): so que
 * aqui a dependencia nao e pacote npm, e o que se guarda nao e o import, e a
 * referencia as variaveis de ambiente que apontam pros binarios —
 * tests/fronteira-de-dependencia.test.ts varre por elas.
 */

const executarArquivo = promisify(execFile);
// 16 MB: a saida do whisper-cli e so o texto transcrito (curto); o teto e
// para nao herdar o default de 1 MB do Node e truncar em silencio, nunca
// para acomodar volume real.
const BUFFER_MAXIMO = 16 * 1024 * 1024;

export interface ConfiguracaoDoMotor {
  whisperBinario: string;
  whisperModelo: string;
  ffmpegBinario: string;
  /** Nucleos que o whisper.cpp usa. Fracao do total, nunca todos — ver ADR local. */
  threads: number;
  /** Codigo de idioma do whisper.cpp — 'pt' por default, medido na viabilidade. */
  idioma: string;
}

/** `undefined` quando falta o essencial — o worker fica desligado, sem erro. */
export function configuracaoDoMotor(
  env: Record<string, string | undefined>,
): ConfiguracaoDoMotor | undefined {
  const whisperBinario = env['MALOTE_WHISPER_BINARIO'];
  const whisperModelo = env['MALOTE_WHISPER_MODELO'];
  if (whisperBinario === undefined || whisperModelo === undefined) return undefined;
  const threads = Number(env['MALOTE_TRANSCRICAO_THREADS'] ?? '4');
  return {
    whisperBinario,
    whisperModelo,
    ffmpegBinario: env['MALOTE_FFMPEG_BINARIO'] ?? 'ffmpeg',
    threads: Number.isInteger(threads) && threads > 0 ? threads : 4,
    idioma: env['MALOTE_TRANSCRICAO_IDIOMA'] ?? 'pt',
  };
}

export class MotorDeTranscricaoError extends Error {}

/**
 * Transcreve um arquivo de audio. Lanca MotorDeTranscricaoError em qualquer
 * falha — do ffmpeg, do whisper.cpp, ou saida vazia.
 *
 * ASSINCRONO DE PROPOSITO: `execFileSync` bloquearia a THREAD do processo
 * `malote servir` pelo tempo inteiro do subprocesso (~43s de CPU por minuto
 * de audio, medido em 28/09/2026) — nenhuma requisicao HTTP seria atendida
 * enquanto transcreve. Com `execFile` promisificado, o subprocesso roda fora
 * do caminho sincrono e o servidor continua respondendo.
 *
 * O .wav intermediario NUNCA vai para o Destino de Midia: vive em pasta
 * temporaria do sistema, apagada ao final (com ou sem erro).
 */
export async function transcrever(
  config: ConfiguracaoDoMotor,
  caminhoDoAudio: string,
): Promise<string> {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-transcricao-'));
  const wav = join(pasta, 'audio.wav');
  try {
    try {
      await executarArquivo(
        config.ffmpegBinario,
        ['-y', '-loglevel', 'error', '-i', caminhoDoAudio, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav],
        { maxBuffer: BUFFER_MAXIMO },
      );
    } catch (causa) {
      throw new MotorDeTranscricaoError(
        `ffmpeg falhou ao converter ${caminhoDoAudio}: ${(causa as Error).message}`,
      );
    }

    let saida: { stdout: string };
    try {
      saida = await executarArquivo(
        config.whisperBinario,
        ['-m', config.whisperModelo, '-l', config.idioma, '-t', String(config.threads), '--no-timestamps', '-f', wav],
        { encoding: 'utf8', maxBuffer: BUFFER_MAXIMO },
      );
    } catch (causa) {
      throw new MotorDeTranscricaoError(
        `whisper.cpp falhou ao transcrever ${caminhoDoAudio}: ${(causa as Error).message}`,
      );
    }

    const texto = saida.stdout.trim();
    if (texto === '') {
      throw new MotorDeTranscricaoError(`whisper.cpp devolveu saida vazia para ${caminhoDoAudio}`);
    }
    return texto;
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}
