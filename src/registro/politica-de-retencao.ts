import type { Registro } from './registro.js';
import type { InquilinoId } from '../nucleo/tipos.js';
import { emOperacao } from '../nucleo/trilha.js';

/**
 * Os critérios que decidem quais Anexos deixam de ocupar disco.
 *
 * Vive no Registro, por Inquilino, e não no Acervo: é configuração do
 * Inquilino, como a precedência de nome e o intervalo esperado — e é isso que
 * faz trocá-la mudar a projeção sem escrever uma linha no Acervo.
 *
 * Os critérios declarados se combinam por E, nunca por OU. "Vídeo com mais de
 * três anos" é a pergunta que o Titular faz; "vídeo OU com mais de três anos"
 * descartaria todo o texto antigo do Acervo junto.
 */
export interface CriteriosDeRetencao {
  maisVelhoQueDias?: number;
  maiorQueBytes?: number;
  /** Tipos de Anexo alcançados. Vazio ou ausente = qualquer tipo. */
  tipos?: string[];
}

export interface PoliticaDeRetencao extends CriteriosDeRetencao {
  definidaEm: string;
}

export function definirPoliticaDeRetencao(
  registro: Registro,
  inquilinoId: InquilinoId,
  criterios: CriteriosDeRetencao,
): void {
  const existe = registro.preparar('SELECT 1 AS ok FROM inquilinos WHERE id = ?')
    .get(inquilinoId) as { ok: number } | undefined;
  if (existe === undefined) throw new Error(`Inquilino desconhecido: ${inquilinoId}`);

  const dias = criterios.maisVelhoQueDias;
  const bytes = criterios.maiorQueBytes;
  const tipos = criterios.tipos?.filter((t) => t.trim() !== '') ?? [];

  if (dias !== undefined && (!Number.isInteger(dias) || dias <= 0)) {
    throw new Error(`Idade precisa ser inteiro de dias maior que zero: ${dias}`);
  }
  if (bytes !== undefined && (!Number.isInteger(bytes) || bytes <= 0)) {
    throw new Error(`Tamanho precisa ser inteiro de bytes maior que zero: ${bytes}`);
  }

  // A recusa da Politica vazia e estrutural, nao conveniencia de interface: a
  // selecao de alvos combina os criterios declarados por E, e a conjuncao
  // sobre nenhum criterio alcanca TODO Anexo presente. Uma Politica sem
  // criterio, aplicada com efeito, apagaria o Acervo inteiro em disco — e
  // pareceria, na linha de comando, com nao ter decidido nada ainda.
  if (dias === undefined && bytes === undefined && tipos.length === 0) {
    throw new Error(
      'Politica de Retencao exige pelo menos um criterio: ' +
        '--mais-velho-que-dias, --maior-que-mb ou --tipos.',
    );
  }

  const antes = registro.preparar(
      `SELECT mais_velho_que_dias, maior_que_bytes, tipos
         FROM politicas_de_retencao WHERE inquilino_id = ?`,
    )
    .get(inquilinoId) as
    | { mais_velho_que_dias: number | null; maior_que_bytes: number | null; tipos: string | null }
    | undefined;

  const novos = {
    mais_velho_que_dias: dias ?? null,
    maior_que_bytes: bytes ?? null,
    tipos: tipos.length === 0 ? null : tipos.join(','),
  };

  emOperacao(
    registro,
    { natureza: 'definir-politica', reversibilidade: 'por-efeito', inquilinoId },
    (op) => {
      registro.preparar(
          `INSERT INTO politicas_de_retencao
             (inquilino_id, mais_velho_que_dias, maior_que_bytes, tipos, definida_em)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (inquilino_id) DO UPDATE SET
             mais_velho_que_dias = excluded.mais_velho_que_dias,
             maior_que_bytes     = excluded.maior_que_bytes,
             tipos               = excluded.tipos,
             definida_em         = excluded.definida_em`,
        )
        .run(
          inquilinoId,
          novos.mais_velho_que_dias,
          novos.maior_que_bytes,
          novos.tipos,
          new Date().toISOString(),
        );

      // So campo que MUDOU. Relatar campo intocado faria a trilha afirmar
      // mudanca que nao houve — e e esta trilha que responde "quem mudou a
      // Politica e quando", que ate agora era irrecuperavel.
      for (const campo of ['mais_velho_que_dias', 'maior_que_bytes', 'tipos'] as const) {
        const de = antes === undefined ? null : antes[campo];
        const para = novos[campo];
        if (de === para) continue;
        op.valor({
          tabela: 'politicas_de_retencao',
          chave: inquilinoId,
          campo,
          antes: de === null ? null : String(de),
          depois: para === null ? null : String(para),
        });
      }
    },
  );
}

export function lerPoliticaDeRetencao(
  registro: Registro,
  inquilinoId: InquilinoId,
): PoliticaDeRetencao | null {
  const l = registro.preparar(
      `SELECT mais_velho_que_dias, maior_que_bytes, tipos, definida_em
         FROM politicas_de_retencao WHERE inquilino_id = ?`,
    )
    .get(inquilinoId) as
    | {
        mais_velho_que_dias: number | null;
        maior_que_bytes: number | null;
        tipos: string | null;
        definida_em: string;
      }
    | undefined;
  if (l === undefined) return null;

  // Montado campo a campo por causa de `exactOptionalPropertyTypes`: atribuir
  // `undefined` explicito a propriedade opcional nao compila neste repo.
  const p: PoliticaDeRetencao = { definidaEm: l.definida_em };
  if (l.mais_velho_que_dias !== null) p.maisVelhoQueDias = l.mais_velho_que_dias;
  if (l.maior_que_bytes !== null) p.maiorQueBytes = l.maior_que_bytes;
  if (l.tipos !== null) p.tipos = l.tipos.split(',');
  return p;
}

/**
 * Descrição estável da Política, gravada em `descartado_por`.
 *
 * Não existe id de Política — a tabela tem uma linha por Inquilino e trocá-la
 * sobrescreve. Gravar a descrição é o que permite, meses depois, saber por
 * qual regra aquele arquivo saiu, mesmo que a Política já seja outra.
 */
export function descreverPolitica(p: CriteriosDeRetencao): string {
  const partes: string[] = [];
  if (p.maisVelhoQueDias !== undefined) partes.push(`idade>${p.maisVelhoQueDias}d`);
  if (p.maiorQueBytes !== undefined) partes.push(`tamanho>${p.maiorQueBytes}b`);
  if (p.tipos !== undefined && p.tipos.length > 0) partes.push(`tipos=${p.tipos.join('|')}`);
  return partes.join(';');
}
