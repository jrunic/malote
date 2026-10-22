/**
 * O que a recepcao do WhatsApp entende como CONTEUDO de uma mensagem: quais tipos viram Mensagem e como abrir os dois
 * envelopes. Mora aqui, e nao no `ao-vivo.ts`, porque a leitura da Citacao (#1334) precisa da mesma resposta e o
 * `ao-vivo.ts` a importa: dois modulos que se importam nao se resolvem.
 */

/**
 * Quais tipos de evento viram MENSAGEM no Acervo.
 *
 * Nem tudo que a plataforma entrega e mensagem. A captura mediu 42 de 288 como
 * `protocolMessage` — recibo, distribuicao de chave, edicao —, e o acervo do
 * produto anterior corretamente nao os guarda. Grava-los criaria Mensagens de
 * conteudo vazio que NENHUM outro caminho produz: o material exportado nunca as
 * tera, e a convergencia divergiria por construcao, medindo o defeito que o
 * proprio adaptador criou.
 *
 * Escolher o que vira Mensagem e semantica de Adaptador — a importacao tambem
 * escolhe, lendo linhas de mensagem real. Nao e recorte do Conteudo Bruto, que
 * continua preservado inteiro para o que entra.
 */
export const VIRAM_MENSAGEM = new Set([
  'conversation',
  'extendedTextMessage',
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'stickerMessage',
  'documentMessage',
  'reactionMessage',
  'contactMessage',
  // O cartao MULTIPLO (varios contatos num envio, #1206): medido na espiga de 14/10/2026, chega por `messages.upsert`
  // como assunto do evento, sozinho ou so com `messageContextInfo`. Descartado antes, e guardado cru.
  'contactsArrayMessage',
  'locationMessage',
]);

/**
 * Desembrulha dois envelopes, e so estes.
 *
 * O documento com legenda chega como `documentWithCaptionMessage.message.documentMessage`.
 * Medido em 06/10/2026 (documento real de uma Conversa direta ausente do Acervo) e provado
 * com o evento sintetico pela propria `receberEvento`.
 *
 * O envelope de MIDIA ASSOCIADA (`associatedChildMessage`, #1190) carrega a mesma midia em
 * outra forma: a versao em alta definicao de um video, ou o trecho de video de uma foto em
 * movimento. Medido em 17/10/2026 (3 eventos em 5 dias): o interior e uma Mensagem comum e a
 * associacao ao pai mora ao lado, em `messageContextInfo`. Diferente do documento com legenda,
 * ele so se abre quando o interior tem conteudo que VIRA Mensagem: aberto, um interior vazio
 * viraria tipo nulo, e tipo nulo vai para a gravacao de Mensagem, nao para o descarte (criaria
 * uma Mensagem vazia). Fechado, segue com o rotulo de sempre, contado e guardado cru.
 *
 * Os outros embrulhos que a biblioteca desembrulha (`ephemeralMessage`, `viewOnce*`,
 * `editedMessage`) nao foram medidos contra captura real, e a classificacao e medida, nunca
 * deduzida: `editedMessage` e edicao de Mensagem ja gravada, e trata-lo como nova duplicaria.
 * Seguem ignorados e contados. So para classificar e ler texto/Anexo: o Conteudo Bruto grava o
 * evento inteiro.
 */
export function desembrulhar(
  message: Record<string, unknown> | undefined | null,
): Record<string, unknown> | undefined | null {
  const filho = message?.['associatedChildMessage'];
  if (filho !== null && typeof filho === 'object') {
    const interior = (filho as Record<string, unknown>)['message'];
    if (interior !== null && typeof interior === 'object') {
      const aberto = interior as Record<string, unknown>;
      if (Object.keys(aberto).some((k) => VIRAM_MENSAGEM.has(k))) return aberto;
    }
    return message;
  }
  const embrulho = message?.['documentWithCaptionMessage'];
  if (embrulho === null || typeof embrulho !== 'object') return message;
  const interna = (embrulho as Record<string, unknown>)['message'];
  if (interna === null || typeof interna !== 'object') return message;
  return interna as Record<string, unknown>;
}
