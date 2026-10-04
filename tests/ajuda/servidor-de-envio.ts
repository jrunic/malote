import { createServer, type Server } from 'node:http';
import { cenario } from './acervo.js';
import { criarServidor } from '../../src/rede/servidor.js';
import { emitirChaveDeAcesso } from '../../src/registro/chave-de-acesso.js';
import { abrirRegistro } from '../../src/registro/registro.js';
import { resolverConfiguracao } from '../../src/registro/configuracao-adaptador.js';
import { abrirAcervoSomenteLeitura } from '../../src/nucleo/acervo.js';

async function portaLivre(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const porta = (srv.address() as { port: number }).port;
  await new Promise<void>((r) => srv.close(() => r()));
  return porta;
}

export interface EnvioLido {
  estado: string;
  conteudo_tipo: string;
  conteudo_texto: string | null;
  conteudo_caminho_arquivo: string | null;
  conteudo_mimetype: string | null;
  conteudo_nome_arquivo: string | null;
}

export interface CenaDeEnvio {
  raiz: string;
  url: string;
  inquilinoId: string;
  /** Chave de Acesso do Inquilino "Hera", dono da Configuracao `hera`. */
  chave: { id: string; valor: string };
  /** Chave de Acesso de OUTRO Inquilino, que nao tem a Configuracao `hera`. */
  chaveDoOutro: { id: string; valor: string };
  lerEnvios: () => EnvioLido[];
  atorDoEnvio: () => string | undefined;
  encerrar: () => void;
}

/** Servidor de consulta REAL sobre um Acervo de fixture, com a Configuracao `hera` e duas chaves. */
export async function subirCenaDeEnvio(): Promise<CenaDeEnvio> {
  const c = cenario();
  const { id: inquilinoId, acervo } = c.novoInquilino('Hera');
  acervo.fechar();
  const { id: outroId, acervo: acervoDoOutro } = c.novoInquilino('Titular');
  acervoDoOutro.fechar();
  const registro = abrirRegistro(c.raiz);
  resolverConfiguracao(registro, inquilinoId, 'whatsapp', 'hera');
  const chave = emitirChaveDeAcesso(registro, inquilinoId);
  const chaveDoOutro = emitirChaveDeAcesso(registro, outroId);
  registro.fechar();

  const porta = await portaLivre();
  const srv = criarServidor({ dados: c.raiz, porta });
  await new Promise<void>((r) => srv.listen(porta, '127.0.0.1', r));

  return {
    raiz: c.raiz,
    url: `http://127.0.0.1:${porta}`,
    inquilinoId,
    chave: { id: chave.id, valor: chave.valor },
    chaveDoOutro: { id: chaveDoOutro.id, valor: chaveDoOutro.valor },
    lerEnvios: () => {
      const a = abrirAcervoSomenteLeitura(`${c.raiz}/acervos`, inquilinoId);
      try {
        return a
          .preparar(
            `SELECT estado, conteudo_tipo, conteudo_texto, conteudo_caminho_arquivo,
                    conteudo_mimetype, conteudo_nome_arquivo FROM envios ORDER BY rowid`,
          )
          .all() as EnvioLido[];
      } finally {
        a.fechar();
      }
    },
    atorDoEnvio: () => {
      const a = abrirAcervoSomenteLeitura(`${c.raiz}/acervos`, inquilinoId);
      try {
        const o = a.db
          .prepare(`SELECT ator FROM operacoes WHERE natureza = 'solicitar-envio' ORDER BY rowid DESC LIMIT 1`)
          .get() as { ator: string } | undefined;
        return o?.ator;
      } finally {
        a.fechar();
      }
    },
    encerrar: () => {
      srv.closeAllConnections();
      srv.close();
      c.limpar();
    },
  };
}

export interface ServidorContador {
  url: string;
  requisicoes: () => number;
  fechar: () => void;
}

/** Servidor que CONTA o que recebe e responde 500: prova de "recusou antes de abrir conexao". */
export async function subirServidorContador(): Promise<ServidorContador> {
  let n = 0;
  const srv: Server = createServer((req, res) => {
    n += 1;
    req.resume();
    res.writeHead(500);
    res.end();
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const porta = (srv.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${porta}`,
    requisicoes: () => n,
    fechar: () => {
      srv.closeAllConnections();
      srv.close();
    },
  };
}
