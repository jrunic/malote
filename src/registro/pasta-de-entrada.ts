import type { InquilinoId } from '../nucleo/tipos.js';
import type { Registro } from './registro.js';
import { emOperacao } from '../nucleo/trilha.js';

/**
 * Onde uma Configuracao espera material novo, e como le-lo.
 *
 * NAO valida se o caminho existe: pasta ausente e condicao de EXECUCAO da
 * varredura, nao erro de configuracao — mesma razao pela qual Destino de Midia
 * fora do ar nao muda a Presenca de um Anexo. Declarar antes de a pasta existir
 * e caso normal em instalacao nova.
 */

export type NaturezaDoMaterial = 'completo' | 'parcial';

const NATUREZAS: readonly NaturezaDoMaterial[] = ['completo', 'parcial'];

export interface PastaDeEntrada {
  configuracaoId: string;
  pasta: string;
  natureza: NaturezaDoMaterial;
  nomeDoTitularNaFonte: string | null;
  declaradaEm: string;
}

export interface Declaracao {
  pasta: string;
  natureza: NaturezaDoMaterial;
  nomeDoTitularNaFonte?: string;
}

interface Linha {
  configuracao_id: string;
  pasta: string;
  natureza: string;
  nome_do_titular_na_fonte: string | null;
  declarada_em: string;
}

function paraPasta(l: Linha): PastaDeEntrada {
  return {
    configuracaoId: l.configuracao_id,
    pasta: l.pasta,
    natureza: l.natureza as NaturezaDoMaterial,
    nomeDoTitularNaFonte: l.nome_do_titular_na_fonte,
    declaradaEm: l.declarada_em,
  };
}

export function declararPastaDeEntrada(
  registro: Registro,
  configuracaoId: string,
  d: Declaracao,
): void {
  if (!NATUREZAS.includes(d.natureza)) {
    throw new Error(
      `natureza precisa ser uma de ${NATUREZAS.join(', ')}; veio: ${String(d.natureza)}`,
    );
  }
  if (d.pasta.trim().length === 0) throw new Error('pasta nao pode ser vazia');

  // O Inquilino nao e parametro desta funcao — ela recebe a Configuracao.
  // Resolver antes, para que a Operacao saiba de quem e. Mesmo padrao de
  // definirIntervaloEsperado, e pela mesma razao.
  const dono = registro
    .preparar('SELECT inquilino_id FROM configuracoes_de_adaptador WHERE id = ?')
    .get(configuracaoId) as { inquilino_id: string } | undefined;
  if (dono === undefined) throw new Error(`Configuracao desconhecida: ${configuracaoId}`);

  const antes = registro
    .preparar('SELECT pasta FROM entradas_de_adaptador WHERE configuracao_id = ?')
    .get(configuracaoId) as { pasta: string } | undefined;

  emOperacao(
    registro,
    {
      natureza: 'declarar-pasta-de-entrada',
      reversibilidade: 'por-efeito',
      inquilinoId: dono.inquilino_id,
    },
    (op) => {
      registro
        .preparar(
          `INSERT INTO entradas_de_adaptador
             (configuracao_id, pasta, natureza, nome_do_titular_na_fonte, declarada_em)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (configuracao_id) DO UPDATE SET
             pasta = excluded.pasta,
             natureza = excluded.natureza,
             nome_do_titular_na_fonte = excluded.nome_do_titular_na_fonte,
             declarada_em = excluded.declarada_em`,
        )
        .run(
          configuracaoId,
          d.pasta,
          d.natureza,
          d.nomeDoTitularNaFonte ?? null,
          new Date().toISOString(),
        );

      if (antes?.pasta !== d.pasta) {
        op.valor({
          tabela: 'entradas_de_adaptador',
          chave: configuracaoId,
          campo: 'pasta',
          antes: antes?.pasta ?? null,
          depois: d.pasta,
        });
      }
    },
  );
}

export function lerPastaDeEntrada(
  registro: Registro,
  configuracaoId: string,
): PastaDeEntrada | null {
  const l = registro
    .preparar(
      `SELECT configuracao_id, pasta, natureza, nome_do_titular_na_fonte, declarada_em
         FROM entradas_de_adaptador WHERE configuracao_id = ?`,
    )
    .get(configuracaoId) as Linha | undefined;
  return l === undefined ? null : paraPasta(l);
}

/**
 * Todas as Configuracoes vigiadas de um Inquilino, em ordem estavel.
 *
 * Por fonte e apelido, e NAO por instante de declaracao: duas declaracoes no
 * mesmo milissegundo sairiam em ordem indefinida, e esta saida e lida por gente
 * e comparada entre execucoes.
 */
export function listarPastasDeEntrada(
  registro: Registro,
  inquilinoId: InquilinoId,
): PastaDeEntrada[] {
  const linhas = registro
    .preparar(
      `SELECT e.configuracao_id, e.pasta, e.natureza, e.nome_do_titular_na_fonte, e.declarada_em
         FROM entradas_de_adaptador e
         JOIN configuracoes_de_adaptador c ON c.id = e.configuracao_id
        WHERE c.inquilino_id = ?
        ORDER BY c.fonte, c.apelido`,
    )
    .all(inquilinoId) as Linha[];
  return linhas.map(paraPasta);
}
