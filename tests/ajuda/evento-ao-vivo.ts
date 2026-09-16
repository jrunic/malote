/**
 * Eventos na forma que a plataforma entrega, medida em 02/09/2026 sobre 11h23
 * de captura contra conta real — e com dado inteiramente SINTETICO.
 *
 * A forma e real porque testar contra forma inventada mede o inventor. O dado
 * e sintetico porque a captura e conversa pessoal, e a Restricao do repo vale
 * para fixture derivada dela.
 *
 * O que a forma real ensina, e que uma fixture inventada nao teria:
 *  - `participant` traz o endereco na forma nova e `participantPn` o mesmo
 *    autor na forma canonica, NA MESMA CHAVE — 364 de 370 casos. E dai que a
 *    correspondencia se aprende, sem fonte externa nenhuma.
 *  - 6 de 370 chegam SEM o par. A lacuna e real e tem de ser exercitada.
 *  - o identificador de Mensagem tem 20, 32 ou 22 caracteres.
 *  - `protocolMessage` e 42 de 288, e NAO e mensagem: e recibo, distribuicao
 *    de chave, edicao. O backup nunca os tera.
 */

export interface ChaveDeEvento {
  remoteJid: string;
  id: string;
  fromMe: boolean;
  participant?: string;
  participantPn?: string;
}

export interface MensagemDeEvento {
  key: ChaveDeEvento;
  messageTimestamp: number;
  pushName?: string;
  message?: Record<string, unknown>;
}

const TELEFONE = '5565911110001';
const OUTRO = '5565911110002';
const NOVA_FORMA = '109876543210987';
const GRUPO = '120363000000000001';

export const ENDERECOS = {
  TELEFONE: `${TELEFONE}@s.whatsapp.net`,
  OUTRO: `${OUTRO}@s.whatsapp.net`,
  NOVA_FORMA: `${NOVA_FORMA}@lid`,
  GRUPO: `${GRUPO}@g.us`,
};

export function mensagemDireta(id: string, quando: number): MensagemDeEvento {
  return {
    key: { remoteJid: ENDERECOS.TELEFONE, id, fromMe: false },
    messageTimestamp: quando,
    pushName: 'Leia Organa',
    message: { conversation: 'texto sintetico' },
  };
}

/** Coletiva com as DUAS formas na mesma chave — o caso de 364 em 370. */
export function mensagemColetivaComPar(id: string, quando: number): MensagemDeEvento {
  return {
    key: {
      remoteJid: ENDERECOS.GRUPO,
      id,
      fromMe: false,
      participant: ENDERECOS.NOVA_FORMA,
      participantPn: ENDERECOS.OUTRO,
    },
    messageTimestamp: quando,
    pushName: 'Han Solo',
    message: { extendedTextMessage: { text: 'texto sintetico' } },
  };
}

/** Coletiva SEM o par — o caso de 6 em 370, que fica sem traducao. */
export function mensagemColetivaSemPar(id: string, quando: number): MensagemDeEvento {
  return {
    key: {
      remoteJid: ENDERECOS.GRUPO,
      id,
      fromMe: false,
      participant: ENDERECOS.NOVA_FORMA,
    },
    messageTimestamp: quando,
    message: { conversation: 'texto sintetico' },
  };
}

export function mensagemComMidia(id: string, quando: number): MensagemDeEvento {
  return {
    key: { remoteJid: ENDERECOS.TELEFONE, id, fromMe: false },
    messageTimestamp: quando,
    message: {
      messageContextInfo: { deviceListMetadataVersion: 2 },
      imageMessage: {
        mimetype: 'image/jpeg',
        fileLength: 123456,
        directPath: '/v/t62.0-24/sintetico',
      },
    },
  };
}

/** Ruido de protocolo — 42 de 288. NAO vira Mensagem. */
export function eventoDeProtocolo(id: string, quando: number): MensagemDeEvento {
  return {
    key: { remoteJid: ENDERECOS.TELEFONE, id, fromMe: false },
    messageTimestamp: quando,
    message: {
      messageContextInfo: { deviceListMetadataVersion: 2 },
      protocolMessage: { type: 'REVOKE' },
    },
  };
}

/** Enviada pelo Titular: sem autor externo. */
export function mensagemEnviada(id: string, quando: number): MensagemDeEvento {
  return {
    key: { remoteJid: ENDERECOS.TELEFONE, id, fromMe: true },
    messageTimestamp: quando,
    message: { conversation: 'texto sintetico' },
  };
}
