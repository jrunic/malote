import { readFileSync, existsSync } from 'node:fs';
import type { Acervo } from '../../nucleo/acervo.js';
import { registrarConversa } from '../../nucleo/escrita.js';
import { enderecoEhColetivo } from './ao-vivo.js';
import {
  type ConteudoDeEnvio,
  proximoEnvioPendente,
  marcarEnvioEnviado,
  marcarEnvioFalhou,
  incrementarTentativaDeEnvio,
  atualizarConversaDoEnvio,
} from '../../nucleo/envio.js';

const FONTE = 'whatsapp' as const;

export interface OpcoesDeProcessamento {
  configuracao: { id: string; fonte: 'whatsapp' };
  /**
   * Injetado por `ouvir.ts`, fechado sobre `conexao.enviar` — este modulo
   * nunca importa a biblioteca diretamente (fronteira de dependencia).
   * Ja devolve `undefined` para falha de TRANSPORTE (ver conexao.ts); o que
   * chega aqui como excecao e falha DEFINITIVA.
   */
  enviar: (jid: string, conteudo: unknown) => Promise<{ keyId: string } | undefined>;
  /**
   * Chamado quando um Envio de MIDIA (imagem/documento) sai com sucesso —
   * nunca para texto. `ouvir.ts` o usa para alimentar o mapa de bytes
   * originados: quando o eco daquela Mensagem chegar, usa o arquivo de
   * staging em vez de baixar de volta do WhatsApp. Este modulo nunca move
   * nem apaga o staging.
   */
  aoEnviar?: (keyId: string, caminhoDeStaging: string) => void;
}

export interface ResultadoDoProcessamento {
  /** 0 ou 1: um Envio por chamada, mesmo padrao do worker de Transcricao. */
  processados: number;
}

/**
 * Forma reconhecida de endereco WhatsApp: numero+sufixo de usuario, grupo,
 * ou LID. Destino sem essa forma e recusado ANTES de tentar enviar — sem
 * isso, `--para 5565936180479` (sem sufixo) criaria uma Conversa que o eco
 * de recepcao (que sempre traz o endereco COM sufixo) nunca reencontra,
 * duplicando a Conversa (#1112, achado do dev-10).
 */
function formaDeEnderecoReconhecida(endereco: string): boolean {
  return (
    endereco.endsWith('@s.whatsapp.net') ||
    endereco.endsWith('@g.us') ||
    endereco.endsWith('@lid')
  );
}

/**
 * Monta o conteudo no formato que `sendMessage` espera. Le o arquivo de
 * staging AQUI: arquivo removido ou ilegivel vira falha definitiva, e vale
 * igual para base criada do zero e base migrada (os CHECK do schema fresco
 * nao alcancam a migrada). `readFileSync` carrega o arquivo inteiro — ok
 * para imagem/documento tipicos; stream fica para quando houver medicao.
 */
function montarConteudo(conteudo: ConteudoDeEnvio): { payload: unknown } | { erro: string } {
  if (conteudo.tipo === 'texto') return { payload: { text: conteudo.texto } };
  if (!existsSync(conteudo.caminhoArquivo)) {
    return { erro: `arquivo de staging nao encontrado: ${conteudo.caminhoArquivo}` };
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(conteudo.caminhoArquivo);
  } catch (erro) {
    return { erro: `falha ao ler staging: ${(erro as Error).message}` };
  }
  const legenda = conteudo.legenda !== undefined ? { caption: conteudo.legenda } : {};
  if (conteudo.tipo === 'imagem') {
    return { payload: { image: bytes, mimetype: conteudo.mimetype, ...legenda } };
  }
  return {
    payload: {
      document: bytes,
      mimetype: conteudo.mimetype,
      fileName: conteudo.nomeDeArquivo,
      ...legenda,
    },
  };
}

/**
 * Processa UM Envio pendente da Configuracao — nunca mais de um por chamada,
 * mesmo espirito sequencial do worker de Transcricao. Quem chama em laco
 * (o poller de `ouvir.ts`) avanca a fila real.
 */
export async function processarEnvios(
  acervo: Acervo,
  opcoes: OpcoesDeProcessamento,
): Promise<ResultadoDoProcessamento> {
  const envio = proximoEnvioPendente(acervo, opcoes.configuracao.id);
  if (envio === undefined) return { processados: 0 };

  let jid: string;
  if (envio.conversaId !== null) {
    const conversa = acervo
      .preparar('SELECT id_externo FROM conversas WHERE id = ?')
      .get(envio.conversaId) as { id_externo: string };
    jid = conversa.id_externo;
  } else {
    jid = envio.destinoCru as string;
    if (!formaDeEnderecoReconhecida(jid)) {
      marcarEnvioFalhou(
        acervo,
        envio.envioId,
        `destino sem forma reconhecida: "${jid}" (esperado @s.whatsapp.net, @g.us ou @lid)`,
      );
      return { processados: 1 };
    }
  }

  const montado = montarConteudo(envio.conteudo);
  if ('erro' in montado) {
    marcarEnvioFalhou(acervo, envio.envioId, montado.erro);
    return { processados: 1 };
  }

  let resultado: { keyId: string } | undefined;
  try {
    resultado = await opcoes.enviar(jid, montado.payload);
  } catch (erro) {
    // Chegou aqui: NAO e falha de transporte (conexao.ts ja filtrou). E
    // definitiva — destinatario invalido, rejeicao da plataforma etc.
    marcarEnvioFalhou(acervo, envio.envioId, String((erro as Error).message ?? erro));
    return { processados: 1 };
  }
  if (resultado === undefined) {
    // Indeterminado — a propria conexao ja filtrou transporte caido.
    // Fica pendente, com tentativa somada, retentado na proxima passada.
    incrementarTentativaDeEnvio(acervo, envio.envioId);
    return { processados: 1 };
  }

  // A MENSAGEM JA SAIU. O que vem abaixo e contabilidade, e uma falha dela
  // (banco ocupado, disco) NAO pode virar `falhou`: `falhou` so volta a
  // `pendente` por reprocessar explicito, que reenviaria, e a mensagem ja foi.
  // Por isso nada aqui esta num `catch`: a excecao sobe, o Envio continua
  // `pendente` e a proxima passada tenta de novo — ao menos uma vez, com o
  // risco de duplicata nomeado na spec (criterio 6 da #1112).
  if (envio.conteudo.tipo !== 'texto') {
    // Antes da contabilidade: o eco chega de qualquer jeito, e o mapa de
    // bytes originados precisa existir mesmo que a gravacao abaixo falhe.
    opcoes.aoEnviar?.(resultado.keyId, envio.conteudo.caminhoArquivo);
  }
  // A Conversa so e gravada/garantida AQUI, depois de confirmar que o envio
  // saiu — destinatario errado nunca deixa Conversa imortal no Acervo (#1112,
  // achado do dev-10).
  if (envio.conversaId === null) {
    const coletiva = enderecoEhColetivo(jid);
    const conversaId = registrarConversa(acervo, {
      fonte: FONTE,
      idExterno: jid,
      coletiva,
      ...(coletiva ? {} : { configuracao: opcoes.configuracao }),
    });
    atualizarConversaDoEnvio(acervo, envio.envioId, conversaId);
  }
  marcarEnvioEnviado(acervo, envio.envioId);

  return { processados: 1 };
}
