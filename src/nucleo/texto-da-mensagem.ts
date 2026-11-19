import type { Acervo } from './acervo.js';
import type { Fonte } from './tipos.js';

/**
 * O texto de uma Mensagem que JA existe (#1530): a porta que o estoque da legenda usa. A gravacao nova escreve o texto
 * no INSERT e o gatilho de insercao mantem a busca; aqui o texto de uma linha existente muda, e a busca por texto
 * (conteudo externo, com gatilho so de insercao e de remocao) NAO acompanha sozinha.
 *
 * Por isso cada escrita refaz a entrada do indice, e na ORDEM que se mediu num indice igual ao do Acervo: retirar a
 * entrada com o texto ANTIGO (nulo ou vazio tambem precisa ser retirado), atualizar a linha, pôr a entrada nova. Retirar
 * com o texto novo depois de atualizar, ou atualizar sem retirar, deixa o indice defasado, e apagar a Mensagem depois
 * dá "indice malformado" na busca inteira.
 */

export interface TextoDeMensagem {
  /** O texto antes: nulo ou vazio, as duas formas contam como "sem texto". */
  antes: string | null;
}

/** Uma Mensagem sem texto: nulo ou vazio. */
function semTexto(valor: string | null): boolean {
  return valor === null || valor === '';
}

function retirarDoIndice(acervo: Acervo, rowid: number, texto: string | null): void {
  acervo
    .preparar(`INSERT INTO mensagens_texto(mensagens_texto, rowid, conteudo) VALUES ('delete', ?, ?)`)
    .run(rowid, texto);
}

function porNoIndice(acervo: Acervo, rowid: number, texto: string | null): void {
  acervo.preparar(`INSERT INTO mensagens_texto(rowid, conteudo) VALUES (?, ?)`).run(rowid, texto);
}

/**
 * Escreve o texto de uma Mensagem que ainda NAO tem (nulo ou vazio). Devolve o texto de antes, ou `null` quando a
 * Mensagem ja tem texto ou saiu do Acervo: nunca sobrescreve. A leitura, o `UPDATE` e as duas operacoes do indice
 * correm na transacao do chamador (um lote), e a leitura dentro dela e a que decide.
 */
export function escreverTextoDeMensagem(acervo: Acervo, mensagemId: string, texto: string): TextoDeMensagem | null {
  if (texto === '') throw new RangeError('o texto a gravar nao pode ser vazio');
  // A propria transacao (um savepoint quando o chamador ja tem uma): uma queda entre retirar a entrada do indice e poe-la
  // deixaria o indice defasado, e o produto nao o reconstroi.
  return acervo.db.transaction((): TextoDeMensagem | null => {
    const l = acervo.preparar('SELECT rowid AS rowid, conteudo FROM mensagens WHERE id = ?').get(mensagemId) as
      | { rowid: number; conteudo: string | null }
      | undefined;
    if (l === undefined || !semTexto(l.conteudo)) return null;
    retirarDoIndice(acervo, l.rowid, l.conteudo);
    acervo.preparar('UPDATE mensagens SET conteudo = ? WHERE id = ?').run(texto, mensagemId);
    porNoIndice(acervo, l.rowid, texto);
    return { antes: l.conteudo };
  })();
}

/**
 * O inverso, para o `desfazer`: devolve o texto ao de antes (nulo ou vazio), mas so se a Mensagem ainda tem o texto que o
 * comando gravou. O texto que outro caminho escreveu depois nao se toca. A mesma ordem: retira a entrada com o texto
 * gravado, atualiza, repoe a entrada do texto de antes.
 */
export function restaurarTextoDeMensagem(
  acervo: Acervo,
  mensagemId: string,
  textoGravado: string,
  antes: string | null,
): boolean {
  return acervo.db.transaction((): boolean => {
    const l = acervo.preparar('SELECT rowid AS rowid, conteudo FROM mensagens WHERE id = ?').get(mensagemId) as
      | { rowid: number; conteudo: string | null }
      | undefined;
    if (l === undefined || l.conteudo !== textoGravado) return false;
    retirarDoIndice(acervo, l.rowid, l.conteudo);
    acervo.preparar('UPDATE mensagens SET conteudo = ? WHERE id = ?').run(antes, mensagemId);
    porNoIndice(acervo, l.rowid, antes);
    return true;
  })();
}

/**
 * O indice de busca por texto esta de acordo com as Mensagens? Na forma que COMPARA o indice com o conteudo (`rank = 1`):
 * a forma simples do `integrity-check` nao compara e dá ok com o indice defasado (medido). Devolve `false` no lugar do
 * erro de banco que o SQLite lança quando ha divergencia.
 */
export function indiceDeBuscaEstaIntegro(acervo: Acervo): boolean {
  try {
    acervo.preparar(`INSERT INTO mensagens_texto(mensagens_texto, rank) VALUES ('integrity-check', 1)`).run();
    return true;
  } catch (erro) {
    if (erro instanceof Error && /malformed|SQLITE_CORRUPT|corrupt/i.test(`${erro.message} ${(erro as { code?: string }).code ?? ''}`)) {
      return false;
    }
    throw erro;
  }
}

export interface FiltroDeCandidatasDeTexto {
  fonte: Fonte;
  /** O trecho que o Conteudo Bruto (ou o do Anexo) precisa conter: e do Adaptador, o nucleo nao conhece o formato. */
  contem: string;
  /** O trecho que o Conteudo Bruto da Mensagem precisa COMECAR com: separa a forma do evento ao vivo da do backup. */
  comecaCom: string;
  depoisDe: number;
  limite: number;
}

export interface CandidataDeTexto {
  rowid: number;
  mensagemId: string;
  bruto: string;
}

/**
 * As Mensagens sem texto (nulo ou vazio) cujo Conteudo Bruto contem o trecho e comeca como o Adaptador diz, em ordem de
 * posicao fisica a partir de um cursor. Serve para a consulta nao trazer o Acervo inteiro: quem le o bruto decide se ha
 * legenda de verdade. A Fonte entra como `+fonte` pelo mesmo motivo da Citacao (o indice unico faria o plano reler tudo).
 */
export function listarCandidatasDeTextoPeloBruto(acervo: Acervo, filtro: FiltroDeCandidatasDeTexto): CandidataDeTexto[] {
  const linhas = acervo
    .preparar(
      `SELECT rowid AS rowid, id, bruto FROM mensagens
        WHERE rowid > ? AND +fonte = ? AND (conteudo IS NULL OR conteudo = '')
          AND bruto IS NOT NULL AND substr(bruto, 1, ?) = ? AND instr(bruto, ?) > 0
        ORDER BY rowid LIMIT ?`,
    )
    .all(filtro.depoisDe, filtro.fonte, filtro.comecaCom.length, filtro.comecaCom, filtro.contem, filtro.limite) as Array<{
    rowid: number;
    id: string;
    bruto: string;
  }>;
  return linhas.map((l) => ({ rowid: l.rowid, mensagemId: l.id, bruto: l.bruto }));
}

export interface CandidataDeTextoPeloAnexo extends CandidataDeTexto {
  tipoDoAnexo: string;
  brutoDoAnexo: string;
}

/**
 * O mesmo, para o que mora no registro do ANEXO (a legenda do backup): as Mensagens sem texto, com Anexo de um dos tipos,
 * cujo Conteudo Bruto da Mensagem comeca como o Adaptador diz e cujo bruto do Anexo contem o trecho.
 */
export function listarCandidatasDeTextoPeloAnexo(
  acervo: Acervo,
  filtro: FiltroDeCandidatasDeTexto & { tipos: readonly string[] },
): CandidataDeTextoPeloAnexo[] {
  const marcas = filtro.tipos.map(() => '?').join(', ');
  const linhas = acervo
    .preparar(
      `SELECT m.rowid AS rowid, m.id AS id, m.bruto AS bruto, a.tipo AS tipo, a.bruto AS bruto_anexo
         FROM mensagens m JOIN anexos a ON a.mensagem_id = m.id
        WHERE m.rowid > ? AND +m.fonte = ? AND (m.conteudo IS NULL OR m.conteudo = '')
          AND m.bruto IS NOT NULL AND substr(m.bruto, 1, ?) = ? AND a.tipo IN (${marcas})
          AND a.bruto IS NOT NULL AND instr(a.bruto, ?) > 0
        ORDER BY m.rowid LIMIT ?`,
    )
    .all(
      filtro.depoisDe,
      filtro.fonte,
      filtro.comecaCom.length,
      filtro.comecaCom,
      ...filtro.tipos,
      filtro.contem,
      filtro.limite,
    ) as Array<{ rowid: number; id: string; bruto: string; tipo: string; bruto_anexo: string }>;
  return linhas.map((l) => ({
    rowid: l.rowid,
    mensagemId: l.id,
    bruto: l.bruto,
    tipoDoAnexo: l.tipo,
    brutoDoAnexo: l.bruto_anexo,
  }));
}
