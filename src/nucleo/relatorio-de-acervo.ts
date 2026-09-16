import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Acervo } from './acervo.js';

/**
 * O relatório existe para tornar o problema de espaço visível ANTES de virar
 * incidente. É só leitura: nenhum caminho daqui escreve no Acervo, no Registro
 * ou no Destino — e a garantia é estrutural, porque quem chama abre o Acervo
 * em modo de leitura, que o SQLite recusa gravar.
 *
 * Nenhuma consulta aqui toca o conteúdo nem o bruto da Mensagem: quem opera
 * precisa saber quanto ocupa, nunca o que diz.
 */

/**
 * As faixas são declaradas, não derivadas de percentil: o Titular precisa
 * comparar dois relatórios de meses distintos, e faixa que se move sozinha
 * torna a comparação impossível.
 */
export const FAIXAS_DE_IDADE = [
  { nome: 'ate-30-dias', ateDias: 30 },
  { nome: 'ate-1-ano', ateDias: 365 },
  { nome: 'ate-3-anos', ateDias: 365 * 3 },
  { nome: 'mais-de-3-anos', ateDias: Number.POSITIVE_INFINITY },
] as const;

export interface Recorte {
  anexos: number;
  bytesDeclarados: number;
  bytesPresentes: number;
}

export interface TotalDoAcervo extends Recorte {
  anexosPresentes: number;
  anexosNuncaObtidos: number;
  anexosDescartados: number;
  /**
   * Anexo cujo material nunca declarou tamanho. Contado A PARTE de zero bytes:
   * "o material não diz" e "o material diz que é vazio" são coisas diferentes,
   * e é esta contagem que distingue Fonte que não declara de Fonte não trazida.
   */
  anexosSemTamanhoDeclarado: number;
}

export interface RelatorioDeAcervo {
  total: TotalDoAcervo;
  porFonte: Record<string, Recorte>;
  porTipo: Record<string, Recorte>;
  porNaturezaDeConversa: Record<string, Recorte>;
  porFaixaDeIdade: Record<string, Recorte>;
}

export interface OpcoesDeRelatorio {
  /** Instante de referência das faixas de idade. Injetado, nunca `Date.now()`. */
  agora: number;
}

interface LinhaDeAnexo {
  tipo: string;
  tamanho: number | null;
  presenca: string;
  fonte: string;
  coletiva: number;
  ocorrida_em: number;
}

function vazio(): Recorte {
  return { anexos: 0, bytesDeclarados: 0, bytesPresentes: 0 };
}

function somar(alvo: Record<string, Recorte>, chave: string, linha: LinhaDeAnexo): void {
  const r = (alvo[chave] ??= vazio());
  r.anexos += 1;
  r.bytesDeclarados += linha.tamanho ?? 0;
  if (linha.presenca === 'presente') r.bytesPresentes += linha.tamanho ?? 0;
}

function faixaDe(ocorridaEm: number, agora: number): string {
  const dias = (agora - ocorridaEm) / 86_400_000;
  for (const f of FAIXAS_DE_IDADE) {
    if (dias <= f.ateDias) return f.nome;
  }
  return FAIXAS_DE_IDADE[FAIXAS_DE_IDADE.length - 1]!.nome;
}

export function relatarAcervo(acervo: Acervo, opcoes: OpcoesDeRelatorio): RelatorioDeAcervo {
  const linhas = acervo.preparar(
      `SELECT a.tipo, a.tamanho, a.presenca, m.fonte, c.coletiva, m.ocorrida_em
         FROM anexos a
         JOIN mensagens m ON m.id = a.mensagem_id
         JOIN conversas c ON c.id = m.conversa_id`,
    )
    .all() as LinhaDeAnexo[];

  const r: RelatorioDeAcervo = {
    total: {
      ...vazio(),
      anexosPresentes: 0,
      anexosNuncaObtidos: 0,
      anexosDescartados: 0,
      anexosSemTamanhoDeclarado: 0,
    },
    porFonte: {},
    porTipo: {},
    porNaturezaDeConversa: {},
    porFaixaDeIdade: {},
  };

  for (const l of linhas) {
    r.total.anexos += 1;
    r.total.bytesDeclarados += l.tamanho ?? 0;
    if (l.tamanho === null) r.total.anexosSemTamanhoDeclarado += 1;
    if (l.presenca === 'presente') {
      r.total.anexosPresentes += 1;
      r.total.bytesPresentes += l.tamanho ?? 0;
    } else if (l.presenca === 'descartado') {
      r.total.anexosDescartados += 1;
    } else {
      r.total.anexosNuncaObtidos += 1;
    }

    somar(r.porFonte, l.fonte, l);
    somar(r.porTipo, l.tipo, l);
    somar(r.porNaturezaDeConversa, l.coletiva === 1 ? 'coletiva' : 'direta', l);
    somar(r.porFaixaDeIdade, faixaDe(l.ocorrida_em, opcoes.agora), l);
  }
  return r;
}

export interface DivergenciaDeDisco {
  /**
   * Falso quando o Destino esta inacessivel. Os vetores vem VAZIOS nesse caso,
   * e nao cheios: Destino desmontado nao e perda de acervo, e apresenta-lo
   * como perda e o defeito que este campo existe para impedir.
   */
  conferiu: boolean;
  /** Acervo diz `presente` e o disco nao tem o arquivo. */
  presentesSemArquivo: string[];
  /** Arquivo sob a subarvore do Inquilino que nenhum Anexo reivindica. */
  arquivosSemAnexo: string[];
  /** Arquivo existe e o tamanho nao bate com o gravado. */
  tamanhoDivergente: string[];
}

/** Todo arquivo sob uma raiz, em caminho relativo a ela. */
function arquivosSob(raiz: string): string[] {
  const achados: string[] = [];
  const pilha = [raiz];
  while (pilha.length > 0) {
    const atual = pilha.pop() as string;
    for (const nome of readdirSync(atual)) {
      const alvo = join(atual, nome);
      if (statSync(alvo).isDirectory()) pilha.push(alvo);
      else achados.push(relative(raiz, alvo));
    }
  }
  return achados;
}

/**
 * Confronta o que o Acervo diz com o que esta no disco, NOS DOIS SENTIDOS.
 *
 * A conferencia e por `stat` — existe e o tamanho bate. Nao abre arquivo e nao
 * compara impressao: comparar conteudo de 166 mil arquivos e operacao de outra
 * natureza, e o campo `impressao` existe para quando ela fizer sentido.
 *
 * A varredura do disco fica na SUBARVORE DO INQUILINO, nunca na raiz do
 * Destino: dois Inquilinos podem apontar para a mesma raiz, e varrer a raiz
 * inteira faria os arquivos de um aparecerem como orfaos do outro.
 */
export function conferirDisco(acervo: Acervo, destino: string): DivergenciaDeDisco {
  const nada: DivergenciaDeDisco = {
    conferiu: false,
    presentesSemArquivo: [],
    arquivosSemAnexo: [],
    tamanhoDivergente: [],
  };
  if (!existsSync(destino)) return nada;

  const reivindicados = new Map<string, number | null>();
  for (const l of acervo.preparar(
      "SELECT caminho, tamanho FROM anexos WHERE presenca = 'presente' AND caminho IS NOT NULL",
    )
    .all() as Array<{ caminho: string; tamanho: number | null }>) {
    reivindicados.set(l.caminho, l.tamanho);
  }

  const r: DivergenciaDeDisco = {
    conferiu: true,
    presentesSemArquivo: [],
    arquivosSemAnexo: [],
    tamanhoDivergente: [],
  };
  for (const [caminho, tamanho] of reivindicados) {
    const alvo = join(destino, caminho);
    if (!existsSync(alvo)) {
      r.presentesSemArquivo.push(caminho);
      continue;
    }
    if (tamanho !== null && statSync(alvo).size !== tamanho) r.tamanhoDivergente.push(caminho);
  }

  const subarvore = join(destino, acervo.inquilinoId);
  if (existsSync(subarvore)) {
    for (const relativo of arquivosSob(subarvore)) {
      const comoNoAcervo = join(acervo.inquilinoId, relativo);
      if (!reivindicados.has(comoNoAcervo)) r.arquivosSemAnexo.push(comoNoAcervo);
    }
  }
  return r;
}
