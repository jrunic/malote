// src/adaptadores/whatsapp/reenvio.ts
/**
 * A RESPOSTA AO PEDIDO DE REENVIO (#1420).
 *
 * Quando o aparelho de quem recebeu um Envio nao o decifra, a plataforma pede ao remetente que reenvie a MESMA
 * mensagem, com o mesmo identificador, e a biblioteca pergunta qual era a mensagem original. Sem resposta, nao ha
 * reenvio. Este modulo responde, em duas fontes e nesta ordem: a memoria do envio (exata, de vida curta) e, depois de
 * um reinicio, o Acervo, pelo leitor que o chamador injeta (o nucleo so devolve o registro de uma Mensagem cuja
 * Referencia Externa consta num Envio da Configuracao do ouvinte).
 *
 * Nao importa a biblioteca (o portao e `conexao.ts`): recebe o `proto` dela. Nunca lanca e nunca rejeita: uma
 * rejeicao aqui derrubaria o reenvio do recibo inteiro e viraria, na biblioteca, uma falha de reenvio que nao houve.
 * Nao tem temporizador: a leitura do Acervo e sincrona e, em WAL, nao espera escritor. Se mesmo assim o Acervo responder
 * ocupado, a leitura espera o `busy_timeout` da conexao (5 s) antes do `SQLITE_BUSY`, com o processo parado, dentro do
 * mutex do recibo da biblioteca; o erro vira `erro` e indisponivel.
 */

/** O gancho que liga a resposta. Ausente, o socket nasce como sempre nasceu. */
export interface GanchoDoReenvio {
  /** Le do Acervo o bruto da Mensagem enviada pela Referencia Externa; `undefined` se o malote nao a enviou. Sincrono. */
  lerDoAcervo: (referenciaExterna: string) => string | undefined;
  /** Conta e registra. Excecao daqui e engolida. */
  aoEvento: (evento: EventoDeReenvio) => void;
}

export type ResultadoDoPedidoDeReenvio = 'achada-na-memoria' | 'achada-no-acervo' | 'nao-achada' | 'erro';

export type EventoDeReenvio =
  | {
      tipo: 'pedido';
      resultado: ResultadoDoPedidoDeReenvio;
      idadeSegundos: number | undefined;
      enderecoDoRecibo: 'igual' | 'diferente' | 'desconhecido';
    }
  | { tipo: 'recibo-falhou' }
  | { tipo: 'recusa'; motivo: 'limite' | 'nao-propria' };

/** O pedaco do `proto` da biblioteca que a reconstituicao usa. */
export interface ProtoDoReenvio {
  Message: { fromObject: (objeto: Record<string, unknown>) => unknown };
}

/** A chave que a biblioteca passa a cada pergunta: uma por identificador do recibo. */
export interface ChaveDoPedidoDeReenvio {
  remoteJid?: string | null;
  id?: string | null;
}

interface EcoLocal {
  mensagem: unknown;
  endereco: string | undefined;
  instanteMs: number | undefined;
}

function objeto(valor: unknown): valor is Record<string, unknown> {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

function instanteEmMs(valor: unknown): number | undefined {
  const segundos = typeof valor === 'number' ? valor : typeof valor === 'string' && valor !== '' ? Number(valor) : NaN;
  return Number.isFinite(segundos) ? segundos * 1000 : undefined;
}

/**
 * So a FORMA DO ECO LOCAL e reconstituida: mensagem propria (`key.fromMe === true`) com a mensagem presente e objeto.
 * O bruto de outra porta (a recepcao da outra conta, que grava a forma recebida; o backup do aparelho, com colunas
 * proprias e sem `message`) devolve `undefined`. JSON invalido e `fromObject` que falha LANCAM: quem chama conta `erro`.
 */
function lerEcoLocal(proto: ProtoDoReenvio, bruto: string): EcoLocal | undefined {
  const registro: unknown = JSON.parse(bruto);
  if (!objeto(registro)) return undefined;
  const chave = registro['key'];
  const mensagem = registro['message'];
  if (!objeto(chave) || chave['fromMe'] !== true) return undefined;
  if (!objeto(mensagem)) return undefined;
  const endereco = chave['remoteJid'];
  return {
    // O INVERSO da serializacao da biblioteca: enum pelo nome, longo em texto e binario em base64 voltam ao tipo do
    // protobuf. `encode` direto do JSON perderia o enum (vira 0); por isso nunca se devolve o objeto lido.
    mensagem: proto.Message.fromObject(mensagem),
    endereco: typeof endereco === 'string' ? endereco : undefined,
    instanteMs: instanteEmMs(registro['messageTimestamp']),
  };
}

/** A mensagem do eco local reconstituida pelo inverso da biblioteca, ou `undefined` se o bruto tem outra forma. */
export function reconstituirMensagemDoEco(proto: ProtoDoReenvio, bruto: string): unknown {
  return lerEcoLocal(proto, bruto)?.mensagem;
}

/** A causa de uma falha SEM conteudo: so a classe e o codigo. A mensagem do erro de JSON traz trecho do registro. */
export function causaSemConteudo(erro: unknown): string {
  if (!(erro instanceof Error)) return typeof erro;
  const codigo = (erro as { code?: unknown }).code;
  return typeof codigo === 'string' ? `${erro.name} ${codigo}` : erro.name;
}
