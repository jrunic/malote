import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { opcao, recusarBandeiras, temBandeira } from './bandeiras.js';
import type { Ambiente } from './index.js';
import {
  MENSAGEM_RCLONE_NAO_DECLARADO,
  configuracaoDoRclone,
  iniciarRclone,
  type ConfiguracaoDoRclone,
  type Remoto,
} from './motor-de-armazenamento.js';
import {
  conferirPorAmostra,
  estadoDoArmazenamento,
  inquilinosComDestinoRemoto,
  passadaDeApagarCopiaLocal,
  passadaDeDescartados,
  passadaDeEnvio,
  reconstruirLocalizacao,
  type DependenciasDoServico,
  type GrupoDeTipos,
} from './servico-de-armazenamento.js';

/**
 * `malote armazenamento`: o Servico de Armazenamento e seus comandos de campo.
 * Processo proprio, como `servir` e `ouvir`: `executar()` continua sincrona e
 * este modulo e despachado antes dela. O que o servico decide mora em
 * `servico-de-armazenamento.ts`; o que fala com o rclone, em
 * `motor-de-armazenamento.ts`. Sem o binario do rclone declarado o servico nao sobe, e o
 * resto do produto nao muda.
 *
 * Codigos de saida: 0 ok ou parada pedida (SIGTERM/SIGINT); 1 veredito (envio
 * com falha, divergencia no remoto) ou o rclone nao subiu; 2 invocacao ou
 * configuracao errada (o unit NAO reinicia).
 */

export interface AmbienteDeArmazenamento extends Ambiente {
  env?: Record<string, string | undefined>;
  /** Injetavel nos testes: devolve o Remoto sem subir `rclone`. */
  iniciarRemoto?: (config: ConfiguracaoDoRclone, env: Record<string, string | undefined>) => Promise<Remoto>;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
}

const PREFIXO = '[armazenamento]';
const USO =
  'Uso: malote armazenamento servir\n' +
  '     malote armazenamento passada --inquilino <id> [--grupo video|resto|todos] [--limite <n>] [--ensaio]\n' +
  '     malote armazenamento apagar-local --inquilino <id>\n' +
  '     malote armazenamento conferir --inquilino <id> [--amostra <n>]\n' +
  '     malote armazenamento reconstruir --inquilino <id> [--confirmo]\n' +
  '     malote armazenamento estado --inquilino <id> [--json]';

/**
 * O arquivo que diz que um servico esta no ar (o pid dele). Duas instancias disputariam a mesma porta do `rcd` e a mesma
 * base; e `reconstruir` apaga a base por baixo de quem a tem aberta. Os comandos de campo que ESCREVEM recusam com o
 * servico vivo.
 */
function caminhoDaTrava(estado: string): string {
  return join(estado, 'armazenamento', 'servico.pid');
}

/** O pid do servico vivo, ou `undefined`: sem arquivo, ou o arquivo e de um processo que ja morreu. */
export function servicoVivo(estado: string): number | undefined {
  let pid: number;
  try {
    pid = Number(readFileSync(caminhoDaTrava(estado), 'utf8').trim());
  } catch {
    return undefined;
  }
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    process.kill(pid, 0);
    return pid;
  } catch (erro) {
    return (erro as NodeJS.ErrnoException).code === 'EPERM' ? pid : undefined;
  }
}

function adquirirTrava(estado: string): boolean {
  mkdirSync(join(estado, 'armazenamento'), { recursive: true, mode: 0o700 });
  const vivo = servicoVivo(estado);
  if (vivo !== undefined && vivo !== process.pid) return false;
  writeFileSync(caminhoDaTrava(estado), String(process.pid), { mode: 0o600 });
  return true;
}

function soltarTrava(estado: string): void {
  rmSync(caminhoDaTrava(estado), { force: true });
}

const INTERVALO_PADRAO_MS = 60_000;
const CHECAGEM_PADRAO_MS = 6 * 60 * 60 * 1000;
const AMOSTRA_PADRAO = 50;

function inteiroPositivo(valor: string | undefined, padrao: number): number {
  const n = valor === undefined ? NaN : Number(valor);
  return Number.isInteger(n) && n > 0 ? n : padrao;
}

const dormirDeVerdade = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** O Remoto que `estado` recebe: ele nunca fala com o remoto, e usa-lo e defeito. */
const REMOTO_INERTE: Remoto = {
  copiarArquivo: () => Promise.reject(new Error('estado nao fala com o remoto')),
  statArquivo: () => Promise.reject(new Error('estado nao fala com o remoto')),
  listarArquivos: () => Promise.reject(new Error('estado nao fala com o remoto')),
  apagarArquivo: () => Promise.reject(new Error('estado nao fala com o remoto')),
  parar: () => Promise.resolve(),
};

function dependencias(ambiente: AmbienteDeArmazenamento, remoto: Remoto, parou?: () => boolean): DependenciasDoServico {
  return {
    dados: ambiente.dados,
    estado: ambiente.estado,
    remoto,
    agora: ambiente.agora ?? Date.now,
    dormir: ambiente.dormir ?? dormirDeVerdade,
    escrever: ambiente.escrever,
    ...(parou === undefined ? {} : { parou }),
  };
}

async function comRemoto<T>(
  ambiente: AmbienteDeArmazenamento,
  usar: (remoto: Remoto) => Promise<T>,
): Promise<T | number> {
  const env = ambiente.env ?? process.env;
  const config = configuracaoDoRclone(env);
  if (config === undefined) {
    ambiente.escrever(`${PREFIXO} ${MENSAGEM_RCLONE_NAO_DECLARADO}`);
    return 2;
  }
  let remoto: Remoto;
  try {
    remoto = await (ambiente.iniciarRemoto ?? iniciarRclone)(config, env);
  } catch (erro) {
    ambiente.escrever(`${PREFIXO} O rclone nao subiu: ${(erro as Error).message}`);
    return 1;
  }
  try {
    return await usar(remoto);
  } finally {
    await remoto.parar();
  }
}

function linhaDeEnvio(inquilino: string, r: Awaited<ReturnType<typeof passadaDeEnvio>>): string {
  return (
    `${PREFIXO} Inquilino ${inquilino} (${r.grupo})${r.ensaio ? ' [ensaio]' : ''}: ` +
    `${r.examinados} examinado(s), ${r.jaEnviados} ja enviado(s), ${r.enviados} enviado(s) (${r.bytesEnviados} bytes), ` +
    `${r.adiados} adiado(s), ${r.falhos} com falha, ${r.limitesDeCota} limite(s) de cota${r.interrompida ? ', interrompida' : ''}.`
  );
}

export async function armazenamento(argumentos: string[], ambiente: AmbienteDeArmazenamento): Promise<number> {
  const { escrever } = ambiente;
  const recusa = recusarBandeiras(argumentos, escrever);
  if (recusa !== undefined) return recusa;
  if (ambiente.servidor !== undefined) {
    // O armazenamento remoto roda no HOST que tem o Acervo: nao ha o que pedir a um servidor por rede.
    escrever('O armazenamento remoto e uma operacao LOCAL (roda no host): nao use com MALOTE_SERVIDOR.');
    return 2;
  }
  const sub = argumentos[1];

  if (sub === 'servir') return servirEmLaco(ambiente);

  if (sub !== 'passada' && sub !== 'apagar-local' && sub !== 'conferir' && sub !== 'reconstruir' && sub !== 'estado') {
    escrever(USO);
    return 2;
  }
  const inquilino = opcao(argumentos, 'inquilino');
  if (inquilino === undefined) {
    escrever(`Informe --inquilino.\n${USO}`);
    return 2;
  }

  for (const flag of ['limite', 'amostra'] as const) {
    const valor = opcao(argumentos, flag);
    if (valor !== undefined && !/^[1-9]\d*$/.test(valor)) {
      escrever(`--${flag} precisa ser um inteiro maior que zero.`);
      return 2;
    }
  }
  const soLeitura = sub === 'estado' || (sub === 'passada' && temBandeira(argumentos, 'ensaio'));
  if (!soLeitura) {
    const vivo = servicoVivo(ambiente.estado);
    if (vivo !== undefined) {
      escrever(
        `${PREFIXO} O servico esta no ar (pid ${vivo}): pare-o antes de rodar "armazenamento ${sub}" ` +
          '(dois escritores na mesma base, e reconstruir apagaria a base por baixo dele). Leitura: estado e passada --ensaio.',
      );
      return 2;
    }
  }

  if (sub === 'estado') {
    const estado = estadoDoArmazenamento(dependencias(ambiente, REMOTO_INERTE), inquilino);
    if (estado === undefined) {
      escrever(`${PREFIXO} Inquilino ${inquilino} sem Destino Remoto declarado (ou Acervo em outra forma).`);
      return 2;
    }
    if (temBandeira(argumentos, 'json')) {
      escrever(JSON.stringify(estado));
      return 0;
    }
    escrever(
      `Destino Remoto: ${estado.remoto}:${estado.pastaBase} | janela ${estado.janelaDias} dia(s) | ` +
        `apagamento local: ${estado.apagarLocal ? 'LIBERADO' : 'travado'}`,
    );
    escrever(
      `Anexos presentes: ${estado.presentes} | enviados: ${estado.enviados} | pendentes: ${estado.pendentes} | ` +
        `com falha de envio: ${estado.falhos} | divergencias: ${estado.divergencias} | duplicatas: ${estado.duplicatas}`,
    );
    escrever(
      `Copias locais removidas: ${estado.copiasLocaisRemovidas} | pendente mais antigo: ` +
        `${estado.idadeDoPendenteMaisAntigoSegundos === null ? 'nenhum' : `${estado.idadeDoPendenteMaisAntigoSegundos} s`} | ` +
        `ultima verificacao: ${estado.ultimaVerificacaoEm ?? 'nunca'}`,
    );
    return 0;
  }

  const resultado = await comRemoto(ambiente, async (remoto) => {
    const dep = dependencias(ambiente, remoto);
    if (sub === 'passada') {
      const grupoDado = opcao(argumentos, 'grupo');
      const grupos: GrupoDeTipos[] = grupoDado === undefined ? ['video', 'resto'] : [grupoDado as GrupoDeTipos];
      const limiteDado = opcao(argumentos, 'limite');
      let falhos = 0;
      for (const grupo of grupos) {
        const r = await passadaDeEnvio(dep, inquilino, {
          grupo,
          ensaio: temBandeira(argumentos, 'ensaio'),
          ...(limiteDado === undefined ? {} : { limite: inteiroPositivo(limiteDado, 1) }),
        });
        escrever(linhaDeEnvio(inquilino, r));
        falhos += r.falhos;
      }
      return falhos > 0 ? 1 : 0;
    }
    if (sub === 'apagar-local') {
      const r = await passadaDeApagarCopiaLocal(dep, inquilino);
      escrever(
        r.trava
          ? `${PREFIXO} Inquilino ${inquilino}: apagamento local TRAVADO; nada foi examinado.`
          : `${PREFIXO} Inquilino ${inquilino}: ${r.apagadas} copia(s) local(is) apagada(s), ${r.adiadas} adiada(s), ` +
            `${r.jaAusentes} ja ausente(s), ${r.divergencias} divergencia(s).`,
      );
      return r.divergencias > 0 ? 1 : 0;
    }
    if (sub === 'conferir') {
      const r = await conferirPorAmostra(dep, inquilino, inteiroPositivo(opcao(argumentos, 'amostra'), AMOSTRA_PADRAO));
      escrever(`${PREFIXO} Inquilino ${inquilino}: ${r.conferidos} conferido(s), ${r.divergentes} divergente(s).`);
      return r.divergentes > 0 ? 1 : 0;
    }
    const r = await reconstruirLocalizacao(dep, inquilino, { confirmar: temBandeira(argumentos, 'confirmo') });
    if (r.recusada !== null) {
      escrever(`${PREFIXO} Inquilino ${inquilino}: reconstrucao RECUSADA, a base nao foi tocada: ${r.recusada}`);
      return 1;
    }
    escrever(
      `${PREFIXO} Inquilino ${inquilino}: base refeita: ${r.restauradas} restaurada(s), ${r.duplicatas} duplicata(s), ` +
        `${r.divergentes} divergente(s), ${r.semAnexo} arquivo(s) do remoto sem Anexo.`,
    );
    return 0;
  });
  return resultado;
}

/** O processo longo: uma passada completa por Inquilino a cada intervalo, ate o pedido de parada. */
async function servirEmLaco(ambiente: AmbienteDeArmazenamento): Promise<number> {
  const env = ambiente.env ?? process.env;
  const intervaloMs = inteiroPositivo(env['MALOTE_ARMAZENAMENTO_INTERVALO_MS'], INTERVALO_PADRAO_MS);
  const checagemACadaMs = inteiroPositivo(env['MALOTE_ARMAZENAMENTO_CHECAGEM_A_CADA_MS'], CHECAGEM_PADRAO_MS);
  const amostra = inteiroPositivo(env['MALOTE_ARMAZENAMENTO_AMOSTRA'], AMOSTRA_PADRAO);

  let parar = false;
  let acordar: (() => void) | undefined;
  const pedirParada = (sinal: string): void => {
    ambiente.escrever(`${PREFIXO} ${sinal}: parando depois do arquivo em andamento.`);
    parar = true;
    acordar?.();
  };
  const aoTermo = (): void => pedirParada('SIGTERM');
  const aoInterromper = (): void => pedirParada('SIGINT');

  if (!adquirirTrava(ambiente.estado)) {
    ambiente.escrever(`${PREFIXO} Ja ha um servico no ar (pid ${String(servicoVivo(ambiente.estado))}). Nao subo um segundo.`);
    return 2;
  }
  const resultado = await comRemoto(ambiente, async (remoto) => {
    process.once('SIGTERM', aoTermo);
    process.once('SIGINT', aoInterromper);
    const dep = dependencias(ambiente, remoto, () => parar);
    ambiente.escrever(`${PREFIXO} servico no ar; passada a cada ${intervaloMs} ms.`);
    let ultimaChecagem = 0;
    try {
      while (!parar) {
        let inquilinos: string[] = [];
        try {
          inquilinos = inquilinosComDestinoRemoto(dep);
        } catch (erro) {
          ambiente.escrever(`${PREFIXO} nao deu para ler os Destinos Remotos: ${(erro as Error).message}`);
        }
        for (const id of inquilinos) {
          if (parar) break;
          try {
            for (const grupo of ['video', 'resto'] as const) {
              const r = await passadaDeEnvio(dep, id, { grupo });
              if (r.enviados + r.falhos + r.adiados > 0) ambiente.escrever(linhaDeEnvio(id, r));
            }
            await passadaDeDescartados(dep, id);
            await passadaDeApagarCopiaLocal(dep, id);
            if (dep.agora() - ultimaChecagem >= checagemACadaMs) await conferirPorAmostra(dep, id, amostra);
          } catch (erro) {
            ambiente.escrever(`${PREFIXO} Inquilino ${id}: a passada abortou — ${(erro as Error).message}`);
          }
        }
        if (dep.agora() - ultimaChecagem >= checagemACadaMs) ultimaChecagem = dep.agora();
        if (parar) break;
        await Promise.race([
          (ambiente.dormir ?? dormirDeVerdade)(intervaloMs),
          new Promise<void>((resolver) => {
            acordar = resolver;
          }),
        ]);
      }
    } finally {
      process.off('SIGTERM', aoTermo);
      process.off('SIGINT', aoInterromper);
    }
    ambiente.escrever(`${PREFIXO} servico parado.`);
    return 0;
  }).finally(() => soltarTrava(ambiente.estado));
  return resultado;
}
