import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { MensagemRecebida } from './ao-vivo.js';

/**
 * A conexao ao vivo do WhatsApp.
 *
 * Este e o UNICO arquivo do repositorio que importa a biblioteca de recepcao, e
 * o import e DINAMICO. Estatico carregaria os 120 pacotes da arvore em todo
 * comando — `malote conversas` incluso — e faria o produto inteiro parar de
 * subir no dia em que ela quebrar, contra o criterio 19 da spec, que exige que
 * importar e consultar nao dependam do ouvinte.
 *
 * Ele nao decide identidade, nao abre banco e nao interpreta conteudo: entrega
 * o que chega ao adaptador puro, que e quem sabe traduzir.
 */

interface ConexaoAtualizada {
  connection?: string;
  lastDisconnect?: { error?: { output?: { statusCode?: number } } };
}

interface Socket {
  ev: { on: (fluxo: string, ouvinte: (dado: never) => void) => void };
  requestPairingCode: (numero: string) => Promise<string>;
}

interface Biblioteca {
  default: (config: { auth: unknown }) => Socket;
  useMultiFileAuthState: (pasta: string) => Promise<{ state: unknown; saveCreds: () => void }>;
  DisconnectReason: { loggedOut: number };
}

export interface OpcoesDeConexao {
  /** Pasta do vinculo do dispositivo. E CREDENCIAL: quem a tem fala pela conta. */
  pastaDoVinculo: string;
  /** So digitos, com codigo do pais. Necessario apenas no primeiro pareamento. */
  numero?: string | undefined;
  aoReceber: (mensagens: MensagemRecebida[]) => void;
  registrar: (linha: string) => void;
  /**
   * Chamado quando a conexao termina para NAO voltar — hoje, so no caso de
   * vinculo invalidado. E a terceira ponta da interface, e sem ela o processo
   * fica pendurado: o modulo nao pode chamar `process.exit`, entao precisa
   * dizer a quem o chamou que acabou.
   */
  aoTerminar: (motivo: string) => void;
  /** Injetavel para teste. Por padrao, o import dinamico da biblioteca. */
  carregarBiblioteca?: () => Promise<unknown>;
  /**
   * Gancho de captura DIAGNOSTICA, com valor. Ausente em producao — e o
   * default, e e o que roda. Ver `src/cli/captura-de-retrato.ts`.
   *
   * Existe porque a Autoridade do nome que chega no Retrato nao se decide por
   * forma: o evento que traz `name` nao traz `notify`, entao o resumo do log
   * compara com um campo ausente e devolve zero por vacuidade.
   */
  capturar?: (fluxo: string, dado: unknown) => void;
  /**
   * Resumo ESTRUTURADO de cada evento de app-state observado — forma, nunca
   * valor. Diferente de `capturar`, este fica LIGADO em producao: e por ele
   * que o instante do ultimo Retrato de Estado e anotado.
   */
  aoObservar?: (fluxo: string, resumo: ResumoDeAppState) => void;
  /**
   * Dado CRU do evento de app-state, para gravar no Acervo. Try proprio:
   * estourar aqui nao pode custar Mensagem.
   */
  aoEstado?: (fluxo: string, dado: unknown, resumo: ResumoDeAppState) => void;
}

export interface Conexao {
  /** Encerra sem religar. Idempotente. */
  parar: () => void;
}

/**
 * Fluxos de app-state que o ouvinte OBSERVA sem escrever.
 *
 * Sao os que carregam favorito, fixacao, arquivado e o nome de agenda. Ficam
 * numa constante e nao espalhados pelo codigo porque a guarda os confere um a
 * um: assinatura que sai da lista sem sair da guarda e assinatura que ninguem
 * percebe que sumiu.
 */
const FLUXOS_DE_APP_STATE = [
  'contacts.upsert',
  'contacts.update',
  'chats.upsert',
  'chats.update',
  'messages.update',
  // A SEGUNDA fonte possivel de Retrato de Estado, e ate 13/09/2026 ela nunca
  // foi assinada — entao "nao chega" nunca foi medido, so nao observado. A
  // biblioteca a usa para entregar `chats`, `contacts` e `messages` de uma vez
  // na sincronizacao inicial.
  'messaging-history.set',
] as const;

/**
 * FORMA, nunca valor. O log de um servico e um arquivo em disco, e nome,
 * telefone e texto de conversa nao entram nele. O que interessa para decidir e
 * quais chaves chegam — e, no caso do nome, se `name` difere de `notify`, que
 * foi o oraculo que separou nome de agenda de pushName no material.
 */
export interface ResumoDeAppState {
  itens: number;
  chaves: string[];
  comNome: number;
  nomeDifereDoPush: number;
}

function resumoDeAppState(dado: unknown): ResumoDeAppState {
  const lista = Array.isArray(dado) ? dado : [dado];
  const chaves = new Set<string>();
  let comNome = 0;
  let nomeDifereDoPush = 0;
  for (const item of lista) {
    if (item === null || typeof item !== 'object') continue;
    const registro = item as Record<string, unknown>;
    for (const k of Object.keys(registro)) chaves.add(k);
    const nome = registro['name'];
    const push = registro['notify'];
    if (typeof nome === 'string' && nome.length > 0) {
      comNome += 1;
      if (typeof push === 'string' && nome !== push) nomeDifereDoPush += 1;
    }
    const atualizacao = registro['update'];
    if (atualizacao !== null && typeof atualizacao === 'object') {
      for (const k of Object.keys(atualizacao)) chaves.add(`update.${k}`);
    }
  }
  return {
    itens: lista.length,
    chaves: [...chaves].sort(),
    comNome,
    nomeDifereDoPush,
  };
}

/** Primeira espera da religacao, em milissegundos. */
const ESPERA_INICIAL = 5_000;
/** Teto da espera. Acima disso, insistir mais rapido nao ajuda e chama atencao. */
const ESPERA_MAXIMA = 300_000;

export async function conectar(opcoes: OpcoesDeConexao): Promise<Conexao> {
  const carregar = opcoes.carregarBiblioteca ?? ((): Promise<unknown> => import('baileys'));
  const lib = (await carregar()) as Biblioteca;

  const { state, saveCreds } = await lib.useMultiFileAuthState(opcoes.pastaDoVinculo);
  const jaVinculado = existsSync(join(opcoes.pastaDoVinculo, 'creds.json'));

  let parado = false;
  let espera = ESPERA_INICIAL;
  let codigoPedido = false;
  let agendado: NodeJS.Timeout | undefined;

  const abrir = (): void => {
    if (parado) return;
    const sock = lib.default({ auth: state });
    sock.ev.on('creds.update', saveCreds as (dado: never) => void);

    sock.ev.on('messages.upsert', ((dado: { messages?: unknown[] }) => {
      // NORMALIZACAO POR IDA E VOLTA DE JSON, e ela nao e cosmetica.
      //
      // Tudo que validou o adaptador puro passou por serializacao: a captura
      // virou JSONL e voltou. O objeto CRU da biblioteca traz numero longo como
      // objeto e binario como vetor de bytes — `messageTimestamp * 1000` daria
      // NaN, e o Conteudo Bruto sairia com outra cara. Passar pela mesma forma
      // contra a qual a convergencia foi medida e o que faz a medicao valer
      // para o que roda de verdade.
      const normalizadas = JSON.parse(JSON.stringify(dado.messages ?? [])) as MensagemRecebida[];
      if (normalizadas.length > 0) opcoes.aoReceber(normalizadas);
    }) as (dado: never) => void);

    if (!jaVinculado && !codigoPedido && opcoes.numero !== undefined) {
      const numero = opcoes.numero;
      codigoPedido = true;
      void (async (): Promise<void> => {
        try {
          // O codigo e pedido UMA VEZ na vida do processo, e a trava vive FORA
          // de `abrir`: dentro, ela nasceria nova a cada religacao, e pedir de
          // novo num socket que esta fechando estoura 428 e mata o processo —
          // foi o que aconteceu no primeiro pareamento real, em 01/09/2026,
          // com o codigo ja impresso na tela.
          await new Promise((r) => setTimeout(r, 3_000));
          const codigo = await sock.requestPairingCode(numero);
          opcoes.registrar(`codigo de pareamento: ${codigo.slice(0, 4)} ${codigo.slice(4)}`);
          opcoes.registrar('no aparelho: Dispositivos vinculados > Vincular com numero.');
          opcoes.registrar('a conexao vai cair e religar sozinha — e esperado.');
        } catch (erro) {
          // Sem este catch a rejeicao nao tratada derruba o processo.
          codigoPedido = false;
          opcoes.registrar(`falhou ao pedir o codigo: ${String(erro)}`);
          opcoes.registrar('a religacao seguinte tenta de novo.');
        }
      })();
    }

    // === APP-STATE: so observa, nao escreve ===
    //
    // Favorito, fixacao, arquivado e o NOME QUE O DONO DA CONTA CADASTROU nao
    // viajam na Mensagem — medido em 07/09/2026: `pushName` aparece em 415.171
    // payloads capturados, nome de agenda em NENHUM. Eles vem pela camada de
    // app-state, e ate aqui o ouvinte assinava tres fluxos, nenhum deles dela.
    //
    // Nada disto entra no Acervo. Primeiro se descobre O QUE chega neste
    // vinculo, depois se decide o que vale modelar — e a decisao muda com o
    // dado: um vinculo recem-pareado chegou a 251 chaves de app-state em
    // minutos, enquanto outro, criado para medir, ficou em UMA por tres horas.
    for (const fluxo of FLUXOS_DE_APP_STATE) {
      sock.ev.on(fluxo, ((dado: unknown) => {
        // O emissor NAO protege: excecao dentro do handler derruba o processo,
        // e o processo aqui e a captura. Observacao nunca pode custar Mensagem.
        try {
          const resumo = resumoDeAppState(dado);
          opcoes.registrar(`[app-state] ${fluxo} ${JSON.stringify(resumo)}`);
          // O resumo sai ESTRUTURADO para quem quiser decidir sobre ele. Sem
          // isto, quem precisasse classificar o evento teria de reparsear a
          // linha do log — que e formato de leitura humana, nao contrato.
          opcoes.aoObservar?.(fluxo, resumo);
          try {
            opcoes.aoEstado?.(fluxo, dado, resumo);
          } catch {
            opcoes.registrar(`[app-state] ${fluxo} (falhou ao processar estado)`);
          }
        } catch {
          opcoes.registrar(`[app-state] ${fluxo} (falhou ao resumir)`);
        }
        // A captura vem DEPOIS do resumo e num try PROPRIO: no mesmo try, uma
        // falha ao resumir pularia a captura, e e ela que carrega o valor que
        // a medicao precisa. Estourar aqui tambem nao pode custar Mensagem.
        try {
          opcoes.capturar?.(fluxo, dado);
        } catch {
          opcoes.registrar(`[app-state] ${fluxo} (falhou ao capturar)`);
        }
      }) as (dado: never) => void);
    }

    sock.ev.on('connection.update', ((u: ConexaoAtualizada) => {
      if (u.connection === 'open') {
        // A espera se reseta AQUI, e nao a cada tentativa: religacao que
        // conecta e cai em seguida nao pode voltar a insistir de 5 em 5s.
        espera = ESPERA_INICIAL;
        opcoes.registrar('conectado.');
        return;
      }
      if (u.connection !== 'close' || parado) return;

      const codigo = u.lastDisconnect?.error?.output?.statusCode;
      if (codigo === lib.DisconnectReason.loggedOut) {
        // O vinculo obsoleto sai da frente por MOVIMENTO, nunca por remocao:
        // se algum dia esta deteccao estiver errada, o que foi movido volta.
        // Medido em 01/09/2026: `creds.registered` fica true com o servidor
        // dizendo deslogado, e quem confia nesse campo nunca mais pede codigo.
        const obsoleto = `${opcoes.pastaDoVinculo}-obsoleto-${new Date().toISOString()}`;
        try {
          renameSync(opcoes.pastaDoVinculo, obsoleto);
          opcoes.registrar(`DESLOGADO. O vinculo foi movido para ${obsoleto}`);
        } catch {
          opcoes.registrar('DESLOGADO, e nao consegui mover o vinculo.');
        }
        parado = true;
        opcoes.registrar('pareie de novo para voltar a receber.');
        // Avisa quem chamou. Sem isto, quem chamou fica preso esperando um
        // sinal que nao vem, e o supervisor ve "no ar" um processo com o socket
        // morto — o pior dos desfechos, porque o verificador de fora demora um
        // ciclo inteiro para notar o que o processo ja sabe.
        opcoes.aoTerminar('vinculo invalidado pela plataforma');
        return;
      }

      opcoes.registrar(`conexao caiu (${codigo ?? '—'}); religando em ${espera / 1000}s`);
      agendado = setTimeout(abrir, espera);
      espera = Math.min(espera * 2, ESPERA_MAXIMA);
    }) as (dado: never) => void);
  };

  abrir();

  return {
    parar: (): void => {
      parado = true;
      if (agendado !== undefined) clearTimeout(agendado);
    },
  };
}
