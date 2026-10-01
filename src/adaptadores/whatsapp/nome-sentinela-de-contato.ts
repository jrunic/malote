/**
 * O WhatsApp dispara uma mutacao 'contactAction' de app-state tambem para
 * contatos que nunca foram nomeados de verdade — provavelmente para
 * sincronizar outro metadado da mesma acao (vinculo LID/PN, etc). Nesses
 * casos 'fullName' nao vem ausente: vem com um valor-placeholder, nao um
 * nome. Tarefa #1101.
 *
 * EVIDENCIA de que e placeholder e nao corrupcao de parsing (medido em
 * 30/09/2026 contra o Acervo real do Titular): das 7.253 ocorrencias-lixo em
 * identificadores sem Pessoa, 5.897 (81%) sao o MESMO texto exato, '+EAA='.
 * Corrupcao de decodificacao produz ruido variado; valor identico repetido
 * em massa e assinatura de sentinela fixo. O comprimento e discreto (5, 13,
 * 17, 25, 33... sempre ≡ 1 mod 4) — consistente com '+' seguido de um bloco
 * base64 valido (o protobuf serializado de outros campos da mesma mutacao).
 *
 * Entre quem TEM Pessoa (veio do catalogo), o mesmo campo e majoritariamente
 * confiavel — nome real ou etiqueta de negocio. Isto NAO filtra por conteudo
 * generico "parece lixo": filtra pela FORMA ESPECIFICA medida, porque nome
 * humano nunca tem essa forma (alfabeto base64 puro, terminado em padding).
 */
const FORMA_DA_SENTINELA = /^\+[A-Za-z0-9+/]+={1,2}$/;

export function pareceValorSentinela(valor: string): boolean {
  if (!FORMA_DA_SENTINELA.test(valor)) return false;
  // Base64 valido vem em blocos de 4; o '+' inicial nao faz parte do bloco —
  // e por isso o comprimento TOTAL medido e sempre 1 mod 4, nunca 0.
  return (valor.length - 1) % 4 === 0;
}
