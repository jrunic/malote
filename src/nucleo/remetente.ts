import type { Acervo } from './acervo.js';
import type { Fonte } from './tipos.js';

/**
 * Os Identificadores GRAVADOS que um valor de remetente alcanca: ele mesmo, a forma canonica e as
 * alternativas que a correspondencia de endereco conhece e que existem como linha. E a mesma
 * expansao de `identificarPorValor`, sem a presenca (contagens de Conversas e Mensagens), que
 * custa demais para servir de filtro; um teste fixa que as duas concordam.
 *
 * Valor sem nenhum Identificador devolve lista vazia — e quem filtra por ela recebe NADA, nao
 * tudo. So le: nao abre Operacao.
 */
export function identificadoresDoRemetente(
  acervo: Acervo,
  entrada: { valor: string; fonte?: Fonte },
): string[] {
  const { valor } = entrada;
  const fontes = new Set<Fonte>();
  for (const l of acervo
    .preparar('SELECT DISTINCT fonte FROM identificadores WHERE valor = ?')
    .all(valor) as Array<{ fonte: Fonte }>) {
    fontes.add(l.fonte);
  }
  for (const l of acervo
    .preparar('SELECT DISTINCT fonte FROM correspondencias_de_endereco WHERE alternativo = ? OR canonico = ?')
    .all(valor, valor) as Array<{ fonte: Fonte }>) {
    fontes.add(l.fonte);
  }

  const buscarLinha = acervo.preparar('SELECT id FROM identificadores WHERE fonte = ? AND valor = ?');
  const ids = new Set<string>();
  for (const fonte of fontes) {
    if (entrada.fonte !== undefined && fonte !== entrada.fonte) continue;
    const canonico =
      (
        acervo
          .preparar('SELECT canonico FROM correspondencias_de_endereco WHERE fonte = ? AND alternativo = ?')
          .get(fonte, valor) as { canonico: string } | undefined
      )?.canonico ?? valor;
    const alternativos = (
      acervo
        .preparar('SELECT alternativo FROM correspondencias_de_endereco WHERE fonte = ? AND canonico = ?')
        .all(fonte, canonico) as Array<{ alternativo: string }>
    ).map((l) => l.alternativo);
    for (const forma of [canonico, valor, ...alternativos]) {
      const linha = buscarLinha.get(fonte, forma) as { id: string } | undefined;
      if (linha !== undefined) ids.add(linha.id);
    }
  }
  return [...ids].sort();
}
