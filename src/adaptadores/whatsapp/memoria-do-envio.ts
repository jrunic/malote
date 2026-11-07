// src/adaptadores/whatsapp/memoria-do-envio.ts

/**
 * A MEMORIA DO ENVIO (#1420): a mensagem exatamente como a biblioteca a montou ao enviar, indexada pelo identificador
 * que a plataforma deu a ela (a Referencia Externa da Mensagem enviada), junto do endereco com que foi enviada e do
 * instante em que foi guardada. E a primeira fonte da resposta ao pedido de reenvio: exata por construcao, e a unica
 * que cobre a janela em que o eco ainda nao foi gravado no Acervo.
 *
 * Conjunto PEQUENO e de vida CURTA, porque guarda conteudo de conversa em claro no processo: 256 mensagens e 1 h (o
 * prazo do cache de contagem de reenvios da biblioteca). Sem temporizador: o que venceu sai na busca, e o mais antigo
 * sai quando o teto passa. Quem a cria e `conectar`, FORA de `abrir`, para ela sobreviver a religacao; `parar` a esvazia.
 */

export const TETO_DA_MEMORIA_DO_ENVIO = 256;
export const VIDA_DA_MEMORIA_DO_ENVIO_MS = 3_600_000;

export interface LembrancaDoEnvio {
  /** A mensagem montada pela biblioteca, como ela a devolveu ao enviar. Nunca copiada nem normalizada. */
  mensagem: unknown;
  /** O endereco com que o Envio saiu. So comparado, nunca registrado. */
  endereco: string;
  guardadaEm: number;
}

export interface MemoriaDoEnvio {
  guardar: (identificador: string, mensagem: unknown, endereco: string) => void;
  /** `undefined` quando nunca foi guardada, quando saiu pelo teto ou quando passou de `vidaMs`. */
  buscar: (identificador: string) => LembrancaDoEnvio | undefined;
  tamanho: () => number;
  /** Esquece tudo. `parar` da Conexao chama: o conteudo em claro nao sobrevive a Conexao. */
  limpar: () => void;
}

export interface OpcoesDaMemoriaDoEnvio {
  agora: () => number;
  teto?: number;
  vidaMs?: number;
}

export function criarMemoriaDoEnvio(opcoes: OpcoesDaMemoriaDoEnvio): MemoriaDoEnvio {
  const teto = opcoes.teto ?? TETO_DA_MEMORIA_DO_ENVIO;
  const vidaMs = opcoes.vidaMs ?? VIDA_DA_MEMORIA_DO_ENVIO_MS;
  // O `Map` guarda a ordem de insercao: o primeiro e o mais antigo, e regravar um identificador o leva para o fim.
  const itens = new Map<string, LembrancaDoEnvio>();
  const venceu = (l: LembrancaDoEnvio, agora: number): boolean => agora - l.guardadaEm > vidaMs;

  const aparar = (agora: number): void => {
    for (const [identificador, l] of itens) {
      if (!venceu(l, agora)) break;
      itens.delete(identificador);
    }
    while (itens.size > teto) {
      const primeiro = itens.keys().next();
      if (primeiro.done === true) break;
      itens.delete(primeiro.value);
    }
  };

  return {
    guardar: (identificador, mensagem, endereco): void => {
      const agora = opcoes.agora();
      itens.delete(identificador);
      itens.set(identificador, { mensagem, endereco, guardadaEm: agora });
      aparar(agora);
    },
    buscar: (identificador): LembrancaDoEnvio | undefined => {
      const l = itens.get(identificador);
      if (l === undefined) return undefined;
      if (venceu(l, opcoes.agora())) {
        itens.delete(identificador);
        return undefined;
      }
      return l;
    },
    tamanho: (): number => itens.size,
    limpar: (): void => itens.clear(),
  };
}
