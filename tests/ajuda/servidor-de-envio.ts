import { createServer, type Server } from 'node:http';
import { cenario } from './acervo.js';
import { criarServidor } from '../../src/rede/servidor.js';
import { emitirChaveDeAcesso } from '../../src/registro/chave-de-acesso.js';
import { abrirRegistro } from '../../src/registro/registro.js';
import { resolverConfiguracao } from '../../src/registro/configuracao-adaptador.js';
import { abrirAcervo, abrirAcervoSomenteLeitura } from '../../src/nucleo/acervo.js';
import { registrarEnvio } from '../../src/nucleo/envio.js';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

async function portaLivre(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const porta = (srv.address() as { port: number }).port;
  await new Promise<void>((r) => srv.close(() => r()));
  return porta;
}

export interface EnvioLido {
  identificador_de_envio: string;
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
  /** Chave de Acesso de um terceiro Inquilino que TEM a Configuracao `hera` (o escopo do identificador). */
  chaveDeOutroComHera: { id: string; valor: string };
  lerEnviosDeOutroComHera: () => EnvioLido[];
  /** Quantas Operacoes `solicitar-envio` o Acervo do Inquilino tem. */
  operacoesDeSolicitacao: () => number;
  /** Arquivos que sobraram em `envios-pendentes/` (zero quando a pasta nem existe). */
  arquivosEmStaging: () => number;
  atorDoEnvio: () => string | undefined;
  encerrar: () => void;
}

export interface OpcoesDaCena {
  /** Chamado entre o exame de repeticao e o registro: simula o outro processo que ganha a corrida. */
  entreOExameEORegistro?: (inserirComoVencedor: (mimetype?: string) => void) => void;
}

/** Servidor de consulta REAL sobre um Acervo de fixture, com a Configuracao `hera` e duas chaves. */
export async function subirCenaDeEnvio(opcoes: OpcoesDaCena = {}): Promise<CenaDeEnvio> {
  const c = cenario();
  const { id: inquilinoId, acervo } = c.novoInquilino('Hera');
  acervo.fechar();
  const { id: outroId, acervo: acervoDoOutro } = c.novoInquilino('Titular');
  acervoDoOutro.fechar();
  const registro = abrirRegistro(c.raiz);
  const configuracaoDaHera = resolverConfiguracao(registro, inquilinoId, 'whatsapp', 'hera');
  const chave = emitirChaveDeAcesso(registro, inquilinoId);
  const chaveDoOutro = emitirChaveDeAcesso(registro, outroId);
  const { id: terceiroId, acervo: acervoDoTerceiro } = c.novoInquilino('Terceiro');
  acervoDoTerceiro.fechar();
  resolverConfiguracao(registro, terceiroId, 'whatsapp', 'hera');
  const chaveDoTerceiro = emitirChaveDeAcesso(registro, terceiroId);
  registro.fechar();

  const lerDe = (id: string): EnvioLido[] => {
    const a = abrirAcervoSomenteLeitura(`${c.raiz}/acervos`, id as never);
    try {
      return a
        .preparar(
          `SELECT identificador_de_envio, estado, conteudo_tipo, conteudo_texto, conteudo_caminho_arquivo,
                  conteudo_mimetype, conteudo_nome_arquivo FROM envios ORDER BY rowid`,
        )
        .all() as EnvioLido[];
    } finally {
      a.fechar();
    }
  };

  const inserirComoVencedor = (mimetype = 'image/png'): void => {
    // O vencedor grava como a rota grava: staging em `envios-pendentes/`, referenciado pelo Envio dele.
    const pasta = join(c.raiz, 'envios-pendentes');
    mkdirSync(pasta, { recursive: true });
    const caminho = join(pasta, 'staging-do-vencedor');
    writeFileSync(caminho, Buffer.from('bytes'));
    const a = abrirAcervo(`${c.raiz}/acervos`, inquilinoId as never);
    try {
      registrarEnvio(a, {
        configuracaoId: configuracaoDaHera.id,
        destino: { enderecoCru: '5511999990000@s.whatsapp.net' },
        conteudo: { tipo: 'imagem', caminhoArquivo: caminho, mimetype },
        identificadorDeEnvio: '3f2b8c1e-5d4a-4e7b-9c10-1a2b3c4d5e6f',
        fonte: 'whatsapp',
      });
    } finally {
      a.fechar();
    }
  };

  const porta = await portaLivre();
  const srv = criarServidor({
    dados: c.raiz,
    porta,
    ...(opcoes.entreOExameEORegistro
      ? {
          ganchoDeTeste: {
            entreOExameEORegistro: () => opcoes.entreOExameEORegistro?.(inserirComoVencedor),
          },
        }
      : {}),
  });
  await new Promise<void>((r) => srv.listen(porta, '127.0.0.1', r));

  return {
    raiz: c.raiz,
    url: `http://127.0.0.1:${porta}`,
    inquilinoId,
    chave: { id: chave.id, valor: chave.valor },
    chaveDoOutro: { id: chaveDoOutro.id, valor: chaveDoOutro.valor },
    lerEnvios: () => lerDe(inquilinoId),
    chaveDeOutroComHera: { id: chaveDoTerceiro.id, valor: chaveDoTerceiro.valor },
    lerEnviosDeOutroComHera: () => lerDe(terceiroId),
    operacoesDeSolicitacao: () => {
      const a = abrirAcervoSomenteLeitura(`${c.raiz}/acervos`, inquilinoId);
      try {
        return (
          a.db
            .prepare(`SELECT COUNT(*) AS n FROM operacoes WHERE natureza = 'solicitar-envio'`)
            .get() as {
            n: number;
          }
        ).n;
      } finally {
        a.fechar();
      }
    },
    arquivosEmStaging: () => {
      const pasta = join(c.raiz, 'envios-pendentes');
      return existsSync(pasta) ? readdirSync(pasta).length : 0;
    },
    atorDoEnvio: () => {
      const a = abrirAcervoSomenteLeitura(`${c.raiz}/acervos`, inquilinoId);
      try {
        const o = a.db
          .prepare(
            `SELECT ator FROM operacoes WHERE natureza = 'solicitar-envio' ORDER BY rowid DESC LIMIT 1`,
          )
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
