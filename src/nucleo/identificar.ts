import type { Acervo } from './acervo.js';
import type { Fonte } from './tipos.js';
import type { PrecedenciaDeNome } from '../registro/precedencia-de-nome.js';
import { nomeDaPessoa, nomeEscolhido, nomesDoIdentificador } from './identidade.js';

export type PapelDaForma = 'consultado' | 'canonico' | 'alternativo';

/** Uma forma do endereco que a correspondencia conhece, gravada como linha ou nao. */
export interface FormaDeEndereco {
  fonte: Fonte;
  valor: string;
  papel: PapelDaForma;
  /** O id do Identificador gravado, ou `null` quando a forma so existe como correspondencia. */
  identificador: string | null;
}

export interface NomeDaResposta {
  nome: string;
  origem: string;
  autoridade: 'titular' | 'terceiro' | null;
  atribuidoEm: string;
}

export interface IdentificadorIdentificado {
  id: string;
  fonte: Fonte;
  valor: string;
  papel: PapelDaForma;
  pessoaId: string | null;
  /** Nome corrente da PESSOA (familia inteira), pela precedencia; nulo sem Pessoa ou sem nome. */
  nomeDaPessoa: string | null;
  /** Nome corrente do PROPRIO Identificador, pela precedencia, e a origem dele. */
  nome: string | null;
  origemDoNome: string | null;
  nomes: NomeDaResposta[];
  /** Conversas em que consta como participante OU em que escreveu. */
  conversas: number;
  mensagens: number;
  primeiraMensagemEm: number | null;
  ultimaMensagemEm: number | null;
}

export interface Identificacao {
  consultado: { valor: string; fonte: Fonte | null };
  identificadores: IdentificadorIdentificado[];
  formas: FormaDeEndereco[];
}

const ORDEM_DO_PAPEL: Record<PapelDaForma, number> = { consultado: 0, canonico: 1, alternativo: 2 };

/**
 * O que o Acervo sabe de um Identificador, POR VALOR — com ou sem Pessoa. Parte do Identificador e
 * nunca da Pessoa: 37.988 Identificadores de WhatsApp nao tem Pessoa e `pessoas --texto` nao os ve.
 *
 * O Acervo grava o endereco na forma canonica e guarda a alternativa so como correspondencia
 * (valor contra valor); parte das alternativas existe tambem como linha, por heranca. Por isso
 * a resposta separa os Identificadores GRAVADOS das FORMAS que a correspondencia conhece.
 *
 * So le: nao abre Operacao.
 */
export function identificarPorValor(
  acervo: Acervo,
  entrada: { valor: string; fonte?: Fonte },
  precedencia: PrecedenciaDeNome,
): Identificacao {
  const { valor } = entrada;
  const fonteFiltro = entrada.fonte ?? null;

  const fontes = new Set<Fonte>();
  const comLinha = acervo
    .preparar('SELECT DISTINCT fonte FROM identificadores WHERE valor = ?')
    .all(valor) as Array<{ fonte: Fonte }>;
  for (const l of comLinha) fontes.add(l.fonte);
  const comCorrespondencia = acervo
    .preparar('SELECT DISTINCT fonte FROM correspondencias_de_endereco WHERE alternativo = ? OR canonico = ?')
    .all(valor, valor) as Array<{ fonte: Fonte }>;
  for (const l of comCorrespondencia) fontes.add(l.fonte);

  const buscarLinha = acervo.preparar('SELECT id, pessoa_id FROM identificadores WHERE fonte = ? AND valor = ?');
  const formas: FormaDeEndereco[] = [];
  const gravados = new Map<
    string,
    { id: string; pessoaId: string | null; fonte: Fonte; valor: string; papel: PapelDaForma }
  >();

  const registrar = (fonte: Fonte, v: string, papel: PapelDaForma): void => {
    const linha = buscarLinha.get(fonte, v) as { id: string; pessoa_id: string | null } | undefined;
    formas.push({ fonte, valor: v, papel, identificador: linha?.id ?? null });
    if (linha !== undefined && !gravados.has(linha.id)) {
      gravados.set(linha.id, { id: linha.id, pessoaId: linha.pessoa_id, fonte, valor: v, papel });
    }
  };

  for (const fonte of [...fontes].sort()) {
    if (fonteFiltro !== null && fonte !== fonteFiltro) continue;
    const canonico =
      (
        acervo
          .preparar('SELECT canonico FROM correspondencias_de_endereco WHERE fonte = ? AND alternativo = ?')
          .get(fonte, valor) as { canonico: string } | undefined
      )?.canonico ?? valor;
    const alternativos = (
      acervo
        .preparar(
          'SELECT alternativo FROM correspondencias_de_endereco WHERE fonte = ? AND canonico = ? ORDER BY alternativo',
        )
        .all(fonte, canonico) as Array<{ alternativo: string }>
    ).map((l) => l.alternativo);

    registrar(fonte, canonico, canonico === valor ? 'consultado' : 'canonico');
    for (const alt of alternativos) registrar(fonte, alt, alt === valor ? 'consultado' : 'alternativo');
    // O valor consultado entra sempre, mesmo sem correspondencia nem linha na forma pedida.
    if (!formas.some((f) => f.fonte === fonte && f.valor === valor)) registrar(fonte, valor, 'consultado');
  }

  const contarConversas = acervo.preparar(
    `SELECT COUNT(*) AS n FROM (
       SELECT conversa_id FROM participacoes WHERE identificador_id = ?
       UNION
       SELECT conversa_id FROM mensagens WHERE autor_id = ?
     )`,
  );
  const contarMensagens = acervo.preparar(
    'SELECT COUNT(*) AS n, MIN(ocorrida_em) AS primeira, MAX(ocorrida_em) AS ultima FROM mensagens WHERE autor_id = ?',
  );

  const identificadores: IdentificadorIdentificado[] = [...gravados.values()].map((g) => {
    const nomes = nomesDoIdentificador(acervo, g.id);
    const escolhido = nomeEscolhido(nomes, precedencia);
    const mensagens = contarMensagens.get(g.id) as { n: number; primeira: number | null; ultima: number | null };
    return {
      id: g.id,
      fonte: g.fonte,
      valor: g.valor,
      papel: g.papel,
      pessoaId: g.pessoaId,
      nomeDaPessoa: g.pessoaId === null ? null : nomeDaPessoa(acervo, g.pessoaId, precedencia),
      nome: escolhido?.nome ?? null,
      origemDoNome: escolhido?.origem ?? null,
      nomes: nomes.map((n) => ({
        nome: n.nome,
        origem: n.origem,
        autoridade: n.autoridade,
        atribuidoEm: n.atribuidoEm,
      })),
      conversas: (contarConversas.get(g.id, g.id) as { n: number }).n,
      mensagens: mensagens.n,
      primeiraMensagemEm: mensagens.primeira,
      ultimaMensagemEm: mensagens.ultima,
    };
  });
  identificadores.sort((a, b) => ORDEM_DO_PAPEL[a.papel] - ORDEM_DO_PAPEL[b.papel] || a.valor.localeCompare(b.valor));
  formas.sort((a, b) => ORDEM_DO_PAPEL[a.papel] - ORDEM_DO_PAPEL[b.papel] || a.valor.localeCompare(b.valor));

  return { consultado: { valor, fonte: fonteFiltro }, identificadores, formas };
}
