/**
 * Quem pode receber um Envio (#1323). Vocabulario de Fonte: o sufixo do endereco mora aqui, no adaptador, e nao no
 * nucleo. Modulo puro, sem import: a rota de rede e a CLI o usam sem carregar a recepcao.
 *
 * O feed de status (`@status`, `@lid.status`) e a lista de transmissao (`@broadcast`) sao Conversas coletivas no
 * Acervo, mas NAO sao destinatarios: enviar a um feed de status publicaria um Status.
 */

/**
 * Forma reconhecida de endereco WhatsApp: numero+sufixo de usuario, grupo, ou LID. Destino sem essa forma e recusado
 * ANTES de tentar enviar — sem isso, `--para 5511999990000` (sem sufixo) criaria uma Conversa que o eco de recepcao
 * (que sempre traz o endereco COM sufixo) nunca reencontra, duplicando a Conversa (#1112, achado do dev-10).
 */
export function enderecoEhDestinatarioDeEnvio(endereco: string): boolean {
  return (
    endereco.endsWith('@s.whatsapp.net') ||
    endereco.endsWith('@g.us') ||
    endereco.endsWith('@lid')
  );
}
