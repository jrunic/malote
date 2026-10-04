import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Acervo } from '../nucleo/acervo.js';
import { buscarMensagens, contarPorFonte, expandirData, fonteDaConversa, lerAnexoPorId, lerMensagens, listarConversas, procurarPessoas } from '../nucleo/consulta.js';
import { quemEstavaEm } from '../nucleo/presenca.js';
import { codificarCursor, decodificarCursor } from '../nucleo/cursor.js';
import { abrirRegistro } from '../registro/registro.js';
import { listarChavesDeAcesso } from '../registro/chave-de-acesso.js';
import { configuracaoPorApelido, listarConfiguracoes, resolverFiltroDeConfiguracao } from '../registro/configuracao-adaptador.js';
import { conversasMarcadas } from '../nucleo/marca-do-titular.js';
import { lerDestinoDeMidia } from '../registro/destino-midia.js';
import type { IdentidadeDeAcesso } from '../registro/chave-de-acesso.js';
import { ehFonte, PRESENCAS } from '../nucleo/tipos.js';
import type { ConversaId, Fonte, InquilinoId } from '../nucleo/tipos.js';
import { identificadoresDoRemetente } from '../nucleo/remetente.js';
import { autoresDaConversa } from '../nucleo/autores-da-conversa.js';
import { cursorDaProximaPagina, listarAnexosDaConversa } from '../nucleo/anexos-da-conversa.js';
import { abrirAcervo, versaoDoAcervoEmDisco, VERSAO_SCHEMA_ACERVO } from '../nucleo/acervo.js';
import { solicitarTranscricao } from '../nucleo/transcricao.js';
import {
  contarEnviosPorEstado,
  EnvioDivergenteError,
  examinarRepeticao,
  lerEnvio,
  registrarEnvio,
  type ConteudoDeEnvio,
  type ExameDeRepeticao,
} from '../nucleo/envio.js';
import { identificarPorValor } from '../nucleo/identificar.js';
import { enriquecerPresenca } from '../nucleo/nomes-em-lote.js';
import { lerPrecedenciasDeNome, type PrecedenciaDeNome } from '../registro/precedencia-de-nome.js';

/**
 * As rotas. Cada uma recebe o Acervo que a Chave abriu e devolve dado.
 *
 * Nenhuma delas escolhe Inquilino: quando chegam aqui, o alcance ja esta
 * decidido pela credencial. E isso que impede que um parametro do chamador
 * amplie o que ele ve.
 */

export interface ContextoDaRequisicao {
  acervo: Acervo;
  identidade: IdentidadeDeAcesso;
  dados: string;
  /**
   * SO PARA TESTE: chamado entre o exame de repeticao e o registro de um Envio, para um teste
   * simular o outro processo que ganha a corrida. Producao nunca o define.
   */
  ganchoDeTeste?: { entreOExameEORegistro?: () => void; antesDeResponder?: (res: ServerResponse) => void };
}

/**
 * `limite` da query: inteiro maior que zero. `limite=abc` virava `LIMIT NaN` e `limite=0` lancava
 * `Cannot read properties of undefined` — as duas derrubavam o servidor (#1131); `-1` passava e, para o
 * SQLite, e SEM limite. Entrada invalida e erro de uso: `400`.
 */
function limiteInvalido(texto: string | null | undefined): boolean {
  if (texto === null || texto === undefined) return false;
  const n = Number(texto);
  return !Number.isInteger(n) || n < 1;
}

const ERRO_DE_LIMITE = { erro: 'limite precisa ser um inteiro maior que zero' };

function json(res: ServerResponse, status: number, corpo: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(corpo));
}

/**
 * Vazio de proposito: 404 detalhado e mapa para quem varre.
 *
 * Serve tanto para rota inexistente quanto para Conversa que este Acervo nao
 * tem — e a mesma resposta nos dois casos, porque distinguir "esta Conversa nao
 * e sua" de "esta Conversa nao existe" vazaria que ela existe em algum lugar.
 */
function naoEncontrado(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end('');
}

/**
 * `video` fica de fora: recusado com sinal dedicado (415), nunca chega aqui.
 * Tipo desconhecido cai em `application/octet-stream` — generico, nao quebra.
 */
const CONTENT_TYPE_POR_TIPO: Record<string, string> = {
  image: 'image/jpeg',
  audio: 'audio/opus',
  document: 'application/octet-stream',
  sticker: 'image/webp',
};

const TAMANHO_MAXIMO_DO_CORPO = 64 * 1024;

async function lerCorpoJson(req: IncomingMessage): Promise<unknown> {
  const pedacos: Buffer[] = [];
  let total = 0;
  for await (const pedaco of req as AsyncIterable<Buffer>) {
    total += pedaco.length;
    if (total > TAMANHO_MAXIMO_DO_CORPO) throw new Error('corpo grande demais');
    pedacos.push(pedaco);
  }
  const texto = Buffer.concat(pedacos).toString('utf8');
  return texto.length === 0 ? undefined : JSON.parse(texto);
}

/**
 * A UNICA rota de ESCRITA da API por rede — spec #1103, parte 3. Supera a
 * decisao formal de so-leitura do v1 (01-discussoes/20260824-recorte-v1.md)
 * de proposito, por decisao do Titular — o criterio 5 do ciclo 21 continua
 * valendo PARA O CLIENTE CLI, que nao aceita `--servidor` neste comando.
 *
 * Abre uma conexao PROPRIA, de ESCRITA — nunca `ctx.acervo`, que e
 * somente-leitura para toda outra rota. Confere a versao do schema ANTES de
 * abrir para escrita, mesma disciplina que o worker de Transcricao ja segue
 * dentro de `malote servir` (CONTEXTO.md: nenhum processo de fundo abre para
 * escrita sem checar a versao primeiro) — sem isso, o primeiro pedido
 * pos-deploy migraria a base sozinho, repetindo por desenho o
 * quase-incidente da v0.21.0.
 *
 * Isolamento por Inquilino: ESTRUTURAL, nao checagem a escrever — a conexao
 * abre o Acervo do Inquilino da credencial, e Anexo de outro Inquilino
 * simplesmente nao existe nessa base. `anexo-inexistente` e a MESMA resposta
 * (404, corpo vazio) para "nao existe em lugar nenhum" e "existe, mas em
 * outro Inquilino" — e por isso que a distincao nunca aparece aqui.
 *
 * CORPO INTEIRO sob try/catch — achado da revisao (dev-10, 01/10/2026):
 * `responder()` chama esta funcao sem `await` (fire-and-forget, `void`). Uma
 * excecao depois de um `await` (SQLITE_BUSY alem do busy_timeout, erro de
 * disco) viraria unhandled rejection — e por padrao do Node isso DERRUBA O
 * PROCESSO inteiro, nao so a requisicao. O worker de Transcricao ja tem essa
 * disciplina (`.catch(...)` em `iniciarWorkerDeTranscricao`); esta rota
 * precisa da mesma.
 */
async function responderSolicitacaoDeTranscricao(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ContextoDaRequisicao,
): Promise<void> {
  try {
    let corpo: unknown;
    try {
      corpo = await lerCorpoJson(req);
    } catch {
      json(res, 400, { erro: 'corpo invalido' });
      return;
    }

    const anexoId =
      typeof corpo === 'object' &&
      corpo !== null &&
      typeof (corpo as Record<string, unknown>)['anexoId'] === 'string'
        ? ((corpo as Record<string, unknown>)['anexoId'] as string)
        : undefined;
    if (anexoId === undefined) {
      json(res, 400, { erro: 'informe anexoId' });
      return;
    }

    const pastaDeAcervos = join(ctx.dados, 'acervos');
    const inquilinoId = ctx.identidade.inquilinoId as InquilinoId;
    const versao = versaoDoAcervoEmDisco(pastaDeAcervos, inquilinoId);
    if (versao !== undefined && versao !== VERSAO_SCHEMA_ACERVO) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end('');
      return;
    }

    const escrita = abrirAcervo(pastaDeAcervos, inquilinoId);
    try {
      const resultado = solicitarTranscricao(escrita, anexoId);
      if (!resultado.aceita) {
        if (resultado.motivoDeRecusa === 'anexo-inexistente') {
          naoEncontrado(res);
        } else {
          json(res, 400, { erro: resultado.motivoDeRecusa });
        }
        return;
      }
      json(res, 202, { aceita: true });
    } finally {
      escrita.fechar();
    }
  } catch {
    // NUNCA deixar subir sem resposta — SQLITE_BUSY além do busy_timeout cai
    // aqui. `headersSent` evita escrever duas vezes se a excecao vier depois
    // de uma resposta ja enviada (nao deveria acontecer, mas e gratis checar).
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('');
    }
  }
}

/**
 * Limite maior que o das rotas de JSON puro (64 KB): o corpo pode carregar
 * uma imagem ou documento em base64. 8 MB — nao 20 — pelo pico de memoria no
 * processo `servir`: base64 de 8 MB em string JSON sao ~11 MB parseados, mais
 * o `Buffer.from(..., 'base64')`, ~19 MB de pico por requisicao (20 MB de
 * limite daria ~47 MB). `servir` tambem roda o worker de Transcricao, que
 * mantem Buffer de audio durante a chamada ao whisper.cpp. Imagem comprimida
 * pelo WhatsApp tem 100-300 KB e a maioria dos PDFs cabe folgado; maior que
 * isso e recusado com 400, nunca aceito e truncado.
 */
export const TAMANHO_MAXIMO_DO_CORPO_DE_ENVIO = 8 * 1024 * 1024;

async function lerCorpoJsonGrande(req: IncomingMessage, limite: number): Promise<unknown> {
  const pedacos: Buffer[] = [];
  let total = 0;
  for await (const pedaco of req as AsyncIterable<Buffer>) {
    total += pedaco.length;
    if (total > limite) throw new Error('corpo grande demais');
    pedacos.push(pedaco);
  }
  const texto = Buffer.concat(pedacos).toString('utf8');
  return texto.length === 0 ? undefined : JSON.parse(texto);
}

const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O conteudo do pedido SEM arquivo em disco, so para o exame de repeticao (que ignora o caminho). */
function conteudoParaExame(
  tipo: 'texto' | 'imagem' | 'documento',
  legendaOuTexto: string | undefined,
  mimetype: string | undefined,
  nomeDeArquivo: string | undefined,
): ConteudoDeEnvio {
  if (tipo === 'texto') return { tipo: 'texto', texto: legendaOuTexto as string };
  const legenda = legendaOuTexto !== undefined ? { legenda: legendaOuTexto } : {};
  return tipo === 'imagem'
    ? { tipo: 'imagem', caminhoArquivo: '', mimetype: mimetype as string, ...legenda }
    : {
        tipo: 'documento',
        caminhoArquivo: '',
        mimetype: mimetype as string,
        nomeDeArquivo: nomeDeArquivo as string,
        ...legenda,
      };
}

/**
 * Segunda rota de escrita da API por rede, depois de `/transcricoes/solicitar`
 * (#1103). Mesma disciplina: conexao propria de escrita, versao do schema
 * checada ANTES de abrir, Inquilino so da credencial, corpo inteiro sob
 * try/catch (excecao depois de `await` num handler `void` derrubaria o
 * processo).
 *
 * Transporte de midia: JSON com o arquivo em base64 — nunca multipart (o
 * servidor e `node:http` cru, sem parser). ~33% a mais de bytes, aceito.
 *
 * A Conversa NAO nasce aqui: nasce em `processarEnvios`, dentro do `ouvir`,
 * que ja tem o privilegio de escrita. Esta rota so registra o pedido.
 */
async function responderSolicitacaoDeEnvio(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ContextoDaRequisicao,
): Promise<void> {
  try {
    let corpo: unknown;
    try {
      corpo = await lerCorpoJsonGrande(req, TAMANHO_MAXIMO_DO_CORPO_DE_ENVIO);
    } catch {
      json(res, 400, { erro: 'corpo invalido ou grande demais' });
      return;
    }
    if (typeof corpo !== 'object' || corpo === null) {
      json(res, 400, { erro: 'corpo invalido' });
      return;
    }
    const campos = corpo as Record<string, unknown>;
    const texto = (nome: string): string | undefined =>
      typeof campos[nome] === 'string' ? (campos[nome] as string) : undefined;

    // `fonte` opcional, default 'whatsapp' (a unica com Envio hoje): o
    // contrato nao muda quando outra Fonte ganhar Envio.
    const fonte = texto('fonte') ?? 'whatsapp';
    if (fonte !== 'whatsapp') {
      json(res, 400, { erro: `fonte "${fonte}" nao suporta Envio ainda — so whatsapp` });
      return;
    }
    const apelido = texto('configuracao');
    const para = texto('para');
    const tipo = texto('tipo') ?? 'texto';
    const legendaOuTexto = texto('texto');
    const arquivoBase64 = texto('arquivoBase64');
    const mimetype = texto('mimetype');
    const nomeDeArquivo = texto('nomeDeArquivo');
    const identificadorDeEnvio = texto('identificadorDeEnvio');
    if (
      campos['identificadorDeEnvio'] !== undefined &&
      (identificadorDeEnvio === undefined || !FORMA_DE_UUID.test(identificadorDeEnvio))
    ) {
      json(res, 400, { erro: 'identificadorDeEnvio precisa ser um UUID' });
      return;
    }

    if (apelido === undefined || para === undefined) {
      json(res, 400, { erro: 'informe configuracao e para' });
      return;
    }
    if (tipo !== 'texto' && tipo !== 'imagem' && tipo !== 'documento') {
      json(res, 400, { erro: 'tipo precisa ser texto, imagem ou documento' });
      return;
    }
    if (tipo === 'texto' && legendaOuTexto === undefined) {
      json(res, 400, { erro: 'informe texto' });
      return;
    }
    if (tipo !== 'texto' && (arquivoBase64 === undefined || mimetype === undefined)) {
      json(res, 400, { erro: 'informe arquivoBase64 e mimetype' });
      return;
    }
    if (tipo === 'documento' && nomeDeArquivo === undefined) {
      json(res, 400, { erro: 'informe nomeDeArquivo' });
      return;
    }

    const inquilinoId = ctx.identidade.inquilinoId as InquilinoId;
    const pastaDeAcervos = join(ctx.dados, 'acervos');
    const versao = versaoDoAcervoEmDisco(pastaDeAcervos, inquilinoId);
    if (versao !== undefined && versao !== VERSAO_SCHEMA_ACERVO) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end('');
      return;
    }

    // BUSCA, NUNCA CRIA, escopada ao Inquilino da credencial: Configuracao de
    // outro Inquilino responde igual a "nao existe em lugar nenhum".
    const registro = abrirRegistro(ctx.dados);
    let cfg;
    try {
      cfg = configuracaoPorApelido(registro, inquilinoId, fonte, apelido);
    } finally {
      registro.fechar();
    }
    if (cfg === undefined) {
      naoEncontrado(res);
      return;
    }

    // O Acervo abre ANTES de qualquer byte ir a disco: se `abrirAcervo`
    // lancar, nenhum staging orfao foi criado. O staging so existe dentro do
    // try que grava o Envio, e e removido se `registrarEnvio` nao concluir —
    // aqui ele so existiria por uma fracao de segundo, sem Envio nenhum o
    // referenciando, entao remover nao viola "o produto nunca apaga o que
    // moveu" (que vale para staging JA referenciado por Envio).
    const escrita = abrirAcervo(pastaDeAcervos, inquilinoId);
    let stagingParaLimpar: string | undefined;
    try {
      const destino = { enderecoCru: para };
      // Repeticao: examina ANTES de mandar bytes a disco. O arbitro final e a unicidade da
      // coluna, la no registro; aqui se evita escrever o que a repeticao nao vai usar.
      if (identificadorDeEnvio !== undefined) {
        const exame: ExameDeRepeticao = examinarRepeticao(escrita, {
          configuracaoId: cfg.id,
          destino,
          conteudo: conteudoParaExame(
            tipo as 'texto' | 'imagem' | 'documento',
            legendaOuTexto,
            mimetype,
            nomeDeArquivo,
          ),
          identificadorDeEnvio,
          fonte: 'whatsapp',
        });
        if (exame.resultado === 'divergente') {
          json(res, 409, { erro: 'identificadorDeEnvio ja usado para outro pedido' });
          return;
        }
        if (exame.resultado === 'repetido') {
          json(res, 200, { aceita: true, repetido: true, envioId: exame.envioId, identificadorDeEnvio });
          return;
        }
      }
      ctx.ganchoDeTeste?.entreOExameEORegistro?.();
      let conteudo: ConteudoDeEnvio;
      if (tipo === 'texto') {
        conteudo = { tipo: 'texto', texto: legendaOuTexto as string };
      } else {
        const pastaDeStaging = join(ctx.dados, 'envios-pendentes');
        mkdirSync(pastaDeStaging, { recursive: true });
        const caminhoDeStaging = join(pastaDeStaging, randomUUID());
        writeFileSync(caminhoDeStaging, Buffer.from(arquivoBase64 as string, 'base64'));
        stagingParaLimpar = caminhoDeStaging;
        const legenda = legendaOuTexto !== undefined ? { legenda: legendaOuTexto } : {};
        conteudo =
          tipo === 'imagem'
            ? { tipo: 'imagem', caminhoArquivo: caminhoDeStaging, mimetype: mimetype as string, ...legenda }
            : {
                tipo: 'documento',
                caminhoArquivo: caminhoDeStaging,
                mimetype: mimetype as string,
                nomeDeArquivo: nomeDeArquivo as string,
                ...legenda,
              };
      }
      const resultado = registrarEnvio(escrita, {
        configuracaoId: cfg.id,
        destino,
        conteudo,
        ...(identificadorDeEnvio !== undefined ? { identificadorDeEnvio, fonte: 'whatsapp' as const } : {}),
      });
      if (resultado.repetido) {
        // Outro processo ganhou a corrida: o staging que ESTE pedido escreveu nao e de ninguem.
        if (stagingParaLimpar !== undefined) {
          try {
            unlinkSync(stagingParaLimpar);
          } catch {
            // best-effort
          }
        }
        stagingParaLimpar = undefined;
        json(res, 200, {
          aceita: true,
          repetido: true,
          envioId: resultado.envioId,
          identificadorDeEnvio: resultado.identificadorDeEnvio,
        });
        return;
      }
      stagingParaLimpar = undefined; // o Envio agora o referencia
      json(res, 202, {
        aceita: true,
        envioId: resultado.envioId,
        identificadorDeEnvio: resultado.identificadorDeEnvio,
      });
    } catch (erroDeRegistro) {
      if (stagingParaLimpar !== undefined) {
        try {
          unlinkSync(stagingParaLimpar);
        } catch {
          // best-effort: nao mascara o erro original
        }
      }
      if (erroDeRegistro instanceof EnvioDivergenteError) {
        json(res, 409, { erro: 'identificadorDeEnvio ja usado para outro pedido' });
        return;
      }
      throw erroDeRegistro;
    } finally {
      escrita.fechar();
    }
  } catch {
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('');
    }
  }
}

export function responder(req: IncomingMessage, res: ServerResponse, ctx: ContextoDaRequisicao): void {
  const url = new URL(req.url ?? '/', 'http://interno');
  const partes = url.pathname.split('/').filter((p) => p !== '');

  // UNICA excecao ao bloqueio de metodo abaixo — tratada ANTES dele, nunca
  // relaxando a guarda geral. Fire-and-forget de proposito: `responder` e
  // sincrona para toda outra rota, e o `acervo` (somente-leitura) que
  // `criarServidor` fecha ao final NAO e usado por este handler, que abre a
  // propria conexao de escrita — fechar um nao afeta o outro.
  if (req.method === 'POST' && partes.length === 2 && partes[0] === 'transcricoes' && partes[1] === 'solicitar') {
    void responderSolicitacaoDeTranscricao(req, res, ctx);
    return;
  }
  if (req.method === 'POST' && partes.length === 2 && partes[0] === 'envios' && partes[1] === 'solicitar') {
    void responderSolicitacaoDeEnvio(req, res, ctx);
    return;
  }

  if (req.method !== 'GET') {
    // A Chave de Acesso e SOMENTE-LEITURA no v1 (decidido em 24/08/2026,
    // 01-discussoes/20260824-recorte-v1.md), com a UNICA excecao nomeada
    // acima — tratada antes desta guarda, nunca por ela.
    naoEncontrado(res);
    return;
  }

  // Leitura do Envio (#1117). A contagem vem ANTES da rota de um Envio: senao a palavra
  // `contagem` seria lida como identificador. Nenhuma das duas grava Operacao.
  if (partes.length === 2 && partes[0] === 'envios' && partes[1] === 'contagem') {
    json(res, 200, Object.fromEntries(contarEnviosPorEstado(ctx.acervo).map((c) => [c.estado, c.n])));
    return;
  }
  if (partes.length === 2 && partes[0] === 'envios') {
    const envio = lerEnvio(ctx.acervo, partes[1] as string);
    if (envio === undefined) {
      naoEncontrado(res);
      return;
    }
    const registro = abrirRegistro(ctx.dados);
    let apelido: string | null;
    try {
      apelido =
        listarConfiguracoes(registro, ctx.identidade.inquilinoId).find((c) => c.id === envio.configuracaoId)
          ?.apelido ?? null;
    } finally {
      registro.fechar();
    }
    // Sem texto nem caminho de arquivo: o estado basta para decidir repetir, e conteudo
    // exposto por rota nova e superficie nova.
    json(res, 200, {
      envioId: envio.envioId,
      identificadorDeEnvio: envio.identificadorDeEnvio,
      configuracao: apelido,
      estado: envio.estado,
      tentativas: envio.tentativas,
      motivoFalha: envio.motivoFalha,
      tipo: envio.tipo,
      solicitadaEm: envio.solicitadaEm,
      concluidaEm: envio.concluidaEm,
    });
    return;
  }

  // Identificar por valor (#1126): parte do Identificador, com ou sem Pessoa. Valor desconhecido
  // e lista vazia — e busca, nao endereco. So le.
  if (partes.length === 1 && partes[0] === 'identificadores') {
    const valor = url.searchParams.get('valor');
    if (valor === null || valor === '') {
      json(res, 400, { erro: 'informe o parametro valor' });
      return;
    }
    const fonteParam = url.searchParams.get('fonte');
    if (fonteParam !== null && !ehFonte(fonteParam)) {
      json(res, 400, { erro: `fonte desconhecida: ${fonteParam}` });
      return;
    }
    const registro = abrirRegistro(ctx.dados);
    let precedencia: PrecedenciaDeNome;
    try {
      precedencia = lerPrecedenciasDeNome(registro, ctx.identidade.inquilinoId);
    } finally {
      registro.fechar();
    }
    json(
      res,
      200,
      identificarPorValor(ctx.acervo, { valor, ...(fonteParam !== null ? { fonte: fonteParam } : {}) }, precedencia),
    );
    return;
  }

  if (partes.length === 1 && partes[0] === 'conversas') {
    // Parametros OPCIONAIS: quem nao os envia recebe a resposta de sempre —
    // o contrato publicado no guia do cliente nao muda de significado.
    const q = url.searchParams;
    const fonte = q.get('fonte') ?? undefined;
    const coletiva = q.get('coletiva') ?? undefined;
    const busca = q.get('busca') ?? undefined;
    const pessoa = q.get('pessoa') ?? undefined;
    const limite = q.get('limite') ?? undefined;
    if (limiteInvalido(limite)) {
      json(res, 400, ERRO_DE_LIMITE);
      return;
    }
    const configuracaoApelido = q.get('configuracao');
    const fixada = q.get('fixada') ?? undefined;
    const desdeParam = q.get('desde');

    if (fixada === 'true' && configuracaoApelido === null) {
      json(res, 400, { erro: 'fixada exige configuracao' });
      return;
    }

    let filtroDesde: number | undefined;
    if (desdeParam !== null) {
      try {
        filtroDesde = expandirData(desdeParam, 'inicio');
      } catch (e) {
        json(res, 400, { erro: (e as Error).message });
        return;
      }
    }

    const registro = abrirRegistro(ctx.dados);
    let configuracaoId: string | undefined;
    let apelidoPorId: Map<string, string>;
    let precedencia: PrecedenciaDeNome;
    try {
      if (configuracaoApelido !== null) {
        const resolucao = resolverFiltroDeConfiguracao(
          registro,
          ctx.identidade.inquilinoId,
          configuracaoApelido,
          fonte,
        );
        if (!resolucao.ok) {
          json(res, 400, { erro: resolucao.erro });
          return;
        }
        configuracaoId = resolucao.configuracao.id;
      }
      apelidoPorId = new Map(
        listarConfiguracoes(registro, ctx.identidade.inquilinoId).map((c) => [c.id, c.apelido]),
      );
      precedencia = lerPrecedenciasDeNome(registro, ctx.identidade.inquilinoId);
    } finally {
      registro.fechar();
    }

    // Quando fixada esta ativo, `configuracao` escopa a MARCA
    // (marcas_de_conversa.configuracao_id), NAO a atribuicao
    // (conversas.configuracao_id) — compor os dois em AND mataria coletiva
    // fixada, porque a atribuicao e NULL nela e a Marca nao depende dela. O
    // filtro de marca acontece DEPOIS, em JS, contra o conjunto que
    // conversasMarcadas devolve — nunca como condicao SQL a mais.
    const marcadas = fixada === 'true'
      ? new Set(conversasMarcadas(ctx.acervo, { marca: 'fixada', configuracaoId: configuracaoId! }))
      : undefined;

    let conversas = listarConversas(ctx.acervo, {
      precedencia,
      ...(fonte !== undefined ? { fonte: fonte as Fonte } : {}),
      ...(coletiva !== undefined ? { coletiva: coletiva === 'true' } : {}),
      ...(busca !== undefined ? { busca } : {}),
      ...(pessoa !== undefined ? { pessoaId: pessoa } : {}),
      // limite so vai pro SQL quando NAO ha marca a filtrar depois — senao o
      // corte aconteceria ANTES do filtro de marca, podendo devolver menos
      // que o pedido mesmo havendo marcadas suficientes.
      ...(marcadas === undefined && limite !== undefined ? { limite: Number(limite) } : {}),
      ...(marcadas === undefined && configuracaoId !== undefined ? { configuracaoId } : {}),
      ...(filtroDesde !== undefined ? { desde: filtroDesde } : {}),
    }).map((c) => ({
      id: c.id,
      fonte: c.fonte,
      coletiva: c.coletiva,
      assunto: c.assunto,
      mensagens: c.mensagens,
      configuracao: c.configuracaoId === null ? null : (apelidoPorId.get(c.configuracaoId) ?? null),
      nome: c.nome,
      origemDoNome: c.origemDoNome,
    }));

    if (marcadas !== undefined) {
      conversas = conversas.filter((c) => marcadas.has(c.id));
      if (limite !== undefined) conversas = conversas.slice(0, Number(limite));
    }

    json(res, 200, { conversas });
    return;
  }

  if (partes.length === 1 && partes[0] === 'mensagens') {
    const q = url.searchParams;
    const limite = q.get('limite');
    if (limiteInvalido(limite)) {
      json(res, 400, ERRO_DE_LIMITE);
      return;
    }
    const desde = q.get('desde');
    const ate = q.get('ate');
    const autor = q.get('autor');
    const fonte = q.get('fonte');
    const direcao = q.get('direcao');
    const antes = q.get('antes');

    if (direcao !== null && direcao !== 'enviada' && direcao !== 'recebida') {
      json(res, 400, { erro: 'direcao invalida — use "enviada" ou "recebida"' });
      return;
    }
    if (fonte !== null && !ehFonte(fonte)) {
      json(res, 400, { erro: `fonte invalida: ${fonte}` });
      return;
    }
    const remetente = q.get('remetente');
    if (remetente === '') {
      json(res, 400, { erro: 'remetente vazio — informe o valor do Identificador' });
      return;
    }
    const autorIds =
      remetente === null
        ? undefined
        : identificadoresDoRemetente(ctx.acervo, { valor: remetente, ...(fonte !== null ? { fonte } : {}) });

    let cursor: { ocorridaEm: number; id: string } | undefined;
    if (antes !== null) {
      cursor = decodificarCursor(antes);
      if (cursor === undefined) {
        json(res, 400, { erro: 'cursor invalido — devolva o token `proximo` tal como recebeu' });
        return;
      }
    }
    let filtroDe: number | undefined;
    let filtroAte: number | undefined;
    try {
      if (desde !== null) filtroDe = expandirData(desde, 'inicio');
      if (ate !== null) filtroAte = expandirData(ate, 'fim');
    } catch (e) {
      json(res, 400, { erro: (e as Error).message });
      return;
    }

    // Default de ORDEM diverge da rota por Conversa DE PROPOSITO: esta rota
    // existe para "ultimas mensagens", entao recencia e o default — a rota
    // por Conversa continua cronologica por default, sem regressao.
    const ordem = q.get('ordem') === 'cronologica' ? ('cronologica' as const) : ('recentes' as const);

    const mensagens = lerMensagens(ctx.acervo, {
      ...(filtroDe !== undefined ? { de: filtroDe } : {}),
      ...(filtroAte !== undefined ? { ate: filtroAte } : {}),
      ...(autor !== null ? { pessoaId: autor } : {}),
      ...(fonte !== null ? { fonte } : {}), // já estreitado para Fonte pela guarda ehFonte acima
      ...(autorIds !== undefined ? { autorIds } : {}),
      ...(direcao !== null ? { direcao: direcao as 'enviada' | 'recebida' } : {}),
      ...(limite !== null ? { limite: Number(limite) } : {}),
      ordem,
      ...(cursor !== undefined ? { cursor } : {}),
    });

    // Sem a ambiguidade da rota por Conversa: aqui vazio e resultado
    // legitimo (Inquilino sem Mensagem que bata o filtro), nunca 404 — nao
    // ha existencia de recurso singular para confirmar ou negar.
    const temMais = limite !== null && mensagens.length >= Number(limite);
    json(res, 200, {
      mensagens,
      ...(temMais
        ? {
            proximo: codificarCursor({
              ocorridaEm: mensagens[mensagens.length - 1]!.ocorridaEm,
              id: mensagens[mensagens.length - 1]!.id,
            }),
          }
        : {}),
    });
    return;
  }

  if (partes.length === 3 && partes[0] === 'conversas' && partes[2] === 'anexos') {
    const conversaId = partes[1] as ConversaId;
    const q = url.searchParams;
    // Uma so ordem (cronologica): nao ha default que mude com o cursor, e pedir outra e erro de uso.
    if (q.has('ordem')) {
      json(res, 400, { erro: 'esta rota tem uma so ordem (cronologica); `ordem` nao existe aqui' });
      return;
    }
    let limite: number | undefined;
    const limiteTexto = q.get('limite');
    if (limiteTexto !== null) {
      limite = Number(limiteTexto);
      if (!Number.isInteger(limite) || limite < 1) {
        json(res, 400, { erro: 'limite precisa ser um inteiro maior que zero' });
        return;
      }
    }
    const presenca = q.get('presenca');
    if (presenca !== null && !(PRESENCAS as readonly string[]).includes(presenca)) {
      json(res, 400, { erro: 'presenca invalida — use presente, nunca-obtido ou descartado' });
      return;
    }
    const tipo = q.get('tipo');
    if (tipo === '') {
      json(res, 400, { erro: 'tipo vazio — informe o tipo do Anexo' });
      return;
    }
    const remetente = q.get('remetente');
    if (remetente === '') {
      json(res, 400, { erro: 'remetente vazio — informe o valor do Identificador' });
      return;
    }
    let cursor: { ocorridaEm: number; id: string } | undefined;
    const antes = q.get('antes');
    if (antes !== null) {
      cursor = decodificarCursor(antes);
      if (cursor === undefined) {
        json(res, 400, { erro: 'cursor invalido — devolva o token `proximo` tal como recebeu' });
        return;
      }
    }
    let filtroDe: number | undefined;
    let filtroAte: number | undefined;
    try {
      const desde = q.get('desde');
      const ate = q.get('ate');
      if (desde !== null) filtroDe = expandirData(desde, 'inicio');
      if (ate !== null) filtroAte = expandirData(ate, 'fim');
    } catch (e) {
      json(res, 400, { erro: (e as Error).message });
      return;
    }

    // A Conversa existir e a UNICA coisa que decide 404 — a regra da #1090: lista vazia por filtro
    // que nao casa e resposta legitima (200). Os 400 acima vem ANTES e nao revelam existencia.
    const fonteDaConversaAtual = fonteDaConversa(ctx.acervo, conversaId);
    if (fonteDaConversaAtual === undefined) {
      naoEncontrado(res);
      return;
    }
    // A Fonte da Conversa restringe o remetente: o mesmo valor em OUTRA Fonte nao entra. Mutante que
    // sobrevive por EQUIVALENCIA — a fixture so tem Fonte whatsapp, entao tirar `fonte` daqui nao muda
    // nenhuma resposta; a restricao em si e coberta no nucleo (`remetente.test.ts`, caso da Fonte).
    const autorIds =
      remetente === null
        ? undefined
        : identificadoresDoRemetente(ctx.acervo, { valor: remetente, fonte: fonteDaConversaAtual });

    const anexos = listarAnexosDaConversa(ctx.acervo, {
      conversaId,
      ...(tipo !== null ? { tipo } : {}),
      ...(autorIds !== undefined ? { autorIds } : {}),
      ...(filtroDe !== undefined ? { de: filtroDe } : {}),
      ...(filtroAte !== undefined ? { ate: filtroAte } : {}),
      ...(presenca !== null ? { presenca: presenca as (typeof PRESENCAS)[number] } : {}),
      ...(limite !== undefined ? { limite } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    });
    const proximo = cursorDaProximaPagina(anexos, limite);
    json(res, 200, { anexos, ...(proximo !== undefined ? { proximo } : {}) });
    return;
  }

  if (partes.length === 3 && partes[0] === 'conversas' && partes[2] === 'mensagens') {
    const conversaId = partes[1] as ConversaId;
    const q = url.searchParams;
    const limite = q.get('limite');
    if (limiteInvalido(limite)) {
      json(res, 400, ERRO_DE_LIMITE);
      return;
    }
    const desde = q.get('desde');
    const ate = q.get('ate');
    const autor = q.get('autor');
    const antes = q.get('antes');
    const favorito = q.get('favorito');
    const configuracaoApelido = q.get('configuracao');
    const direcao = q.get('direcao');
    if (direcao !== null && direcao !== 'enviada' && direcao !== 'recebida') {
      json(res, 400, { erro: 'direcao invalida — use "enviada" ou "recebida"' });
      return;
    }
    const remetente = q.get('remetente');
    if (remetente === '') {
      json(res, 400, { erro: 'remetente vazio — informe o valor do Identificador' });
      return;
    }
    let cursor: { ocorridaEm: number; id: string } | undefined;
    if (antes !== null) {
      cursor = decodificarCursor(antes);
      // Cursor invalido e erro de USO: tratar como primeira pagina seria uma
      // leitura silenciosamente errada (revisao do ciclo 21).
      if (cursor === undefined) {
        json(res, 400, { erro: 'cursor invalido — devolva o token `proximo` tal como recebeu' });
        return;
      }
    }
    let filtroDe: number | undefined;
    let filtroAte: number | undefined;
    try {
      if (desde !== null) filtroDe = expandirData(desde, 'inicio');
      if (ate !== null) filtroAte = expandirData(ate, 'fim');
    } catch (e) {
      json(res, 400, { erro: (e as Error).message });
      return;
    }

    // A Conversa existir e a UNICA coisa que decide 404 nesta rota — checado
    // UMA VEZ, antes de qualquer filtro, e nunca mais depois. Lista vazia por
    // filtro que nao bate em nada, ou por a Conversa nunca ter tido Mensagem,
    // e resposta LEGITIMA (200): confundir isso com "nao existe" e o que a
    // #1090 corrige. Fonte IMPLICITA da propria Conversa — esta rota nunca e
    // ambigua, porque Conversa tem uma Fonte so.
    const fonteDaConversaAtual = fonteDaConversa(ctx.acervo, conversaId);
    if (fonteDaConversaAtual === undefined) {
      naoEncontrado(res);
      return;
    }
    const autorIds =
      remetente === null
        ? undefined
        : identificadoresDoRemetente(ctx.acervo, { valor: remetente, fonte: fonteDaConversaAtual });

    let configuracaoId: string | undefined;
    if (favorito === 'true') {
      if (configuracaoApelido === null) {
        json(res, 400, { erro: 'favorito exige configuracao' });
        return;
      }
      const registro = abrirRegistro(ctx.dados);
      let resolucao;
      try {
        resolucao = resolverFiltroDeConfiguracao(
          registro, ctx.identidade.inquilinoId, configuracaoApelido, fonteDaConversaAtual,
        );
      } finally {
        registro.fechar();
      }
      if (!resolucao.ok) {
        json(res, 400, { erro: resolucao.erro });
        return;
      }
      configuracaoId = resolucao.configuracao.id;
    }

    // Ordem: valor EXPLICITO no query sempre vence, com ou sem cursor — o bug
    // era o ramo sem cursor so reconhecer 'cronologica' explicito e tratar
    // 'recentes' explicito como ausente. Sem `ordem` nenhum no query, o
    // default e assimetrico por DESENHO (nao regressao a corrigir): sem
    // cursor, cronologica (primeira pagina desta rota sempre foi assim); com
    // cursor, recentes (continuacao de paginacao ja assumia isso).
    const ordemParam = q.get('ordem');
    const ordemExplicita =
      ordemParam === 'cronologica' ? ('cronologica' as const)
        : ordemParam === 'recentes' ? ('recentes' as const)
          : undefined;
    const ordem = ordemExplicita ?? (cursor !== undefined ? 'recentes' : 'cronologica');

    const mensagens = lerMensagens(ctx.acervo, {
      conversaId,
      ...(filtroDe !== undefined ? { de: filtroDe } : {}),
      ...(filtroAte !== undefined ? { ate: filtroAte } : {}),
      ...(autor !== null ? { pessoaId: autor } : {}),
      ...(autorIds !== undefined ? { autorIds } : {}),
      ...(direcao !== null ? { direcao: direcao as 'enviada' | 'recebida' } : {}),
      ...(limite !== null ? { limite: Number(limite) } : {}),
      ...(favorito === 'true' ? { favorito: true, configuracaoId: configuracaoId! } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
      ordem,
    });

    // A Conversa ja provou que existe, acima — lista vazia aqui e sempre
    // resposta legitima (200), qualquer que seja o motivo (filtro, ou a
    // Conversa nunca ter tido Mensagem).
    // O cursor `proximo` so existe quando ha mais paginas: o consumidor nunca
    // monta cursor, devolve o que recebeu.
    const temMais = limite !== null && mensagens.length >= Number(limite);
    json(res, 200, {
      mensagens,
      ...(temMais
        ? {
            proximo: codificarCursor({
              ocorridaEm: mensagens[mensagens.length - 1]!.ocorridaEm,
              id: mensagens[mensagens.length - 1]!.id,
            }),
          }
        : {}),
    });
    return;
  }

  if (partes.length === 1 && partes[0] === 'buscar') {
    const texto = url.searchParams.get('texto');
    if (texto === null || texto === '') {
      // 400, e nao 404: invocacao errada nao e "nao existe". Quem apresentou
      // Chave valida merece saber que errou a chamada.
      json(res, 400, { erro: 'informe o parametro texto' });
      return;
    }
    const q = url.searchParams;
    const limite = q.get('limite');
    if (limiteInvalido(limite)) {
      json(res, 400, ERRO_DE_LIMITE);
      return;
    }
    const desde = q.get('desde');
    const ate = q.get('ate');
    const autor = q.get('autor');
    const conversa = q.get('conversa');
    let filtroDe: number | undefined;
    let filtroAte: number | undefined;
    try {
      if (desde !== null) filtroDe = expandirData(desde, 'inicio');
      if (ate !== null) filtroAte = expandirData(ate, 'fim');
    } catch (e) {
      json(res, 400, { erro: (e as Error).message });
      return;
    }
    json(res, 200, { mensagens: buscarMensagens(ctx.acervo, {
      texto,
      ...(autor !== null ? { pessoaId: autor } : {}),
      ...(conversa !== null ? { conversaId: conversa } : {}),
      ...(filtroDe !== undefined ? { de: filtroDe } : {}),
      ...(filtroAte !== undefined ? { ate: filtroAte } : {}),
      ...(limite !== null ? { limite: Number(limite) } : {}),
    }) });
    return;
  }

  if (partes.length === 1 && partes[0] === 'chaves') {
    // As Chaves vivem no REGISTRO, e nao no Acervo. Reabrir aqui custa 0,46 ms
    // — medido em 03/09/2026 —, e evita segurar a base aberta durante a
    // consulta ao Acervo.
    //
    // O Inquilino e o da credencial, entao o Titular ve as Chaves DELE,
    // inclusive as que nao pediu, e nunca as de outro.
    const registro = abrirRegistro(ctx.dados);
    try {
      json(res, 200, { chaves: listarChavesDeAcesso(registro, ctx.identidade.inquilinoId) });
    } finally {
      registro.fechar();
    }
    return;
  }

  if (partes.length === 1 && partes[0] === 'pessoas') {
    const texto = url.searchParams.get('texto');
    if (texto === null || texto === '') {
      json(res, 400, { erro: 'informe o parametro texto' });
      return;
    }
    // Envoltorio nomeado, forma das outras rotas; Pessoa inexistente e lista
    // vazia — e busca, nao endereco.
    json(res, 200, { pessoas: procurarPessoas(ctx.acervo, { texto }) });
    return;
  }

  if (partes.length === 3 && partes[0] === 'conversas' && partes[2] === 'autores') {
    const conversaId = partes[1] as ConversaId;
    if (fonteDaConversa(ctx.acervo, conversaId) === undefined) {
      naoEncontrado(res);
      return;
    }
    const registro = abrirRegistro(ctx.dados);
    let precedencia: PrecedenciaDeNome;
    try {
      precedencia = lerPrecedenciasDeNome(registro, ctx.identidade.inquilinoId);
    } finally {
      registro.fechar();
    }
    json(res, 200, { autores: autoresDaConversa(ctx.acervo, conversaId, precedencia) });
    return;
  }

  if (partes.length === 3 && partes[0] === 'conversas' && partes[2] === 'participantes') {
    const conversaId = partes[1] as ConversaId;
    const emParam = url.searchParams.get('em');
    let em = Date.now();
    if (emParam !== null) {
      try {
        em = expandirData(emParam, 'fim');
      } catch (e) {
        json(res, 400, { erro: (e as Error).message });
        return;
      }
    }
    // A pergunta de Presenca que o modelo ja responde; o --em e o fim do dia
    // capado ao Alcance, regra medida (CONTEXTO.md).
    const registro = abrirRegistro(ctx.dados);
    let precedencia: PrecedenciaDeNome;
    try {
      precedencia = lerPrecedenciasDeNome(registro, ctx.identidade.inquilinoId);
    } finally {
      registro.fechar();
    }
    json(res, 200, {
      presenca: enriquecerPresenca(ctx.acervo, quemEstavaEm(ctx.acervo, { conversaId, em }), precedencia),
    });
    return;
  }

  if (partes.length === 1 && partes[0] === 'relatorio') {
    json(res, 200, { relatorio: contarPorFonte(ctx.acervo) });
    return;
  }

  if (partes.length === 1 && partes[0] === 'configuracoes') {
    const registro = abrirRegistro(ctx.dados);
    try {
      const configuracoes = listarConfiguracoes(registro, ctx.identidade.inquilinoId).map((c) => ({
        apelido: c.apelido,
        fonte: c.fonte,
      }));
      json(res, 200, { configuracoes });
    } finally {
      registro.fechar();
    }
    return;
  }

  if (partes.length === 2 && partes[0] === 'midia') {
    const anexoId = partes[1] as string;
    const anexo = lerAnexoPorId(ctx.acervo, anexoId);
    if (anexo === undefined || anexo.presenca !== 'presente' || anexo.caminho === null) {
      naoEncontrado(res);
      return;
    }
    if (anexo.tipo === 'video') {
      // Sinal DEDICADO, nao o 404 generico dos demais casos — aqui a posse
      // ja foi confirmada (o Anexo existe e e deste Inquilino), entao nomear
      // o tipo nao vaza nada que a posse ja nao tivesse revelado.
      json(res, 415, { erro: `tipo de Anexo nao suportado nesta rota: ${anexo.tipo}` });
      return;
    }

    const registro = abrirRegistro(ctx.dados);
    let destino;
    try {
      destino = lerDestinoDeMidia(registro, ctx.identidade.inquilinoId);
    } finally {
      registro.fechar();
    }
    if (destino === undefined) {
      naoEncontrado(res);
      return;
    }

    let bytes: Buffer;
    try {
      bytes = readFileSync(join(destino.endereco, anexo.caminho));
    } catch {
      // Presenca diz 'presente' e o arquivo nao esta la — disco perdeu o
      // dado sem o banco saber. Mesma classe "sem bytes disponiveis" dos
      // demais 404, nao um caso novo.
      naoEncontrado(res);
      return;
    }

    res.writeHead(200, {
      'content-type': CONTENT_TYPE_POR_TIPO[anexo.tipo] ?? 'application/octet-stream',
    });
    res.end(bytes);
    return;
  }

  naoEncontrado(res);
}
