import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { abrirRegistro, listarInquilinos } from '../registro/registro.js';
import { lerDestinoDeMidia, type DestinoDeMidia } from '../registro/destino-midia.js';
import { lerDestinoRemotoDeMidia } from '../registro/destino-remoto.js';
import { abrirAcervo, versaoDoAcervoEmDisco, VERSAO_SCHEMA_ACERVO } from '../nucleo/acervo.js';
import { proximoElegivel, marcarPendente, marcarConcluida, marcarFalhou } from '../nucleo/transcricao.js';
import type { BuscadorDeMidiaRemota, ResultadoDaBusca } from '../nucleo/midia-remota.js';
import { configuracaoDoMotor, transcrever, MotorDeTranscricaoError } from './motor-de-transcricao.js';

export interface AmbienteDoWorker {
  dados: string;
  /** Como pedir ao Servico de Armazenamento os bytes de um audio que mora no remoto. Ausente: so a copia local conta. */
  buscarMidiaRemota?: BuscadorDeMidiaRemota;
  env: Record<string, string | undefined>;
  /** Os Anexos adiados porque o Servico de Armazenamento nao entregou (ate quando, em ms). O laco do worker o mantem entre as passadas. */
  adiados?: Map<string, number>;
  /** Quantas vezes o Servico declarou `inacessivel` para cada Anexo (`<inquilino>:<anexo>`). O laco do worker o mantem. */
  tentativas?: Map<string, number>;
  agora?: () => number;
  /** Sinal proprio do worker — nunca a saida default de outro comando (criterio 4 da spec). */
  escrever: (linha: string) => void;
}

const ADIAMENTO_MS = 5 * 60 * 1000;
/** O Servico esta no limite de entregas: repetir resolve logo. */
const ADIAMENTO_DO_OCUPADO_MS = 60 * 1000;
/** Tentativas com `inacessivel` (o remoto nao entrega, o conteudo nao confere) antes de marcar falha com o motivo. */
const TENTATIVAS_COM_INACESSIVEL = 3;
/**
 * Quantos Anexos uma passada pode saltar (adiados) procurando um que se possa transcrever. Com o Servico fora do ar e uma
 * fila longa so no remoto, e o que deixa o audio recem-chegado, com copia local, alcancavel na MESMA passada.
 */
const MAXIMO_DE_ADIAMENTOS_POR_PASSADA = 200;
/** Igual ao teto do canal (25 s): pedir mais nao adianta, o Servico o corta. */
const PRAZO_DA_ENTREGA_MS = 25_000;

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
  // Le os Destinos de todos de uma vez, ainda com o Registro aberto, e fecha
  // ANTES do laco — mesmo motivo do Acervo ser fechado antes do subprocesso:
  // nada aqui pode ficar retendo um arquivo aberto por um `await` que leva
  // minutos. `caminho` (ver abaixo) e RELATIVO a esse Destino.
  const destinos = new Map<string, DestinoDeMidia>();
  const comDestinoRemoto = new Set<string>();
  for (const inquilino of inquilinos) {
    const destino = lerDestinoDeMidia(registro, inquilino.id);
    if (destino !== undefined) destinos.set(inquilino.id, destino);
    if (lerDestinoRemotoDeMidia(registro, inquilino.id) !== undefined) comDestinoRemoto.add(inquilino.id);
  }
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

    const destino = destinos.get(inquilino.id);
    // Anexos que ja foram tentados e adiados (o Servico fora do ar): nao se tenta o mesmo toda passada.
    const adiados = ambiente.adiados ?? new Map<string, number>();
    const tentativas = ambiente.tentativas ?? new Map<string, number>();
    // O Servico respondeu `servico-fora` ha pouco: nao se pergunta de novo a cada audio da fila, e a passada segue pelo que tem copia local.
    const chaveDoServicoFora = `servico-fora:${inquilino.id}`;
    const agora = (ambiente.agora ?? Date.now)();
    for (const [chave, ate] of adiados) if (ate <= agora) adiados.delete(chave);
    const adiadosDeste = (): string[] =>
      [...adiados.keys()].filter((k) => k.startsWith(`${inquilino.id}:`)).map((k) => k.slice(inquilino.id.length + 1));

    for (let saltos = 0; saltos < MAXIMO_DE_ADIAMENTOS_POR_PASSADA; saltos += 1) {
      const acervo = abrirAcervo(join(ambiente.dados, 'acervos'), inquilino.id);
      const elegivel = proximoElegivel(acervo, adiadosDeste());
      if (elegivel === undefined) {
        acervo.fechar();
        break;
      }

      // `elegivel.caminho` e RELATIVO ao Destino de Midia do Inquilino — o Destino e configuracao por Inquilino e
      // nunca entra no Acervo (mesmo principio de `midia trazer`/`midia reprocessar`). Sem resolver contra ele aqui, o
      // motor recebe um caminho que nao existe a partir do cwd do processo (#1106).
      if (destino === undefined) {
        acervo.fechar();
        ambiente.escrever(`[transcricao] Inquilino ${inquilino.id}: Destino de Midia nao configurado. Pulado.`);
        break;
      }

      marcarPendente(acervo, elegivel.anexoId);
      acervo.fechar(); // libera o Acervo enquanto o subprocesso roda — pode levar minutos.

      const caminhoLocal = join(destino.endereco, elegivel.caminho);
      let caminhoDoAudio = caminhoLocal;
      let pastaTemporaria: string | undefined;
      try {
        if (comDestinoRemoto.has(inquilino.id) && ambiente.buscarMidiaRemota !== undefined) {
          // Escolha 2 (b): o Anexo que ja tem Localizacao se le pelo Servico, a partir do remoto; so o que ainda nao foi
          // enviado (audio recem-chegado) se le da copia local.
          const busca: ResultadoDaBusca =
            (adiados.get(chaveDoServicoFora) ?? 0) > agora
              ? { tipo: 'servico-fora' }
              : await ambiente.buscarMidiaRemota({
                  inquilinoId: inquilino.id,
                  anexoId: elegivel.anexoId,
                  prazoMs: PRAZO_DA_ENTREGA_MS,
                });
          if (busca.tipo === 'servico-fora') adiados.set(chaveDoServicoFora, agora + ADIAMENTO_MS);
          if (busca.tipo === 'bytes') {
            pastaTemporaria = mkdtempSync(join(tmpdir(), 'malote-transcricao-entrega-'));
            caminhoDoAudio = join(pastaTemporaria, `audio${extname(elegivel.caminho)}`);
            writeFileSync(caminhoDoAudio, busca.bytes, { mode: 0o600 });
          } else if (busca.tipo === 'grande-demais') {
            throw new MotorDeTranscricaoError(
              `audio acima do tamanho maximo que o Servico de Armazenamento entrega (${busca.maximo} bytes)`,
            );
          } else if (busca.tipo === 'inacessivel' || busca.tipo === 'servico-fora' || busca.tipo === 'ocupado') {
            if (!existsSync(caminhoLocal)) {
              const chave = `${inquilino.id}:${elegivel.anexoId}`;
              if (busca.tipo === 'inacessivel') {
                // O Servico diz que o arquivo existe e nao veio (o remoto nao o tem, o conteudo nao confere): isso nao se
                // resolve sozinho. Depois de algumas tentativas vira falha, com o motivo, e `transcricao reprocessar` a devolve.
                const n = (tentativas.get(chave) ?? 0) + 1;
                tentativas.set(chave, n);
                if (n >= TENTATIVAS_COM_INACESSIVEL) {
                  tentativas.delete(chave);
                  throw new MotorDeTranscricaoError(`o Servico de Armazenamento nao entrega o audio: ${busca.motivo}`);
                }
              }
              // `servico-fora` e `ocupado` sao transitorios: o audio fica `pendente` e se tenta de novo mais tarde.
              adiados.set(chave, agora + (busca.tipo === 'ocupado' ? ADIAMENTO_DO_OCUPADO_MS : ADIAMENTO_MS));
              ambiente.escrever(
                `[transcricao] Anexo ${elegivel.anexoId} (Inquilino ${inquilino.id}): o Servico de Armazenamento nao entregou o audio; tenta de novo depois.`,
              );
              continue;
            }
            // Ha copia local: o Servico fora do ar, ocupado ou sem o arquivo nao derruba a transcricao.
          }
          // 'sem-localizacao': nunca foi enviado, le a copia local.
        }
        const texto = await transcrever(config, caminhoDoAudio);
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
      } finally {
        if (pastaTemporaria !== undefined) rmSync(pastaTemporaria, { recursive: true, force: true });
      }
      return { motorConfigurado: true, processados: 1 };
    }
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
export function iniciarWorkerDeTranscricao(entrada: AmbienteDoWorker, intervaloMs: number): () => void {
  // Os adiados vivem entre as passadas: sem isso o mesmo audio que o Servico nao entregou seria tentado toda passada.
  const ambiente: AmbienteDoWorker = {
    ...entrada,
    adiados: entrada.adiados ?? new Map<string, number>(),
    tentativas: entrada.tentativas ?? new Map<string, number>(),
  };
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
