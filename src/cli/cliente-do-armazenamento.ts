import { request } from 'node:http';
import type {
  BuscadorDeMidiaRemota,
  ConsultorDeLocalizacoes,
  LocalizacaoParaOIndice,
  PedidoDeBusca,
  PedidoDeLocalizacoes,
  ResultadoDaBusca,
  ResultadoDasLocalizacoes,
} from '../nucleo/midia-remota.js';
import { caminhoDoSoquete } from './caminho-do-soquete.js';

/**
 * O outro lado do canal local: pede ao Servico de Armazenamento, pelo soquete, os bytes de um Anexo. Quem usa e o
 * servidor de consulta e a transcricao (ambos recebem esta funcao de `servir`, que e quem sabe onde o soquete mora).
 *
 * "O servico nao esta no ar" (soquete ausente ou recusado) e um resultado, nao uma excecao: para quem pede e diferente
 * de "nao existe", e quem decide o que fazer e quem chamou.
 */
export function criarBuscadorDeMidiaRemota(estado: string): BuscadorDeMidiaRemota {
  const soquete = caminhoDoSoquete(estado);
  return (pedido: PedidoDeBusca) => buscar(soquete, pedido);
}

function buscar(soquete: string, pedido: PedidoDeBusca): Promise<ResultadoDaBusca> {
  return new Promise((resolver) => {
    let concluido = false;
    const concluir = (r: ResultadoDaBusca): void => {
      if (concluido) return;
      concluido = true;
      clearTimeout(relogio);
      resolver(r);
    };
    const req = request(
      {
        socketPath: soquete,
        path: `/anexo/${encodeURIComponent(pedido.inquilinoId)}/${encodeURIComponent(pedido.anexoId)}`,
        method: 'GET',
        // Uma conexao por pedido: keep-alive reaproveitaria o soquete de um servico que ja reiniciou (EPIPE).
        agent: false,
        headers: { 'x-malote-prazo-ms': String(Math.max(1, Math.floor(pedido.prazoMs))) },
        ...(pedido.sinal === undefined ? {} : { signal: pedido.sinal }),
      },
      (res) => {
        const pedacos: Buffer[] = [];
        res.on('data', (p: Buffer) => pedacos.push(p));
        res.on('error', () => concluir({ tipo: 'inacessivel', motivo: 'a conexao com o servico caiu na leitura' }));
        res.on('end', () => {
          const corpo = Buffer.concat(pedacos);
          const status = res.statusCode ?? 0;
          if (status === 200) return concluir({ tipo: 'bytes', bytes: corpo });
          let json: { tamanho?: number; maximo?: number; motivo?: string; erro?: string } = {};
          try {
            json = JSON.parse(corpo.toString('utf8')) as typeof json;
          } catch {
            // corpo que nao e JSON: so o status vale
          }
          if (status === 404) return concluir({ tipo: 'sem-localizacao' });
          if (status === 413) {
            return concluir({ tipo: 'grande-demais', tamanho: json.tamanho ?? 0, maximo: json.maximo ?? 0 });
          }
          // 503 com `ocupado` e o limite de entregas em voo do Servico (repetir resolve); o resto do 503 e Servico parando.
          if (status === 503) return concluir({ tipo: json.erro === 'ocupado' ? 'ocupado' : 'servico-fora' });
          return concluir({ tipo: 'inacessivel', motivo: json.motivo ?? `o servico respondeu ${status}` });
        });
      },
    );
    // Prazo do pedido: o proprio relogio (o `signal` so cobre o abandono pelo cliente).
    const relogio = setTimeout(() => {
      req.destroy();
      concluir({ tipo: 'inacessivel', motivo: 'o servico nao respondeu no prazo' });
    }, Math.max(1, pedido.prazoMs));
    req.on('error', (erro: NodeJS.ErrnoException) => {
      if (pedido.sinal?.aborted === true) return concluir({ tipo: 'inacessivel', motivo: 'pedido abandonado' });
      if (erro.code === 'ENOENT' || erro.code === 'ECONNREFUSED') return concluir({ tipo: 'servico-fora' });
      return concluir({ tipo: 'inacessivel', motivo: `canal com o servico: ${erro.message}` });
    });
    req.end();
  });
}

/** Pede ao Servico as Localizacoes de uma pagina do Indice de Midia. O Servico fora do ar e um resultado, nao uma excecao. */
export function criarConsultorDeLocalizacoes(estado: string): ConsultorDeLocalizacoes {
  const soquete = caminhoDoSoquete(estado);
  return (pedido: PedidoDeLocalizacoes) => consultar(soquete, pedido);
}

function consultar(soquete: string, pedido: PedidoDeLocalizacoes): Promise<ResultadoDasLocalizacoes> {
  return new Promise((resolver) => {
    let concluido = false;
    const concluir = (r: ResultadoDasLocalizacoes): void => {
      if (concluido) return;
      concluido = true;
      clearTimeout(relogio);
      resolver(r);
    };
    const corpo = JSON.stringify({ inquilino: pedido.inquilinoId, anexos: pedido.anexoIds });
    const req = request(
      {
        socketPath: soquete,
        path: '/localizacoes',
        method: 'POST',
        agent: false,
        headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(corpo)) },
        ...(pedido.sinal === undefined ? {} : { signal: pedido.sinal }),
      },
      (res) => {
        const pedacos: Buffer[] = [];
        res.on('data', (p: Buffer) => pedacos.push(p));
        res.on('error', () => concluir({ tipo: 'inacessivel', motivo: 'a conexao com o servico caiu na leitura' }));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          let json: { localizacoes?: Record<string, LocalizacaoParaOIndice>; motivo?: string; erro?: string } = {};
          try {
            json = JSON.parse(Buffer.concat(pedacos).toString('utf8')) as typeof json;
          } catch {
            // corpo que nao e JSON: so o status vale
          }
          if (status === 200 && json.localizacoes !== undefined) return concluir({ tipo: 'localizacoes', porAnexo: json.localizacoes });
          if (status === 503) return concluir({ tipo: json.erro === 'ocupado' ? 'ocupado' : 'servico-fora' });
          return concluir({ tipo: 'inacessivel', motivo: json.motivo ?? json.erro ?? `o servico respondeu ${status}` });
        });
      },
    );
    const relogio = setTimeout(() => {
      req.destroy();
      concluir({ tipo: 'inacessivel', motivo: 'o servico nao respondeu no prazo' });
    }, Math.max(1, pedido.prazoMs));
    req.on('error', (erro: NodeJS.ErrnoException) => {
      if (pedido.sinal?.aborted === true) return concluir({ tipo: 'inacessivel', motivo: 'pedido abandonado' });
      if (erro.code === 'ENOENT' || erro.code === 'ECONNREFUSED') return concluir({ tipo: 'servico-fora' });
      return concluir({ tipo: 'inacessivel', motivo: `canal com o servico: ${erro.message}` });
    });
    req.end(corpo);
  });
}
