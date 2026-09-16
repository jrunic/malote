/**
 * O catalogo nao produz Conversa nem Mensagem, entao nao usa o
 * `RelatorioDeImportacao` compartilhado: treze dos catorze campos dele seriam
 * zero permanente, e relatorio de zeros fixos nao informa — afirma fracasso.
 * `jaRegistrado` e replicado com o mesmo nome e o mesmo significado.
 */
export interface RelatorioDeCatalogo {
  /** Verdadeiro quando o Material ja entrou e a passagem foi PULADA. */
  jaRegistrado: boolean;
  cartoesLidos: number;
  /**
   * Cartao sem telefone. Medido no material real: 1.210 de 6.693.
   *
   * DEIXOU DE SER DESCARTE em 12/09/2026: 869 deles tem e-mail e entram. O
   * contador fica porque continua respondendo uma pergunta util — quanto do
   * acervo o produtor por telefone nao alcanca.
   */
  cartoesSemTelefone: number;
  /**
   * Cartao sem telefone E sem e-mail — nao ha nada ali. Medido: 341.
   *
   * E o descarte de verdade, e o unico. Era subconjunto de `cartoesSemTelefone`
   * enquanto os dois significavam descarte; hoje sao coisas diferentes.
   */
  cartoesSemContatoAlgum: number;
  identificadoresCriados: number;
  identificadoresJaExistentes: number;
  nomesCriados: number;
  nomesJaExistentes: number;
}

export function relatorioDeCatalogoVazio(): RelatorioDeCatalogo {
  return {
    jaRegistrado: false,
    cartoesLidos: 0,
    cartoesSemTelefone: 0,
    cartoesSemContatoAlgum: 0,
    identificadoresCriados: 0,
    identificadoresJaExistentes: 0,
    nomesCriados: 0,
    nomesJaExistentes: 0,
  };
}
