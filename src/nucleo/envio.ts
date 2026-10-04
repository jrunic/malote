import { randomUUID } from 'node:crypto';
import type { Acervo } from './acervo.js';
import type { ConversaId, Fonte } from './tipos.js';
import { resolverEndereco } from './correspondencia.js';
import { emOperacao } from './trilha.js';

export type DestinoDeEnvio = { conversaId: ConversaId } | { enderecoCru: string };

export interface ConteudoDeEnvioTexto {
  tipo: 'texto';
  texto: string;
}

export interface ConteudoDeEnvioImagem {
  tipo: 'imagem';
  /** Caminho de STAGING — nunca o caminho original do usuario. */
  caminhoArquivo: string;
  mimetype: string;
  legenda?: string;
}

export interface ConteudoDeEnvioDocumento {
  tipo: 'documento';
  caminhoArquivo: string;
  mimetype: string;
  nomeDeArquivo: string;
  legenda?: string;
}

export type ConteudoDeEnvio =
  ConteudoDeEnvioTexto | ConteudoDeEnvioImagem | ConteudoDeEnvioDocumento;

export interface EntradaDeEnvio {
  configuracaoId: string;
  destino: DestinoDeEnvio;
  conteudo: ConteudoDeEnvio;
  /**
   * Identificador de Envio FORNECIDO pelo solicitante. Pedir de novo o mesmo identificador
   * para o mesmo pedido devolve o Envio existente. Exige `fonte`, que o exame usa para
   * comparar o endereco do destinatario.
   */
  identificadorDeEnvio?: string;
  fonte?: Fonte;
}

export interface ResultadoDeRegistro {
  envioId: string;
  identificadorDeEnvio: string;
  /** Verdadeiro quando o identificador fornecido ja existia para o mesmo pedido. */
  repetido: boolean;
}

/** O mesmo identificador foi usado antes para outro pedido: Configuracao, destino ou conteudo diferentes. */
export class EnvioDivergenteError extends Error {
  constructor(readonly identificadorDeEnvio: string) {
    super(`o Identificador de Envio ${identificadorDeEnvio} ja foi usado para outro pedido`);
    this.name = 'EnvioDivergenteError';
  }
}

export type ExameDeRepeticao =
  { resultado: 'nova' } | { resultado: 'repetido'; envioId: string } | { resultado: 'divergente' };

interface LinhaDeEnvio {
  id: string;
  identificador_de_envio: string;
  configuracao_id: string;
  conversa_id: string | null;
  destino_cru: string | null;
  conteudo_tipo: string;
  conteudo_texto: string | null;
  conteudo_mimetype: string | null;
  conteudo_nome_arquivo: string | null;
  estado: string;
  motivo_falha: string | null;
  tentativas: number;
  solicitada_em: string;
  concluida_em: string | null;
}

const COLUNAS_DE_ENVIO = `id, identificador_de_envio, configuracao_id, conversa_id, destino_cru,
  conteudo_tipo, conteudo_texto, conteudo_mimetype, conteudo_nome_arquivo, estado, motivo_falha,
  tentativas, solicitada_em, concluida_em`;

/** O endereco do destino de um Envio ja gravado: o cru, ou o da Conversa em que ele virou. */
function enderecoGravado(acervo: Acervo, linha: LinhaDeEnvio): string | undefined {
  if (linha.destino_cru !== null) return linha.destino_cru;
  const c = acervo
    .preparar('SELECT id_externo FROM conversas WHERE id = ?')
    .get(linha.conversa_id) as { id_externo: string } | undefined;
  return c?.id_externo;
}

function enderecoDoPedido(acervo: Acervo, destino: DestinoDeEnvio): string | undefined {
  if ('enderecoCru' in destino) return destino.enderecoCru;
  const c = acervo
    .preparar('SELECT id_externo FROM conversas WHERE id = ?')
    .get(destino.conversaId) as { id_externo: string } | undefined;
  return c?.id_externo;
}

function exigirFonte(entrada: EntradaDeEnvio): Fonte {
  if (entrada.identificadorDeEnvio !== undefined && entrada.fonte === undefined) {
    throw new Error(
      'identificador de envio fornecido exige a fonte (fonte) para comparar o endereco',
    );
  }
  return entrada.fonte as Fonte;
}

function igualAoPedido(acervo: Acervo, linha: LinhaDeEnvio, entrada: EntradaDeEnvio): boolean {
  const fonte = exigirFonte(entrada);
  if (linha.configuracao_id !== entrada.configuracaoId) return false;
  const gravado = enderecoGravado(acervo, linha);
  const pedido = enderecoDoPedido(acervo, entrada.destino);
  if (gravado === undefined || pedido === undefined) return false;
  // As duas pontas pela MESMA resolucao: o gravado pode ser a forma canonica e o do pedido, a alternativa.
  if (resolverEndereco(acervo, fonte, gravado) !== resolverEndereco(acervo, fonte, pedido))
    return false;
  const c = entrada.conteudo;
  const texto = c.tipo === 'texto' ? c.texto : (c.legenda ?? null);
  const mimetype = c.tipo === 'texto' ? null : c.mimetype;
  const nome = c.tipo === 'documento' ? c.nomeDeArquivo : null;
  return (
    linha.conteudo_tipo === c.tipo &&
    linha.conteudo_texto === texto &&
    linha.conteudo_mimetype === mimetype &&
    linha.conteudo_nome_arquivo === nome
  );
}

/**
 * Examina, SEM escrever, o que o identificador fornecido significa neste Acervo. A rota usa
 * isto ANTES de mandar bytes a disco; o arbitro final continua sendo a unicidade da coluna.
 */
export function examinarRepeticao(
  acervo: Acervo,
  entrada: EntradaDeEnvio & { identificadorDeEnvio: string },
): ExameDeRepeticao {
  const linha = acervo
    .preparar(`SELECT ${COLUNAS_DE_ENVIO} FROM envios WHERE identificador_de_envio = ?`)
    .get(entrada.identificadorDeEnvio) as LinhaDeEnvio | undefined;
  if (linha === undefined) return { resultado: 'nova' };
  return igualAoPedido(acervo, linha, entrada)
    ? { resultado: 'repetido', envioId: linha.id }
    : { resultado: 'divergente' };
}

export interface EnvioLido {
  envioId: string;
  identificadorDeEnvio: string;
  configuracaoId: string;
  estado: 'pendente' | 'enviado' | 'falhou';
  tentativas: number;
  motivoFalha: string | null;
  tipo: 'texto' | 'imagem' | 'documento';
  solicitadaEm: string;
  concluidaEm: string | null;
}

/** Um Envio por id OU por Identificador de Envio (os dois sao UUID). Nunca devolve texto nem caminho. */
export function lerEnvio(acervo: Acervo, idOuIdentificador: string): EnvioLido | undefined {
  const l = acervo
    .preparar(`SELECT ${COLUNAS_DE_ENVIO} FROM envios WHERE id = ? OR identificador_de_envio = ?`)
    .get(idOuIdentificador, idOuIdentificador) as LinhaDeEnvio | undefined;
  if (l === undefined) return undefined;
  return {
    envioId: l.id,
    identificadorDeEnvio: l.identificador_de_envio,
    configuracaoId: l.configuracao_id,
    estado: l.estado as EnvioLido['estado'],
    tentativas: l.tentativas,
    motivoFalha: l.motivo_falha,
    tipo: l.conteudo_tipo as EnvioLido['tipo'],
    solicitadaEm: l.solicitada_em,
    concluidaEm: l.concluida_em,
  };
}

/**
 * Pelo CODIGO do erro, nunca pela mensagem. A tabela `envios` tem um unico UNIQUE alem da chave
 * primaria (que tem codigo proprio, `SQLITE_CONSTRAINT_PRIMARYKEY`): `SQLITE_CONSTRAINT_UNIQUE`
 * aqui so pode ser o Identificador de Envio.
 */
function ehViolacaoDoIdentificador(e: unknown): boolean {
  return (e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE';
}

/**
 * Registra um pedido de Envio. O Identificador de Envio e gerado AQUI, antes de qualquer
 * tentativa de enviar — ou fornecido pelo solicitante, e entao pedir de novo o mesmo
 * identificador para o mesmo pedido devolve o existente. E o que sustenta a garantia ao menos
 * uma vez (ver docs/dominio/malote.md, agregado Envio).
 *
 * Comando de decisao: grava uma Operacao, com o Envio como Linha de Efeito. A repeticao nao
 * grava nenhuma: a violacao de unicidade sai de dentro da Operacao, que e desfeita junto.
 */
export function registrarEnvio(acervo: Acervo, entrada: EntradaDeEnvio): ResultadoDeRegistro {
  exigirFonte(entrada);
  const envioId = randomUUID();
  const identificadorDeEnvio = entrada.identificadorDeEnvio ?? randomUUID();
  const conversaId = 'conversaId' in entrada.destino ? entrada.destino.conversaId : null;
  const destinoCru = 'enderecoCru' in entrada.destino ? entrada.destino.enderecoCru : null;
  const c = entrada.conteudo;
  // Legenda de midia mora em conteudo_texto, a mesma coluna do texto puro.
  const conteudoTexto = c.tipo === 'texto' ? c.texto : (c.legenda ?? null);
  const caminhoArquivo = c.tipo === 'texto' ? null : c.caminhoArquivo;
  const mimetype = c.tipo === 'texto' ? null : c.mimetype;
  const nomeDeArquivo = c.tipo === 'documento' ? c.nomeDeArquivo : null;

  try {
    emOperacao(acervo, { natureza: 'solicitar-envio', reversibilidade: 'por-efeito' }, (op) => {
      acervo
        .preparar(
          `INSERT INTO envios
           (id, identificador_de_envio, configuracao_id, conversa_id, destino_cru,
            conteudo_tipo, conteudo_texto, conteudo_caminho_arquivo, conteudo_mimetype,
            conteudo_nome_arquivo, estado, solicitada_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?)`,
        )
        .run(
          envioId,
          identificadorDeEnvio,
          entrada.configuracaoId,
          conversaId,
          destinoCru,
          c.tipo,
          conteudoTexto,
          caminhoArquivo,
          mimetype,
          nomeDeArquivo,
          new Date().toISOString(),
        );
      op.valor({
        tabela: 'envios',
        chave: envioId,
        campo: 'estado',
        antes: null,
        depois: 'pendente',
      });
    });
  } catch (e) {
    // Quem arbitra a repeticao e a unicidade da coluna: aqui se RELE o existente.
    if (entrada.identificadorDeEnvio !== undefined && ehViolacaoDoIdentificador(e)) {
      const exame = examinarRepeticao(
        acervo,
        entrada as EntradaDeEnvio & { identificadorDeEnvio: string },
      );
      if (exame.resultado === 'repetido') {
        return { envioId: exame.envioId, identificadorDeEnvio, repetido: true };
      }
      throw new EnvioDivergenteError(identificadorDeEnvio);
    }
    throw e;
  }

  return { envioId, identificadorDeEnvio, repetido: false };
}

export interface EnvioElegivel {
  envioId: string;
  identificadorDeEnvio: string;
  conversaId: string | null;
  destinoCru: string | null;
  conteudo: ConteudoDeEnvio;
}

/**
 * O proximo Envio pendente DAQUELA Configuracao — nunca atravessa
 * Configuracao, porque `processarEnvios` roda dentro de um `ouvir` que so
 * tem o socket de UMA conta. Ordena por `tentativas` primeiro: um Envio que
 * ja tentou e nao conseguiu cede a vez aos que nunca tentaram, para a fila
 * nao travar atras do mesmo problema. Desempate por `solicitada_em` e, por
 * ultimo, `rowid` — duas solicitacoes no mesmo milissegundo precisam de
 * ordem estavel (mesmo motivo do `solicitada_em` em `transcricao.ts`).
 */
export function proximoEnvioPendente(
  acervo: Acervo,
  configuracaoId: string,
): EnvioElegivel | undefined {
  const linha = acervo
    .preparar(
      `SELECT id, identificador_de_envio, conversa_id, destino_cru, conteudo_tipo,
              conteudo_texto, conteudo_caminho_arquivo, conteudo_mimetype, conteudo_nome_arquivo
         FROM envios
        WHERE configuracao_id = ? AND estado = 'pendente'
        ORDER BY tentativas ASC, solicitada_em ASC, rowid ASC
        LIMIT 1`,
    )
    .get(configuracaoId) as
    | {
        id: string;
        identificador_de_envio: string;
        conversa_id: string | null;
        destino_cru: string | null;
        conteudo_tipo: 'texto' | 'imagem' | 'documento';
        conteudo_texto: string | null;
        conteudo_caminho_arquivo: string | null;
        conteudo_mimetype: string | null;
        conteudo_nome_arquivo: string | null;
      }
    | undefined;
  if (linha === undefined) return undefined;

  const legenda = linha.conteudo_texto !== null ? { legenda: linha.conteudo_texto } : {};
  let conteudo: ConteudoDeEnvio;
  if (linha.conteudo_tipo === 'texto') {
    conteudo = { tipo: 'texto', texto: linha.conteudo_texto as string };
  } else if (linha.conteudo_tipo === 'imagem') {
    conteudo = {
      tipo: 'imagem',
      caminhoArquivo: linha.conteudo_caminho_arquivo as string,
      mimetype: linha.conteudo_mimetype as string,
      ...legenda,
    };
  } else {
    conteudo = {
      tipo: 'documento',
      caminhoArquivo: linha.conteudo_caminho_arquivo as string,
      mimetype: linha.conteudo_mimetype as string,
      nomeDeArquivo: linha.conteudo_nome_arquivo as string,
      ...legenda,
    };
  }
  return {
    envioId: linha.id,
    identificadorDeEnvio: linha.identificador_de_envio,
    conversaId: linha.conversa_id,
    destinoCru: linha.destino_cru,
    conteudo,
  };
}

/**
 * Marca "enviado" — chamado quando `sendMessage` devolve `key.id`. NAO espera
 * o eco de `messages.upsert`: o retorno ja confirma relay aceito.
 */
export function marcarEnvioEnviado(acervo: Acervo, envioId: string): void {
  acervo
    .preparar(`UPDATE envios SET estado = 'enviado', concluida_em = ? WHERE id = ?`)
    .run(new Date().toISOString(), envioId);
}

/**
 * Marca falha DEFINITIVA — destino malformado ou rejeicao que `conexao.enviar`
 * nao classificou como transporte. Retorno `undefined` por transporte caido
 * NAO chama esta funcao: ver `incrementarTentativaDeEnvio`.
 */
export function marcarEnvioFalhou(acervo: Acervo, envioId: string, motivo: string): void {
  acervo
    .preparar(`UPDATE envios SET estado = 'falhou', motivo_falha = ? WHERE id = ?`)
    .run(motivo, envioId);
}

/**
 * Soma uma tentativa SEM mudar o estado — o Envio continua `pendente`.
 * Chamado quando `conexao.enviar` devolve indeterminado (transporte caido ou
 * retorno sem key.id): a garantia e ao menos uma vez, e o risco de duplicata
 * e aceito; o que este contador evita e a fila travar atras do mesmo item.
 */
export function incrementarTentativaDeEnvio(acervo: Acervo, envioId: string): void {
  acervo.preparar(`UPDATE envios SET tentativas = tentativas + 1 WHERE id = ?`).run(envioId);
}

/**
 * Grava a Conversa resolvida/criada apos o envio ter sucesso, e apaga o
 * destino cru — a partir daqui o Envio sabe para onde foi sem reresolver.
 */
export function atualizarConversaDoEnvio(
  acervo: Acervo,
  envioId: string,
  conversaId: string,
): void {
  acervo
    .preparar(`UPDATE envios SET conversa_id = ?, destino_cru = NULL WHERE id = ?`)
    .run(conversaId, envioId);
}

export interface EnvioFalho {
  envioId: string;
  motivoFalha: string | null;
}

export function listarEnviosFalhos(acervo: Acervo): EnvioFalho[] {
  return (
    acervo
      .preparar(
        `SELECT id AS envioId, motivo_falha AS motivoFalha FROM envios WHERE estado = 'falhou'`,
      )
      .all() as { envioId: string; motivoFalha: string | null }[]
  ).map((l) => ({ envioId: l.envioId, motivoFalha: l.motivoFalha }));
}

/**
 * Volta todo Envio falho para pendente E ZERA tentativas — mesmo espirito de
 * `reenfileirarFalhas` (Transcricao) e `reprocessar-derrame`: estado de
 * falha e terminal ate este ato explicito.
 */
export function reenfileirarEnviosFalhos(acervo: Acervo): number {
  const falhas = listarEnviosFalhos(acervo);
  if (falhas.length === 0) return 0;
  emOperacao(acervo, { natureza: 'reprocessar-envio', reversibilidade: 'por-efeito' }, (op) => {
    for (const f of falhas) {
      acervo
        .preparar(
          `UPDATE envios SET estado = 'pendente', motivo_falha = NULL, tentativas = 0 WHERE id = ?`,
        )
        .run(f.envioId);
      op.valor({
        tabela: 'envios',
        chave: f.envioId,
        campo: 'estado',
        antes: 'falhou',
        depois: 'pendente',
      });
    }
  });
  return falhas.length;
}

export interface ContagemDeEnvio {
  estado: 'pendente' | 'enviado' | 'falhou';
  n: number;
}

const ESTADOS_DE_ENVIO = ['enviado', 'falhou', 'pendente'] as const;

/** O "sinal proprio" de `malote envio estado` — sempre os tres estados, zero quando nao ha. */
export function contarEnviosPorEstado(acervo: Acervo): ContagemDeEnvio[] {
  const linhas = acervo
    .preparar(`SELECT estado, COUNT(*) AS n FROM envios GROUP BY estado`)
    .all() as ContagemDeEnvio[];
  return ESTADOS_DE_ENVIO.map((estado) => ({
    estado,
    n: linhas.find((l) => l.estado === estado)?.n ?? 0,
  }));
}
