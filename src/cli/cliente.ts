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
  /** Status HTTP quando a falha veio de uma resposta (so a classe `uso` o usa hoje). */
  status?: number;
}

const TIMEOUT_PADRAO_MS = 30_000;

function falha(
  classe: CodigoDeFalha['classe'],
  codigoDeSaida: number,
  mensagem: string,
  status?: number,
): CodigoDeFalha {
  const e = new Error(mensagem) as CodigoDeFalha;
  e.classe = classe;
  e.codigoDeSaida = codigoDeSaida;
  if (status !== undefined) e.status = status;
  return e;
}

/**
 * O codigo de saida e o mesmo (5, a classe "servidor"), e o prefixo "Erro do servidor (NNN)" tambem; so o 504 e o
 * 503 ganham uma frase que diz o que fazer.
 */
function mensagemDeErroDoServidor(status: number): string {
  if (status === 504) {
    return 'Erro do servidor (504): a consulta passou do prazo do servidor. Restrinja os filtros, por exemplo por período ou remetente.';
  }
  if (status === 503) return 'Erro do servidor (503). Servidor ocupado ou indisponível: tente de novo daqui a pouco.';
  return `Erro do servidor (${status}).`;
}

/** A classificacao por status, a mesma para leitura e escrita. Lanca; nao devolve nada. */
function classificarResposta(status: number, corpo: string): void {
  if (status === 401) {
    throw falha(
      'credencial',
      3,
      'Credencial recusada — a Chave de Acesso está ausente, inválida ou revogada ' +
        '(o servidor não distingue as três, e este cliente não adivinha).',
    );
  }
  if (status >= 500) throw falha('servidor', 5, mensagemDeErroDoServidor(status));
  if (status >= 400) throw falha('uso', 6, `Invocação recusada (${status}): ${corpo}`, status);
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
  classificarResposta(resposta.status, corpo);
  return { status: resposta.status, corpo };
}

/**
 * Irmã de `pedirGet` para corpo BINÁRIO — `.text()` corromperia bytes de
 * imagem/documento. A classificação de status (401/5xx/4xx) é a mesma; só o
 * corpo de sucesso muda de forma.
 */
export async function pedirGetBinario(
  servidor: string,
  chave: string,
  caminho: string,
  opcoes: { timeoutMs?: number } = {},
): Promise<{ status: number; contentType: string | null; bytes: Buffer }> {
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

  if (resposta.status === 401) {
    throw falha(
      'credencial',
      3,
      'Credencial recusada — a Chave de Acesso está ausente, inválida ou revogada ' +
        '(o servidor não distingue as três, e este cliente não adivinha).',
    );
  }
  if (resposta.status >= 500) {
    throw falha('servidor', 5, mensagemDeErroDoServidor(resposta.status));
  }
  if (resposta.status >= 400) {
    const corpo = await resposta.text();
    throw falha('uso', 6, `Invocação recusada (${resposta.status}): ${corpo}`);
  }

  const bytes = Buffer.from(await resposta.arrayBuffer());
  return { status: resposta.status, contentType: resposta.headers.get('content-type'), bytes };
}

const MENSAGEM_DE_TIMEOUT_DE_ESCRITA =
  'Tempo esgotado esperando o servidor — resultado DESCONHECIDO: o pedido pode ter sido ' +
  'aceito. Repetir pode DUPLICAR a mensagem. Confira antes com: malote mensagens ' +
  '--direcao enviada (a Mensagem aparece depois que o ouvir da conta processa o Envio, ' +
  'alguns segundos depois).';

/**
 * Irmã de escrita de `pedirGet`: POST com corpo JSON. A classificação de status é a
 * mesma; o que muda é a mensagem do timeout, porque aqui REPETIR NÃO É INOFENSIVO.
 * Sem retry — quem decide repetir é quem chamou. O `.text()` fica dentro do `try`: o
 * sinal de timeout também aborta a leitura do corpo.
 */
export async function pedirPost(
  servidor: string,
  chave: string,
  caminho: string,
  corpoJson: string,
  opcoes: { timeoutMs?: number } = {},
): Promise<{ status: number; corpo: string }> {
  const url = `${servidor}${caminho}`;
  let status: number;
  let corpo: string;
  try {
    const resposta = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${chave}`, 'content-type': 'application/json' },
      body: corpoJson,
      signal: AbortSignal.timeout(opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS),
    });
    status = resposta.status;
    corpo = await resposta.text();
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') {
      throw falha('indeterminado', 7, MENSAGEM_DE_TIMEOUT_DE_ESCRITA);
    }
    throw falha(
      'conexao',
      4,
      `Não consegui falar com ${servidor}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  classificarResposta(status, corpo);
  return { status, corpo };
}
