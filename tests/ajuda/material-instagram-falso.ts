import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Uma mensagem no formato do material, como a plataforma a serializa. */
export interface MensagemBruta {
  sender_name: string;
  timestamp_ms: number;
  content?: string;
  photos?: { uri: string }[];
  videos?: { uri: string }[];
  audio_files?: { uri: string }[];
  share?: { link?: string; share_text?: string };
  reactions?: { reaction: string; actor: string }[];
}

export interface ConversaBruta {
  /** Vira `<slug-do-titulo>_<numero>` no nome do diretório. */
  slug: string;
  numero: string;
  title: string;
  participants: string[];
  messages: MensagemBruta[];
  /** Presente só em conversa coletiva. */
  joinable_mode?: { mode: number; link: string };
  /** Quando true, o diretório é criado sem arquivo de mensagem nenhum. */
  semArquivo?: boolean;
  /** Quando informado, as mensagens são fatiadas em message_1..N. */
  mensagensPorArquivo?: number;
  caixa?: 'inbox' | 'message_requests';
}

/**
 * A plataforma serializa UTF-8 como bytes latinos escapados. O material real
 * chega assim, e a fixture precisa chegar assim também — senão o teste de
 * acento não mede nada.
 */
export function deformar(texto: string): string {
  return Buffer.from(texto, 'utf8').toString('latin1');
}

export interface MaterialFalso {
  raiz: string;
  limpar: () => void;
}

/**
 * Escreve a arvore do material num diretorio EXISTENTE, dado.
 *
 * Extraido de `materialInstagramFalso` para a varredura, que precisa do
 * material dentro de uma Pasta de Entrada — e nao num mkdtemp proprio.
 */
export function escreverMaterialInstagramEm(destino: string, conversas: ConversaBruta[]): void {
  const raiz = destino;
  for (const c of conversas) {
    const caixa = c.caixa ?? 'inbox';
    const pasta = join(raiz, 'your_instagram_activity', 'messages', caixa, `${c.slug}_${c.numero}`);
    mkdirSync(pasta, { recursive: true });
    if (c.semArquivo === true) continue;

    // O material chega em ordem decrescente. Se a fixture entregar crescente,
    // o teste de ordenação passa com a ordenação removida.
    const emOrdemDaFonte = [...c.messages]
      .map((m) => ({
        ...m,
        sender_name: deformar(m.sender_name),
        ...(m.content !== undefined ? { content: deformar(m.content) } : {}),
      }))
      .sort((a, b) => b.timestamp_ms - a.timestamp_ms);

    const porArquivo = c.mensagensPorArquivo ?? emOrdemDaFonte.length;
    const fatias: (typeof emOrdemDaFonte)[] = [];
    for (let i = 0; i < emOrdemDaFonte.length; i += Math.max(1, porArquivo)) {
      fatias.push(emOrdemDaFonte.slice(i, i + Math.max(1, porArquivo)));
    }
    if (fatias.length === 0) fatias.push([]);

    fatias.forEach((fatia, indice) => {
      const conteudo: Record<string, unknown> = {
        participants: c.participants.map((name) => ({ name: deformar(name) })),
        messages: fatia,
        title: deformar(c.title),
        is_still_participant: true,
        thread_path: `${caixa}/${c.slug}_${c.numero}`,
        magic_words: [],
      };
      if (c.joinable_mode !== undefined) conteudo.joinable_mode = c.joinable_mode;
      writeFileSync(join(pasta, `message_${indice + 1}.json`), JSON.stringify(conteudo), 'utf8');
    });
  }
}

export function materialInstagramFalso(conversas: ConversaBruta[]): MaterialFalso {
  const raiz = mkdtempSync(join(tmpdir(), 'malote-instagram-'));
  escreverMaterialInstagramEm(raiz, conversas);
  return { raiz, limpar: () => rmSync(raiz, { recursive: true, force: true }) };
}
