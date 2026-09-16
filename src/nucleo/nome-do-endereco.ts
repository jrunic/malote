/**
 * A plataforma preenche o campo de nome com o PROPRIO numero quando nao ha
 * contato cadastrado — e isso nao nomeia ninguem. Gravar como Atribuicao faz o
 * endereco competir com o nome de verdade, e vencer quando for mais recente.
 *
 * Medido em 12/09/2026 contra o Acervo real: 1.271 de 11.967 Atribuicoes de
 * origem whatsapp (10,6%) repetem o endereco do proprio Identificador.
 *
 * FICA NO NUCLEO, e nao no Adaptador, porque a regra e MECANICA: compara
 * digitos, como a forma de comparacao de nome. Nasceu no Adaptador de WhatsApp
 * e subiu quando a porta de remocao passou a precisar dela — o nucleo nao
 * importa Adaptador, e a alternativa seria passar a decisao por parametro em
 * toda chamada.
 *
 * O que NAO sobe, se um dia existir, e traduzir a forma escrita do numero na
 * forma do endereco: essa e vocabulario de Fonte. Hoje nao existe — comparar
 * digitos serve a qualquer Fonte.
 *
 * O piso de digitos existe para que "Turma 2024" nao dispare a regra.
 */
const PISO_DE_DIGITOS = 8;

const somenteDigitos = (texto: string): string => (texto.match(/\d/g) ?? []).join('');

export function nomeRepeteOEndereco(nome: string, endereco: string): boolean {
  const n = somenteDigitos(nome);
  const e = somenteDigitos(endereco);
  if (n.length < PISO_DE_DIGITOS || e.length < PISO_DE_DIGITOS) return false;
  return n === e || e.endsWith(n) || n.endsWith(e);
}
