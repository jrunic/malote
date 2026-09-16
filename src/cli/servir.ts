import { once } from 'node:events';
import { criarServidor } from '../rede/servidor.js';
import type { Ambiente } from './index.js';

/** Os unicos enderecos que nao exigem ato explicito. */
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export function enderecoRecusado(endereco: string, exposto: boolean): string | null {
  if (exposto || LOOPBACK.has(endereco)) return null;
  // A recusa DIZ O QUE FAZER. Recusar em silencio seria pior que aceitar: quem
  // opera ficaria sem saber por que o comando nao subiu, e o caminho comum
  // viraria tentar de novo ate acertar por acaso.
  return (
    `Recusado: ${endereco} e alcancavel de fora da maquina, e a Chave de Acesso ` +
    'viaja no cabecalho da requisicao.\n' +
    'Este produto NAO termina TLS — a exposicao e de quem opera, atras de um ' +
    'terminador (proxy reverso com certificado).\n' +
    'Se e isso mesmo que voce quer, repita com --exposto.'
  );
}

export interface AmbienteDeServico extends Ambiente {
  /** Injetavel para teste: por padrao, o servidor de verdade. */
  criar?: typeof criarServidor;
}

function opcao(argumentos: string[], nome: string): string | undefined {
  const i = argumentos.indexOf(`--${nome}`);
  if (i === -1) return undefined;
  return argumentos[i + 1];
}

export async function servir(argumentos: string[], ambiente: AmbienteDeServico): Promise<number> {
  const { escrever } = ambiente;
  const porta = Number(opcao(argumentos, 'porta') ?? '0');
  if (!Number.isInteger(porta) || porta < 0 || porta > 65535) {
    escrever('Uso: malote servir --porta <n> [--endereco <ip>] [--exposto]');
    return 2;
  }
  const endereco = opcao(argumentos, 'endereco') ?? '127.0.0.1';
  const recusa = enderecoRecusado(endereco, argumentos.includes('--exposto'));
  if (recusa !== null) {
    escrever(recusa);
    return 2;
  }

  const servidor = (ambiente.criar ?? criarServidor)({ dados: ambiente.dados, porta });
  servidor.listen(porta, endereco);
  // Espera pelo EVENTO, e nunca por tempo: a porta so existe depois dele.
  await once(servidor, 'listening');
  const alcance = servidor.address() as { address: string; port: number };
  escrever(`Servindo em http://${alcance.address}:${alcance.port}`);
  escrever('Somente leitura, e so com Chave de Acesso. Chave de Operador nao le acervo.');

  return await new Promise<number>((resolver) => {
    const parar = (sinal: string): void => {
      escrever(`[servir] ${sinal} recebido; parando.`);
      servidor.close();
      resolver(0);
    };
    process.once('SIGTERM', () => parar('SIGTERM'));
    process.once('SIGINT', () => parar('SIGINT'));
  });
}
