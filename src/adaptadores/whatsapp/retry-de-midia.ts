/**
 * Reconstitui a Mensagem AO VIVO a partir do `bruto` ja gravado, para o retry
 * de download de midia (#1084) — a #1068 baixa na hora, usando o lote cru do
 * evento; aqui nao ha lote nenhum, so o que o Acervo guardou.
 *
 * PURO: sem I/O, sem `baileys`. So `conexao.ts` fala com a biblioteca —
 * `tests/fronteira-de-dependencia.test.ts` guarda essa fronteira por mutacao,
 * e este arquivo nao pode furá-la.
 */

/**
 * `mediaKey` aparece em DUAS formas no `bruto` gravado, medidas contra os dois
 * casos reais de producao (29-30/09/2026): string base64 pura (a
 * forma que os dois casos reais tinham) e `{type:'Buffer',data:[...]}` (o que
 * o round-trip de JSON do `aoReceber` produz quando o valor em memoria era um
 * `Uint8Array` de verdade — documentado na #1068, `conexao.ts`). Nenhuma das
 * duas e "a" forma certa; as duas acontecem, e tratar so uma deixaria a outra
 * silenciosamente sem retry.
 */
function normalizarMediaKey(valor: unknown): Buffer | null {
  if (typeof valor === 'string') return Buffer.from(valor, 'base64');
  if (
    valor !== null &&
    typeof valor === 'object' &&
    (valor as { type?: unknown }).type === 'Buffer' &&
    Array.isArray((valor as { data?: unknown }).data)
  ) {
    return Buffer.from((valor as { data: number[] }).data);
  }
  return null;
}

/**
 * Devolve a Mensagem pronta para `downloadMediaMessage`, ou `null` quando o
 * `bruto` nao e elegivel: nao e forma de recepcao ao vivo (material importado
 * tem outra forma inteira, ZWAMESSAGE do backup de iOS — `key.remoteJid` so
 * existe na forma ao vivo), nao tem o conteudo do TIPO do Anexo, ou o
 * conteudo nao tem `mediaKey` em forma reconhecida.
 *
 * `tipoDoAnexo` e o que `anexos.tipo` guarda (`video`, `image`, ...) — a
 * chave de conteudo correspondente e sempre `${tipoDoAnexo}Message`, mesma
 * convencao que `ao-vivo.ts` usa ao registrar (`tipo.replace('Message', '')`,
 * na direcao inversa).
 */
export function reconstituirMensagemParaRetry(
  tipoDoAnexo: string,
  mensagemBruto: string,
): unknown | null {
  let bruto: Record<string, unknown>;
  try {
    bruto = JSON.parse(mensagemBruto) as Record<string, unknown>;
  } catch {
    return null;
  }

  const key = bruto['key'] as Record<string, unknown> | undefined;
  if (typeof key?.['remoteJid'] !== 'string') return null;

  const mensagemInterna = bruto['message'] as Record<string, unknown> | undefined;
  const chaveDoConteudo = `${tipoDoAnexo}Message`;
  const conteudo = mensagemInterna?.[chaveDoConteudo] as Record<string, unknown> | undefined;
  if (conteudo === undefined || conteudo === null) return null;

  const mediaKey = normalizarMediaKey(conteudo['mediaKey']);
  if (mediaKey === null) return null;

  return {
    ...bruto,
    message: {
      ...mensagemInterna,
      [chaveDoConteudo]: { ...conteudo, mediaKey },
    },
  };
}
