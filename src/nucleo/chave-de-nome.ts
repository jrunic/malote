/**
 * A forma sob a qual dois nomes sao O MESMO para o produto.
 *
 * NAO e a normalizacao do adaptador de catalogo (`adaptadores/contatos/nome.ts`),
 * que baixa caixa e tira acento para CASAR PESSOAS. Esta aqui so remove o que e
 * invisivel: duas escritas do mesmo nome que diferem por marca de direcao,
 * espaco nao-quebravel ou hifen nao-ASCII sao a mesma afirmacao, e gravar as
 * duas cria linha gemea que ninguem consegue distinguir lendo.
 *
 * Medido em 12/09/2026 contra o Acervo real: 1.609 Atribuicoes de origem
 * whatsapp carregam pelo menos uma dessas marcas, e 1.014 delas sao nome
 * humano — fora do alcance da regra que recusa nome igual ao endereco.
 *
 * Baixar caixa ou tirar acento AQUI fundiria nomes que a Fonte distingue, e o
 * custo apareceria como Pessoa errada. Por isso a chave e conservadora: so sai
 * o que nao se ve.
 */

// Escapes, e nao o caractere literal. Fonte com invisivel vira "Bin" no git —
// aconteceu com o adaptador de Instagram, e o `git show` daquele commit sai
// mudo. Pior: editor e formatador engolem caractere invisivel, que e
// exatamente o defeito que este modulo existe para tratar.
const MARCAS_INVISIVEIS = /[\u200B-\u200F\u061C\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const ESPACOS = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
const HIFENS = /[\u2010-\u2015\u2212]/g;

export function chaveDeNome(texto: string): string {
  return texto
    .replace(MARCAS_INVISIVEIS, '')
    .replace(ESPACOS, ' ')
    .replace(HIFENS, '-')
    .replace(/\s+/g, ' ')
    .trim();
}
