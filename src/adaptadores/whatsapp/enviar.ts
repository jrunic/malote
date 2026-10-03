import type { Acervo } from '../../nucleo/acervo.js';
import { registrarConversa } from '../../nucleo/escrita.js';
import { enderecoEhColetivo } from './ao-vivo.js';
import {
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

  const conteudo = { text: envio.conteudo.texto };

  try {
    const resultado = await opcoes.enviar(jid, conteudo);
    if (resultado === undefined) {
      // Indeterminado — a propria conexao ja filtrou transporte caido.
      // Fica pendente, com tentativa somada, retentado na proxima passada.
      incrementarTentativaDeEnvio(acervo, envio.envioId);
      return { processados: 1 };
    }
    // SUCESSO: a Conversa so e gravada/garantida AQUI, depois de confirmar
    // que o envio saiu — destinatario errado nunca deixa Conversa imortal
    // no Acervo (#1112, achado do dev-10).
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
  } catch (erro) {
    // Chegou aqui: NAO e falha de transporte (conexao.ts ja filtrou). E
    // definitiva — destinatario invalido, rejeicao da plataforma etc.
    marcarEnvioFalhou(acervo, envio.envioId, String((erro as Error).message ?? erro));
  }

  return { processados: 1 };
}
