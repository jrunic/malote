import { chmodSync, mkdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname } from 'node:path';
import { TAMANHO_MAXIMO_PADRAO_DA_MIDIA_REMOTA } from '../nucleo/midia-remota.js';
import { caminhoDoSoquete } from './caminho-do-soquete.js';
import { entregarAnexo } from './entrega-de-anexo.js';
import type { DependenciasDoServico } from './servico-de-armazenamento.js';

export { caminhoDoSoquete };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const ENTREGAS_EM_VOO_PADRAO = 4;
export const PRAZO_DA_ENTREGA_PADRAO_MS = 25_000;

export interface OpcoesDoServidorDoServico {
  tamanhoMaximo?: number;
  entregasEmVoo?: number;
  /** O prazo que o pedido traz no cabecalho nao passa deste. */
  prazoMaximoMs?: number;
}

export interface ServidorDoServico {
  fechar(): Promise<void>;
}

/**
 * O canal servidor→servico: `GET /anexo/<inquilino>/<anexo>` num soquete de dominio Unix. So atende quem ja esta no
 * host com o mesmo usuario (a pasta e o soquete nao dao acesso a outro), e o pedido e por Inquilino e Anexo, nunca por
 * caminho. Respostas: 200 com os bytes; 404 sem Localizacao; 413 acima do tamanho maximo; 502 inacessivel (a razao no
 * corpo, sem dado pessoal); 503 com entregas demais em voo ou parando. O log leva so identificadores do produto.
 */
export async function iniciarServidorDoServico(
  dep: DependenciasDoServico,
  opcoes: OpcoesDoServidorDoServico = {},
): Promise<ServidorDoServico> {
  const soquete = caminhoDoSoquete(dep.estado);
  mkdirSync(dirname(soquete), { recursive: true, mode: 0o700 });
  // O arquivo do soquete de uma execucao anterior que morreu: a trava de instancia ja garantiu que este e o unico servico.
  rmSync(soquete, { force: true });

  const tamanhoMaximo = opcoes.tamanhoMaximo ?? TAMANHO_MAXIMO_PADRAO_DA_MIDIA_REMOTA;
  const limiteEmVoo = opcoes.entregasEmVoo ?? ENTREGAS_EM_VOO_PADRAO;
  const prazoMaximo = opcoes.prazoMaximoMs ?? PRAZO_DA_ENTREGA_PADRAO_MS;
  let emVoo = 0;
  let parando = false;

  const servidor: Server = createServer((req, res) => {
    const json = (status: number, corpo: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(corpo));
    };
    const partes = (req.url ?? '').split('?')[0]?.split('/').filter((p) => p !== '') ?? [];
    if (req.method !== 'GET' || partes.length !== 3 || partes[0] !== 'anexo') {
      json(404, { erro: 'rota desconhecida' });
      return;
    }
    const [, inquilinoId, anexoId] = partes as [string, string, string];
    if (!ID.test(inquilinoId) || !ID.test(anexoId)) {
      json(400, { erro: 'identificador invalido' });
      return;
    }
    if (parando || emVoo >= limiteEmVoo) {
      res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '1' });
      res.end(JSON.stringify({ erro: parando ? 'parando' : 'ocupado' }));
      return;
    }
    const pedido = Number(req.headers['x-malote-prazo-ms']);
    const prazoMs = Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, prazoMaximo) : prazoMaximo;
    const abandono = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abandono.abort();
    });
    emVoo += 1;
    void entregarAnexo(dep, inquilinoId, anexoId, { tamanhoMaximo, prazoMs, sinal: abandono.signal })
      .then((r) => {
        if (res.destroyed) return;
        switch (r.tipo) {
          case 'bytes':
            res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(r.bytes.length) });
            res.end(r.bytes);
            return;
          case 'sem-localizacao':
            json(404, { erro: 'sem localizacao' });
            return;
          case 'grande-demais':
            json(413, { erro: 'acima do tamanho maximo', tamanho: r.tamanho, maximo: r.maximo });
            return;
          case 'inacessivel':
            dep.escrever(`[armazenamento] entrega: Anexo ${anexoId} (Inquilino ${inquilinoId}) inacessivel — ${r.motivo}`);
            json(502, { erro: 'inacessivel', motivo: r.motivo });
            return;
          case 'servico-fora':
          case 'ocupado':
            json(503, { erro: r.tipo === 'ocupado' ? 'ocupado' : 'servico fora' });
            return;
        }
      })
      .catch((erro: unknown) => {
        dep.escrever(`[armazenamento] entrega: Anexo ${anexoId} falhou — ${erro instanceof Error ? erro.message : String(erro)}`);
        if (!res.destroyed && !res.headersSent) json(502, { erro: 'inacessivel', motivo: 'falha interna da entrega' });
      })
      .finally(() => {
        emVoo -= 1;
      });
  });

  await new Promise<void>((resolver, rejeitar) => {
    servidor.once('error', rejeitar);
    servidor.listen(soquete, () => {
      servidor.off('error', rejeitar);
      resolver();
    });
  });
  chmodSync(soquete, 0o600);

  return {
    async fechar() {
      parando = true;
      servidor.closeAllConnections();
      await new Promise<void>((resolver) => servidor.close(() => resolver()));
      rmSync(soquete, { force: true });
    },
  };
}
