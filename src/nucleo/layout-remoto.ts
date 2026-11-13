/**
 * Onde o arquivo de um Anexo cai no Destino Remoto.
 *
 * Decisao do NUCLEO, como o layout local (`caminho-de-midia.ts`), e derivada
 * dele: o segundo nivel do identificador derivado deixa de ser pasta e passa a
 * abrir o nome do arquivo. O caminho local tem DOIS niveis de pasta, o que
 * deixa quase uma pasta por arquivo (183 mil pastas para 247 mil arquivos,
 * medido em 11/11/2026); num remoto de objetos cada pasta criada custa uma
 * chamada de API (~1,2 s no piloto, e a criacao nao escala com a concorrencia).
 * Com um nivel so, o estoque inteiro cabe em ~1,5 mil pastas.
 *
 * Mesma garantia do caminho local: nada do que a Fonte entrega entra aqui.
 * A funcao so rearranja o caminho que `caminhoDeMidia` ja produziu, e RECUSA
 * qualquer forma diferente dela — recusar e a protecao contra alguem alimentar
 * esta funcao com um caminho que carregue nome de contato.
 *
 * O primeiro segmento continua sendo o Inquilino: dois Inquilinos podem
 * apontar para o mesmo remoto, e sem o segmento apagar os arquivos de um
 * alcancaria os do outro.
 */

export class CaminhoLocalInvalidoError extends Error {
  constructor(caminho: string) {
    super(`Caminho de Anexo fora da forma que o nucleo produz, nao ha caminho remoto para ele: ${caminho}`);
    this.name = 'CaminhoLocalInvalidoError';
  }
}

const SEGMENTO = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const NIVEL = /^[0-9a-f]{2}$/;
const ARQUIVO = /^[0-9a-f]{32}\.[a-z0-9]+$/;

/**
 * `<inquilino>/<pasta>/<n1>/<n2>/<resto>.<ext>` vira
 * `<inquilino>/<pasta>/<n1>/<n2><resto>.<ext>`. Funcao pura e injetiva: dois
 * caminhos locais distintos nunca dao o mesmo caminho remoto.
 */
export function caminhoRemoto(caminhoLocal: string): string {
  const partes = caminhoLocal.split('/');
  if (partes.length !== 5) throw new CaminhoLocalInvalidoError(caminhoLocal);
  const [inquilino, pasta, nivel1, nivel2, arquivo] = partes as [string, string, string, string, string];
  if (
    !SEGMENTO.test(inquilino) ||
    !SEGMENTO.test(pasta) ||
    !NIVEL.test(nivel1) ||
    !NIVEL.test(nivel2) ||
    !ARQUIVO.test(arquivo)
  ) {
    throw new CaminhoLocalInvalidoError(caminhoLocal);
  }
  return `${inquilino}/${pasta}/${nivel1}/${nivel2}${arquivo}`;
}

/** O caminho remoto sob a pasta-base do Destino Remoto; pasta-base vazia nao deixa barra sobrando. */
export function caminhoRemotoCompleto(pastaBase: string, caminhoLocal: string): string {
  const base = pastaBase.replace(/^\/+|\/+$/g, '');
  const relativo = caminhoRemoto(caminhoLocal);
  return base === '' ? relativo : `${base}/${relativo}`;
}
