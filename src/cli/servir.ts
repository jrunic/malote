import { once } from 'node:events';
import { abrirRegistro } from '../registro/registro.js';
import { criarServidor, PRAZO_PADRAO_MS, TRABALHADORES_PADRAO } from '../rede/servidor.js';
import { iniciarWorkerDeTranscricao } from './transcricao.js';
import { configuracaoDoMotor } from './motor-de-transcricao.js';
import type { Ambiente } from './index.js';

/** Os unicos enderecos que nao exigem ato explicito. */
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

const INTERVALO_DEFAULT_MS = 30_000;

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
  /** Injetavel para teste: por padrao, o worker de verdade. */
  iniciarWorker?: typeof iniciarWorkerDeTranscricao;
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
    escrever('Uso: malote servir --porta <n> [--endereco <ip>] [--exposto] [--trabalhadores <n>] [--prazo <segundos>]');
    return 2;
  }
  const trabalhadores = Number(opcao(argumentos, 'trabalhadores') ?? String(TRABALHADORES_PADRAO));
  if (!Number.isInteger(trabalhadores) || trabalhadores < 1 || trabalhadores > 16) {
    escrever('--trabalhadores precisa ser um inteiro de 1 a 16.');
    return 2;
  }
  const prazoSegundos = Number(opcao(argumentos, 'prazo') ?? String(PRAZO_PADRAO_MS / 1000));
  if (!Number.isInteger(prazoSegundos) || prazoSegundos < 1 || prazoSegundos > 300) {
    escrever('--prazo precisa ser um inteiro de 1 a 300 (segundos).');
    return 2;
  }
  const endereco = opcao(argumentos, 'endereco') ?? '127.0.0.1';
  const recusa = enderecoRecusado(endereco, argumentos.includes('--exposto'));
  if (recusa !== null) {
    escrever(recusa);
    return 2;
  }

  // O Registro e aberto UMA vez, para escrita, antes de aceitar requisicao: se a forma subiu de versao, a migracao
  // acontece aqui, e nao na disputa entre workers. Os workers o abrem somente-leitura.
  abrirRegistro(ambiente.dados).fechar();

  const servidor = (ambiente.criar ?? criarServidor)({
    dados: ambiente.dados,
    porta,
    trabalhadores,
    prazoMs: prazoSegundos * 1000,
  });
  // Um worker precisa subir ANTES de aceitar pedido: se ele nao carrega (caminho, dependencia, import quebrado), toda
  // leitura viraria 503 com o servico `active`. Recusar a subida e falhar no deploy, e nao no primeiro pedido.
  if (!(await servidor.despachante.aquecer(5000))) {
    escrever('Nao subi: o worker de leitura nao carregou em 5 s (veja a mensagem acima).');
    await servidor.pararLeituras(0);
    return 1;
  }
  servidor.listen(porta, endereco);
  // Espera pelo EVENTO, e nunca por tempo: a porta so existe depois dele.
  await once(servidor, 'listening');
  const alcance = servidor.address() as { address: string; port: number };
  escrever(`Servindo em http://${alcance.address}:${alcance.port}`);
  escrever(`Leituras em ${trabalhadores} workers, prazo de ${prazoSegundos} s.`);
  escrever(
    'Leitura por Chave de Acesso; escrita so em /transcricoes/solicitar e /envios/solicitar. ' +
      'Chave de Operador nao le acervo.',
  );

  // Log na subida do que o worker vai fazer — parte do "sinal proprio" do
  // criterio 4: quem opera sabe, sem precisar de --json, se a transcricao
  // vai rodar ou ficar parada.
  const motorConfigurado = configuracaoDoMotor(process.env) !== undefined;
  escrever(
    motorConfigurado
      ? '[transcricao] motor configurado; fila ativa.'
      : '[transcricao] motor NAO configurado (variaveis de ambiente do motor ausentes); fila parada.',
  );
  const intervaloMs = Number(process.env['MALOTE_TRANSCRICAO_INTERVALO_MS'] ?? String(INTERVALO_DEFAULT_MS));
  const pararWorker = (ambiente.iniciarWorker ?? iniciarWorkerDeTranscricao)(
    { dados: ambiente.dados, env: process.env, escrever },
    Number.isInteger(intervaloMs) && intervaloMs > 0 ? intervaloMs : INTERVALO_DEFAULT_MS,
  );

  return await new Promise<number>((resolver) => {
    const parar = (sinal: string): void => {
      escrever(`[servir] ${sinal} recebido; parando.`);
      pararWorker();
      servidor.close(); // para de aceitar (no Node >=19, `close` ja fecha as conexoes ociosas: `closeIdleConnections` seria redundante)
      void (async () => {
        await servidor.pararLeituras(5000); // espera as leituras por ate 5 s e termina os workers
        servidor.closeAllConnections();
        resolver(0);
      })();
    };
    process.once('SIGTERM', () => parar('SIGTERM'));
    process.once('SIGINT', () => parar('SIGINT'));
  });
}
