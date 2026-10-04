import { existsSync, readFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { pedirPost, type CodigoDeFalha } from './cliente.js';
import { mimetypeDoCaminho } from './mimetype-do-caminho.js';
import { resolverChaveEm } from './chave-em.js';

/**
 * `malote enviar` no MODO REDE: pede o Envio ao servidor (`POST /envios/solicitar`) em vez
 * de gravar no Acervo local. O Inquilino vem so da Chave de Acesso — por isso `--inquilino`
 * e RECUSADO, nao ignorado. A mensagem so e processada pelo `malote ouvir` da Configuracao:
 * esta rota aceita o pedido, nao confirma o envio.
 *
 * Recusa local = codigo 2, ANTES de qualquer I/O de rede.
 */

/**
 * Copia do limite do CORPO da rota de Envio, que mora na camada de rede — e a camada da CLI
 * nao pode importa-la (fronteira da biblioteca de recepcao). Um teste compara as duas. E
 * limite do corpo JSON, nao do arquivo: o base64 incha o arquivo em 4/3.
 */
export const LIMITE_DO_CORPO_DE_ENVIO = 8 * 1024 * 1024;
const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT_TEXTO_MS = 30_000;
const TIMEOUT_ARQUIVO_MS = 120_000;

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
  const fornecido = opcao(argumentos, 'identificador');
  if (fornecido !== undefined && !FORMA_DE_UUID.test(fornecido)) {
    escrever(`--identificador precisa ser um UUID, recebido "${fornecido}".`);
    return 2;
  }
  // O Identificador de Envio nasce AQUI, antes do pedido: e o que torna a repeticao segura quando
  // a resposta nao chega (codigo 7), porque o cliente o tem mesmo sem ter recebido o envioId.
  const identificadorDeEnvio = fornecido ?? randomUUID();
  const caminhoDoArquivo = imagem ?? documento;
  if (caminhoDoArquivo !== undefined && !existsSync(caminhoDoArquivo)) {
    escrever(`Arquivo nao encontrado: ${caminhoDoArquivo}`);
    return 2;
  }

  const resolvida = resolverChaveEm(argumentos, rede.env, rede.chave);
  if ('erro' in resolvida) {
    escrever(resolvida.erro);
    return 2;
  }
  const chave = resolvida.chave;
  if (chave === undefined || chave.trim() === '') {
    escrever(
      'Informe MALOTE_CHAVE_DE_ACESSO ou --chave-em <VARIAVEL>: ' +
        'a Chave de Acesso e a identidade do pedido por rede.',
    );
    return 2;
  }

  let corpo: Record<string, unknown>;
  if (caminhoDoArquivo === undefined) {
    corpo = { configuracao: apelido, para, tipo: 'texto', texto, identificadorDeEnvio };
  } else {
    // Guarda de memoria: o base64 nunca e menor que a entrada, entao arquivo que sozinho ja
    // passa do limite do corpo e recusado sem ser lido. A checagem exata, pos-codificacao,
    // logo abaixo, e a guarda de verdade.
    const tamanhoDoArquivo = statSync(caminhoDoArquivo).size;
    if (tamanhoDoArquivo > LIMITE_DO_CORPO_DE_ENVIO) {
      escrever(
        `O arquivo tem ${tamanhoDoArquivo} bytes e o pedido todo (em base64) tem teto de ` +
          `${LIMITE_DO_CORPO_DE_ENVIO} bytes: o teto pratico do arquivo fica perto de 6 MB.`,
      );
      return 2;
    }
    const bytes = readFileSync(caminhoDoArquivo);
    corpo = {
      configuracao: apelido,
      para,
      identificadorDeEnvio,
      tipo: imagem !== undefined ? 'imagem' : 'documento',
      arquivoBase64: bytes.toString('base64'),
      mimetype: mimetypeDoCaminho(caminhoDoArquivo),
      ...(documento !== undefined ? { nomeDeArquivo: basename(caminhoDoArquivo) } : {}),
      ...(texto !== undefined ? { texto } : {}),
    };
  }
  const corpoJson = JSON.stringify(corpo);
  const tamanho = Buffer.byteLength(corpoJson);
  if (tamanho > LIMITE_DO_CORPO_DE_ENVIO) {
    escrever(
      `Pedido de ${tamanho} bytes passa do limite de ${LIMITE_DO_CORPO_DE_ENVIO} bytes do corpo ` +
        '(o arquivo em base64 incha ~4/3: o teto pratico do arquivo fica perto de 6 MB).',
    );
    return 2;
  }

  let resposta: { corpo: string };
  try {
    resposta = await pedirPost(rede.servidor, chave, '/envios/solicitar', corpoJson, {
      timeoutMs: rede.timeoutMs ?? (caminhoDoArquivo === undefined ? TIMEOUT_TEXTO_MS : TIMEOUT_ARQUIVO_MS),
    });
  } catch (e) {
    const falha = e as CodigoDeFalha;
    if (typeof falha.codigoDeSaida !== 'number') throw e;
    if (falha.status === 409) {
      escrever(
        `O identificador ${identificadorDeEnvio} ja foi usado para outro pedido ` +
          '(outra Configuracao, destinatario ou conteudo). Use outro identificador.',
      );
      return falha.codigoDeSaida;
    }
    if (falha.codigoDeSaida === 7) {
      escrever(
        `Sem resposta do servidor: nao sei se o Envio entrou. Identificador do pedido: ${identificadorDeEnvio}. ` +
          `Repita com --identificador ${identificadorDeEnvio}: o servidor nao cria um segundo Envio. ` +
          `Para saber o estado: malote envio estado ${identificadorDeEnvio} --chave-em <VARIAVEL>.`,
      );
      return 7;
    }
    if (falha.classe === 'uso' && falha.status === 404) {
      escrever(
        `Configuracao "${apelido}" nao existe neste Inquilino, ou a chave nao o alcanca ` +
          '(o servidor nao distingue as duas, e este cliente nao adivinha).',
      );
    } else {
      escrever(falha.message);
    }
    if (falha.codigoDeSaida === 4 || falha.codigoDeSaida === 5) {
      escrever(
        `Identificador do pedido: ${identificadorDeEnvio} (repita com --identificador ${identificadorDeEnvio}).`,
      );
    }
    return falha.codigoDeSaida;
  }

  // --json imprime o corpo como veio, e so ele: quem consome o --json confere o campo
  // `identificadorDeEnvio` do corpo (o aviso de servidor antigo e do modo texto).
  if (argumentos.includes('--json')) {
    escrever(resposta.corpo);
    return 0;
  }
  const lido = JSON.parse(resposta.corpo) as {
    envioId?: string;
    identificadorDeEnvio?: string;
    repetido?: boolean;
  };
  const envioId = lido.envioId ?? '?';
  escrever(
    lido.repetido === true
      ? `Envio ja registrado: ${envioId} (identificador ${identificadorDeEnvio}; nenhum Envio novo foi criado).`
      : `Envio aceito: ${envioId} (identificador ${identificadorDeEnvio}; pendente — o "malote ouvir" da ` +
          `Configuracao o processa; confira com: malote envio estado ${identificadorDeEnvio} --chave-em <VARIAVEL>).`,
  );
  if (lido.identificadorDeEnvio !== identificadorDeEnvio) {
    escrever(
      'Aviso: o servidor nao confirmou o identificador deste pedido (servidor sem repeticao segura). ' +
        'Repetir este pedido pode DUPLICAR a mensagem.',
    );
  }
  return 0;
}
