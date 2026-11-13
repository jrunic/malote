/**
 * O rotulo de uma midia no Indice de Midia: `AAAAMMDD-NN-<conversa>`. Funcao pura e determinista: duas execucoes sobre o
 * mesmo Acervo dao o mesmo rotulo. Nada aqui carrega o endereco opaco da Fonte.
 */

/** Maximo de caracteres do nome da Conversa no rotulo. */
export const TAMANHO_MAXIMO_DO_NOME_NO_ROTULO = 60;

/**
 * Minusculas, sem acento, em que qualquer sequencia de caracteres que nao sejam letra ou digito ASCII vira um unico hifen,
 * sem hifen nas bordas e com no maximo 60 caracteres (cortado e depois sem hifen na borda).
 */
export function nomeParaRotulo(texto: string): string {
  const semAcento = texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const ascii = semAcento.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return ascii.slice(0, TAMANHO_MAXIMO_DO_NOME_NO_ROTULO).replace(/-+$/g, '');
}

export interface FontesDoNomeDoRotulo {
  /** Nome corrente do outro lado da Conversa direta. */
  nome: string | null;
  /** Assunto da coletiva. */
  assunto: string | null;
  /** So os digitos do telefone, quando a Conversa direta tem telefone. Nunca o endereco opaco. */
  telefone: string | null;
  conversaId: string;
}

/** Nome, ou assunto, ou os digitos do telefone, ou `sem-nome-` com os 6 primeiros caracteres do id da Conversa. */
export function nomeDaConversaNoRotulo(f: FontesDoNomeDoRotulo): string {
  for (const candidato of [f.assunto, f.nome]) {
    if (candidato !== null) {
      const slug = nomeParaRotulo(candidato);
      if (slug !== '') return slug;
    }
  }
  if (f.telefone !== null && /^\d+$/.test(f.telefone)) return f.telefone.slice(0, TAMANHO_MAXIMO_DO_NOME_NO_ROTULO);
  return `sem-nome-${f.conversaId.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toLowerCase()}`;
}

/** `AAAAMMDD` do instante no fuso (zona IANA). */
const FORMATADORES = new Map<string, Intl.DateTimeFormat>();

export function dataNoFuso(ocorridaEm: number, fuso: string): string {
  let formatador = FORMATADORES.get(fuso);
  if (formatador === undefined) {
    formatador = new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' });
    FORMATADORES.set(fuso, formatador);
  }
  const partes = formatador
    .formatToParts(new Date(ocorridaEm))
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${partes['year']}${partes['month']}${partes['day']}`;
}

/** `AAAAMMDD` que existe no calendario: `20261340` nao e dia, e `Date.UTC` o normalizaria em silencio para outro. */
export function diaValido(dia: string): boolean {
  if (!/^\d{8}$/.test(dia)) return false;
  const [a, m, d] = [Number(dia.slice(0, 4)), Number(dia.slice(4, 6)), Number(dia.slice(6, 8))];
  const x = new Date(Date.UTC(a, m - 1, d));
  return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
}

/**
 * O primeiro instante (ms) cujo dia no fuso e `AAAAMMDD`. Busca binaria em vez de aritmetica de deslocamento: no dia em que o
 * horario de verao comecava as 00:00 a meia-noite nao existe, e o dia comeca as 01:00 (a aritmetica caia na hora anterior,
 * ainda no dia anterior). O dia no fuso nao diminui com o instante, e os deslocamentos de fuso ficam entre -12 h e +14 h:
 * a 15 h de cada lado da meia-noite UTC o invariante vale.
 */
export function inicioDoDiaNoFuso(dia: string, fuso: string): number {
  if (!diaValido(dia)) throw new Error(`Dia invalido (use AAAAMMDD, um dia que existe): ${dia}`);
  const meiaNoiteUtc = Date.UTC(Number(dia.slice(0, 4)), Number(dia.slice(4, 6)) - 1, Number(dia.slice(6, 8)));
  let baixo = meiaNoiteUtc - 15 * 3_600_000; // o dia no fuso e anterior a `dia`
  let alto = meiaNoiteUtc + 15 * 3_600_000; // o dia no fuso ja e `dia` (ou depois)
  while (alto - baixo > 1) {
    const meio = Math.floor((baixo + alto) / 2);
    if (dataNoFuso(meio, fuso) >= dia) alto = meio;
    else baixo = meio;
  }
  return alto;
}

/** O instante (ms) do ultimo milissegundo do dia no fuso. */
export function fimDoDiaNoFuso(dia: string, fuso: string): number {
  const proximo = new Date(Date.UTC(Number(dia.slice(0, 4)), Number(dia.slice(4, 6)) - 1, Number(dia.slice(6, 8)) + 1));
  const aaaammdd = `${proximo.getUTCFullYear()}${String(proximo.getUTCMonth() + 1).padStart(2, '0')}${String(proximo.getUTCDate()).padStart(2, '0')}`;
  return inicioDoDiaNoFuso(aaaammdd, fuso) - 1;
}

/** `NN` com zeros a esquerda e no minimo 3 digitos (passando de 999, os digitos necessarios). */
export function ordemNoRotulo(nn: number): string {
  return String(nn).padStart(3, '0');
}

export function rotuloDeMidia(data: string, nn: number, nomeNoRotulo: string): string {
  return `${data}-${ordemNoRotulo(nn)}-${nomeNoRotulo}`;
}

/**
 * Numera as midias de uma Conversa na ORDEM em que chegam (instante, Mensagem, Anexo): o `NN` e a ordem da midia na
 * Conversa naquele dia, e recomeca em 1 quando o dia (no fuso) muda. Quem a usa entrega os itens em ordem; ela nao reordena.
 */
export class NumeradorDeMidia {
  private dia: string | undefined;
  private n = 0;

  constructor(private readonly fuso: string) {}

  proximo(ocorridaEm: number): { data: string; nn: number } {
    const data = dataNoFuso(ocorridaEm, this.fuso);
    if (data !== this.dia) {
      this.dia = data;
      this.n = 0;
    }
    this.n += 1;
    return { data, nn: this.n };
  }
}
