import { textoAtualDe, type EdicaoDaMensagem } from '../nucleo/edicao.js';

/**
 * A Mensagem editada (#1246) na saida de texto de `mensagens`, `buscar` e `exportar`: o texto ATUAL com a marca
 * `(editada)` e, logo abaixo e indentadas, as versoes anteriores em ordem (a original primeiro, quando tem texto).
 * Aceita `edicoes` ausente de proposito: servidor anterior a este campo nao o devolve, e o cliente trata a ausencia como
 * lista vazia, com a saida de sempre.
 */
export interface MensagemComEdicoes {
  conteudo: string | null;
  edicoes?: readonly EdicaoDaMensagem[] | undefined;
}

const SEM_TEXTO = '(sem texto)';

/** O texto da linha principal. Legenda apagada (texto vazio) e Mensagem sem texto saem como `(sem texto)`. */
export function textoParaExibir(m: MensagemComEdicoes): string {
  const edicoes = m.edicoes ?? [];
  const atual = textoAtualDe(m.conteudo, edicoes);
  const base = atual === null || atual === '' ? SEM_TEXTO : atual;
  return edicoes.length > 0 ? `${base} (editada)` : base;
}

/**
 * As versoes anteriores, uma por texto (a continuacao de texto de varias linhas fica recuada). Sem edicao, nenhuma linha.
 * A original que nao tem texto (midia) nao e versao.
 */
export function linhasDaMensagemEditada(m: MensagemComEdicoes, recuo = '    '): string[] {
  const edicoes = m.edicoes ?? [];
  if (edicoes.length === 0) return [];
  const versoes = [m.conteudo, ...edicoes.slice(0, -1).map((e) => e.texto)].filter((t): t is string => t !== null);
  return versoes.flatMap((texto) => {
    const [primeira = '', ...resto] = (texto === '' ? SEM_TEXTO : texto).split('\n');
    return [`${recuo}[antes] ${primeira}`, ...resto.map((l) => `${recuo}        ${l}`)];
  });
}
