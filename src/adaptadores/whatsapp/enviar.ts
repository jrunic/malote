import { readFileSync, existsSync } from 'node:fs';
import type { Acervo } from '../../nucleo/acervo.js';
import { registrarConversa } from '../../nucleo/escrita.js';
import { enderecoEhColetivo } from './ao-vivo.js';
import { destinoDeEnvioDeWhatsapp, resolverEnderecoDeWhatsapp } from './resolver-celular.js';
import { enderecoEhDestinatarioDeEnvio } from './destinatario-de-envio.js';
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
      .get(envio.conversaId) as { id_externo: string } | undefined;
    if (conversa === undefined) {
      // A chave estrangeira impede isto na pratica (so um Acervo recriado a contorna); falha o Envio com o motivo em
      // vez de derrubar o ouvinte com um TypeError.
      marcarEnvioFalhou(acervo, envio.envioId, 'a Conversa do Envio nao existe mais neste Acervo');
      return { processados: 1 };
    }
    jid = conversa.id_externo;
  } else {
    jid = envio.destinoCru as string;
    if (!enderecoEhDestinatarioDeEnvio(jid)) {
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

  // O endereco que vai a plataforma e o que o Acervo guarda, e e decidido AQUI, ao processar, e nao ao registrar: cobre
  // tambem o Envio pendente de antes da release. O numero que o Acervo nao conhece sai como foi pedido (#1364).
  const destino = destinoDeEnvioDeWhatsapp(acervo, jid);

  let resultado: { keyId: string } | undefined;
  try {
    resultado = await opcoes.enviar(destino, montado.payload);
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
  // Tambem quando o Envio foi dado por Conversa e o destino mudou (a Conversa dada e a forma alternativa do celular): o
  // eco cai na Conversa da forma gravada, e e nela que o Envio fica.
  if (envio.conversaId === null || destino !== jid) {
    const coletiva = enderecoEhColetivo(jid);
    // O destino foi digitado pelo OPERADOR: nao e evidencia de qual forma a plataforma usa. Se o Acervo ja conhece o celular,
    // a Conversa e a dele; se nao conhece, fica na forma pedida e nenhum par e inventado (#1364).
    const conversaId = registrarConversa(acervo, {
      fonte: FONTE,
      idExterno: resolverEnderecoDeWhatsapp(acervo, jid, undefined, { soComEvidencia: true }),
      coletiva,
      ...(coletiva ? {} : { configuracao: opcoes.configuracao }),
    });
    atualizarConversaDoEnvio(acervo, envio.envioId, conversaId);
  }
  marcarEnvioEnviado(acervo, envio.envioId, resultado.keyId);

  return { processados: 1 };
}
