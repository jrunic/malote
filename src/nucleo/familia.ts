import type { Acervo } from './acervo.js';
import type { PessoaId } from './tipos.js';

/**
 * A resolução da família mora aqui, num módulo só, e todo ponto de leitura a
 * importa. É o que impede que oito lugares divirjam sobre o que "a Pessoa"
 * significa depois de uma mesclagem.
 *
 * A família é uma ESTRELA DE UM SALTO: toda absorvida aponta direto para a
 * mestre, nunca para outra absorvida. Por isso não há percurso recursivo aqui —
 * e é o invariante que as duas guardas do Acervo sustentam.
 */

/**
 * Expressão reusável: os ids da família. Um salto, sem recursão.
 *
 * Usa `?` posicional REPETIDO, e quem chama passa o id DUAS vezes. A forma
 * numerada `?1` seria mais enxuta e o driver a recusa quando os valores vêm
 * posicionalmente — medido em 29/08/2026: `Too many parameter values were
 * provided`. Ela funciona por objeto, mas as consultas que embutem esta
 * expressão montam os valores por posição, e misturar as duas convenções na
 * mesma instrução é como se erra a ordem dos parâmetros sem o driver reclamar.
 */
export const SQL_FAMILIA = `SELECT id FROM pessoas WHERE id = ? OR absorvida_por = ?`;

/**
 * Os ids da família. Para uma mestre, ela e as absorvidas nela; para uma
 * absorvida, apenas ela — ler uma absorvida NÃO redireciona, porque
 * redirecionar faria a leitura mentir sobre qual Pessoa foi pedida.
 */
export function familiaDe(acervo: Acervo, pessoaId: PessoaId): PessoaId[] {
  const linha = acervo.preparar('SELECT absorvida_por FROM pessoas WHERE id = ?')
    .get(pessoaId) as { absorvida_por: string | null } | undefined;
  if (linha === undefined) return [];
  if (linha.absorvida_por !== null) return [pessoaId];
  return (acervo.preparar(SQL_FAMILIA).all(pessoaId, pessoaId) as Array<{ id: string }>).map((l) => l.id);
}

/** A raiz da família desta Pessoa. Ela mesma, quando já é raiz. */
export function mestreDe(acervo: Acervo, pessoaId: PessoaId): PessoaId | null {
  const linha = acervo.preparar('SELECT absorvida_por FROM pessoas WHERE id = ?')
    .get(pessoaId) as { absorvida_por: string | null } | undefined;
  if (linha === undefined) return null;
  return linha.absorvida_por ?? pessoaId;
}
