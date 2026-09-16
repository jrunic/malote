/**
 * Cliente HTTP do malote — o que a CLI usa no modo rede.
 *
 * Contrato de saída, POR CLASSE de falha (mesmo molde do tili):
 *   3 = credencial — 401 de corpo vazio: ausente, inválida ou revogada é
 *       indistinguível POR DESENHO do servidor, e a mensagem não adivinha.
 *   4 = conexão recusada ou credencial/servidor ausente do lado cliente.
 *   5 = 5xx — o servidor errou.
 *   6 = 4xx que não seja 401 — uso errado da API.
 *   7 = timeout — resultado DESCONHECIDO: o servidor pode ter concluído
 *       depois de o cliente desistir. Em somente leitura é inofensivo, mas a
 *       mensagem diz o que é.
 *
 * Sem retry: consulta é leitura; quem decide repetir é quem chamou.
 */
export interface CodigoDeFalha extends Error {
  classe: 'credencial' | 'conexao' | 'servidor' | 'uso' | 'indeterminado';
  codigoDeSaida: number;
}

const TIMEOUT_PADRAO_MS = 30_000;

function falha(classe: CodigoDeFalha['classe'], codigoDeSaida: number, mensagem: string): CodigoDeFalha {
  const e = new Error(mensagem) as CodigoDeFalha;
  e.classe = classe;
  e.codigoDeSaida = codigoDeSaida;
  return e;
}

export async function pedirGet(
  servidor: string,
  chave: string,
  caminho: string,
  opcoes: { timeoutMs?: number } = {},
): Promise<{ status: number; corpo: string }> {
  const url = `${servidor}${caminho}`;
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      headers: { authorization: `Bearer ${chave}` },
      signal: AbortSignal.timeout(opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS),
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') {
      throw falha(
        'indeterminado',
        7,
        'Tempo esgotado esperando o servidor — resultado DESCONHECIDO: ' +
          'a consulta pode ter sido concluída de lá. Repetir é seguro (somente leitura).',
      );
    }
    throw falha(
      'conexao',
      4,
      `Não consegui falar com ${servidor}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const corpo = await resposta.text();
  if (resposta.status === 401) {
    throw falha(
      'credencial',
      3,
      'Credencial recusada — a Chave de Acesso está ausente, inválida ou revogada ' +
        '(o servidor não distingue as três, e este cliente não adivinha).',
    );
  }
  if (resposta.status >= 500) {
    throw falha('servidor', 5, `Erro do servidor (${resposta.status}).`);
  }
  if (resposta.status >= 400) {
    throw falha('uso', 6, `Invocação recusada (${resposta.status}): ${corpo}`);
  }
  return { status: resposta.status, corpo };
}
