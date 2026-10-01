import { nomeRepeteOEndereco } from '../../nucleo/nome-do-endereco.js';

/**
 * Envolve nomeRepeteOEndereco (nucleo, mecanico — so compara sufixo/prefixo
 * de digitos) com o NONO DIGITO MOVEL BRASILEIRO, que entrou em 2012:
 * cadastro antigo/JID guarda oito digitos de assinante, o nome escrito por
 * extenso as vezes guarda nove. O digito extra fica no MEIO do numero (logo
 * apos DDI+DDD), entao nenhuma comparacao de sufixo ou prefixo o alcanca.
 *
 * FICA NO ADAPTADOR DE WHATSAPP, nao no nucleo: o cabecalho de
 * nome-do-endereco.ts e explicito — "traduzir a forma escrita do numero na
 * forma do endereco e vocabulario de Fonte" e nao deve subir. Precedente:
 * src/adaptadores/contatos/telefone.ts resolve o mesmo nono digito para o
 * casamento de catalogo, tambem no adaptador, nunca no nucleo. Este arquivo
 * NAO importa aquele — adaptador nao importa adaptador (so `src/cli`
 * compoe mais de uma Fonte) — e reimplementa a parte minima que este caso
 * precisa: aqui os dois lados ja sao conhecidos, entao nao ha "gerar
 * variante para buscar no catalogo" nem o risco de casar com o numero de
 * OUTRA pessoa que aquela geracao existe para evitar.
 *
 * Medido em 30/09/2026 contra o Acervo real: 1.110 de 1.110 Atribuicoes de
 * nome origem='whatsapp' com prefixo '+55' que nomeRepeteOEndereco nao
 * reconhecia tinham EXATAMENTE esta forma — 100%, nao uma classe entre
 * outras. Tarefa #1101.
 */
const DDI_BR = '55';

const somenteDigitos = (texto: string): string => (texto.match(/\d/g) ?? []).join('');

export function nomeRepeteONumeroBrasileiro(nome: string, endereco: string): boolean {
  if (nomeRepeteOEndereco(nome, endereco)) return true;

  const n = somenteDigitos(nome);
  const e = somenteDigitos(endereco);
  const [maior, menor] = n.length > e.length ? [n, e] : [e, n];
  if (maior.length !== menor.length + 1) return false;
  if (!maior.startsWith(DDI_BR)) return false;
  // Posicao 4 = logo apos DDI (2) + DDD (2). So conta como nono digito
  // quando o digito INSERIDO ali e '9' — a convencao real, nao qualquer
  // digito que por coincidencia alinhe o resto.
  if (maior[4] !== '9') return false;

  const semNono = maior.slice(0, 4) + maior.slice(5);
  return semNono === menor;
}
