import { once } from 'node:events';
import type { Server } from 'node:http';
import { instalacaoTemporaria } from './instalacao.js';
import { abrirRegistro, criarInquilino, type Registro } from '../../src/registro/registro.js';
import { abrirAcervo } from '../../src/nucleo/acervo.js';
import { registrarConversa, registrarMensagem } from '../../src/nucleo/escrita.js';
import {
  emitirChaveDeAcesso,
  revogarChaveDeAcesso,
  type ChaveDeAcessoCriada,
} from '../../src/registro/chave-de-acesso.js';
import { criarChaveDeOperador } from '../../src/registro/chave-operador.js';
import { criarServidor } from '../../src/rede/servidor.js';
import { join } from 'node:path';
import { CFG_WHATSAPP } from './configuracao.js';

export interface Resposta {
  status: number;
  corpo: string;
}

export interface CenarioDeRede {
  inquilinoA: string;
  inquilinoB: string;
  /** A Conversa de cada Inquilino, para o teste de isolamento nomear o que procura. */
  conversaDeA: string;
  conversaDeB: string;
  chaveDeOperador: string;
  endereco: string;
  /** Para testes que precisam criar Configuracao/Conversa fora do povoamento padrao. */
  registro: Registro;
  raiz: string;
  emitir: (inquilinoId: string) => ChaveDeAcessoCriada;
  revogar: (chaveId: string) => void;
  pedir: (caminho: string, chave?: string) => Promise<Resposta>;
  pedirBinario: (caminho: string, chave?: string) => Promise<{
    status: number;
    contentType: string | null;
    bytes: Buffer;
  }>;
  parar: () => Promise<void>;
}

/**
 * Instalacao com DOIS Inquilinos POVOADOS, e um servidor em porta efemera.
 *
 * Dois porque teste de isolamento com um so passa por vacuidade: nao ha de onde
 * vazar, e a guarda poderia estar desligada sem que nada acusasse.
 *
 * Porta efemera porque porta fixa faz execucoes concorrentes brigarem, e a
 * briga aparece como falha intermitente — a pior de diagnosticar.
 */
export async function cenarioDeRede(): Promise<CenarioDeRede> {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro: Registro = abrirRegistro(raiz);
  const chaveDeOperador = criarChaveDeOperador(registro).valor;

  // A Conversa e identificada pelo ID que o nucleo da, e nao pelo endereco da
  // Fonte: a listagem NAO expoe `id_externo`, e isso e deliberado — ele e o
  // endereco, e endereco nao vaza em listagem. O id e unico e serve melhor.
  const povoar = (nome: string, idExterno: string): { inquilino: string; conversa: string } => {
    const inquilino = criarInquilino(registro, { titularNome: nome });
    const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
    try {
      const conversa = registrarConversa(acervo, {
        fonte: 'whatsapp',
        idExterno,
        coletiva: false, configuracao: CFG_WHATSAPP,
        bruto: '{}',
      });
      // Com Mensagem, e nao so com Conversa: a rota de mensagens de uma
      // Conversa vazia responde igual a de uma inexistente — de proposito —, e
      // um cenario sem Mensagem nao distinguiria o dono de quem nao e.
      registrarMensagem(acervo, {
        conversaId: conversa,
        fonte: 'whatsapp',
        idExterno: `msg-${idExterno}`,
        conteudo: `mensagem de ${nome}`,
        ocorridaEm: Date.parse('2026-06-01T12:00:00Z'),
        agora: Date.now(),
      });
      return { inquilino, conversa };
    } finally {
      acervo.fechar();
    }
  };
  const a = povoar('Titular A', '5565900000001@s.whatsapp.net');
  const b = povoar('Titular B', '5565900000002@s.whatsapp.net');
  const inquilinoA = a.inquilino;
  const inquilinoB = b.inquilino;

  const servidor: Server = criarServidor({ dados: raiz, porta: 0 });
  servidor.listen(0, '127.0.0.1');
  // A porta so existe DEPOIS do evento: `address()` antes dele devolve null, e
  // o teste que lesse ali falharia de forma intermitente. Espera por EVENTO,
  // nunca por tempo.
  await once(servidor, 'listening');
  const { address, port } = servidor.address() as { address: string; port: number };

  return {
    inquilinoA,
    inquilinoB,
    conversaDeA: a.conversa,
    conversaDeB: b.conversa,
    chaveDeOperador,
    endereco: address,
    registro,
    raiz,
    emitir: (inquilinoId) => emitirChaveDeAcesso(registro, inquilinoId),
    revogar: (chaveId) => revogarChaveDeAcesso(registro, chaveId),
    pedir: async (caminho, chave) => {
      const cabecalhos: Record<string, string> = {};
      if (chave !== undefined) cabecalhos['authorization'] = `Bearer ${chave}`;
      const r = await fetch(`http://${address}:${port}${caminho}`, { headers: cabecalhos });
      return { status: r.status, corpo: await r.text() };
    },
    pedirBinario: async (caminho, chave) => {
      const cabecalhos: Record<string, string> = {};
      if (chave !== undefined) cabecalhos['authorization'] = `Bearer ${chave}`;
      const r = await fetch(`http://${address}:${port}${caminho}`, { headers: cabecalhos });
      const bytes = Buffer.from(await r.arrayBuffer());
      return { status: r.status, contentType: r.headers.get('content-type'), bytes };
    },
    parar: async () => {
      servidor.close();
      // Aguarda o fechamento, senao o processo segura o socket e a proxima
      // porta efemera pode colidir.
      await once(servidor, 'close');
      registro.fechar();
      limpar();
    },
  };
}
