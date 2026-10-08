import type { Acervo } from '../../nucleo/acervo.js';
import { emOperacao } from '../../nucleo/trilha.js';
import { ehBancoOcupado } from '../../nucleo/erro-de-banco.js';
import {
  aprenderCorrespondencia,
  resolverEndereco,
  CorrespondenciaEmConflitoError,
} from '../../nucleo/correspondencia.js';
import {
  anexoJaExiste,
  registrarAnexo,
  registrarConversa,
  registrarIdentificador,
  registrarMensagem,
  registrarParticipacao,
  registrarTransicao,
  registrarEtiqueta,
} from '../../nucleo/escrita.js';
import { lerMudancaDeEtiqueta, type MudancaDeEtiqueta } from './etiqueta-ao-vivo.js';
import { nomeRepeteONumeroBrasileiro } from './nome-repete-numero-br.js';
import { registrarNome } from '../../nucleo/identidade.js';
import { ehCifrada, naturezaDoStub, textoDoStub } from './stubs-ao-vivo.js';

/**
 * Recepcao ao vivo do WhatsApp: o evento vira escrita pelas portas do nucleo.
 *
 * O adaptador NAO abre banco, NAO decide identidade e NAO importa a biblioteca
 * de recepcao — ele recebe a mensagem ja decodificada. E o que permite testa-lo
 * sem socket, e o que mantem a biblioteca confinada ao processo que a usa.
 *
 * Ele traduz endereco, monta a entrada e chama a porta — a MESMA que a
 * importacao usa. E isso que faz os dois caminhos convergirem sem codigo de
 * convergencia.
 *
 * Toda decisao aqui cita a medicao de 02/09/2026, sobre 11h23 de captura contra
 * conta real.
 */

/** A forma da chave, medida na captura. */
export interface ChaveRecebida {
  remoteJid: string;
  id: string;
  fromMe: boolean;
  /** Endereco do autor numa Conversa coletiva, na forma que a Fonte escolher. */
  participant?: string;
  /** O MESMO autor na forma canonica. Presente em 364 de 370 casos. */
  participantPn?: string;
  /**
   * O companheiro da Conversa DIRETA: o canonico de quem `remoteJid` nomeia em
   * forma opaca. Campo distinto de `participantPn`, e a #775 nomeava so aquele.
   */
  senderPn?: string;
}

export interface MensagemRecebida {
  key: ChaveRecebida;
  messageTimestamp: number;
  pushName?: string;
  /**
   * O conteudo. Pode vir AUSENTE ou explicitamente NULO — a Fonte manda as
   * duas coisas, e elas nao sao a mesma. Medido em 04/09/2026 contra acervo
   * real de captura ao vivo: 99 eventos com conteudo nulo em 410.710, cerca de
   * 1 em 4.000. Declarar so `?` fazia o tipo mentir sobre o fio, e a guarda que
   * so testava `undefined` derrubava a recepcao.
   */
  message?: Record<string, unknown> | null;
  /** Tipo de evento administrativo. Chega como nome OU como numero. */
  messageStubType?: string | number;
  /** Os alvos do evento — enderecos, na forma que a Fonte escolher. */
  messageStubParameters?: string[];
}

/**
 * Um evento que a recepcao NAO gravou como Mensagem, com o porque.
 *
 * `motivo` e o mesmo rotulo que `ignorados` usa (o tipo do conteudo, `cifrada`,
 * `status`, os rotulos das Etiquetas), mais `recusado`; `protocolMessage` leva o
 * tipo do protocolo. `ruido` marca o que a recepcao sabe ser protocolo sem dado:
 * e CONTADO, nunca guardado.
 */
export interface EventoDescartado {
  motivo: string;
  /** So para `recusado`: a causa da recusa. Nunca texto de conversa. */
  causa?: string;
  ruido: boolean;
  evento: MensagemRecebida;
}

/**
 * O ruido de protocolo conhecido, num so lugar. Cifrada e reenviada decifrada pela
 * biblioteca (90 de 4.167 eventos, 02/09/2026); status e decisao do Titular (#1094);
 * distribuicao de chave SOZINHA nao tem dado (6.231 no Acervo real). Atencao: a
 * distribuicao de chave que ACOMPANHA conteudo nao chega aqui, e `tipoDeConteudo`.
 */
const MOTIVOS_DE_RUIDO: ReadonlySet<string> = new Set([
  'cifrada',
  'status',
  'senderKeyDistributionMessage',
]);

/**
 * O motivo de um tipo ignorado. `protocolMessage` esconde varias coisas
 * (revogacao, material de chave de estado, historico), e um balde so nao mede
 * nada: leva o `type` do protocolo, a mesma leitura que a Etiqueta ja faz. Os
 * demais tipos seguem pelo nome.
 */
function motivoDoTipo(tipo: string, message: Record<string, unknown> | null | undefined): string {
  if (tipo !== 'protocolMessage') return tipo;
  const protocolo = message?.['protocolMessage'];
  if (protocolo === null || typeof protocolo !== 'object') return tipo;
  const subtipo = (protocolo as Record<string, unknown>)['type'];
  return typeof subtipo === 'string' || typeof subtipo === 'number' ? `${tipo}:${String(subtipo)}` : tipo;
}

function descartar(
  relato: RelatoDeRecepcao,
  evento: MensagemRecebida,
  motivo: string,
  causa?: string,
): void {
  relato.descartados.push({
    motivo,
    ruido: MOTIVOS_DE_RUIDO.has(motivo),
    evento,
    ...(causa !== undefined ? { causa } : {}),
  });
}

export interface OpcoesDeRecepcao {
  agora: number;
  /**
   * A Configuracao da conta que este processo escuta. OBRIGATORIA: um ouvinte
   * escuta UMA conta, e sem ela a Conversa direta nao sabe de qual fio e.
   */
  configuracao: { id: string; fonte: 'whatsapp' };
}

export interface RelatoDeRecepcao {
  gravados: number;
  /** O que nao entrou, com a causa. Nunca silencio. */
  recusados: { idExterno: string; causa: string }[];
  /** Correspondencias que a Fonte contradisse. Achado, nao erro. */
  conflitos: { alternativo: string; gravado: string; novo: string }[];
  /** Tipos ignorados por nao serem Mensagem, contados por tipo. */
  ignorados: Record<string, number>;
  /**
   * Cada evento que NAO virou Mensagem (descartado ou recusado), com o motivo.
   * Nao inclui `parametro-sem-endereco`: la o evento ja e Mensagem.
   */
  descartados: EventoDescartado[];
  /** Transicoes de Participacao que NASCERAM nesta recepcao. */
  transicoes: number;
  /** Etiquetas de Participacao que NASCERAM nesta recepcao (nunca o texto delas). */
  etiquetas: number;
  /** Destas, as que sao REMOCAO (texto vazio). */
  etiquetasRemovidas: number;
  /**
   * Etiquetas da PROPRIA conta cujo endereco a Configuracao ainda nao conferiu:
   * contadas e NAO gravadas. O autor proprio chega em LID, e sem o Endereco da
   * Conta o LID nao resolve para o JID; gravar sob o LID criaria uma identidade
   * a parte para a propria conta.
   */
  etiquetasDaContaSemEndereco: number;
  /**
   * Nomes recusados por apenas repetirem o PROPRIO endereco.
   *
   * Contado aqui, e nao no relatorio de importacao, porque ao vivo nao ha
   * relatorio: sem este campo a recusa seria silenciosa no caminho continuo.
   */
  nomesQueRepetemOEndereco: number;
  /**
   * Vigilancia da fonte de correspondencia de endereco — a #775.
   *
   * O produto aprende a correspondencia entre as duas formas de endereco a
   * partir do campo que a Fonte manda JUNTO do evento. Se ela parar de mandar,
   * o aprendizado para e NADA acusa: o ouvinte nao trava, nao reinicia, nao
   * some do watchdog de silencio. So empobrece — e cada endereco novo visto so
   * na forma opaca vira uma identidade que nunca sera ligada a pessoa certa.
   *
   * SAO DUAS POPULACOES, e nao uma: `participantPn` acompanha a Conversa
   * coletiva e `senderPn` a direta. Medido em 12/09/2026 no Acervo de producao,
   * em setembro: 95,2% de par na coletiva contra 28,6% na direta. Somar as duas
   * diluiria a menor na maior e reproduziria a cegueira que esta contagem
   * existe para acabar.
   *
   * Contagem crua, sem juizo: quem compara com a linha de base e alarma e a
   * frota. Mesma fronteira do timer da varredura e do watchdog de silencio.
   */
  correspondencia: ContagemDeCorrespondencia;
  /**
   * Anexos que nasceram `nunca-obtido` NESTA passada, com o INDICE da
   * Mensagem de origem no lote de entrada (`mensagens`, no parametro desta
   * funcao) — nao um id externo.
   *
   * A #1068: quem baixa os bytes e o modulo de conexao, unico autorizado a
   * falar com a biblioteca — e ele so tem o lote CRU, por posicao, porque o
   * round-trip de JSON que normaliza a mensagem destroi o `mediaKey` binario
   * que o decrypt exige. O indice e o que liga as duas pontas sem o adaptador
   * conhecer a biblioteca.
   */
  anexosNuncaObtidos: { indice: number; anexoId: string; tipo: string }[];
}

export interface ContagemDeCorrespondencia {
  /** Eventos de Conversa coletiva cujo autor veio em forma opaca. */
  coletivaOpaca: number;
  /** Destes, quantos trouxeram o canonico junto. */
  coletivaComPar: number;
  /** Eventos de Conversa direta cujo endereco veio em forma opaca. */
  diretaOpaca: number;
  /** Destes, quantos trouxeram o canonico junto. */
  diretaComPar: number;
}

/**
 * A forma opaca do endereco. Substring nao serve: tem de ser o sufixo.
 */
function ehOpaco(endereco: string | undefined): boolean {
  return endereco !== undefined && endereco.endsWith('@lid');
}

const FONTE = 'whatsapp';

/**
 * Quais tipos de evento viram MENSAGEM no Acervo.
 *
 * Nem tudo que a plataforma entrega e mensagem. A captura mediu 42 de 288 como
 * `protocolMessage` — recibo, distribuicao de chave, edicao —, e o acervo do
 * produto anterior corretamente nao os guarda. Grava-los criaria Mensagens de
 * conteudo vazio que NENHUM outro caminho produz: o material exportado nunca as
 * tera, e a convergencia divergiria por construcao, medindo o defeito que o
 * proprio adaptador criou.
 *
 * Escolher o que vira Mensagem e semantica de Adaptador — a importacao tambem
 * escolhe, lendo linhas de mensagem real. Nao e recorte do Conteudo Bruto, que
 * continua preservado inteiro para o que entra.
 */
const VIRAM_MENSAGEM = new Set([
  'conversation',
  'extendedTextMessage',
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'stickerMessage',
  'documentMessage',
  'reactionMessage',
  'contactMessage',
  'locationMessage',
]);

/** Tipos de conteudo que carregam Anexo, medidos na captura. */
const COM_ANEXO = [
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'stickerMessage',
  'documentMessage',
];

/** O tipo principal do evento, ou `null` quando nao ha conteudo. */
/**
 * Chaves que ACOMPANHAM o conteudo e nunca sao o tipo principal.
 *
 * `senderKeyDistributionMessage` entrou em 04/09/2026, medido contra acervo
 * real de captura ao vivo numa janela de 4,5 meses: ela aparece em 174.490
 * eventos e **168.259 deles tem conteudo real junto** — 59.623 textos, 24.727
 * imagens, 14.602 videos. Ela vem PRIMEIRA no objeto em 165.096 dos casos, e a
 * classificacao devolvia a primeira chave: a Mensagem inteira era descartada em
 * silencio, no caminho ao vivo tambem.
 *
 * O criterio que separa decoracao de tipo e a razao entre acompanhando e
 * sozinha — 27 para 1 aqui. Chave que quase sempre viaja junto de outra nao e
 * o assunto da Mensagem.
 */
const ACOMPANHAM = new Set(['messageContextInfo', 'senderKeyDistributionMessage']);

/**
 * Desembrulha o documento com legenda: a plataforma o entrega como
 * `documentWithCaptionMessage.message.documentMessage`. Medido em 06/10/2026
 * (documento real de uma Conversa direta ausente do Acervo) e provado com o
 * evento sintético pela própria `receberEvento`.
 *
 * SO este embrulho. Os outros que a biblioteca desembrulha (`ephemeralMessage`,
 * `viewOnce*`, `editedMessage`) nao foram medidos contra captura real, e a
 * classificacao e medida, nunca deduzida: `editedMessage` e edicao de Mensagem
 * ja gravada, e tratá-lo como nova duplicaria. Seguem ignorados e contados. So
 * para classificar e ler texto/Anexo: o Conteudo Bruto grava o evento inteiro.
 */
function desembrulhar(
  message: Record<string, unknown> | undefined | null,
): Record<string, unknown> | undefined | null {
  const embrulho = message?.['documentWithCaptionMessage'];
  if (embrulho === null || typeof embrulho !== 'object') return message;
  const interna = (embrulho as Record<string, unknown>)['message'];
  if (interna === null || typeof interna !== 'object') return message;
  return interna as Record<string, unknown>;
}

function tipoDeConteudo(rotulada: Record<string, unknown> | undefined | null): string | null {
  // `== null` de proposito: apanha ausente E nulo de uma vez. A Fonte entrega
  // os dois, e tratar so um foi o defeito.
  const message = desembrulhar(rotulada);
  if (message == null) return null;
  const chaves = Object.keys(message);
  const principal = chaves.find((k) => !ACOMPANHAM.has(k));
  if (principal !== undefined) return principal;
  // So acompanhantes. Distribuicao de chave SOZINHA e evento de protocolo, nao
  // Mensagem — devolve-la faz a classificacao ignora-la, como ja fazia. Sao
  // 6.231 no mesmo acervo, e trata-los como conteudo vazio criaria seis mil
  // Mensagens sem nada dentro.
  if (chaves.includes('senderKeyDistributionMessage')) return 'senderKeyDistributionMessage';
  // `messageContextInfo` sozinho segue devolvendo nulo, exatamente como antes:
  // corrigir um defeito nao e hora de mudar o que ja estava decidido.
  return null;
}

function textoDe(rotulada: Record<string, unknown> | undefined | null): string | undefined {
  const message = desembrulhar(rotulada);
  if (message == null) return undefined;
  const direto = message['conversation'];
  if (typeof direto === 'string') return direto;
  const estendido = message['extendedTextMessage'];
  if (estendido !== null && typeof estendido === 'object') {
    const t = (estendido as Record<string, unknown>)['text'];
    if (typeof t === 'string') return t;
  }
  // A legenda do documento e o texto da Mensagem (so vem embrulhada).
  const documento = message['documentMessage'];
  if (documento !== null && typeof documento === 'object') {
    const legenda = (documento as Record<string, unknown>)['caption'];
    if (typeof legenda === 'string' && legenda !== '') return legenda;
  }
  return undefined;
}

/**
 * Se o endereco e de Conversa COLETIVA — grupo ou lista de transmissao.
 *
 * A REGRA NASCEU DE UMA DIVERGENCIA MEDIDA, e nao de gosto. Ate 08/09/2026 a
 * recepcao ao vivo decidia so por `@g.us`, e a importacao de material por
 * `ZSESSIONTYPE != 0` (material.ts). Os dois discordavam em broadcast e
 * status. Contra o Acervo real, com 1.429.620 Mensagens:
 *
 *   1.054 Conversas de broadcast/status marcadas COLETIVA (vieram da importacao)
 *      11 marcadas DIRETA           (vieram daqui)
 *
 * Enquanto o lookup ignorava a natureza, quem chegasse segundo encontrava a
 * linha do primeiro e a divergencia era inofensiva por acidente. Com a chave
 * por natureza, o mesmo endereco vira DUAS Conversas — e a guarda que impede
 * isso passou a BLOQUEAR a importacao da segunda conta. Foi assim que apareceu.
 *
 * SUPERADO em 29/09/2026 (#1094), so para o feed de status: o criterio 11a da
 * spec do #825 dizia que ele cai do lado compartilhado (coletiva). Decisao do
 * Titular: "status nao faz sentido em malote" — o mesmo feed que a #1069 ja
 * passou a descartar por completo no caminho de importacao. `enderecoEhColetivo`
 * NAO VE MAIS status — quem descarta o evento inteiro, antes de chegar aqui, e
 * `enderecoEhFeedDeStatus` no laco principal de `receberEvento`. Lista de
 * transmissao (`@broadcast`) nao e tocada pela reversao: tem Mensagem real
 * (29.035 medidas em #825/#826) e continua coletiva.
 */
export function enderecoEhColetivo(endereco: string): boolean {
  return endereco.endsWith('@g.us') || endereco.endsWith('@broadcast');
}

/**
 * O feed de Status/Stories de um contato — nunca chat de verdade.
 *
 * Duas formas conhecidas: `<numero>@status` (a que a importacao ja traz) e
 * `<lid>@lid.status` (a variante em LID, que `@status` sozinho nao casa). A
 * #1069 ja descarta esse feed na importacao (`material.ts`); esta funcao e o
 * espelho no caminho ao vivo — decisao do Titular em 29/09/2026, revertendo o
 * criterio 11a do #825.
 */
export function enderecoEhFeedDeStatus(endereco: string): boolean {
  return endereco.endsWith('@status') || endereco.endsWith('.status');
}

export function receberEvento(
  acervo: Acervo,
  mensagens: readonly MensagemRecebida[],
  opcoes: OpcoesDeRecepcao,
): RelatoDeRecepcao {
  const relato: RelatoDeRecepcao = {
    gravados: 0,
    recusados: [],
    conflitos: [],
    ignorados: {},
    descartados: [],
    transicoes: 0,
    etiquetas: 0,
    etiquetasRemovidas: 0,
    etiquetasDaContaSemEndereco: 0,
    nomesQueRepetemOEndereco: 0,
    correspondencia: {
      coletivaOpaca: 0,
      coletivaComPar: 0,
      diretaOpaca: 0,
      diretaComPar: 0,
    },
    anexosNuncaObtidos: [],
  };

  // Conta ANTES de qualquer escrita, e sobre o lote INTEIRO: o que se mede aqui
  // e o que a FONTE entregou, nao o que o Acervo aceitou. Evento recusado, ou
  // derramado por Acervo ocupado, continua sendo evidencia de que a fonte da
  // correspondencia esta viva — e contar depois da gravacao faria a metrica
  // cair junto com a disponibilidade da base, medindo outra coisa.
  for (const m of mensagens) {
    if (ehOpaco(m.key.participant)) {
      relato.correspondencia.coletivaOpaca += 1;
      if (m.key.participantPn !== undefined) relato.correspondencia.coletivaComPar += 1;
    } else if (ehOpaco(m.key.remoteJid)) {
      relato.correspondencia.diretaOpaca += 1;
      if (m.key.senderPn !== undefined) relato.correspondencia.diretaComPar += 1;
    }
  }

  // PRIMEIRA PASSADA: aprende TODAS as correspondencias do lote, antes que
  // qualquer endereco seja escrito.
  //
  // A ordem nao e livre, e a Restricao do repositorio ja dizia por que: quem
  // aprende correspondencia tem de aprende-la ANTES do laco que escreve
  // endereco. A ordem do lote e da Fonte, nao nossa — o evento que move uma
  // pessoa pode chegar antes da mensagem que revela as duas formas do endereco
  // dela. Aprendendo dentro do laco, aquele evento grava a forma alternativa; e
  // ao reprocessar o mesmo lote, ele resolve para a canonica e nasce uma
  // SEGUNDA linha para o mesmo fato.
  //
  // Medido em 02/09/2026 contra a captura real, sobre 1.018.130 Mensagens: a
  // segunda passagem criou 10 Transicoes novas, e as 10 eram exatamente os
  // pares em que a mesma pessoa aparecia nas duas formas sob o mesmo evento.
  // A Mensagem nao sofria — a chave de conflito dela nao inclui o autor.
  //
  // Isto NAO resolve o caso entre lotes: evento recebido as 10h com endereco
  // ainda desconhecido continua gravado na forma alternativa quando a
  // correspondencia chega as 11h. Essa e a resolucao retroativa, que e do ciclo
  // 12, e `conferirTransicoesRepetidas` a mede.
  //
  //    UMA Operacao para o lote inteiro, e nao uma por par: aprender endereco e
  //    ingestao, como a recepcao, e um ouvinte que roda por meses geraria uma
  //    Operacao por pessoa vista de outra forma.
  //
  //    O envelope so abre se houver o que aprender. A forma do lote no aceite
  //    NAO e a forma do lote em producao: la a porta e chamada uma vez com
  //    milhares de mensagens, e ao vivo ela e chamada por evento, quase sempre
  //    com uma. Abrindo ansiosamente, cada mensagem recebida geraria DUAS
  //    Operacoes — a do evento e uma de aprendizado vazia, porque so Conversa
  //    coletiva traz o par. Num ouvinte que roda por meses, isso dobra a trilha
  //    com lixo, que e o que este envelope existe para evitar.
  const comPar = mensagens.filter(
    (m) => m.key.participant !== undefined && m.key.participantPn !== undefined,
  );
  if (comPar.length > 0) {
    emOperacao(
      acervo,
      {
        natureza: 'aprender-endereco-ao-vivo',
        reversibilidade: 'irreversivel',
        registraEfeito: false,
      },
      () => {
        for (const m of comPar) {
          try {
            aprenderCorrespondencia(acervo, {
              fonte: FONTE,
              alternativo: m.key.participant as string,
              canonico: m.key.participantPn as string,
            });
          } catch (erro) {
            if (!(erro instanceof CorrespondenciaEmConflitoError)) throw erro;
            relato.conflitos.push({
              alternativo: erro.alternativo,
              gravado: erro.gravado,
              novo: erro.novo,
            });
          }
        }
      },
    );
  }

  for (const [indice, m] of mensagens.entries()) {
    // Cifrada nao vira Mensagem: gravar o envelope vazio travaria o
    // identificador contra quem souber preencher depois. `registrarMensagem` e
    // primeiro escritor vence — o backup que trouxesse a MESMA mensagem
    // decifrada seria descartado como ja existente. Medido em 02/09/2026: 90
    // dos 4.167 eventos de 11h23 de captura.
    if (ehCifrada(m.messageStubType)) {
      relato.ignorados['cifrada'] = (relato.ignorados['cifrada'] ?? 0) + 1;
      descartar(relato, m, 'cifrada');
      continue;
    }

    // Feed de Status/Stories nao e chat de verdade — #1094, espelhando a
    // #1069 que ja descarta o mesmo feed na importacao. Descartado ANTES de
    // resolver endereco ou abrir Operacao: nenhuma Conversa, nenhuma
    // Mensagem, para nenhuma das duas formas conhecidas.
    if (enderecoEhFeedDeStatus(m.key.remoteJid)) {
      relato.ignorados['status'] = (relato.ignorados['status'] ?? 0) + 1;
      descartar(relato, m, 'status');
      continue;
    }

    // A Etiqueta de Participacao e um ramo PROPRIO e vem ANTES do descarte por tipo:
    // ela chega como protocolMessage, que o descarte abaixo ignora e conta.
    // Decide LENDO (sem Operacao) e so abre a Operacao se for gravar, como o
    // resto da recepcao faz por evento.
    const mudanca = lerMudancaDeEtiqueta(m);
    let aGravar: EtiquetaDecidida | null = null;
    if (mudanca !== null) {
      // Dentro de try, como o resto da recepcao: falha de leitura que nao e banco ocupado vira
      // `recusado` e nao derruba o lote (banco ocupado sobe, para o derrame).
      try {
        aGravar = decidirEtiqueta(acervo, m, relato);
      } catch (erro) {
        if (ehBancoOcupado(erro)) throw erro;
        relato.recusados.push({ idExterno: m.key.id, causa: String(erro) });
        descartar(relato, m, 'recusado', String(erro));
        continue;
      }
      if (aGravar === null) continue;
    }

    const tipo = tipoDeConteudo(m.message);
    if (mudanca === null && tipo !== null && !VIRAM_MENSAGEM.has(tipo)) {
      relato.ignorados[tipo] = (relato.ignorados[tipo] ?? 0) + 1;
      descartar(relato, m, motivoDoTipo(tipo, m.message));
      continue;
    }

    try {
      // UMA Operacao por evento, com o efeito desligado.
      //
      // `registrarNome` abre Operacao por conta propria, INCONDICIONALMENTE —
      // medido em 01/09/2026, ele envolve ate o caso em que nao escreve nada.
      // Sem este envelope, um ouvinte que roda por meses gera uma Operacao por
      // nome visto. A reentrancia junta tudo numa so, e o efeito fica desligado
      // porque recepcao e INGESTAO, nao decisao — a classificacao do ciclo 8.
      //
      // A transacao vem junto, e e ela que cumpre "cada evento e gravado por
      // inteiro ou nao e gravado".
      emOperacao(
        acervo,
        { natureza: 'receber-ao-vivo', reversibilidade: 'irreversivel', registraEfeito: false },
        () =>
          mudanca !== null && aGravar !== null
            ? gravarEtiqueta(acervo, m, mudanca, aGravar, relato)
            : gravarUma(acervo, m, indice, opcoes, relato),
      );
    } catch (erro) {
      // O catch e POR EVENTO, e sem ele o adaptador PERDE mensagem.
      //
      // Duas portas lancam de dentro da transacao: a correspondencia recusa
      // conflito, e a Mensagem recusa instante implausivel. Sem catch, um par
      // conflitante ou um instante torto desfaz a transacao E propaga — o
      // evento se perde e o processo cai. A recusa nas portas esta certa; o que
      // faltava era o adaptador ter politica.
      //
      // Instante implausivel se DESCARTA COM CONTAGEM: e o destino que a tarefa
      // #606 fixou para a importacao, e o mesmo vale aqui.
      //
      // DISPUTA DE ESCRITA NAO E RECUSA, E SOBE. Medido em 08/09/2026: com a
      // conversao rodando, este catch transformava `SQLITE_BUSY` numa linha de
      // `recusados` — a Mensagem se PERDIA em silencio, contada como se a
      // Fonte tivesse mandado dado ruim. Recusa e sobre DADO que o modelo nao
      // aceita; banco ocupado e infraestrutura, e a resposta certa e tentar
      // de novo depois. Quem trata e a camada de comando, que derrama o evento
      // em arquivo. Tarefa #824.
      if (ehBancoOcupado(erro)) throw erro;
      relato.recusados.push({ idExterno: m.key.id, causa: String(erro) });
      descartar(relato, m, 'recusado', String(erro));
    }
  }

  return relato;
}

function gravarUma(
  acervo: Acervo,
  m: MensagemRecebida,
  indice: number,
  opcoes: OpcoesDeRecepcao,
  relato: RelatoDeRecepcao,
): void {
  // 1. A correspondencia JA foi aprendida, na passada anterior sobre o lote
  //    inteiro. As duas formas chegam na mesma chave em 364 de 370 casos, e
  //    essa e a unica fonte que o produto tem.
  //
  //    Conflito nao aborta o evento: a primeira correspondencia permanece, o
  //    achado e relatado, e a Mensagem entra assim mesmo. Perder o que chegou
  //    seria pior que ter uma duvida registrada.

  // 2. A Conversa: o endereco e traduzido para a forma canonica ANTES de virar
  //    `id_externo`. E o que faz a Conversa recebida encontrar a que a
  //    importacao criou, em vez de nascer duplicada.
  const enderecoDaConversa = resolverEndereco(acervo, FONTE, m.key.remoteJid);
  const coletiva = enderecoEhColetivo(enderecoDaConversa);
  const conversaId = registrarConversa(acervo, {
    fonte: FONTE,
    idExterno: enderecoDaConversa,
    coletiva,
    // Condicional: a porta RECUSA coletiva com Configuracao, porque o grupo e
    // um so para todas as contas do Inquilino.
    ...(coletiva ? {} : { configuracao: opcoes.configuracao }),
    bruto: JSON.stringify(m.key),
  });

  // 3. O autor. Em coletiva vem na chave; em direta e a propria Conversa.
  //    Sempre a forma CANONICA E INTEIRA — medido em 02/09/2026, 5.027 dos
  //    5.171 Identificadores do acervo guardam o endereco completo, e 53,7% dos
  //    enderecos vistos ao vivo ja existiam la por essa forma. Cortar em
  //    digitos, ou gravar a forma nova, criaria uma segunda identidade para
  //    quem ja esta no acervo.
  //
  //    Enviada pelo Titular nao tem autor externo: o endereco da Conversa e o
  //    do OUTRO lado, e usa-lo diria que o outro escreveu o que o Titular
  //    escreveu.
  const enderecoDoAutor = m.key.fromMe
    ? undefined
    : resolverEndereco(acervo, FONTE, m.key.participant ?? m.key.remoteJid);

  let autorId: string | undefined;
  if (enderecoDoAutor !== undefined && !enderecoDoAutor.endsWith('@broadcast')) {
    const { id } = registrarIdentificador(acervo, { fonte: FONTE, valor: enderecoDoAutor });
    autorId = id;
    registrarParticipacao(acervo, {
      conversaId,
      identificadorId: id,
      observadaEm: new Date(opcoes.agora).toISOString(),
    });
    // O nome que a Fonte declara. A tarefa #734 mediu 715.946 linhas com este
    // campo no material exportado; ao vivo ele vem no mesmo lugar.
    if (m.pushName !== undefined && m.pushName !== '') {
      if (nomeRepeteONumeroBrasileiro(m.pushName, enderecoDoAutor)) {
        relato.nomesQueRepetemOEndereco += 1;
      } else {
        // `terceiro`: e o nome que o REMETENTE escolheu para si, nao o que o
        // Titular cadastrou. Medido em 12/09/2026: em 154 enderecos do Acervo
        // real este nome vencia o nome de agenda so por chegar mais tarde.
        registrarNome(acervo, {
          identificadorId: id,
          origem: FONTE,
          nome: m.pushName,
          autoridade: 'terceiro',
        });
      }
    }
  }

  // 4. A Mensagem.
  const texto = textoDe(m.message);
  const mensagemId = registrarMensagem(acervo, {
    conversaId,
    fonte: FONTE,
    idExterno: m.key.id,
    ocorridaEm: m.messageTimestamp * 1000,
    agora: opcoes.agora,
    bruto: JSON.stringify(m),
    direcao: m.key.fromMe ? 'enviada' : 'recebida',
    ...(autorId !== undefined ? { autorId } : {}),
    ...(texto !== undefined ? { conteudo: texto } : {}),
  });
  relato.gravados += 1;

  // 5. O Anexo nasce `nunca-obtido`, como na importacao. Ao vivo a plataforma
  //    entrega referencia de download — 54 em 288 —, e e ela que o comando de
  //    trazer midia vai usar. O bruto guarda a referencia inteira.
  //    A Mensagem e idempotente por (fonte, id_externo) e devolve o id que ja
  //    existe; o Anexo nao tem restricao de unicidade. Sem esta conferencia, o
  //    MESMO evento passando de novo (reentrega offline, lote drenado do
  //    derrame, `ouvinte reprocessar`, reprocessar a guarda) gravava mais um
  //    Anexo `nunca-obtido` e pedia outro download — medido em 07/10/2026 (#1186):
  //    1 Mensagem, 2 Anexos. A importacao ja se protege com `anexoJaExiste`.
  //    Mensagem que ja tem Anexo (inclusive o `presente` que veio por backup)
  //    nao ganha outro; a que existia sem nenhum ganha o da reentrega.
  const tiposComAnexo = anexoJaExiste(acervo, mensagemId) ? [] : COM_ANEXO;
  for (const tipo of tiposComAnexo) {
    const conteudo = desembrulhar(m.message)?.[tipo];
    if (conteudo === undefined || conteudo === null) continue;
    const tipoDoAnexo = tipo.replace('Message', '');
    // `seconds` é o campo que audioMessage/videoMessage declaram — a mesma
    // chave que o motor de Transcrição já lê do bruto gravado aqui. Extraído
    // na recepção, não depois: `bruto` grava o conteúdo normalizado por JSON
    // round-trip (ver MidiaAoVivo.baixar), e o valor já está disponível sem
    // custo extra.
    const segundos =
      typeof conteudo === 'object' &&
      conteudo !== null &&
      typeof (conteudo as Record<string, unknown>)['seconds'] === 'number'
        ? ((conteudo as Record<string, unknown>)['seconds'] as number)
        : undefined;
    const anexoId = registrarAnexo(acervo, {
      mensagemId,
      tipo: tipoDoAnexo,
      presenca: 'nunca-obtido',
      bruto: JSON.stringify(conteudo),
      ...(segundos !== undefined ? { duracao: segundos } : {}),
    });
    // A #1068: quem baixa os bytes precisa saber ONDE, no lote CRU, esta esta
    // mensagem — ver o comentario de `anexosNuncaObtidos`.
    relato.anexosNuncaObtidos.push({ indice, anexoId, tipo: tipoDoAnexo });
  }

  // 6. A Transicao de Participacao, quando a Fonte declara o evento.
  //
  //    Ela entra pelo fluxo de MENSAGENS, e nao pelo fluxo de participacao de
  //    grupo. Medido em 02/09/2026: `group-participants.update` traz
  //    `{action, author, id, participants}` e NAO traz instante nem
  //    identificador de evento — os dois que `registrarTransicao` exige e se
  //    recusa a derivar. Os mesmos 34 eventos chegam aqui com `key.id` e
  //    `messageTimestamp`. Assinar os dois fluxos duplicaria.
  const natureza = naturezaDoStub(m.messageStubType);
  if (natureza === null) return;

  for (const alvo of m.messageStubParameters ?? []) {
    // Parametro nem sempre e endereco. Contar o que nao e mostra a mudanca de
    // forma no dia em que ela acontecer; descartar em silencio, nao.
    if (!alvo.includes('@')) {
      relato.ignorados['parametro-sem-endereco'] =
        (relato.ignorados['parametro-sem-endereco'] ?? 0) + 1;
      continue;
    }
    const enderecoDoMembro = resolverEndereco(acervo, FONTE, alvo);
    const { id } = registrarIdentificador(acervo, { fonte: FONTE, valor: enderecoDoMembro });
    const nasceu = registrarTransicao(acervo, {
      conversaId,
      identificadorId: id,
      natureza,
      ocorridaEm: m.messageTimestamp * 1000,
      fonte: FONTE,
      // O identificador que a Fonte da, sem derivacao. Ele NAO coincide com o
      // que o material exportado grava para o mesmo evento — medido em
      // 02/09/2026: 10.569 de 10.569 ids de evento no material tem 20
      // caracteres maiusculos, e os 34 da captura tem 9 ou 10 minusculos. A
      // ponte que decidiria a questao nao e mensuravel (3 eventos de
      // sobreposicao), entao o produto MEDE a duplicacao em vez de prometer
      // que ela nao existe: ver `conferirTransicoes`.
      idExterno: m.key.id,
      codigoDaFonte: textoDoStub(m.messageStubType) ?? '',
    });
    if (nasceu) relato.transicoes += 1;
  }
}

interface EtiquetaDecidida {
  enderecoDaConversa: string;
  enderecoDoMembro: string;
}

/**
 * Decide, SO LENDO, se a etiqueta se grava: conta o que descarta e devolve
 * `null`. Quem decide fora da Operacao evita abrir uma Operacao vazia por
 * evento descartado.
 */
function decidirEtiqueta(
  acervo: Acervo,
  m: MensagemRecebida,
  relato: RelatoDeRecepcao,
): EtiquetaDecidida | null {
  const enderecoDaConversa = resolverEndereco(acervo, FONTE, m.key.remoteJid);
  if (!enderecoEhColetivo(enderecoDaConversa)) {
    relato.ignorados['etiqueta-fora-de-coletiva'] = (relato.ignorados['etiqueta-fora-de-coletiva'] ?? 0) + 1;
    descartar(relato, m, 'etiqueta-fora-de-coletiva');
    return null;
  }
  if (m.key.participant === undefined) {
    relato.ignorados['etiqueta-sem-autor'] = (relato.ignorados['etiqueta-sem-autor'] ?? 0) + 1;
    descartar(relato, m, 'etiqueta-sem-autor');
    return null;
  }
  const enderecoDoMembro = resolverEndereco(acervo, FONTE, m.key.participant);
  // O autor PROPRIO chega em LID, sem telefone. So grava se o Acervo ja sabe
  // quem esse LID e (o Endereco da Conta, conferido pela Configuracao).
  if (m.key.fromMe && ehOpaco(enderecoDoMembro)) {
    relato.etiquetasDaContaSemEndereco += 1;
    descartar(relato, m, 'etiqueta-da-conta-sem-endereco');
    return null;
  }
  return { enderecoDaConversa, enderecoDoMembro };
}

function gravarEtiqueta(
  acervo: Acervo,
  m: MensagemRecebida,
  mudanca: MudancaDeEtiqueta,
  alvo: EtiquetaDecidida,
  relato: RelatoDeRecepcao,
): void {
  const conversaId = registrarConversa(acervo, {
    fonte: FONTE,
    idExterno: alvo.enderecoDaConversa,
    coletiva: true,
    bruto: JSON.stringify(m.key),
  });
  const { id } = registrarIdentificador(acervo, { fonte: FONTE, valor: alvo.enderecoDoMembro });
  const nasceu = registrarEtiqueta(acervo, {
    conversaId,
    identificadorId: id,
    texto: mudanca.texto,
    ocorridaEm: mudanca.instante,
    fonte: FONTE,
    // O id da Mensagem de protocolo que carrega o evento: unico por evento e
    // estavel na reentrega.
    idExterno: m.key.id,
    bruto: mudanca.bruto,
  });
  // Conta pelo RETORNO da porta, nunca por chamada.
  if (nasceu) {
    relato.etiquetas += 1;
    if (mudanca.texto === '') relato.etiquetasRemovidas += 1;
  }
}
