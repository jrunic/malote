import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ErroDoRemoto,
  type AlvoRemoto,
  type ItemRemoto,
  type OpcoesDeLeitura,
  type OrigemLocal,
  type Remoto,
} from '../../src/cli/motor-de-armazenamento.js';

/**
 * Um Remoto na memoria, para os testes do Servico de Armazenamento nao subirem processo nenhum. Imita o que o
 * rclone fez no piloto (hash sha256, identificador, 404 ao apagar o que nao existe) e deixa injetar o que o
 * servico precisa saber tratar: hash errado, hash ausente, arquivo que some, duplicata, limite de cota.
 */
export class RemotoEmMemoria implements Remoto {
  readonly arquivos = new Map<string, { conteudo: Buffer; id: string }>();
  readonly chamadas: string[] = [];
  hashErrado = false;
  semHash = false;
  /** As proximas N copias levantam o limite de cota da API. */
  copiasComCota = 0;
  /** As proximas N copias levantam um erro comum (nao e limite de cota). */
  copiasComErro = 0;
  /** Chamado depois de cada copia que deu certo: deixa o teste agir no meio de uma passada. */
  aposCopiar: (() => void) | undefined;
  /** As proximas N conferencias levantam o limite de cota da API. */
  statsComCota = 0;
  /** Chamado no inicio de cada conferencia: deixa o teste agir no meio da passada de apagar. */
  aoStat: (() => void) | undefined;
  readonly perdidos = new Set<string>();
  readonly duplicados = new Set<string>();
  parado = false;

  chave(alvo: AlvoRemoto): string {
    return `${alvo.remoto}:${alvo.pasta}/${alvo.relativo}`;
  }

  private item(chave: string, caminho: string): ItemRemoto {
    const arquivo = this.arquivos.get(chave) as { conteudo: Buffer; id: string };
    return {
      caminho,
      tamanho: arquivo.conteudo.length,
      sha256: this.semHash
        ? null
        : this.hashErrado
          ? 'f'.repeat(64)
          : createHash('sha256').update(arquivo.conteudo).digest('hex'),
      id: arquivo.id,
    };
  }

  copiarArquivo(origem: OrigemLocal, destino: AlvoRemoto): Promise<void> {
    this.chamadas.push('copyfile');
    if (this.copiasComCota > 0) {
      this.copiasComCota -= 1;
      return Promise.reject(new ErroDoRemoto('User rate limit exceeded', 403, true));
    }
    if (this.copiasComErro > 0) {
      this.copiasComErro -= 1;
      return Promise.reject(new ErroDoRemoto('erro de teste', 500, false));
    }
    const conteudo = readFileSync(join(origem.raiz, origem.relativo));
    this.arquivos.set(this.chave(destino), { conteudo, id: `id-${this.arquivos.size + 1}` });
    this.aposCopiar?.();
    return Promise.resolve();
  }

  statArquivo(alvo: AlvoRemoto): Promise<ItemRemoto | null> {
    this.chamadas.push('stat');
    this.aoStat?.();
    if (this.statsComCota > 0) {
      this.statsComCota -= 1;
      return Promise.reject(new ErroDoRemoto('User rate limit exceeded', 403, true));
    }
    const chave = this.chave(alvo);
    if (!this.arquivos.has(chave) || this.perdidos.has(alvo.relativo)) return Promise.resolve(null);
    return Promise.resolve(this.item(chave, alvo.relativo));
  }

  listarArquivos(alvo: AlvoRemoto): Promise<ItemRemoto[]> {
    this.chamadas.push('list');
    const raiz = `${alvo.remoto}:${alvo.pasta}/`;
    const prefixo = `${raiz}${alvo.relativo}/`;
    const itens: ItemRemoto[] = [];
    for (const chave of this.arquivos.keys()) {
      if (!chave.startsWith(prefixo)) continue;
      const caminho = chave.slice(raiz.length);
      const i = this.item(chave, caminho);
      itens.push(i);
      if (this.duplicados.has(caminho)) itens.push({ ...i, id: `${i.id}-copia` });
    }
    return Promise.resolve(itens);
  }

  apagarArquivo(alvo: AlvoRemoto): Promise<void> {
    this.chamadas.push('deletefile');
    if (!this.arquivos.delete(this.chave(alvo))) return Promise.reject(new ErroDoRemoto('object not found', 404, false));
    return Promise.resolve();
  }

  /** As proximas N leituras levantam um erro comum do remoto. */
  leiturasComErro = 0;
  /** Se definido, a leitura devolve estes bytes no lugar do conteudo guardado (remoto que corrompe). */
  conteudoTrocado: Buffer | undefined;
  /** A leitura nao termina ate o cliente ir embora (o sinal aborta): deixa o teste abandonar no meio. */
  leituraEmEspera = false;
  leituraAbortada = false;
  /** O prazo que a ultima leitura recebeu, em ms: prova o teto que o canal impoe. */
  ultimoPrazoMs: number | undefined;

  lerArquivo(alvo: AlvoRemoto, opcoes: OpcoesDeLeitura): Promise<Buffer | null> {
    this.chamadas.push('read');
    this.ultimoPrazoMs = opcoes.prazoMs;
    if (this.leiturasComErro > 0) {
      this.leiturasComErro -= 1;
      return Promise.reject(new ErroDoRemoto('erro de leitura de teste', 500, false));
    }
    if (this.leituraEmEspera) {
      return new Promise((_resolver, rejeitar) => {
        opcoes.sinal?.addEventListener('abort', () => {
          this.leituraAbortada = true;
          rejeitar(new ErroDoRemoto('leitura abortada', undefined, false));
        });
      });
    }
    const arquivo = this.arquivos.get(this.chave(alvo));
    if (arquivo === undefined || this.perdidos.has(alvo.relativo)) return Promise.resolve(null);
    const bytes = this.conteudoTrocado ?? arquivo.conteudo;
    if (bytes.length > opcoes.tamanhoMaximo) {
      return Promise.reject(new ErroDoRemoto('acima do maximo', undefined, false));
    }
    return Promise.resolve(Buffer.from(bytes));
  }

  parar(): Promise<void> {
    this.parado = true;
    return Promise.resolve();
  }
}
