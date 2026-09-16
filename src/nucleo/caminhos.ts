import { chmodSync, mkdirSync, statSync } from 'node:fs';

/**
 * Cria a pasta (com recursividade) e NORMALIZA o modo para 0700 depois de
 * criada: `mode` do mkdirSync sofre umask, e conferir o modo efetivo é o que
 * torna a regra verificável em qualquer instalação (spec XDG: "an attempt
 * should be made to create it with permission 0700"). Fs puro, sem ambiente —
 * o resolvedor de raiz mora na CLI, na borda. NÃO vale para a pasta do
 * ouvinte: lá a criação é pré-condição do operador (CONTEXTO.md).
 */
export function garantirPasta(pasta: string): void {
  mkdirSync(pasta, { recursive: true, mode: 0o700 });
  if ((statSync(pasta).mode & 0o777) !== 0o700) chmodSync(pasta, 0o700);
}
