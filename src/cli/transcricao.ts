import { join } from 'node:path';
import { abrirRegistro, listarInquilinos } from '../registro/registro.js';
import { abrirAcervo, versaoDoAcervoEmDisco, VERSAO_SCHEMA_ACERVO } from '../nucleo/acervo.js';
import { proximoElegivel, marcarPendente, marcarConcluida, marcarFalhou } from '../nucleo/transcricao.js';
import { configuracaoDoMotor, transcrever, MotorDeTranscricaoError } from './motor-de-transcricao.js';

export interface AmbienteDoWorker {
  dados: string;
  env: Record<string, string | undefined>;
  /** Sinal proprio do worker — nunca a saida default de outro comando (criterio 4 da spec). */
  escrever: (linha: string) => void;
}

export interface ResultadoDaPassada {
  motorConfigurado: boolean;
  /** Quantos Anexos foram processados nesta passada — 0 ou 1: o worker e sequencial, um por vez. */
  processados: number;
}

/**
 * Uma passada do worker: acha UM Anexo elegivel, num Inquilino, e o processa.
 *
 * Sequencial de proposito — nunca mais de uma transcricao ao mesmo tempo,
 * mesmo havendo N Inquilinos com fila: o custo de CPU medido (~43s por
 * minuto de audio) e alto o bastante para competir com o resto do processo
 * se paralelizado. Enfileirar todos os Inquilinos, um Anexo por vez, e o
 * worker so avanca para o Inquilino seguinte quando o atual nao tem mais
 * elegivel — chamadores repetidos de `processarUmaVez` avancam a fila real.
 *
 * NUNCA abre o Acervo para escrita sem checar a versao primeiro.
 * `abrirAcervo` MIGRA a base — e o CONTEXTO.md do repo e a spec sao
 * explicitos: um processo que atende requisicao de fora nao pode ter esse
 * poder, e o worker roda DENTRO de `malote servir`. Sem esta checagem, o
 * primeiro boot pos-deploy do servidor migraria a base sozinho, antes da
 * Acao Documentada — o quase-incidente da v0.21.0, agora por desenho. Acervo
 * em forma diferente da corrente e PULADO e RELATADO, nunca migrado aqui;
 * quem migra e `malote acervo migrar`/o ouvinte, como hoje.
 */
export async function processarUmaVez(ambiente: AmbienteDoWorker): Promise<ResultadoDaPassada> {
  const config = configuracaoDoMotor(ambiente.env);
  if (config === undefined) return { motorConfigurado: false, processados: 0 };

  const registro = abrirRegistro(ambiente.dados);
  const inquilinos = listarInquilinos(registro);
  registro.fechar();

  for (const inquilino of inquilinos) {
    const versao = versaoDoAcervoEmDisco(join(ambiente.dados, 'acervos'), inquilino.id);
    if (versao !== undefined && versao !== VERSAO_SCHEMA_ACERVO) {
      ambiente.escrever(
        `[transcricao] Inquilino ${inquilino.id}: Acervo na forma ${versao}, esperava ` +
          `${VERSAO_SCHEMA_ACERVO}. Pulado — rode "malote acervo migrar" antes.`,
      );
      continue;
    }

    const acervo = abrirAcervo(join(ambiente.dados, 'acervos'), inquilino.id);
    const elegivel = proximoElegivel(acervo);
    if (elegivel === undefined) {
      acervo.fechar();
      continue;
    }

    marcarPendente(acervo, elegivel.anexoId);
    acervo.fechar(); // libera o Acervo enquanto o subprocesso roda — pode levar minutos.

    try {
      const texto = await transcrever(config, elegivel.caminho);
      const depois = abrirAcervo(join(ambiente.dados, 'acervos'), inquilino.id);
      marcarConcluida(depois, elegivel.anexoId, texto, 'whisper.cpp', config.whisperModelo);
      depois.fechar();
      ambiente.escrever(`[transcricao] Anexo ${elegivel.anexoId} (Inquilino ${inquilino.id}): concluida.`);
    } catch (erro) {
      const motivo =
        erro instanceof MotorDeTranscricaoError ? erro.message : `erro inesperado: ${(erro as Error).message}`;
      const depois = abrirAcervo(join(ambiente.dados, 'acervos'), inquilino.id);
      marcarFalhou(depois, elegivel.anexoId, motivo);
      depois.fechar();
      ambiente.escrever(`[transcricao] Anexo ${elegivel.anexoId} (Inquilino ${inquilino.id}): falhou — ${motivo}`);
    }
    return { motorConfigurado: true, processados: 1 };
  }

  return { motorConfigurado: true, processados: 0 };
}

/**
 * Inicia o laco periodico. Devolve a funcao que o para.
 *
 * LIMITE CONHECIDO, declarado e nao resolvido nesta versao: `emAndamento` e
 * estado de PROCESSO. Duas instancias de `malote servir` sobre o mesmo
 * `dados` (cenario que o produto nao usa hoje) rodariam passadas em
 * paralelo e poderiam transcrever o MESMO Anexo duas vezes — desperdicio de
 * CPU, nunca corrupcao: `marcarConcluida` e idempotente (UPDATE, nao
 * INSERT). Se um dia houver mais de uma instancia por instalacao, isso
 * precisa de lock real (ex.: linha `transcricoes` com estado
 * 'em-andamento').
 */
export function iniciarWorkerDeTranscricao(ambiente: AmbienteDoWorker, intervaloMs: number): () => void {
  let emAndamento = false;
  const timer = setInterval(() => {
    if (emAndamento) return; // nao empilha passadas se uma estiver lenta
    emAndamento = true;
    processarUmaVez(ambiente)
      .catch((erro) => ambiente.escrever(`[transcricao] passada abortou: ${(erro as Error).message}`))
      .finally(() => {
        emAndamento = false;
      });
  }, intervaloMs);
  return () => clearInterval(timer);
}
