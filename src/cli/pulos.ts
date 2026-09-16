import { readFileSync, writeFileSync } from 'node:fs';

export interface PulosDoOuvinte {
  enderecosOpacos: number;
  favoritosSemMensagem: number;
}

const ZERO: PulosDoOuvinte = { enderecosOpacos: 0, favoritosSemMensagem: 0 };

export function lerPulos(caminho: string): PulosDoOuvinte {
  try {
    const lido: unknown = JSON.parse(readFileSync(caminho, 'utf8'));
    if (lido === null || typeof lido !== 'object') return { ...ZERO };
    const r = lido as Partial<PulosDoOuvinte>;
    if (typeof r.enderecosOpacos !== 'number' || typeof r.favoritosSemMensagem !== 'number') {
      return { ...ZERO };
    }
    return { enderecosOpacos: r.enderecosOpacos, favoritosSemMensagem: r.favoritosSemMensagem };
  } catch {
    return { ...ZERO };
  }
}

export function anotarPulos(caminho: string, delta: PulosDoOuvinte): void {
  const atual = lerPulos(caminho);
  try {
    writeFileSync(
      caminho,
      JSON.stringify({
        enderecosOpacos: atual.enderecosOpacos + delta.enderecosOpacos,
        favoritosSemMensagem: atual.favoritosSemMensagem + delta.favoritosSemMensagem,
      }),
    );
  } catch {
    // Perder o contador e barato; perder Mensagem porque o processo caiu nao.
  }
}
