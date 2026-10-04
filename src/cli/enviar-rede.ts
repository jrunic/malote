import { existsSync } from 'node:fs';
import { pedirPost, type CodigoDeFalha } from './cliente.js';

/**
 * `malote enviar` no MODO REDE: pede o Envio ao servidor (`POST /envios/solicitar`) em vez
 * de gravar no Acervo local. O Inquilino vem so da Chave de Acesso — por isso `--inquilino`
 * e RECUSADO, nao ignorado. A mensagem so e processada pelo `malote ouvir` da Configuracao:
 * esta rota aceita o pedido, nao confirma o envio.
 *
 * Recusa local = codigo 2, ANTES de qualquer I/O de rede.
 */

const TIMEOUT_TEXTO_MS = 30_000;

export interface RedeDeEnvio {
  /** Ja resolvido pelo ponto de entrada: `--servidor` ou a variavel de ambiente. */
  servidor: string;
  /** MALOTE_CHAVE_DE_ACESSO, a chave padrao da sessao. */
  chave: string | undefined;
  /** Ambiente para `--chave-em` ler a variavel nomeada. Injetado: nunca le process.env aqui. */
  env: Record<string, string | undefined>;
  escrever: (texto: string) => void;
  timeoutMs?: number;
}

function opcao(argumentos: string[], nome: string): string | undefined {
  const i = argumentos.indexOf(`--${nome}`);
  return i === -1 ? undefined : argumentos[i + 1];
}

export async function executarEnviarRede(argumentos: string[], rede: RedeDeEnvio): Promise<number> {
  const escrever = rede.escrever;

  if (opcao(argumentos, 'inquilino') !== undefined) {
    escrever(
      '--inquilino nao existe no modo rede: o Inquilino vem da Chave de Acesso. ' +
        'Para enviar pela instalacao local, rode com `env -u MALOTE_SERVIDOR`.',
    );
    return 2;
  }
  const apelido = opcao(argumentos, 'configuracao');
  const para = opcao(argumentos, 'para');
  const texto = opcao(argumentos, 'texto');
  const imagem = opcao(argumentos, 'imagem');
  const documento = opcao(argumentos, 'documento');

  if (apelido === undefined || para === undefined) {
    escrever(
      'Uso: malote enviar --configuracao <apelido> --para <endereco> ' +
        '(--texto <texto> | --imagem <caminho> [--texto <legenda>] | ' +
        '--documento <caminho> [--texto <legenda>]) [--chave-em <VARIAVEL>] [--json]',
    );
    return 2;
  }
  if (imagem === undefined && documento === undefined && texto === undefined) {
    escrever('Informe --texto, --imagem ou --documento.');
    return 2;
  }
  if (imagem !== undefined && documento !== undefined) {
    escrever('--imagem e --documento sao mutuamente exclusivos.');
    return 2;
  }
  if (!para.includes('@')) {
    escrever(`--para precisa de endereco completo (ex.: 5511999990000@s.whatsapp.net), recebido "${para}".`);
    return 2;
  }
  const caminhoDoArquivo = imagem ?? documento;
  if (caminhoDoArquivo !== undefined && !existsSync(caminhoDoArquivo)) {
    escrever(`Arquivo nao encontrado: ${caminhoDoArquivo}`);
    return 2;
  }

  // A chave. `--chave-em` NOMEIA a variavel (nunca recebe o valor). Se foi pedida e nao
  // existe, RECUSA: cair na chave padrao mandaria o pedido pelo Inquilino errado.
  const nomeDaVariavel = opcao(argumentos, 'chave-em');
  let chave: string | undefined;
  if (nomeDaVariavel !== undefined) {
    const valor = rede.env[nomeDaVariavel];
    if (valor === undefined || valor.trim() === '') {
      escrever(
        `A variavel ${nomeDaVariavel} (--chave-em) nao esta definida ou esta vazia; ` +
          'nao uso outra chave no lugar dela.',
      );
      return 2;
    }
    chave = valor.trim();
  } else {
    chave = rede.chave;
  }
  if (chave === undefined || chave.trim() === '') {
    escrever(
      'Informe MALOTE_CHAVE_DE_ACESSO ou --chave-em <VARIAVEL>: ' +
        'a Chave de Acesso e a identidade do pedido por rede.',
    );
    return 2;
  }

  const corpo: Record<string, unknown> = { configuracao: apelido, para, tipo: 'texto', texto };

  let resposta: { corpo: string };
  try {
    resposta = await pedirPost(rede.servidor, chave, '/envios/solicitar', JSON.stringify(corpo), {
      timeoutMs: rede.timeoutMs ?? TIMEOUT_TEXTO_MS,
    });
  } catch (e) {
    const falha = e as CodigoDeFalha;
    if (typeof falha.codigoDeSaida !== 'number') throw e;
    if (falha.classe === 'uso' && falha.status === 404) {
      escrever(
        `Configuracao "${apelido}" nao existe neste Inquilino, ou a chave nao o alcanca ` +
          '(o servidor nao distingue as duas, e este cliente nao adivinha).',
      );
    } else {
      escrever(falha.message);
    }
    return falha.codigoDeSaida;
  }

  if (argumentos.includes('--json')) {
    escrever(resposta.corpo);
    return 0;
  }
  const envioId = (JSON.parse(resposta.corpo) as { envioId?: string }).envioId ?? '?';
  escrever(
    `Envio aceito: ${envioId} (pendente — o "malote ouvir" da Configuracao o processa; ` +
      'confira com: malote mensagens --direcao enviada).',
  );
  return 0;
}
