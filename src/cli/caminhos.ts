import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/**
 * Resolução de caminho da instalação pelo padrão XDG Base Directory, por
 * categoria de ciclo de vida (ADR 20260913-xdg-padrao-de-armazenamento-da-
 * frota). Lê variáveis de ambiente, então é política de BORDA: mora na CLI,
 * e o núcleo não a importa. As quatro regras que o spec do XDG impõe estão
 * testadas em tests/caminhos.test.ts — inclusive a de que MALOTE_RAIZ não
 * existe mais.
 */
export interface EnvDeCaminhos {
  HOME?: string;
  MALOTE_HOME?: string;
  XDG_DATA_HOME?: string;
  XDG_STATE_HOME?: string;
}

/** Vazio conta como ausente; caminho relativo é inválido e se ignora. */
function valido(valor: string | undefined): string | undefined {
  if (valor === undefined || valor === '') return undefined;
  return isAbsolute(valor) ? valor : undefined;
}

function raiz(env: EnvDeCaminhos, xdg: 'XDG_DATA_HOME' | 'XDG_STATE_HOME', categoria: string): string {
  const valvula = valido(env.MALOTE_HOME);
  if (valvula !== undefined) return valvula;
  const base = valido(env[xdg]);
  if (base !== undefined) return join(base, 'malote');
  const home = env.HOME !== undefined && env.HOME !== '' ? env.HOME : homedir();
  return join(home, categoria, 'malote');
}

/** Raiz de DADO (registro.db, acervos/, midia/, entrada/): perder dói. */
export function raizDeDados(env: EnvDeCaminhos): string {
  return raiz(env, 'XDG_DATA_HOME', '.local/share');
}

/** Raiz de ESTADO (ouvinte/<conta>/): se refaz, ou é credencial que se move. */
export function raizDeEstado(env: EnvDeCaminhos): string {
  return raiz(env, 'XDG_STATE_HOME', '.local/state');
}
