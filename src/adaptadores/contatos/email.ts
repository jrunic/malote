/**
 * Normalizacao de e-mail para uso como ENDERECO — chave de unicidade, e nao
 * texto de exibicao.
 *
 * Duas decisoes, e as duas sao politica declarada, nao cosmetica:
 *
 *  - Espaco e CAIXA colapsam. O vCard traz o que o humano digitou, e duas
 *    grafias do mesmo endereco seriam duas pessoas. A parte local e
 *    sensivel a caixa pela RFC 5321, e nenhum provedor de uso corrente a
 *    trata assim — colapsar erra em zero casos reais e acerta nos comuns.
 *
 *  - O `+` NAO colapsa. Ele distingue caixa de entrada em alguns provedores e
 *    e parte do endereco em outros; descarta-lo funde quem o usa de proposito,
 *    e o desfecho e uma Pessoa com a correspondencia de outra.
 *
 * Medido no catalogo real em 11/09/2026: zero e-mails diferindo so por caixa e
 * zero com `+` nos 3.361 distintos. O material atual nao pune a ausencia de
 * politica, o que nao a dispensa — o valor e chave, e a hora de decidir e
 * antes do primeiro import.
 */
export function normalizarEmail(bruto: string): string {
  const limpo = bruto.trim().toLowerCase();
  // O que nao tem exatamente um arroba, com algo dos dois lados, nao e
  // endereco. Recusar aqui e o que impede "sem e-mail" de virar um
  // Identificador de cadeia vazia.
  const partes = limpo.split('@');
  if (partes.length !== 2) return '';
  const [local, dominio] = partes;
  if (local === undefined || dominio === undefined) return '';
  if (local.length === 0 || dominio.length === 0) return '';
  return limpo;
}
