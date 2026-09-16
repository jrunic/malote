/**
 * Leitor de vCard. Sabe desdobrar linha, separar parametros e desescapar —
 * e mais nada. O que e telefone, o que e nome util e o que vira Identificador
 * e decisao de `importar.ts`; aqui nao ha dominio.
 */

export interface CartaoDeContato {
  /** `FN` — o nome de exibicao. Nulo quando o cartao nao traz nenhum. */
  nome: string | null;
  /** Valores crus de `TEL`, na ordem do cartao. Sem normalizar. */
  telefones: string[];
  /**
   * Valores crus de `EMAIL`, na ordem do cartao. Sem normalizar.
   *
   * VIRA Identificador desde 12/09/2026, normalizado pelo adaptador. Ate ali
   * era lido so para distinguir "cartao que o produto ainda nao sabe usar" de
   * "cartao sem contato nenhum" — e a base que so tinha e-mails nao entrava.
   */
  emails: string[];
}

/** Continuacao de linha dobrada comeca com espaco ou tabulacao (RFC 6350). */
function desdobrar(texto: string): string[] {
  const linhas: string[] = [];
  for (const bruta of texto.split(/\r?\n/)) {
    if (bruta.length === 0) continue;
    if ((bruta.startsWith(' ') || bruta.startsWith('\t')) && linhas.length > 0) {
      linhas[linhas.length - 1] += bruta.slice(1);
      continue;
    }
    linhas.push(bruta);
  }
  return linhas;
}

function desescapar(valor: string): string {
  return valor.replace(/\\([\\,;nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** `TEL;TYPE=cell:+55...` -> propriedade `TEL`, valor `+55...`. Parametros fora. */
function partir(linha: string): { propriedade: string; valor: string } | null {
  const doisPontos = linha.indexOf(':');
  if (doisPontos < 0) return null;
  const esquerda = linha.slice(0, doisPontos);
  const pontoEVirgula = esquerda.indexOf(';');
  const propriedade = (pontoEVirgula < 0 ? esquerda : esquerda.slice(0, pontoEVirgula))
    .trim()
    .toUpperCase();
  return { propriedade, valor: linha.slice(doisPontos + 1) };
}

export function lerVCard(texto: string): CartaoDeContato[] {
  const cartoes: CartaoDeContato[] = [];
  let atual: CartaoDeContato | null = null;
  for (const linha of desdobrar(texto)) {
    const p = partir(linha);
    if (p === null) continue;
    if (p.propriedade === 'BEGIN') {
      atual = { nome: null, telefones: [], emails: [] };
      continue;
    }
    if (p.propriedade === 'END') {
      if (atual !== null) cartoes.push(atual);
      atual = null;
      continue;
    }
    if (atual === null) continue;
    if (p.propriedade === 'FN') atual.nome = desescapar(p.valor).trim();
    if (p.propriedade === 'TEL') atual.telefones.push(desescapar(p.valor).trim());
    if (p.propriedade === 'EMAIL') atual.emails.push(desescapar(p.valor).trim());
  }
  return cartoes;
}
